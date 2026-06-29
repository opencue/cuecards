/**
 * `cue profile draft-skill [<profile>]` — propose new SKILL.md files based on
 * recurring session patterns.
 *
 * Data sources (all populated by hooks installed in profiles/core):
 *   • ~/.config/cue/first-prompts/<cwd-hash>.json   first prompt per cwd
 *   • ~/.config/cue/analytics.jsonl                 session start/end/skill_hit
 *
 * Pipeline:
 *   1. For each captured first-prompt, look up the session's profile via
 *      analytics (cwd/time-window match).
 *   2. Cluster first-prompts by keyword similarity (reuses cluster-skills lib).
 *   3. For each cluster of ≥3 similar sessions, ask Claude to draft a SKILL.md
 *      describing the pattern. (Fail-open: cluster name used if claude is
 *      unavailable.)
 *   4. Write drafts under .cue-skill-drafts/<slug>/SKILL.md for review.
 *
 * Closes the learning loop opened by `cue profile evolve`: detect the gap,
 * suggest the skill, let the user adopt it.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { clusterByKeywords, type ClusterItem } from "../lib/cluster-skills";
import { readEvents, } from "../lib/analytics";
import { findRealClaudeBin } from "../lib/claude-binary";
import { repoRoot } from "../lib/repo-root";

const FIRST_PROMPTS_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue", "first-prompts",
);

interface CapturedPrompt {
  ts: string;
  cwd: string;
  session_id: string;
  prompt: string;
}

interface SessionPattern {
  prompt: string;
  cwd: string;
  ts: string;
  profile: string | null;
}

function loadCapturedPrompts(): CapturedPrompt[] {
  if (!existsSync(FIRST_PROMPTS_DIR)) return [];
  const out: CapturedPrompt[] = [];
  for (const f of readdirSync(FIRST_PROMPTS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(readFileSync(join(FIRST_PROMPTS_DIR, f), "utf8")) as CapturedPrompt;
      if (doc?.prompt && doc.cwd) out.push(doc);
    } catch { /* skip malformed */ }
  }
  return out;
}

/**
 * Match each captured prompt to a profile by finding the analytics `start`
 * event with the same cwd whose ts is within 60s of the prompt's ts.
 */
function attributeProfiles(prompts: CapturedPrompt[], since: Date): SessionPattern[] {
  const events = readEvents(since).filter(e => e.event === "start");
  return prompts.map(p => {
    const promptTs = new Date(p.ts).getTime();
    let bestProfile: string | null = null;
    let bestDelta = Infinity;
    for (const e of events) {
      if (e.cwd !== p.cwd) continue;
      const delta = Math.abs(new Date(e.ts).getTime() - promptTs);
      if (delta < bestDelta && delta < 60 * 60 * 1000) {
        bestDelta = delta;
        bestProfile = e.profile ?? null;
      }
    }
    return { prompt: p.prompt, cwd: p.cwd, ts: p.ts, profile: bestProfile };
  });
}

interface DraftedSkill {
  slug: string;
  description: string;
  pattern: string;
  examplePrompts: string[];
}

function draftSkillWithClaude(clusterTerm: string, examples: string[]): DraftedSkill {
  const exemplars = examples.slice(0, 6).map(s => `- ${s.slice(0, 200)}`).join("\n");
  const prompt = `You draft Claude Code SKILL.md files. Given a cluster of recurring user prompts that the agent currently has NO dedicated skill for, propose a new skill.

Cluster keyword: "${clusterTerm}"
Example prompts:
${exemplars}

Output EXACTLY this format (no other text):
SLUG: <lowercase-kebab, 1-3 words>
DESCRIPTION: <one line, under 100 chars, what this skill is for>
PATTERN: <2-3 short sentences describing the workflow the skill should encode>`;

  const tryOne = (bin: string) => spawnSync(bin, ["--print", "-p", prompt], {
    encoding: "utf8", timeout: 30_000, env: { ...process.env, CUE_BYPASS: "1" },
  });
  let res = tryOne("claude");
  if (res.status !== 0 || !res.stdout?.trim()) {
    const fallback = findRealClaudeBin();
    if (fallback) res = tryOne(fallback);
  }

  const fallbackSlug = clusterTerm.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  if (res.status !== 0 || !res.stdout?.trim()) {
    return {
      slug: fallbackSlug,
      description: `Skill for sessions about "${clusterTerm}" (Claude unavailable — name from cluster term)`,
      pattern: "Pattern detected from recurring user prompts. Fill this in by hand.",
      examplePrompts: examples,
    };
  }
  const out = res.stdout.trim();
  const slugMatch = out.match(/SLUG:\s*([a-z0-9][a-z0-9-]*)/i);
  const descMatch = out.match(/DESCRIPTION:\s*(.+)/i);
  const patternMatch = out.match(/PATTERN:\s*([\s\S]+?)(?:\n[A-Z]+:|$)/i);
  return {
    slug: (slugMatch?.[1] ?? fallbackSlug).toLowerCase(),
    description: (descMatch?.[1] ?? `Pattern around "${clusterTerm}"`).trim().slice(0, 120),
    pattern: (patternMatch?.[1] ?? "").trim().slice(0, 500) || `Pattern: recurring prompts about ${clusterTerm}`,
    examplePrompts: examples,
  };
}

function buildSkillMd(draft: DraftedSkill): string {
  return `---
name: ${draft.slug}
description: ${draft.description}
domain: drafted
tags: [drafted, from-sessions]
---

# ${draft.slug}

> Drafted by \`cue profile draft-skill\` from ${draft.examplePrompts.length} recurring session prompts.
> Review, refine, then move to \`resources/skills/skills/<category>/${draft.slug}/SKILL.md\` to adopt.

## When to use

${draft.description}

## Pattern

${draft.pattern}

## Example prompts that triggered this draft

${draft.examplePrompts.slice(0, 8).map(p => `- ${p}`).join("\n")}

## TODO

- [ ] Sharpen the description (current one is auto-generated).
- [ ] Decide the right \`category/slug\` location.
- [ ] Add concrete steps the agent should follow.
- [ ] Pick \`allowed-tools\`, \`model\` overrides, etc., if needed.
- [ ] Delete this TODO section before adopting.
`;
}

// ---------------------------------------------------------------------------
// Tiny ANSI helpers
// ---------------------------------------------------------------------------

const noColor = !process.stdout.isTTY || !!process.env.NO_COLOR;
const bold = (s: string) => noColor ? s : `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => noColor ? s : `\x1b[2m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue profile draft-skill — propose new SKILL.md files from recurring session prompts

Usage:
  cue profile draft-skill                  All profiles
  cue profile draft-skill <profile>        One profile

Options:
  --since <days>     Only consider prompts in the last N days (default: 90)
  --min-size <n>     Cluster size threshold (default: 3)
  --out <dir>        Output directory (default: .cue-skill-drafts/)
  --no-claude        Skip naming step; use cluster term verbatim
  --dry-run          Preview without writing files

Data source: ~/.config/cue/first-prompts/  (populated by first-prompt-capture hook)
             ~/.config/cue/analytics.jsonl (populated by cue launch + Stop hooks)

Output: draft SKILL.md files under .cue-skill-drafts/<slug>/ for manual review.
`);
    return 0;
  }

  const sinceIdx = args.indexOf("--since");
  const sinceDays = sinceIdx >= 0 ? parseInt(args[sinceIdx + 1] ?? "90", 10) : 90;
  const minSizeIdx = args.indexOf("--min-size");
  const minSize = minSizeIdx >= 0 ? parseInt(args[minSizeIdx + 1] ?? "3", 10) : 3;
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]!
    : join(repoRoot(), ".cue-skill-drafts");
  const dryRun = args.includes("--dry-run");
  const noClaude = args.includes("--no-claude");

  const positional = args.filter((a, i) =>
    !a.startsWith("--") && (i === 0 || !["--since", "--min-size", "--out"].includes(args[i - 1] ?? "")),
  );
  const targetProfile = positional[0];

  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const captured = loadCapturedPrompts();

  if (captured.length === 0) {
    process.stdout.write(`\n  ${dim("No first-prompts captured yet.")}\n`);
    process.stdout.write(`  ${dim("Set CUE_SMART_SUBSET=1 in your shell and run a few cue launch sessions.")}\n`);
    process.stdout.write(`  ${dim("The first-prompt-capture hook (in profiles/core) will populate ~/.config/cue/first-prompts/.")}\n\n`);
    return 0;
  }

  let patterns = attributeProfiles(captured, since);
  if (targetProfile) patterns = patterns.filter(p => p.profile === targetProfile);

  if (patterns.length < minSize) {
    process.stdout.write(`\n  Only ${patterns.length} captured prompt(s)${targetProfile ? ` for profile ${targetProfile}` : ""} — need ≥${minSize} to cluster.\n\n`);
    return 0;
  }

  const items: ClusterItem[] = patterns.map((p, i) => ({
    id: `prompt-${i}`,
    text: p.prompt,
  }));

  const clusters = clusterByKeywords(items, { minSize, maxClusters: 6 });
  if (clusters.length === 0) {
    process.stdout.write(`\n  No clusters of ≥${minSize} similar prompts found among ${patterns.length} captures.\n`);
    process.stdout.write(`  ${dim("Try a wider --since window once you've used cue more.")}\n\n`);
    return 0;
  }

  process.stdout.write(`\n  ${bold(`Found ${clusters.length} session pattern cluster(s)`)} ${dim(`from ${patterns.length} captured prompts`)}\n\n`);

  const drafts: DraftedSkill[] = [];
  for (const cluster of clusters) {
    const examples = cluster.items.map(i => patterns[parseInt(i.id.replace("prompt-", ""), 10)]!.prompt);
    process.stdout.write(`  ▸ "${cluster.term}" (${cluster.items.length} sessions)\n`);
    for (const ex of examples.slice(0, 3)) {
      process.stdout.write(`      · ${ex.slice(0, 80)}${ex.length > 80 ? "…" : ""}\n`);
    }
    const draft = noClaude
      ? {
          slug: cluster.term.replace(/\s+/g, "-").toLowerCase(),
          description: `Pattern around "${cluster.term}"`,
          pattern: "Recurring user prompts share this keyword.",
          examplePrompts: examples,
        }
      : draftSkillWithClaude(cluster.term, examples);
    process.stdout.write(`      → drafting skill: ${bold(draft.slug)} — ${draft.description}\n\n`);
    drafts.push(draft);
  }

  if (dryRun) {
    process.stdout.write(`  [dry-run] Would write ${drafts.length} draft SKILL.md file(s) under ${outDir}\n`);
    return 0;
  }

  mkdirSync(outDir, { recursive: true });
  for (const draft of drafts) {
    const skillDir = join(outDir, draft.slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), buildSkillMd(draft));
  }
  process.stdout.write(`  📝 Wrote ${drafts.length} draft SKILL.md file(s) to ${outDir}\n`);
  process.stdout.write(`     Review, refine, then mv <draft>/ resources/skills/skills/<category>/<slug>/ to adopt.\n`);
  return 0;
}
