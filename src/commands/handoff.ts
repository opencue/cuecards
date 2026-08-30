/**
 * `cue handoff` — manage profile handoff context for multi-agent workflows.
 *
 * Subcommands:
 *   create --from <profile> --task "..." --skills s1:high,s2:medium --notes "..."
 *   latest              — show the most recent handoff
 *   list                — list recent handoffs
 *   show <id>           — show a specific handoff
 *   inject              — output the latest handoff formatted for agent injection
 *   hook                — internal native Codex lifecycle hook entrypoint
 */

import { createHandoff, getLatestHandoff, getHandoff, listHandoffs, formatHandoffForAgent } from "../lib/handoff";
import { handleCheckpointHook, type CheckpointHookPayload } from "../lib/session-checkpoint";

export async function run(args: string[]): Promise<number> {
  const sub = args[0] ?? "latest";
  const json = args.includes("--json");

  switch (sub) {
    case "create": return cmdCreate(args.slice(1));
    case "latest": return cmdLatest(json);
    case "list": return cmdList(json);
    case "show": return cmdShow(args[1] ?? "", json);
    case "inject": return cmdInject();
    case "hook": return cmdHook();
    default: return cmdLatest(json);
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

function cmdCreate(args: string[]): number {
  const fromIdx = args.indexOf("--from");
  const from = fromIdx >= 0 ? args[fromIdx + 1] ?? "" : "unknown";
  const taskIdx = args.indexOf("--task");
  const task = taskIdx >= 0 ? args[taskIdx + 1] ?? "" : "";
  const skillsIdx = args.indexOf("--skills");
  const skillsRaw = skillsIdx >= 0 ? args[skillsIdx + 1] ?? "" : "";
  const notesIdx = args.indexOf("--notes");
  const notes = notesIdx >= 0 ? args[notesIdx + 1] ?? "" : "";

  if (!task) {
    process.stderr.write("Usage: cue handoff create --from <profile> --task \"...\" --skills s1:high,s2:medium\n");
    return 1;
  }

  const skills = skillsRaw.split(",").filter(Boolean).map(s => {
    const [id, level] = s.split(":");
    return { id: id!, usefulness: (level as "high" | "medium" | "low") ?? "medium" };
  });

  const handoff = createHandoff({
    from_profile: from,
    from_agent: "claude-code",
    task_summary: task,
    skills_used: skills,
    mcps_used: [],
    notes,
  });

  process.stdout.write(`✅ Handoff created: ${handoff.id}\n`);
  process.stdout.write(`   Pass to receiving agent: cue handoff inject\n`);
  return 0;
}

function cmdLatest(json: boolean): number {
  const h = getLatestHandoff();
  if (!h) { process.stdout.write("No handoffs yet.\n"); return 0; }
  if (json) { process.stdout.write(JSON.stringify(h, null, 2) + "\n"); return 0; }
  process.stdout.write(formatHandoffForAgent(h));
  return 0;
}

function cmdList(json: boolean): number {
  const handoffs = listHandoffs();
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
  const h = getHandoff(id);
  if (!h) { process.stderr.write(`Handoff "${id}" not found.\n`); return 1; }
  if (json) { process.stdout.write(JSON.stringify(h, null, 2) + "\n"); return 0; }
  process.stdout.write(formatHandoffForAgent(h));
  return 0;
}

function cmdInject(): number {
  const h = getLatestHandoff();
  if (!h) { process.stderr.write("No handoffs to inject.\n"); return 1; }
  process.stdout.write(formatHandoffForAgent(h));
  return 0;
}
