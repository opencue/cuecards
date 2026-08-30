/**
 * Skill conflict detection — find opposing directives between skills.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

interface Directive {
  skillId: string;
  text: string;
  type: "prefer" | "avoid" | "always" | "never" | "use";
  domain: string; // extracted from tags/category
  subjectTokens: Set<string>; // normalized tokens of the directive's subject
}

export interface Conflict {
  skillA: string;
  skillB: string;
  directiveA: string;
  directiveB: string;
  domain: string;
}

const DIRECTIVE_PATTERNS = [
  { re: /\b(always|must)\s+(?:use\s+)?(.+?)(?:\.|,|$)/gim, type: "always" as const, subjectGroup: 2 },
  { re: /\b(?:never|don't|do not|avoid)\s+(?:use\s+)?(.+?)(?:\.|,|$)/gim, type: "never" as const, subjectGroup: 1 },
  { re: /\b(?:prefer)\s+(.+?)(?:\s+over\s+.+?)?(?:\.|,|$)/gim, type: "prefer" as const, subjectGroup: 1 },
  { re: /\b(?:avoid)\s+(.+?)(?:\.|,|$)/gim, type: "avoid" as const, subjectGroup: 1 },
  { re: /\buse\s+(.+?)\s+(?:instead of|over|rather than)\s+(.+?)(?:\.|,|$)/gim, type: "use" as const, subjectGroup: 1 },
];

// Strip leading YAML frontmatter — name/description metadata isn't a behavioral directive.
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  return end === -1 ? content : content.slice(end + 4);
}

const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "for", "with", "and", "or", "be",
  "is", "are", "was", "were", "this", "that", "it", "them", "they", "you",
  "your", "we", "our", "us", "i", "my", "me", "any", "all", "no", "not",
  "only", "just", "do", "does", "doing", "done", "can", "may", "should",
  "would", "could", "will", "shall", "must", "have", "has", "had", "but",
  "if", "as", "at", "by", "from", "into", "than", "then", "so", "such",
  "very", "also", "more", "most", "even", "still", "ever", "again", "use",
  "using", "used", "when", "where", "what", "who", "how", "why", "via",
  "skill", "skills", "rules", "rule", "active", "exceptions", "exception",
  "silently", "always", "never", "thing", "things",
]);

function tokenize(subject: string): Set<string> {
  return new Set(
    subject
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOPWORDS.has(t))
      .slice(0, 8), // cap to first 8 meaningful tokens — anything beyond is preamble
  );
}

function extractDirectives(skillId: string): Directive[] {
  const skillPath = join(SKILLS_ROOT, skillId, "SKILL.md");
  let content: string;
  try { content = readFileSync(skillPath, "utf8"); } catch { return []; }
  content = stripFrontmatter(content);

  const category = skillId.split("/")[0] ?? "unknown";
  const directives: Directive[] = [];

  for (const { re, type, subjectGroup } of DIRECTIVE_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const subject = match[subjectGroup] ?? "";
      const subjectTokens = tokenize(subject);
      if (subjectTokens.size === 0) continue; // no meaningful subject — skip
      directives.push({
        skillId,
        text: match[0].trim().slice(0, 100),
        type,
        domain: category,
        subjectTokens,
      });
    }
  }
  return directives;
}

function subjectsOverlap(a: Directive, b: Directive): boolean {
  for (const t of a.subjectTokens) if (b.subjectTokens.has(t)) return true;
  return false;
}

function areOpposing(a: Directive, b: Directive): boolean {
  if (a.domain !== b.domain) return false;
  // Subjects must share at least one meaningful token. "Always run tests" vs
  // "Never run tests" overlaps on "run"/"tests"; "Always active" vs "Don't
  // suggest the flag" shares nothing and is not a conflict.
  if (!subjectsOverlap(a, b)) return false;
  // "always X" vs "never X" or "avoid X"
  if (a.type === "always" && (b.type === "never" || b.type === "avoid")) return true;
  if (b.type === "always" && (a.type === "never" || a.type === "avoid")) return true;
  // "prefer X" vs "avoid X"
  if (a.type === "prefer" && b.type === "avoid") return true;
  if (b.type === "prefer" && a.type === "avoid") return true;
  return false;
}

export function detectConflicts(skillIds: string[]): Conflict[] {
  const allDirectives: Directive[] = [];
  for (const id of skillIds) {
    allDirectives.push(...extractDirectives(id));
  }

  const conflicts: Conflict[] = [];
  for (let i = 0; i < allDirectives.length; i++) {
    for (let j = i + 1; j < allDirectives.length; j++) {
      const a = allDirectives[i]!;
      const b = allDirectives[j]!;
      if (a.skillId === b.skillId) continue;
      if (areOpposing(a, b)) {
        conflicts.push({
          skillA: a.skillId,
          skillB: b.skillId,
          directiveA: a.text,
          directiveB: b.text,
          domain: a.domain,
        });
      }
    }
  }

  // Detect allowed-tools conflicts
  conflicts.push(...detectAllowedToolsConflicts(skillIds));
  // Detect persona conflicts
  conflicts.push(...detectPersonaConflicts(skillIds));

  return conflicts;
}

/**
 * Detect contradicting allowed-tools: one skill allows Bash(*) broadly,
 * another restricts it to specific patterns.
 */
function detectAllowedToolsConflicts(skillIds: string[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const toolSpecs: { id: string; tools: string[] }[] = [];

  for (const id of skillIds) {
    const skillPath = join(SKILLS_ROOT, id, "SKILL.md");
    try {
      const content = readFileSync(skillPath, "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const atMatch = fmMatch[1]!.match(/^allowed-tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
      if (!atMatch) continue;
      const tools = atMatch[1]!.match(/^\s+-\s+(.+)$/gm)?.map(l => l.replace(/^\s+-\s+/, "").trim()) ?? [];
      if (tools.length) toolSpecs.push({ id, tools });
    } catch {}
  }

  for (let i = 0; i < toolSpecs.length; i++) {
    for (let j = i + 1; j < toolSpecs.length; j++) {
      const a = toolSpecs[i]!;
      const b = toolSpecs[j]!;
      // Check for broad vs restricted patterns on same tool family
      for (const ta of a.tools) {
        for (const tb of b.tools) {
          const familyA = ta.split("(")[0]?.trim() ?? ta;
          const familyB = tb.split("(")[0]?.trim() ?? tb;
          if (familyA !== familyB) continue;
          const isWildA = ta.includes("(*)") || ta.includes("(**)");
          const isWildB = tb.includes("(*)") || tb.includes("(**)");
          if (isWildA !== isWildB) {
            conflicts.push({
              skillA: a.id, skillB: b.id,
              directiveA: `allowed-tools: ${ta}`,
              directiveB: `allowed-tools: ${tb}`,
              domain: "allowed-tools",
            });
          }
        }
      }
    }
  }
  return conflicts;
}

/**
 * Detect contradicting persona directives (verbose vs terse, etc.)
 */
const PERSONA_OPPOSITES: [RegExp, RegExp][] = [
  [/\b(be verbose|detailed responses|explain thoroughly)\b/i, /\b(be terse|be concise|minimal output|brief responses)\b/i],
  [/\b(always ask before)\b/i, /\b(never ask|just do it|act without asking)\b/i],
  [/\b(write tests first|TDD)\b/i, /\b(skip tests|no tests needed)\b/i],
];

function detectPersonaConflicts(skillIds: string[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const personas: { id: string; text: string }[] = [];

  for (const id of skillIds) {
    const skillPath = join(SKILLS_ROOT, id, "SKILL.md");
    try {
      const content = readFileSync(skillPath, "utf8");
      const body = stripFrontmatter(content);
      // Look for persona-like sections
      const personaMatch = body.match(/##\s*(?:Persona|Style|Behavior|Tone)\s*\n([\s\S]*?)(?=\n##|\n$)/i);
      if (personaMatch) personas.push({ id, text: personaMatch[1]! });
    } catch {}
  }

  for (let i = 0; i < personas.length; i++) {
    for (let j = i + 1; j < personas.length; j++) {
      const a = personas[i]!;
      const b = personas[j]!;
      for (const [patA, patB] of PERSONA_OPPOSITES) {
        const matchA1 = a.text.match(patA);
        const matchB2 = b.text.match(patB);
        if (matchA1 && matchB2) {
          conflicts.push({
            skillA: a.id, skillB: b.id,
            directiveA: matchA1[0].slice(0, 80),
            directiveB: matchB2[0].slice(0, 80),
            domain: "persona",
          });
        }
        const matchA2 = a.text.match(patB);
        const matchB1 = b.text.match(patA);
        if (matchA2 && matchB1) {
          conflicts.push({
            skillA: a.id, skillB: b.id,
            directiveA: matchA2[0].slice(0, 80),
            directiveB: matchB1[0].slice(0, 80),
            domain: "persona",
          });
        }
      }
    }
  }
  return conflicts;
}

export interface Resolution {
  conflict: Conflict;
  suggestion: "prioritize-a" | "prioritize-b" | "remove-a" | "remove-b" | "merge";
  reason: string;
}

/**
 * Suggest resolutions for detected conflicts.
 */
export function suggestResolutions(conflicts: Conflict[]): Resolution[] {
  return conflicts.map(c => {
    // Heuristic: if one is in a more specific domain, prioritize it
    const aDepth = c.skillA.split("/").length;
    const bDepth = c.skillB.split("/").length;
    if (aDepth > bDepth) {
      return { conflict: c, suggestion: "prioritize-a" as const, reason: `${c.skillA} is more specific` };
    }
    if (bDepth > aDepth) {
      return { conflict: c, suggestion: "prioritize-b" as const, reason: `${c.skillB} is more specific` };
    }
    return { conflict: c, suggestion: "prioritize-a" as const, reason: "alphabetical precedence" };
  });
}
