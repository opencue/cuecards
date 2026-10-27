/**
 * Pure (no-React) utilities for the Explorer view.
 * Extracted so they can be unit-tested without a React JSX runtime.
 */

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Locate the best line in a SKILL.md to highlight for a given CLI, mirroring
 * the server's detection priority but returning a position:
 *   1. First command-position use inside a code span (the real "here's how you
 *      run it" line — what the user wants to jump to).
 *   2. Else the frontmatter `allowed-tools: Bash(<cli>…)` declaration line.
 *   3. Else the first prose mention. Returns -1 when the CLI never appears.
 */
export function findCliLine(body: string, cli: string): number {
  const lines = body.split("\n");
  const word = new RegExp(`(^|[^\\w-])${escapeRe(cli.toLowerCase())}([^\\w-]|$)`);
  let frontLine = -1, codeLine = -1, anyLine = -1;
  let fm = 0, inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln.trim() === "---" && !inCode) { fm++; continue; }
    const trimmed = ln.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) { inCode = !inCode; continue; }
    const low = ln.toLowerCase();
    if (!word.test(low)) continue;
    if (anyLine < 0) anyLine = i;
    if (fm === 1) {
      if (frontLine < 0 && (low.includes("bash(") || low.includes("allowed-tools"))) frontLine = i;
    } else if (codeLine < 0 && (inCode || low.includes("`" + cli.toLowerCase()) || /^\s*\$/.test(ln))) {
      codeLine = i;
    }
  }
  return codeLine >= 0 ? codeLine : frontLine >= 0 ? frontLine : anyLine;
}
