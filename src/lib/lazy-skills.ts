/**
 * Lazy skill loading — generate stubs and manifests for deferred skill bodies.
 */

import type { DeferredSkillEntry, ResolvedProfile } from "../../profiles/_types";

/** Slug the generated index skill materializes under in the skills dir. */
export const DEFERRED_INDEX_SLUG = "cue-deferred-skills";

/** Frontmatter values must stay one line; keep them quote-safe too. */
function fmSafe(value: string): string {
  return value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
}

/**
 * Generate the single index skill that stands in for every skill the project
 * loadout deferred. One always-on frontmatter line buys back the whole
 * deferred tail: the agent invokes this skill when a capability seems
 * missing, finds the entry, and Reads the real SKILL.md at the listed path.
 */
export function generateDeferredIndexSkill(entries: DeferredSkillEntry[]): string {
  const rows = entries
    .map((e) => {
      const desc = fmSafe(e.description) || "(no description)";
      const src = e.path ? ` — \`${e.path}\`` : "";
      return `- \`${e.id}\` — ${desc}${src}`;
    })
    .join("\n");
  return `---
name: ${DEFERRED_INDEX_SLUG}
description: "Index of ${entries.length} skills deferred by cue's project loadout. Use when a task needs a capability that seems missing from the loaded skills — find it below, then Read its SKILL.md and follow it. Also triggered by 'do we have a skill for', 'load the <name> skill', or 'missing skill'."
---

# Deferred skills index

cue's project loadout deferred these skills because no project signal matched
them. They are fully available — each row links the real SKILL.md.

**To use one:** Read the file at the listed path and follow its instructions
as if the skill had been invoked. To load it permanently for this project, run
\`cue loadout keep <id>\` and relaunch (or \`--cue-full\` for everything once).

${rows}
`;
}

/**
 * Generate a minimal SKILL.md stub with just name + description.
 */
export function generateSkillStub(skillId: string, description: string): string {
  const name = skillId.split("/").pop() ?? skillId;
  return `---
name: ${name}
description: "${description}"
---

# ${name}

${description}

> Full skill body available on demand. Reference this skill by name to load it.
`;
}

/**
 * Generate a CLAUDE.md manifest section listing all available lazy skills.
 */
export function generateLazyManifest(skills: { id: string; description: string }[]): string {
  if (skills.length === 0) return "";
  let out = `## Available Skills (lazy-loaded)\n\n`;
  out += `The following skills are available. Ask for the full body by name when needed:\n\n`;
  for (const s of skills) {
    const name = s.id.split("/").pop() ?? s.id;
    out += `- **${name}** (\`${s.id}\`): ${s.description}\n`;
  }
  out += `\n> To use a skill, reference it by name. The full instructions will be loaded on demand.\n`;
  return out;
}

/**
 * Check if a profile has lazy mode enabled.
 */
export function isLazyEnabled(profile: ResolvedProfile): boolean {
  return (profile as any).lazy === true;
}
