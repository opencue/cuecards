import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const hasTmux = spawnSync("tmux", ["-V"]).status === 0;
const fixtures: Array<{ dir: string; socket: string }> = [];
afterEach(async () => {
  for (const { dir, socket } of fixtures.splice(0)) {
    spawnSync("tmux", ["-S", socket, "kill-server"]);
    await rm(dir, { recursive: true, force: true });
  }
});

async function fixture(mode = "ready", status = "off") {
  const dir = await mkdtemp(join(tmpdir(), "cue-fm-live-"));
  const socket = join(dir, "tmux.sock");
  fixtures.push({ dir, socket });
  const repo = join(dir, "firstmate ' $(literal)");
  for (const path of [".git", "bin", "state", ".agents/skills", ".claude", ".codex"]) {
    await mkdir(join(repo, path), { recursive: true });
  }
  for (const path of ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".codex/hooks.json"]) {
    await writeFile(join(repo, path), "fixture\n");
  }
  await writeFile(join(repo, "bin/fm-session-start.sh"), "exit 99 # must not be executed by accept\n");
  await writeFile(join(repo, "bin/codex"), `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(dir, "result.json"))}, JSON.stringify({pid:process.pid, parentPid:Number(process.env.TEST_OWNER_PID), ownPane:process.env.TMUX_PANE, home:process.env.FM_HOME}));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  // Fixture for the external library contract, NOT evidence of real model adoption.
  // Cue must call this verifier instead of treating lock-file contents as authority.
  await writeFile(join(repo, "bin/fm-session-lock-lib.sh"), `
fm_session_lock_owned_by_self() {
  [ "$FM_HOME/state" = "$1" ] || return 1
  [ -z "$FM_STATE_OVERRIDE" ] || return 1
  [ "$(cat "$1/.lock")" = "$TEST_OWNER_PID" ]
}
`);
  const script = join(dir, "harness.ts");
  await writeFile(script, `
import { spawnSync } from "node:child_process";
import { writeFileSync, symlinkSync } from "node:fs";
const repo = ${JSON.stringify(repo)};
const mode = ${JSON.stringify(mode)};
process.env.TEST_OWNER_PID = String(process.pid);
process.env.FM_STATE_OVERRIDE = "/must-not-be-used";
if (mode === "launch") {
  process.env.PATH = repo + "/bin:" + process.env.PATH;
  spawnSync(process.execPath, [${JSON.stringify(join(root, "src/index.ts"))}, "firstmate", "--agent", "codex", "--repo", repo], {stdio:"inherit", env:process.env});
  process.exit();
}
writeFileSync(repo + "/state/.lock", mode === "foreign" ? "999999999" : String(process.pid));
if (mode === "symlink") symlinkSync(repo + "/state/.lock", repo + "/state/.session-start-complete");
else if (mode !== "missing") writeFileSync(repo + "/state/.session-start-complete", mode === "mismatch" ? "123" : String(process.pid));
const ownPane = process.env.TMUX_PANE;
if (mode === "wrong-pane") {
  const other = spawnSync("tmux", ["-S", ${JSON.stringify(socket)}, "split-window", "-d", "-P", "-F", "#{pane_id}", "sleep 60"], {encoding:"utf8"});
  process.env.TMUX_PANE = other.stdout.trim();
}
const cli = () => spawnSync(process.execPath, [${JSON.stringify(join(root, "src/index.ts"))}, "firstmate", "promote", "--accept", "--repo", repo], {encoding:"utf8", env:process.env});
const result = cli();
const again = result.status === 0 ? cli() : null;
writeFileSync(${JSON.stringify(join(dir, "result.json"))}, JSON.stringify({pid:process.pid, ownPane, targetPane:process.env.TMUX_PANE, status:result.status, stdout:result.stdout, stderr:result.stderr, again:again?.status}));
setInterval(() => {}, 1000);
`);
  const env = { ...process.env, TMUX: "", TMUX_PANE: "", CUE_REPO_ROOT: root, CUE_PROFILES_DIR: join(root, "profiles") };
  const tmux = (...args: string[]) => {
    const result = spawnSync("tmux", ["-S", socket, ...args], { encoding: "utf8", env });
    expect(result.status).toBe(0);
    return result.stdout.trimEnd();
  };
  tmux("-f", "/dev/null", "new-session", "-d", "-s", "test", "sleep 60");
  tmux("set-option", "-w", "-t", "test:0", "remain-on-exit", "on");
  tmux("set-option", status === "inherited" ? "-gw" : "-w", "-t", "test:0", "pane-border-format", "#{pane_index} USER #T");
  if (status !== "inherited") tmux("set-option", "-w", "-t", "test:0", "pane-border-status", status);
  const pane = tmux("display-message", "-p", "-t", "test:0.0", "#{pane_id}");
  tmux("respawn-pane", "-k", "-t", pane, process.execPath, script);
  let result;
  for (let i = 0; i < 200; i++) {
    try { result = JSON.parse(await readFile(join(dir, "result.json"), "utf8")); break; }
    catch { await Bun.sleep(50); }
  }
  expect(result).toBeDefined();
  return { ...result, dir, repo, tmux, pane };
}

test.skipIf(!hasTmux)("live acceptance preserves the process and existing pane format; badge expires with its owner", async () => {
  const f = await fixture();
  expect(f.status).toBe(0);
  expect(f.again).toBe(0);
  expect(f.stdout).toContain(`existing PID ${f.pid}`);
  expect(f.tmux("display-message", "-p", "-t", f.pane, "#{pane_pid}")).toBe(String(f.pid));
  expect(f.tmux("show-options", "-w", "-v", "-t", "test:0", "pane-border-format"))
    .toBe("#{E:@cue_firstmate_badge}#{pane_index} USER #T");
  expect(f.tmux("show-options", "-w", "-v", "-t", "test:0", "pane-border-status")).toBe("top");
  const badge = f.tmux("show-options", "-p", "-v", "-t", f.pane, "@cue_firstmate_badge");
  const render = () => spawnSync("sh", ["-c", badge.slice(2, -1)], { encoding: "utf8" }).stdout;
  expect(render()).toBe("⚓ Firstmate ");
  process.kill(f.pid, "SIGTERM");
  // Poll the condition actually asserted. `#{pane_dead}` is only a proxy for it:
  // tmux can flag the pane dead while the signalled process is still visible to
  // the badge's own `ps -p`, so the badge had not cleared yet when this ran.
  for (let i = 0; i < 100 && render() !== ""; i++) await Bun.sleep(50);
  expect(render()).toBe("");
  expect(f.tmux("show-options", "-g", "-w", "-v", "pane-border-status")).toBe("off");
}, 15000);

test.skipIf(!hasTmux)("an existing bottom border remains at the bottom", async () => {
  const f = await fixture("ready", "bottom");
  expect(f.status).toBe(0);
  expect(f.tmux("show-options", "-w", "-v", "-t", "test:0", "pane-border-status")).toBe("bottom");
}, 15000);

test.skipIf(!hasTmux)("inherited tmux defaults enable the badge and preserve the inherited border", async () => {
  const f = await fixture("ready", "inherited");
  expect(f.status).toBe(0);
  expect(f.tmux("show-options", "-w", "-v", "-t", "test:0", "pane-border-status")).toBe("top");
  expect(f.tmux("show-options", "-w", "-v", "-t", "test:0", "pane-border-format"))
    .toBe("#{E:@cue_firstmate_badge}#{pane_index} USER #T");
}, 15000);

test.skipIf(!hasTmux)("separate coordinator launch marks its child rather than the caller", async () => {
  const f = await fixture("launch");
  let badge = "";
  for (let i = 0; i < 40 && !badge; i++) {
    badge = f.tmux("show-options", "-p", "-q", "-v", "-t", f.pane, "@cue_firstmate_badge");
    if (!badge) await Bun.sleep(50);
  }
  expect(f.pid).not.toBe(f.parentPid);
  expect(f.home).toBe(f.repo);
  expect(badge).toContain(`ps -p ${f.pid} `);
  expect(badge).not.toContain(`ps -p ${f.parentPid} `);
}, 15000);

test.skipIf(!hasTmux).each(["foreign", "missing", "mismatch", "symlink", "wrong-pane"])(
  "refuses %s adoption without a badge or replacement process", async mode => {
    const f = await fixture(mode);
    expect(f.status).toBe(1);
    expect(f.stderr).toContain(mode === "wrong-pane" ? "FIRSTMATE_PANE_MISMATCH" : "FIRSTMATE_NOT_READY");
    expect(f.tmux("show-options", "-p", "-q", "-v", "-t", f.targetPane, "@cue_firstmate_badge")).toBe("");
    expect(f.tmux("display-message", "-p", "-t", f.ownPane, "#{pane_pid}")).toBe(String(f.pid));
  }, 15000,
);
