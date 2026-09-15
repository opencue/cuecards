/** Cooperative live adoption: no keystroke injection, harness spawn or hook reload. */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const BADGE_OPTION = "@cue_firstmate_badge";
const BORDER_PREFIX = `#{E:${BADGE_OPTION}}`;
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

function command(bin: string, args: string[]): string {
  const result = spawnSync(bin, args, {
    encoding: "utf8", timeout: 5000, env: { ...process.env, LC_ALL: "C" },
  });
  if (result.error || result.status !== 0) throw new Error(`FIRSTMATE_COMMAND_FAILED: ${bin} failed`);
  return result.stdout.trimEnd();
}

function currentPane() {
  const pane = process.env.TMUX_PANE ?? "";
  const socket = /^(\/[^\x00-\x1f\x7f]+),\d+,\d+$/.exec(process.env.TMUX ?? "")?.[1];
  if (!/^%\d+$/.test(pane) || !socket) {
    throw new Error("FIRSTMATE_TMUX_REQUIRED: run this from the agent's own tmux pane");
  }
  const tmux = (...args: string[]) => command("tmux", ["-S", socket, ...args]);
  const identity = tmux("display-message", "-p", "-t", pane, "#{pane_pid} #{window_id}");
  const match = /^(\d+) (@\d+)$/.exec(identity);
  if (!match) throw new Error("FIRSTMATE_PANE_INVALID: cannot identify the current pane");
  return { pane, rootPid: Number(match[1]), window: match[2]!, tmux };
}

function assertInPane(pid: number, rootPid: number): void {
  // Environment variables identify a candidate pane, not ownership. Check the
  // OS process tree as well; never mark a different pane via a forged TMUX_PANE.
  for (let depth = 0; depth < 64 && pid > 1; depth++) {
    if (pid === rootPid) return;
    const parent = command("ps", ["-p", String(pid), "-o", "ppid="]).trim();
    if (!/^\d+$/.test(parent) || Number(parent) === pid) break;
    pid = Number(parent);
  }
  throw new Error("FIRSTMATE_PANE_MISMATCH: the coordinator does not belong to this pane");
}

/** Badge means selected coordinator, not proof that a crew task succeeded. */
export function setFirstmateBadge(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("FIRSTMATE_PID_INVALID");
  const context = currentPane();
  assertInPane(pid, context.rootPid);
  const started = command("ps", ["-p", String(pid), "-o", "lstart="]);
  if (!started.trim() || !/^[A-Za-z0-9 :]+$/.test(started)) {
    throw new Error("FIRSTMATE_PID_INVALID: cannot identify the coordinator lifetime");
  }
  // A native tmux format job, not another agent/daemon. PID + start time avoids
  // displaying an old role after the process exits or its PID is reused.
  // Only validated numeric/time data enters the shell/format expression.
  const badge = `#(test "$(LC_ALL=C ps -p ${pid} -o lstart=)" = ${quote(started)} && printf '⚓ Firstmate ')`;
  const { tmux, pane, window } = context;
  const border = tmux("show-options", "-A", "-w", "-v", "-t", window, "pane-border-format");
  const status = tmux("show-options", "-A", "-w", "-v", "-t", window, "pane-border-status");
  if (!border.startsWith(BORDER_PREFIX)) {
    tmux("set-option", "-w", "-t", window, "pane-border-format", BORDER_PREFIX + border);
  }
  if (status === "off") tmux("set-option", "-w", "-t", window, "pane-border-status", "top");
  tmux("set-option", "-p", "-t", pane, BADGE_OPTION, badge);
}

export function promoteFirstmate(repo: string, accept: boolean): number {
  if (!accept) {
    const root = quote(repo);
    process.stdout.write(`Firstmate live promotion — NOT YET ACTIVE\n
This handoff must be read and executed by the running agent you want to promote.
Do not start, restart, resume or replace a harness; do not paste into another pane.
Pause the current task safely and retain its context for the coordination handoff.
Read ${join(repo, "AGENTS.md")} and the relevant skills under ${join(repo, ".agents/skills")}.
Respect existing higher-priority instructions, trust boundaries and approval gates.
If another orchestrator owns this session or those rules prevent adoption, stop;
do not claim Firstmate authority and do not run --accept.

Use this explicit checkout/home for EVERY Firstmate helper invocation:
  (set -e; cd -- ${root}; unset FM_ROOT_OVERRIDE FM_STATE_OVERRIDE FM_DATA_OVERRIDE FM_CONFIG_OVERRIDE FM_PROJECTS_OVERRIDE; export FM_HOME=${root}; bash ./bin/fm-session-start.sh)
Run session-start once for adoption (not again if this session already completed it).
Read the entire startup digest, resolve its blockers and respect a live owner's lock.
Bootstrap may reconcile existing crew; obtain any required approval before executing it.
If startup is pending/truncated or ownership is refused, do not accept.

Live adoption uses attended foreground supervision: drain with bin/fm-wake-drain.sh,
handle and acknowledge wakes, then run bin/fm-watch-checkpoint.sh --seconds 180 in
the foreground. On quiet/timeout, check user input and drain again before continuing.
No hooks, MCP servers, plugins, permissions or process environment are hot-reloaded.
Do not rely on Stop hooks, background notifications or unattended/away-mode wakeups.
If the current harness cannot sustain that foreground loop, report the limitation.

Only after adopting this role and completing startup, run from this same agent:
  cue firstmate promote --accept --repo ${root}
Acceptance checks upstream lock ownership and completion, then marks this tmux pane.
It never launches an agent, steals a lock or certifies model understanding.\n`);
    return 0;
  }
  try {
    currentPane(); // Fail before executing upstream code outside tmux.
    // Reuse Firstmate's own ancestry verifier. `fm-lock.sh status` always exits
    // zero, even for foreign owners, so its exit status is not an ownership check.
    const check = spawnSync("bash", ["-c", `
set -e
cd -- "$1"
unset FM_ROOT_OVERRIDE FM_STATE_OVERRIDE FM_DATA_OVERRIDE FM_CONFIG_OVERRIDE FM_PROJECTS_OVERRIDE
export FM_HOME="$1"
state="$1/state"
for file in "$state/.lock" "$state/.session-start-complete"; do
  [ -f "$file" ] && [ ! -L "$file" ] || exit 1
done
. "$1/bin/fm-session-lock-lib.sh"
fm_session_lock_owned_by_self "$state" || exit 1
owner=$(cat "$state/.lock")
[ "$owner" = "$(cat "$state/.session-start-complete")" ] || exit 1
printf '%s' "$owner"
`, "cue-firstmate-accept", repo], { encoding: "utf8", timeout: 5000 });
    const owner = check.stdout?.trim() ?? "";
    if (check.error || check.status !== 0 || !/^\d+$/.test(owner)) {
      throw new Error("FIRSTMATE_NOT_READY: this agent must own the upstream lock and completed startup; no badge applied");
    }
    setFirstmateBadge(Number(owner));
    process.stdout.write(`⚓ Firstmate accepted — existing PID ${owner}, foreground supervision; no agent restarted.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`cue firstmate: ${error instanceof Error ? error.message : "promotion failed"}\n`);
    return 1;
  }
}
