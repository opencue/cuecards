/**
 * Playbook and command-frontmatter parsers extracted from dashboard-server.ts.
 * Pure string manipulation — no I/O.
 */

import type { ProfileCli } from "./skill-clis";

export interface StudioSkill {
  id: string;
  ns: string;
  name: string;
  desc: string;
  sizeK: number;
  body: string;
  uses: string[];
  missing: boolean;
}

/** One `##` heading of a playbook, rendered as a step chip in the studio. */
export interface PlaybookStep {
  name: string;
  detail: string;
}

/** A profile's playbook, shaped for the studio Workflows page. */
export interface PlaybookWorkflow {
  id: string;
  name: string;
  title: string;
  emoji: string;
  trigger: string;
  est: string;
  desc: string;
  steps: PlaybookStep[];
}

/** A delegatable subagent ref, split into its division + slug for grouping. */
export interface SubagentRef {
  /** The raw ref, e.g. "design/design-ui-designer". */
  id: string;
  /** First path segment — the agency division (design, finance, sales…). */
  division: string;
  /** Trailing slug — the agent name. */
  name: string;
}

/** A profile slash-command, resolved from its on-disk markdown source. */
export interface StudioCommand {
  /** Display name with the leading slash, e.g. "/goal". */
  name: string;
  /** Bare ref / file stem used to resolve the source, e.g. "goal". */
  ref: string;
  /** One-line `description:` from frontmatter ("" when absent / unresolved). */
  desc: string;
  /** Optional `argument-hint:` from frontmatter. */
  argHint: string | null;
  /** Full markdown body, rendered in the studio editor preview. */
  body: string;
  /** KB size of the source file (0 when unresolved). */
  sizeK: number;
  /** True when no source .md resolved (built-in / plugin-provided command). */
  missing: boolean;
}

export interface ProfileDetail {
  profile: string;
  parts: string[];
  counts: { skills: number; mcps: number; plugins: number; commands: number; subagents: number; clis: number };
  skills: StudioSkill[];
  mcps: { id: string; status: string }[];
  plugins: { id: string; name: string; marketplace: string; status: string }[];
  commands: StudioCommand[];
  /** Real on-disk workflows: the playbooks this profile declares, parsed. */
  playbooks: PlaybookWorkflow[];
  /** Delegatable specialists this profile wires into `.claude/agents/`. */
  subagents: SubagentRef[];
  /** External CLI tools the profile's skills declare (frontmatter Bash refs). */
  clis: ProfileCli[];
  /** Companion profiles the active profile recommends pairing with. */
  recommends: string[];
}

/** Pull a `uses:` (or `mcps:`) frontmatter list out of a SKILL.md, if present. */
export function parseUsesFromFrontmatter(content: string): string[] {
  const lines = content.split("\n");
  if (lines[0] !== "---") return [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const m = lines[i]!.match(/^(?:uses|mcps):\s*\[([^\]]*)\]/);
    if (m) {
      return m[1]!
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
  }
  return [];
}

/** Strip a single matched pair of wrapping quotes — never an unbalanced lone quote. */
export function stripWrappingQuotes(s: string): string {
  return s.replace(/^(['"])([\s\S]*)\1$/, "$2");
}

/** Pull `description:` and `argument-hint:` out of a command markdown's frontmatter. */
export function parseCommandFrontmatter(content: string): { desc: string; argHint: string | null } {
  // Normalize CRLF so an externally-authored (Windows) command file's "---\r"
  // fence still matches the delimiter check below.
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return { desc: "", argHint: null };
  let desc = "";
  let argHint: string | null = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const d = lines[i]!.match(/^description:\s*(.+)$/);
    if (d) desc = stripWrappingQuotes(d[1]!.trim());
    const a = lines[i]!.match(/^argument-hint:\s*(.+)$/);
    if (a) argHint = stripWrappingQuotes(a[1]!.trim());
  }
  return { desc, argHint };
}

/** Placeholder body for a command with no on-disk source (plugin / built-in). */
export function stubCommandBody(name: string): string {
  return `---
command: ${name}
source: plugin or built-in
---

# ${name}

This command has no markdown source in \`resources/commands/\` — it is contributed by an installed plugin or built in to the agent, so its body isn't stored locally. Invoke it by typing \`${name}\` in the prompt.`;
}

/** Map a playbook slug/title to a stable emoji for its workflow card. */
export function playbookEmoji(hint: string): string {
  const s = hint.toLowerCase();
  // Specific themes first — generic "ship/deploy" verbs appear in many titles.
  if (/bug|triage|debug/.test(s)) return "🐛";
  if (/sprint/.test(s)) return "🏃";
  if (/improve|clean|refactor|health/.test(s)) return "🔧";
  if (/skill/.test(s)) return "🧪";
  if (/research|analyze|investigate/.test(s)) return "🔍";
  if (/security|secops|cso/.test(s)) return "🛡";
  if (/doc|write/.test(s)) return "📝";
  if (/growth|market/.test(s)) return "📈";
  if (/vite|web|frontend|design/.test(s)) return "🎨";
  if (/medusa|shop|commerce/.test(s)) return "🛒";
  if (/ship|deploy|release|land|canary/.test(s)) return "🚀";
  return "📋";
}

/** Rough token estimate (~4 chars/token) → compact "~1.2K" label. */
export function estTokensLabel(chars: number): string {
  const t = Math.max(1, Math.round(chars / 4));
  if (t < 1000) return `~${t}`;
  return `~${(t / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

/** Collapse whitespace and cap a string with an ellipsis. */
export function collapse(s: string, cap = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > cap ? t.slice(0, cap - 1).trimEnd() + "…" : t;
}

/** Strip leading markdown markers (bullets, numbers, bold) from a line. */
export function cleanMdLine(s: string): string {
  return s.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/\*\*/g, "").trim();
}

/**
 * Parse a playbook markdown doc into a workflow-card model:
 *  - `title` from the `# Playbook: …` H1 (falls back to the prettified slug),
 *  - `desc` from the first "Use when …" paragraph (falls back to the first
 *    non-heading paragraph),
 *  - one `step` per `##` heading, numbered prefix stripped, with a one-line
 *    `detail` pulled from that section's first body line.
 */
export function parsePlaybook(slug: string, content: string): PlaybookWorkflow {
  const lines = content.split("\n");

  let title = slug.replace(/[-_]/g, " ");
  const h1Idx = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1Idx >= 0) {
    const m = lines[h1Idx]!.match(/^#\s+(?:Playbook:\s*)?(.+)$/);
    if (m) title = m[1]!.trim();
  }

  let desc = "";
  const gatherParagraph = (start: number): string => {
    const para: string[] = [];
    for (let i = start; i < lines.length && lines[i]!.trim() !== ""; i++) para.push(lines[i]!);
    return collapse(para.join(" "));
  };
  const useIdx = lines.findIndex((l) => /use when/i.test(l));
  if (useIdx >= 0) {
    desc = gatherParagraph(useIdx);
  } else {
    for (let i = h1Idx + 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (!l || l.startsWith("#")) continue;
      desc = gatherParagraph(i);
      break;
    }
  }

  const steps: PlaybookStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^##\s+(.+)$/);
    if (!m) continue;
    const name = collapse(m[1]!.replace(/^\d+\.\s*/, ""), 60);
    let detail = "";
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s+/.test(lines[j]!)) break;
      const c = cleanMdLine(lines[j]!);
      if (c) { detail = collapse(c, 140); break; }
    }
    steps.push({ name, detail });
  }

  return {
    id: slug,
    name: slug,
    title,
    emoji: playbookEmoji(`${slug} ${title}`),
    trigger: "playbook",
    est: estTokensLabel(content.length),
    desc: desc || `Playbook: ${title}`,
    steps,
  };
}
