/**
 * `cue handoff` — manage profile handoff context for multi-agent workflows.
 *
 * Subcommands:
 *   create --from <profile> --task "..." --skills s1:high,s2:medium --notes "..."
 *   latest              — show the most recent handoff
 *   list                — list recent handoffs
 *   show <id>           — show a specific handoff
 *   inject <id> | --repo <path> — explicitly select historical context
 *   hook                — internal native Codex lifecycle hook entrypoint
 */

import { assessHandoff, captureRepository, createHandoff, getLatestHandoff, getHandoff, listHandoffs, formatHandoffForAgent, HandoffError, readHandoffDetails } from "../lib/handoff";
import { handleCheckpointHook, type CheckpointHookPayload } from "../lib/session-checkpoint";

export async function run(args: string[]): Promise<number> {
  const sub = args[0] ?? "latest";
  const json = args.includes("--json");
  if (sub === "hook") return cmdHook();
  try {
    const values: Record<string, string> = {};
    const positional: string[] = [];
    const allowed = sub === "create" ? ["--from", "--agent", "--task", "--skills", "--notes", "--repo", "--context"] : ["--repo", "--id"];
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--json") continue;
      if (!arg.startsWith("--")) { positional.push(arg); continue; }
      if (!allowed.includes(arg) || values[arg] !== undefined || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new HandoffError("HANDOFF_INVALID_INPUT", "Unknown, duplicate, or missing handoff option.");
      values[arg] = args[++i]!;
    }
    if (positional.length > 1 || (positional.length && sub !== "show" && sub !== "inject")) throw new HandoffError("HANDOFF_INVALID_INPUT", "Unexpected handoff argument.");
    const repoPath = values["--repo"];
    switch (sub) {
      case "create": return cmdCreate(values, json);
      case "latest": return cmdLatest(json, repoPath);
      case "list": return cmdList(json, repoPath);
      case "show": return cmdShow(positional[0] ?? values["--id"] ?? "", json);
      case "inject": {
        if (positional[0] && values["--id"]) throw new HandoffError("HANDOFF_INVALID_INPUT", "Select only one handoff ID.");
        return cmdInject(positional[0] ?? values["--id"], repoPath, json);
      }
      default: return cmdLatest(json, repoPath);
    }
  } catch (error) {
    const failure = error instanceof HandoffError ? error : new HandoffError("HANDOFF_FAILED", "Handoff operation failed.");
    if (json) process.stdout.write(JSON.stringify({ error: { code: failure.code, message: failure.message } }) + "\n");
    else process.stderr.write(`${failure.message}\n`);
    return 1;
  }
}

async function cmdHook(): Promise<number> {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += String(chunk);
    if (!raw.trim()) return 0;
    const output = handleCheckpointHook(JSON.parse(raw) as CheckpointHookPayload);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // Lifecycle continuity is best-effort and must never block Codex startup,
    // compaction, or shutdown because of malformed/missing hook state.
  }
  return 0;
}

function cmdCreate(args: Record<string, string>, json: boolean): number {
  const task = args["--task"] ?? "";
  if (!task.trim()) throw new HandoffError("HANDOFF_INVALID_INPUT", "Usage: cue handoff create --from <profile> --task \"...\" --skills s1:high,s2:medium");
  const skills = (args["--skills"] ?? "").split(",").filter(Boolean).map(s => {
    const [id, level] = s.split(":");
    if (s.split(":").length > 2 || (level !== undefined && !["high", "medium", "low"].includes(level))) throw new HandoffError("HANDOFF_INVALID_INPUT", "Invalid skill usefulness.");
    return { id: id!, usefulness: (level as "high" | "medium" | "low") ?? "medium" };
  });
  const handoff = createHandoff({
    ...(args["--context"] ? readHandoffDetails(args["--context"]) : {}),
    from_profile: args["--from"] ?? "unknown",
    from_agent: args["--agent"] ?? "unknown",
    task_summary: task,
    skills_used: skills,
    mcps_used: [],
    notes: args["--notes"] ?? "",
  }, { repoPath: args["--repo"] });
  if (json) { process.stdout.write(JSON.stringify(handoff, null, 2) + "\n"); return 0; }
  process.stdout.write(`✅ Handoff created: ${handoff.id}\n`);
  process.stdout.write(`   Pass to receiving agent: cue handoff inject ${handoff.id}\n`);
  return 0;
}

function cmdLatest(json: boolean, repoPath?: string): number {
  const h = getLatestHandoff({ repoPath });
  if (!h && json) { process.stdout.write("null\n"); return 0; }
  if (!h) { process.stdout.write("No handoffs yet.\n"); return 0; }
  if (json) { process.stdout.write(JSON.stringify(h, null, 2) + "\n"); return 0; }
  process.stdout.write(formatHandoffForAgent(h));
  return 0;
}

function cmdList(json: boolean, repoPath?: string): number {
  const handoffs = listHandoffs(10, { repoPath });
  if (json) { process.stdout.write(JSON.stringify(handoffs, null, 2) + "\n"); return 0; }
  if (!handoffs.length) { process.stdout.write("No handoffs.\n"); return 0; }
  process.stdout.write(`Recent handoffs (${handoffs.length}):\n\n`);
  for (const h of handoffs) {
    process.stdout.write(`  ${h.id}  ${h.ts.slice(0, 16)}  ${h.from_profile} → ${h.to_profile ?? "?"}\n`);
    process.stdout.write(`    ${h.task_summary.slice(0, 60)}\n\n`);
  }
  return 0;
}

function cmdShow(id: string, json: boolean): number {
  if (!id) throw new HandoffError("HANDOFF_NOT_FOUND", "Handoff not found: specify an ID.");
  const h = getHandoff(id);
  if (!h) throw new HandoffError("HANDOFF_NOT_FOUND", `Handoff "${id}" not found.`);
  if (json) { process.stdout.write(JSON.stringify(h, null, 2) + "\n"); return 0; }
  process.stdout.write(formatHandoffForAgent(h));
  return 0;
}

function cmdInject(id: string | undefined, repoPath: string | undefined, json: boolean): number {
  if (!id && !repoPath) throw new HandoffError("HANDOFF_SELECTION_REQUIRED", "Select a handoff ID or --repo explicitly; bare inject is unsafe.");
  const current = captureRepository(repoPath);
  const h = id ? getHandoff(id) : getLatestHandoff({ repoPath: repoPath! });
  if (!h) throw new HandoffError("HANDOFF_NOT_FOUND", "No handoffs to inject.");
  const assessment = assessHandoff(h, current);
  const formatted = formatHandoffForAgent(h, assessment);
  process.stdout.write(json ? JSON.stringify({ handoff: h, assessment, formatted }, null, 2) + "\n" : formatted);
  return assessment.status === "stale" || assessment.status === "repo-mismatch" ? 1 : 0;
}
