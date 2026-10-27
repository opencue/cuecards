/**
 * Pure string manipulation helpers for profile.yaml skill sections.
 * No I/O — callers are responsible for reading/writing the file.
 */

/**
 * Insert or replace the skills.local entries in a profile.yaml string.
 *
 * - "append": adds `ids` after the last existing local entry (or creates the
 *   section if it does not yet exist).
 * - "replace": replaces all existing local entries with `ids`.
 *
 * The function handles three structural cases:
 *   1. An existing `  local:` block — edit in-place.
 *   2. An existing `skills:` key with no `local:` — inject `local:` under it.
 *   3. No `skills:` key at all — append the whole block at EOF.
 */
export function insertSkillsIntoYaml(
  content: string,
  ids: string[],
  mode: "append" | "replace",
): string {
  const skillLines = ids.map((s) => `    - ${s}`);
  const joined = skillLines.join("\n");

  if (content.includes("  local:")) {
    const lines = content.split("\n");
    const localIdx = lines.findIndex((l) => /^\s+local:/.test(l));
    let endIdx = localIdx + 1;
    while (endIdx < lines.length && lines[endIdx]?.match(/^\s{4}-\s/)) endIdx++;
    if (mode === "replace") {
      lines.splice(localIdx + 1, endIdx - localIdx - 1, ...skillLines);
    } else {
      // append: insert after the last existing local entry
      lines.splice(endIdx, 0, ...skillLines);
    }
    return lines.join("\n");
  } else if (content.includes("skills:")) {
    return content.replace(/^(skills:)\s*$/m, `$1\n  local:\n${joined}`);
  } else {
    return content.trimEnd() + `\nskills:\n  local:\n${joined}\n`;
  }
}
