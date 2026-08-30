/**
 * `cue materialize <agent> [--dir <path>]` — write skills + MCPs for any agent.
 *
 * This is the universal materializer. It reads the active profile and writes
 * the config files in whatever format the target agent expects.
 *
 * Examples:
 *   cue materialize cursor           # writes .cursorrules + .cursor/mcp.json
 *   cue materialize cline            # writes .clinerules + cline_mcp_settings.json
 *   cue materialize gemini           # writes ~/.gemini/skills/*.md
 *   cue materialize copilot          # writes .github/copilot-instructions.md
 *   cue materialize --all            # materialize for ALL agents in profile
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { loadProfile } from "../lib/profile-loader";
import { resolveActiveProfile } from "../lib/cwd-resolver";
import { getAdapter, AGENT_IDS, } from "../lib/agent-adapters";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const MCP_CONFIGS_DIR = join(repoRoot(), "resources", "mcps", "configs");

function loadSkillContent(id: string): { id: string; content: string } | null {
  const path = join(SKILLS_ROOT, id, "SKILL.md");
  if (!existsSync(path)) return null;
  return { id, content: readFileSync(path, "utf8") };
}

function loadMcpRegistry(): Record<string, unknown> {
  for (const file of ["claude_runtime.sanitized.json", "claude.sanitized.json"]) {
    try {
      const raw = JSON.parse(readFileSync(join(MCP_CONFIGS_DIR, file), "utf8"));
      if (raw.servers) return raw.servers;
    } catch {}
  }
  return {};
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue materialize — write skills + MCPs for any AI agent

Usage: cue materialize <agent> [--dir <path>] [--profile <name>]

Agents: ${AGENT_IDS.join(", ")}

Flags:
  --dir <path>       Target directory (default: cwd or agent's config dir)
  --profile <name>   Use specific profile (default: resolved from .cue.profile)
  --all              Materialize for all agents listed in the profile
  --dry-run          Show what would be written without writing

Examples:
  cue materialize cursor              # .cursorrules + .cursor/mcp.json
  cue materialize cline               # .clinerules + cline_mcp_settings.json
  cue materialize gemini              # ~/.gemini/skills/*.md
  cue materialize copilot             # .github/copilot-instructions.md
  cue materialize --all               # all agents in profile
`);
    return 0;
  }

  const all = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const dirIdx = args.indexOf("--dir");
  const profileIdx = args.indexOf("--profile");
  const targetDir = dirIdx >= 0 ? args[dirIdx + 1]! : process.cwd();
  const profileArg = profileIdx >= 0 ? args[profileIdx + 1]! : null;

  // Find agent ID: first arg that's not a flag and not a flag value
  const skipValues = new Set<number>();
  if (dirIdx >= 0) skipValues.add(dirIdx + 1);
  if (profileIdx >= 0) skipValues.add(profileIdx + 1);
  const agentId = args.find((a, i) => !a.startsWith("-") && !skipValues.has(i));

  if (!agentId && !all) {
    process.stderr.write(`Usage: cue materialize <agent>\nAgents: ${AGENT_IDS.join(", ")}\n`);
    return 1;
  }

  // Resolve profile
  let profile;
  try {
    const name = profileArg ?? await resolveActiveProfile();
    if (!name) throw new Error("no active profile");
    profile = await loadProfile(name);
  } catch {
    process.stderr.write("No active profile. Pin one with `echo <name> > .cue.profile`\n");
    return 1;
  }

  // Load skills content
  const skills = profile.skills.local
    .map(s => loadSkillContent(s.id))
    .filter(Boolean) as { id: string; content: string }[];

  // Load MCPs
  const registry = loadMcpRegistry();
  const mcps: Record<string, unknown> = {};
  for (const m of profile.mcps) {
    if (registry[m.id]) mcps[m.id] = registry[m.id];
  }

  // Determine which agents to materialize for
  const agents = all
    ? profile.agents.map(a => a === "claude-code" ? "claude-code" : a)
    : [agentId!];

  for (const id of agents) {
    const adapter = getAdapter(id);
    if (!adapter) {
      process.stderr.write(`Unknown agent: "${id}". Available: ${AGENT_IDS.join(", ")}\n`);
      return 1;
    }

    const dir = dirIdx >= 0 ? targetDir : (id === "gemini" ? adapter.configDir() : targetDir);

    if (dryRun) {
      process.stdout.write(`[dry-run] ${adapter.name}:\n`);
      process.stdout.write(`  Skills: ${skills.length} → ${dir}\n`);
      process.stdout.write(`  MCPs: ${Object.keys(mcps).length} → ${dir}\n`);
      continue;
    }

    adapter.writeSkills(skills, dir);
    adapter.writeMcps(mcps, dir);

    process.stdout.write(`✅ ${adapter.name}: ${skills.length} skills + ${Object.keys(mcps).length} MCPs → ${dir}\n`);
  }

  return 0;
}
