import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { withCodexPonytail } from "../lib/codex-ponytail";
import { evaluateCondition } from "../lib/conditional-skills";
import { configDir } from "../lib/config-paths";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { loadProfile } from "../lib/profile-loader";
import { applyProjectLoadout } from "../lib/project-loadout";
import { repoRoot } from "../lib/repo-root";
import { createLocalSkillResolver } from "../lib/resolver-local";
import { expandSkillWildcards, loadMcpRegistry, RUNTIME_AGENTS, type RuntimeAgent } from "../lib/runtime-install";
import { parseMetadataFromContent } from "../lib/skill-parser";
import { catalogSkillsForLaunch } from "./launch";

type Profile = Awaited<ReturnType<typeof loadProfile>>;
type Entry = {
  id: string;
  status: "ready" | "inactive" | "missing" | "deferred" | "remote" | "shadowed";
  repo?: string;
};

function rulePlan(profile: Profile): Entry[] {
  const used = new Set<string>();
  const root = join(repoRoot(), "resources", "rules");
  return profile.rules.map((id) => {
    const file = id.endsWith(".md") ? id : `${id}.md`;
    if (!existsSync(resolve(root, file))) return { id, status: "missing" };
    const name = basename(file);
    if (used.has(name)) return { id, status: "shadowed" };
    used.add(name);
    return { id, status: "ready" };
  });
}

async function agentPlan(profile: Profile, agent: RuntimeAgent, cwd: string) {
  profile = await withCodexPonytail(profile, agent);
  const scoped = ({ agents }: { agents?: Profile["agents"] }) =>
    !agents?.length || agents.includes(agent);
  const catalog = catalogSkillsForLaunch(profile, agent);
  const resolveSkill = createLocalSkillResolver();
  const skills = await Promise.all(catalog.local.filter(scoped).map(async (skill): Promise<Entry> => {
    const { id, when } = skill;
    if (when && !evaluateCondition(when, cwd)) return { id, status: "inactive" };
    try {
      const found = id.startsWith("catalog/") ? catalog.sources.has(id) : !!(await resolveSkill(id));
      return { id, status: found ? "ready" : "missing" };
    } catch {
      return { id, status: "missing" };
    }
  }));
  // Both agents use a flat skill dir; the last resolvable local ref wins a slug.
  const seen = new Set<string>();
  for (const skill of [...skills].reverse()) {
    if (skill.status !== "ready") continue;
    const slug = basename(skill.id);
    if (seen.has(slug)) skill.status = "shadowed";
    seen.add(slug);
  }
  for (const skill of profile.deferredSkills ?? []) {
    skills.push({ id: skill.id, status: "deferred" });
  }
  for (const { repo, skills: ids } of profile.skills.npx.filter(scoped)) {
    for (const id of ids) skills.push({ id, repo, status: "remote" });
  }
  const registry = await loadMcpRegistry(agent);
  const mcps = profile.mcps.filter(scoped).map(({ id, when }): Entry => {
    if (when && !evaluateCondition(when, cwd)) return { id, status: "inactive" };
    return { id, status: Object.hasOwn(registry, id) ? "ready" : "missing" };
  });
  const plugins = agent === "claude-code"
    ? profile.plugins.filter(scoped).map(({ id }) => id)
    : [];
  return { skills, mcps, plugins };
}

function rows(label: string, entries: Entry[]): string[] {
  if (!entries.length) return [`  ${label}: none`];
  return [
    `  ${label}:`,
    ...entries.map(({ id, status, repo }) =>
      `    - ${id}${repo ? ` (${repo})` : ""} — ${status}`),
  ];
}

export async function runCurrentPlan(args: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      options: {
        plan: { type: "boolean" },
        json: { type: "boolean" },
        profile: { type: "string" },
        agent: { type: "string" },
      },
    });
    const agent = values.agent === "claude" ? "claude-code" : values.agent;
    if (agent !== undefined && agent !== "claude-code" && agent !== "codex") {
      throw new Error("--agent must be claude or codex");
    }
    if (values.profile !== undefined && !values.profile.trim()) {
      throw new Error("--profile requires a non-empty selector");
    }
    const cwd = process.cwd();
    const selected = await resolveProfileForCwd({
      cwd, homeDir: homedir(), configDir: configDir(), override: values.profile,
    });
    if (selected.source === "none") {
      process.stdout.write(values.json
        ? JSON.stringify({ profile: null, source: "none" }) + "\n"
        : "No profile selected. Try cue auto-detect or cue current --plan --profile core.\n");
      return 0;
    }
    let profile = await loadProfile(selected.profile);
    await expandSkillWildcards(profile);
    if (!["off", "0", "false"].includes((process.env.CUE_LOADOUT ?? "").trim().toLowerCase())) {
      const loadout = await applyProjectLoadout({
        profile,
        cwd,
        pinDir: selected.source === "pin-file" ? dirname(selected.pinPath) : cwd,
        persist: false,
        readSkill: async (id) => {
          const path = join(repoRoot(), "resources", "skills", "skills", id, "SKILL.md");
          return { path, description: parseMetadataFromContent(await readFile(path, "utf8")).description };
        },
      });
      if (loadout) profile = loadout.profile;
    }
    const targets: RuntimeAgent[] = agent ? [agent] : RUNTIME_AGENTS;
    const plans = await Promise.all(targets.map(async (target) => ({
      target,
      ...(await agentPlan(profile, target, cwd)),
    })));
    const rules = rulePlan(profile);
    if (values.json) {
      process.stdout.write(JSON.stringify({
        ...selected,
        inheritance: profile.inheritanceChain,
        agents: Object.fromEntries(plans.map(({ target, ...plan }) => [target, plan])),
        rules,
      }, null, 2) + "\n");
      return 0;
    }

    const reason = selected.source === "pin-file" ? selected.pinPath : {
      flag: "explicit --profile",
      "repo-default": "saved repository default",
      "global-default": "global default",
    }[selected.source];
    const lines = [
      `Profile: ${selected.profile} — ${reason}`,
      "Read-only profile preview. No agents started, downloads or configuration changes.",
      ...plans.flatMap(({ target, skills, mcps, plugins }) => [
        "",
        target === "claude-code" ? "Claude Code" : "Codex",
        ...rows("Skills", skills),
        ...rows("MCP candidates", mcps),
        ...(target === "claude-code" ? [`  Configured plugins: ${plugins.join(", ") || "none"}`] : []),
      ]),
      "",
      ...rows("Profile rules", rules),
      "",
      "Remote skills/plugins, agent-global config, and interactive launch choices are not verified.",
    ];
    process.stdout.write(lines.join("\n") + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(`cue current --plan: ${(error as Error).message}\n`);
    return 1;
  }
}
