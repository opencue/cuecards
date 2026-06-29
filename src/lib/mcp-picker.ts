/**
 * MCP toggle — the launcher step that lets a user disable individual MCP
 * servers before launch.
 *
 * Default-on: every prunable MCP starts CHECKED. The picker is opt-OUT — hit
 * enter to keep them all, or uncheck the ones you don't want this session. Rows
 * carry a reason ("used by skill X" vs "not referenced") so an informed
 * un-check is easy, but nothing is dropped unless the user says so.
 *
 * Rendering: clack's built-in multiselect draws its checkbox with U+25FB/U+25FC
 * squares, which show as BLANKS in many kitty/tmux fonts — so the user can't
 * see what's on or off (the same bug `picker.ts` hit for the profile combiner).
 * We drive @clack/core's MultiSelectPrompt with a custom ASCII frame instead:
 * `[x]`/`[ ]` boxes, bold group headers with counts, and an aligned reason
 * column — matching the profile picker's visual language.
 *
 * Pinned MCPs (used by the agent directly) can't be meaningfully disabled, so
 * they're surfaced in an "Always on" note and always folded back into the result.
 *
 * Returns the set of kept MCP ids (original casing), or `null` if cancelled —
 * the caller treats null as "leave the MCP set unchanged, persist nothing".
 */

import * as p from "@clack/prompts";
import { MultiSelectPrompt } from "@clack/core";
import { styleText } from "node:util";
import { CATEGORY_RULE_COL, displayWidth, windowOptions } from "./picker.ts";

export interface McpPickInput {
  /** Full profile MCP id list (original casing). */
  profileMcpIds: string[];
  /** Lowercased ids that are pinned (always kept). */
  pinned: Set<string>;
  /** Lowercased mcpId -> who needs it. From getNeededMcps(). */
  needed: Map<string, { skills: string[]; source: "explicit" | "implicit" }>;
}

const MESSAGE = "MCP servers to load";
const GROUP_LABEL: Record<McpRow["group"], string> = {
  used: "Used by active skills",
  unused: "Not referenced (optional)",
};

/**
 * Curated heavy / niche MCPs that render UNCHECKED in the interactive picker
 * even when a skill references them — the user opts in by checking the box.
 *
 * Scope: this is a *picker default* (`buildMcpRows`), NOT a global policy. It
 * only takes effect when the interactive toggle actually runs. Non-interactive
 * launches (no TTY, `--disable-mcp`, or replaying a remembered override) keep
 * every profile-declared MCP — that fail-open "keep all" is deliberate, so a CI
 * or piped run never silently loses an MCP the profile asked for. So a profile
 * that lists one of these still loads it until a human reviews the picker once.
 *
 * Lowercased ids; matched case-insensitively. The row keeps its real group;
 * only the checkbox and reason change ("off by default").
 */
export const DEFAULT_OFF_MCPS = new Set([
  "postiz",
  "mapi-devdocs",
  "google-analytics-mcp",
  "trendradar",
  "cue-tty-watch",
]);

/**
 * Prompt the user to toggle prunable MCPs. Pure list-building (`buildMcpRows`)
 * and pure rendering (`renderMcpFrame`) are split out so both are unit-testable
 * without a TTY.
 */
export async function pickMcps(input: McpPickInput): Promise<Set<string> | null> {
  const { prunable, pinnedIds } = buildMcpRows(input);

  // Nothing to decide — every MCP is pinned (or there are none). Keep all.
  if (prunable.length === 0) {
    return new Set(input.profileMcpIds);
  }

  if (pinnedIds.length > 0) {
    p.note(
      pinnedIds.map((id) => styleText("cyan", id)).join("  "),
      styleText("dim", "Always on · agent core"),
    );
  }

  // Order used-first then unused so the cursor walks skill-backed MCPs before
  // the optional ones, and the two group headers render in a stable order.
  const rows = [
    ...prunable.filter((r) => r.group === "used"),
    ...prunable.filter((r) => r.group === "unused"),
  ];
  const initialValues = rows.filter((r) => r.preselect).map((r) => r.id);

  const prompt = new MultiSelectPrompt<{ value: string; label: string }>({
    options: rows.map((r) => ({ value: r.id, label: r.id })),
    initialValues,
    required: false,
    render() {
      const live = this as unknown as { cursor: number; value?: string[]; output?: { rows?: number } };
      const termRows = live.output?.rows ?? process.stdout.rows ?? 24;
      return renderMcpFrame({
        rows,
        cursor: live.cursor,
        selected: new Set(live.value ?? []),
        // Reserve lines for the gutter (3), both headers + spacer (3), the
        // footer (2), and the ↑/↓ markers (2); floor at 4 for short terminals.
        maxRows: Math.max(4, termRows - 10),
      });
    },
  });

  const result = await prompt.prompt();
  if (typeof result === "symbol") return null;

  // Pinned ids are always kept; union with the user's prunable selection.
  const kept = new Set<string>(pinnedIds);
  for (const id of result as string[]) kept.add(id);
  return kept;
}

export interface McpRow {
  id: string;
  preselect: boolean;
  hint: string;
  /** Which section the row renders under in the grouped picker. */
  group: "used" | "unused";
}

/**
 * Split the profile's MCPs into pinned (always-on, original casing) and
 * prunable rows. Every prunable row is `preselect: true` (default-on); the
 * `group`/`hint` only carry the *reason*, so an opt-out is informed. Lookups are
 * case-insensitive (needed/pinned are lowercased; ids keep original casing).
 */
export function buildMcpRows(input: McpPickInput): { prunable: McpRow[]; pinnedIds: string[] } {
  const pinnedIds: string[] = [];
  const prunable: McpRow[] = [];

  for (const id of input.profileMcpIds) {
    const key = id.toLowerCase();
    if (input.pinned.has(key)) {
      pinnedIds.push(id);
      continue;
    }
    const need = input.needed.get(key);
    const group: McpRow["group"] = need !== undefined ? "used" : "unused";
    // Curated default-off MCPs start unchecked regardless of group; their reason
    // becomes "off by default" so the empty box reads as intentional, not a bug.
    if (DEFAULT_OFF_MCPS.has(key)) {
      prunable.push({ id, preselect: false, group, hint: "off by default" });
      continue;
    }
    if (need !== undefined) {
      // Compact reason: lead skill + "+N" so it never wraps the aligned column.
      const [first, ...rest] = need.skills;
      const hint = rest.length > 0 ? `${first} +${rest.length}` : (first ?? "");
      prunable.push({ id, preselect: true, group: "used", hint });
    } else {
      prunable.push({ id, preselect: true, group: "unused", hint: "no active skill references it" });
    }
  }

  return { prunable, pinnedIds };
}

export interface McpFrameState {
  /** Ordered rows (used group first, then unused). */
  rows: McpRow[];
  /** Cursor index into `rows`. */
  cursor: number;
  /** Currently-checked ids (option value === McpRow.id). */
  selected: Set<string>;
  /** Visible-row cap for windowing; 0/undefined → show all. */
  maxRows?: number;
}

/**
 * Render the live frame string. Pure (no TTY, no prompt object) so the displayed
 * frame and the tested frame are the same code. `styleText` is a no-op when
 * stdout isn't a TTY (as in tests), so assertions match on plain text.
 */
export function renderMcpFrame(state: McpFrameState): string {
  const BAR = styleText("gray", "│");
  const { rows } = state;
  const counts = {
    used: rows.filter((r) => r.group === "used").length,
    unused: rows.filter((r) => r.group === "unused").length,
  };
  // Shared column where every reason hint starts, so they line up in a clean
  // table. Capped so one long id can't push the whole column off a narrow term.
  const labelCol = Math.min(24, rows.reduce((m, r) => Math.max(m, displayWidth(r.id)), 0));

  const lines: string[] = [];
  lines.push(BAR);
  lines.push(`${BAR}  ${MESSAGE}`);
  lines.push(BAR);

  const indexed = rows.map((r, i) => ({ r, i }));
  const max = state.maxRows && state.maxRows > 0 ? state.maxRows : rows.length;
  const win = windowOptions(indexed, state.cursor, max);
  if (win.hiddenAbove > 0) lines.push(`${BAR}  ${styleText("dim", `↑ ${win.hiddenAbove} more`)}`);

  let lastGroup: McpRow["group"] | undefined;
  for (const { r, i } of win.items) {
    if (r.group !== lastGroup) {
      // Blank spacer between groups (never before the first / window top).
      if (lastGroup !== undefined) lines.push(BAR);
      const label = GROUP_LABEL[r.group];
      const labelStyled = styleText("bold", styleText("blueBright", label));
      const ruleLen = Math.max(3, CATEGORY_RULE_COL - displayWidth(label) - 2);
      const rule = styleText("gray", "─".repeat(ruleLen));
      lines.push(`${BAR}  ${labelStyled} ${rule} ${styleText("dim", String(counts[r.group]))}`);
      lastGroup = r.group;
    }
    const isCursor = i === state.cursor;
    const isSel = state.selected.has(r.id);
    const arrow = isCursor ? styleText("cyan", "›") : " ";
    const box = isSel ? styleText("green", "[x]") : styleText("dim", "[ ]");
    const idStyled = isSel || isCursor ? r.id : styleText("dim", r.id);
    const pad = " ".repeat(Math.max(2, labelCol + 2 - displayWidth(r.id)));
    const hint = r.hint ? styleText("dim", r.hint) : "";
    lines.push(`${BAR}  ${arrow} ${box} ${idStyled}${pad}${hint}`);
  }
  if (win.hiddenBelow > 0) lines.push(`${BAR}  ${styleText("dim", `↓ ${win.hiddenBelow} more`)}`);

  // Footer: lead with the enter affordance + live on/total count (the #1
  // question at this screen), nav keys trail dim.
  const on = rows.filter((r) => state.selected.has(r.id)).length;
  const enter = styleText(on > 0 ? "cyan" : "dim", `⏎ enter — ${on} of ${rows.length} on`);
  const nav = styleText("dim", " · space toggle · ↑↓ move · esc cancel");
  lines.push(BAR);
  lines.push(`${BAR}  ${enter}${nav}`);
  return lines.join("\n");
}
