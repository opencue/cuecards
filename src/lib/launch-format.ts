/**
 * Pure formatting / display helpers extracted from src/commands/launch.ts.
 *
 * All symbols here are side-effect-free (colorFns has only the isTTY read,
 * stable after process start) and carry no exec / filesystem / network logic.
 * src/commands/launch.ts re-exports everything below for back-compat.
 */

import { basename, resolve, join, sep } from "node:path";
import { tokenLevelEmoji, type TokenBreakdown } from "./token-budget";
import type { PickerOption } from "./picker";
import { countProfileSkills } from "./profile-capabilities";
import type { DetectionResultV2 } from "./auto-detect";
import type { ResolvedProfile } from "../../profiles/_types";
import type { NpxEntryFailure } from "./resolver-npx";

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

const LIST_TRUNCATE = 8;
const BREAKDOWN_MAX = 6; // per-profile skill breakdown cap before "+N more"
const COMMANDS_PER_LINE = 4;
const LABEL_WIDTH = 10; // "commands  " — keep visually aligned

/**
 * Compact human-readable summary of what a profile would load. Each returned
 * string is one line (or wrapped block) in the picker's post-pick log.
 *
 * When `parts` is supplied and contains more than one entry, the summary
 * shows a composite breakdown after the skills count — e.g.
 * `skills    53  ← skill-writer:8 + core:12 + ecc:33`.
 *
 * Colors are emitted only when stdout is a TTY and `NO_COLOR` is unset.
 */
export function formatProfileSummary(
  profile: ResolvedProfile,
  parts?: ResolvedProfile[],
): string[] {
  const c = colorFns();
  const label = (s: string) => c.cyan(s.padEnd(LABEL_WIDTH));
  const indent = " ".repeat(LABEL_WIDTH);
  const lines: string[] = [];

  const localCount = profile.skills.local.length;
  const npxCount = profile.skills.npx.reduce((sum, source) => sum + source.skills.length, 0);
  const totalSkills = countProfileSkills(profile);
  if (totalSkills > 0) {
    const breakdown =
      npxCount > 0 ? ` (${localCount} local, ${npxCount} npx)` : "";
    let line = `${label("skills")}${c.yellow(String(totalSkills))}${c.dim(breakdown)}`;
    if (parts && parts.length > 1) {
      const segs = parts.map(
        (p) =>
          `${p.icon ? `${p.icon} ` : ""}${p.name}:${countProfileSkills(p)}`,
      );
      // Cap the per-profile breakdown so a fat composite doesn't wrap into a
      // multi-line wall — the headline total already carries the full picture.
      const shown =
        segs.length > BREAKDOWN_MAX
          ? `${segs.slice(0, BREAKDOWN_MAX).join(" + ")} +${segs.length - BREAKDOWN_MAX} more`
          : segs.join(" + ");
      line += `  ${c.dim("←")} ${c.dim(shown)}`;
    }
    lines.push(line);
    if (localCount >= 5) {
      const cats = categoryBreakdown(profile.skills.local.map((s) => s.id));
      if (cats) lines.push(`${indent}${c.dim(cats)}`);
    }
  }
  if (profile.mcps.length > 0) {
    lines.push(
      `${label("mcps")}${truncateList(profile.mcps.map((m) => m.id))}`,
    );
  }
  if (profile.plugins.length > 0) {
    lines.push(
      `${label("plugins")}${truncateList(profile.plugins.map((pl) => pl.id))}`,
    );
  }
  if (profile.commands && profile.commands.length > 0) {
    const slashed = profile.commands.map((cmd) => `/${basename(cmd, ".md")}`);
    lines.push(
      `${label("commands")}${wrapItems(slashed, COMMANDS_PER_LINE, LABEL_WIDTH)}`,
    );
  }
  if (profile.agents && profile.agents.length > 0) {
    lines.push(`${label("agents")}${profile.agents.join("  ")}`);
  }
  return lines;
}

/**
 * Group skill ids by their `<category>/<slug>` prefix and emit a compact
 * `meta:25  gstack:16  plan:5 …` summary. Sorted by descending count.
 * Returns "" when there are no skills.
 */
export function categoryBreakdown(skillIds: string[], max = 7): string {
  if (skillIds.length === 0) return "";
  const groups = new Map<string, number>();
  for (const id of skillIds) {
    const parts = id.split("/");
    const cat = parts.length > 1 ? parts[0]! : "other";
    groups.set(cat, (groups.get(cat) ?? 0) + 1);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted
    .slice(0, max)
    .map(([cat, n]) => `${cat}:${n}`)
    .join("  ");
  if (sorted.length > max) {
    return `${head}  +${sorted.length - max} cats`;
  }
  return head;
}

/** Wrap a list of items into rows of `perRow`, separated by two spaces, with
 * continuation lines indented to align with the first item. */
function wrapItems(items: string[], perRow: number, indent: number): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow).join("  "));
  }
  const pad = " ".repeat(indent);
  return rows.join(`\n${pad}`);
}

function truncateList(items: string[], max = LIST_TRUNCATE): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")}, +${items.length - max} more`;
}

// isTTY and NO_COLOR are stable after process start — cache the result so
// colorFns() allocates 4 closures once instead of on every call.
let _colorFns:
  | { cyan: (s: string) => string; yellow: (s: string) => string; dim: (s: string) => string; bold: (s: string) => string }
  | undefined;
/** Lazy color helpers. Disabled when stdout isn't a TTY or `NO_COLOR` is set. */
export function colorFns() {
  if (_colorFns) return _colorFns;
  const enabled = process.stdout.isTTY === true && !process.env.NO_COLOR;
  const wrap = (code: string) => (s: string) =>
    enabled ? `\x1b[${code}m${s}\x1b[0m` : s;
  return (_colorFns = {
    cyan: wrap("36"),
    yellow: wrap("33"),
    dim: wrap("2"),
    bold: wrap("1"),
  });
}

// ---------------------------------------------------------------------------
// Token-overhead display
// ---------------------------------------------------------------------------

/** Format the token-overhead block. Returns `[]` under the 2K always-on floor. */
export function formatTokenWarning(b: TokenBreakdown): string[] {
  if (b.alwaysOn < 2000) return [];
  const c = colorFns();
  const lines: string[] = [];
  const level = tokenLevelEmoji(b.alwaysOn);
  const alwaysK = `${(b.alwaysOn / 1000).toFixed(1)}K`;
  lines.push(
    `${level} Skill overhead: ${c.yellow(`~${alwaysK}`)} always-on (${b.totalSkills} skills)`,
  );
  if (b.alwaysOn >= 50_000) {
    lines.push(
      `   ${c.yellow("Very heavy profile:")} prefer \`core\` or a narrow stack; use \`--subset "<task>"\` before launching broad composites.`,
    );
  }

  // `byProfile[0]` is the primary (the profile the user actively picked);
  // the rest are companions added via the multiselect. We tag whichever part
  // weighs the most as "← heaviest" purely for info, but only consider
  // *companions* as candidates for the "Drop X" hint below — telling the
  // user to drop their primary is never the right advice.
  let heaviestPart: { name: string; tokens: number } | undefined;
  let heaviestDroppable: { name: string; tokens: number } | undefined;
  if (b.byProfile.length > 1) {
    heaviestPart = [...b.byProfile].sort((a, x) => x.tokens - a.tokens)[0];
    heaviestDroppable = [...b.byProfile.slice(1)].sort(
      (a, x) => x.tokens - a.tokens,
    )[0];
    const heaviestName = heaviestPart!.name;
    const segments = b.byProfile.map((p) => {
      const kStr = `${(p.tokens / 1000).toFixed(1)}K`;
      const iconPart = p.icon ? `${p.icon} ` : "";
      const label = `${iconPart}${p.name} ${kStr}`;
      return p.name === heaviestName
        ? `${c.bold(label)} ${c.dim("← heaviest")}`
        : c.dim(label);
    });
    lines.push(`   By profile:  ${segments.join(c.dim("  ·  "))}`);
  }

  if (b.maxIfAllActivate > 0) {
    const maxK = `${(b.maxIfAllActivate / 1000).toFixed(0)}K`;
    lines.push(
      `   ${c.dim(`~${maxK} max if every skill activates (bodies load on demand)`)}`,
    );
  }

  const top3 = b.heaviestBodies.slice(0, 3);
  if (top3.length > 0) {
    const items = top3
      .map((s) => `${s.id.split("/").pop()} (${(s.tokens / 1000).toFixed(1)}K)`)
      .join(", ");
    lines.push(`   ${c.dim(`Heaviest bodies:  ${items}`)}`);
  }

  if (heaviestDroppable && heaviestDroppable.tokens > 3000) {
    const saveK = `${(heaviestDroppable.tokens / 1000).toFixed(1)}K`;
    lines.push(
      `   💡 Drop ${c.bold(`"${heaviestDroppable.name}"`)} to save ~${saveK} always-on`,
    );
  } else if (b.alwaysOn > 10000) {
    lines.push(`   💡 Run \`cue skills audit\` to trim unused skills.`);
  }

  return lines;
}

/**
 * Format the single-line startup identity banner shown on every warm launch.
 * Confirms what you landed in: agent · icon+profile (collapsed to `primary +N`
 * for composites, via formatTmuxTitle) · skill and MCP counts · the always-on
 * token cost. The token segment is omitted under the 2K floor; a `→ cue cost`
 * pointer is appended only for genuinely heavy profiles. The full breakdown —
 * per-profile attribution, heaviest bodies — lives in `cue cost`.
 */
const BANNER_TOKEN_FLOOR = 2000;
const BANNER_HEAVY = 10_000;

export interface StartupBannerInfo {
  /** Pre-collapsed title from formatTmuxTitle, e.g. "claude · 🏭 gstack +4". */
  title: string;
  /** Total skills (local + npx). */
  skills: number;
  /** MCP server count. */
  mcps: number;
  /** Always-on token estimate, or undefined when not computed (light profile). */
  alwaysOn?: number;
}

export function formatStartupBanner(info: StartupBannerInfo): string {
  const c = colorFns();
  const segs: string[] = [`${c.cyan("▸")} ${info.title}`];
  segs.push(`${info.skills} skill${info.skills === 1 ? "" : "s"}`);
  if (info.mcps > 0) segs.push(`${info.mcps} MCP${info.mcps === 1 ? "" : "s"}`);
  if (info.alwaysOn !== undefined && info.alwaysOn >= BANNER_TOKEN_FLOOR) {
    segs.push(
      `${tokenLevelEmoji(info.alwaysOn)} ${c.yellow(`~${Math.round(info.alwaysOn / 1000)}K`)} always-on`,
    );
  }
  let line = segs.join(c.dim(" · "));
  if (info.alwaysOn !== undefined && info.alwaysOn >= BANNER_HEAVY) {
    line += c.dim(" · → cue cost");
  }
  return line;
}

// ---------------------------------------------------------------------------
// Doctor warnings — inline summary of diagnostics on first build after a
// rebuild. Replaces the older "run cue doctor to see" generic message.
// ---------------------------------------------------------------------------

export interface DoctorWarning {
  code: string;
  message: string;
}

/**
 * Format doctor warnings as a single compact line. Returns `[]` when there are
 * none. The per-warning detail lives in `cue doctor --fix`; launch only signals
 * that there's something to look at.
 */
export function formatDoctorWarnings(warnings: DoctorWarning[]): string[] {
  if (warnings.length === 0) return [];
  const c = colorFns();
  const n = warnings.length;
  return [
    `${c.yellow(`⚠ ${n} cue-doctor warning${n > 1 ? "s" : ""}`)} ${c.dim("→ cue doctor --fix")}`,
  ];
}

/**
 * Sort picker options. Pure function so tests don't need filesystem.
 *
 * Priority order:
 *   1. Pinned profile (if any) — pinned to top so resuming is one Enter.
 *   2. Used profiles, descending by session count.
 *   3. Never-used profiles, alphabetical. `full` no longer floats to the top
 *      here — it carries a NEVER-USE warning and should sit with its peers.
 */
export function sortProfileOptions(
  opts: PickerOption[],
  pinnedProfile?: string,
  usage?: Map<string, number>,
): PickerOption[] {
  return [...opts].sort((a, b) => {
    // `top` (the Default entry) always wins, regardless of pin or usage.
    if (a.top && !b.top) return -1;
    if (b.top && !a.top) return 1;
    if (a.value === pinnedProfile) return -1;
    if (b.value === pinnedProfile) return 1;
    const ua = usage?.get(a.value) ?? 0;
    const ub = usage?.get(b.value) ?? 0;
    if (ua !== ub) return ub - ua;
    return a.value.localeCompare(b.value);
  });
}

/**
 * Format a relative-time string for the picker's recent-section hints.
 * `today` / `yesterday` / `Nd ago` / ISO date. Empty string when `iso` is null.
 */
export function relativeTime(
  iso: string | null | undefined,
  now = Date.now(),
): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = now - then;
  const day = 24 * 3600 * 1000;
  if (diffMs < day) return "today";
  const days = Math.floor(diffMs / day);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toISOString().split("T")[0]!;
}

/**
 * Build a structured picker order: Default → Recent section → All section.
 *
 * Recent = top `recentLimit` profiles by session count whose `lastUsed` is
 * non-null. Empty when nothing's been used yet — the Recent divider is
 * skipped in that case so the picker stays terse for fresh installs.
 */
export interface RecentEntry {
  name: string;
  sessions: number;
  lastUsed: string | null;
}

export interface SuggestedEntry {
  /** Profile name — must match a value in `allProfileOpts`. */
  name: string;
  /** 0.0–1.0 from `detectProfileV2`. */
  confidence: number;
  /** Files / signals that drove the match — surfaced in the hint. */
  reasons: string[];
  /** AI advice is visually distinguished from deterministic detection. */
  source?: "ai" | "deterministic" | "hybrid" | "stale-hybrid";
}

/**
 * Cap on how many cwd-detected suggestions we surface at the top. Two is
 * enough to cover the "primary stack + sub-profile" case (medusa-dev +
 * medusa-next) without dominating the picker.
 */
export const MAX_SUGGESTIONS = 2;

/**
 * Combine model judgement with repository signals without inventing a weighted
 * score. Agreement leads. When they disagree, the model's first choice and the
 * detector's strongest choice both survive the two-row picker cap.
 */
export function mergeProfileSuggestions(
  advised: readonly DetectionResultV2[],
  deterministic: readonly DetectionResultV2[],
): DetectionResultV2[] {
  const deterministicByProfile = new Map(
    deterministic.map((item) => [item.profile, item]),
  );
  const seen = new Set<string>();
  const merged: DetectionResultV2[] = [];
  const add = (
    item: DetectionResultV2,
    counterpart?: DetectionResultV2,
  ): void => {
    if (seen.has(item.profile)) return;
    seen.add(item.profile);
    merged.push({
      profile: item.profile,
      confidence: Math.max(item.confidence, counterpart?.confidence ?? 0),
      reasons: [...new Set([...item.reasons, ...(counterpart?.reasons ?? [])])].slice(
        0,
        3,
      ),
    });
  };

  const consensus = advised.filter((item) =>
    deterministicByProfile.has(item.profile),
  );
  for (const item of consensus) {
    add(item, deterministicByProfile.get(item.profile));
  }

  const advisedOnly = advised.filter(
    (item) => !deterministicByProfile.has(item.profile),
  );
  const deterministicOnly = deterministic.filter(
    (item) => !seen.has(item.profile),
  );

  // No consensus: preserve one choice from each system before either can fill
  // the remaining rows. With consensus, it already represents both systems.
  if (consensus.length === 0) {
    if (advisedOnly[0]) add(advisedOnly[0]);
    if (deterministicOnly[0]) add(deterministicOnly[0]);
  }
  for (const item of advisedOnly) add(item);
  for (const item of deterministicOnly) add(item);
  return merged;
}

/**
 * Minimum confidence for a detection to appear in the Suggested section at
 * all. Below this the signal is too noisy (e.g. a stray tsconfig.json
 * suggesting "frontend") and would push real choices down the screen.
 */
export const SUGGESTED_MIN_CONFIDENCE = 0.5;

/**
 * Confidence at which the picker pre-selects the top suggestion (Enter on
 * first keystroke launches it). Below this we still SHOW the suggestion but
 * leave Default as the Enter-default so a wrong guess can't hijack the
 * common case.
 */
export const SUGGESTED_AUTO_PICK_CONFIDENCE = 0.7;

// ---------------------------------------------------------------------------
// authmux account tag
// ---------------------------------------------------------------------------

/**
 * When cue launches under an authmux parallel account, CLAUDE_CONFIG_DIR points
 * at that account's dir (`~/.claude-accounts/<name>`) or its per-run session
 * copy (`~/.claude-accounts-sessions/<name>/<ts>-<pid>`). Derive a stable
 * per-account tag so the runtime dir can be keyed by profile + account. Without
 * it, two accounts sharing a cue profile share ONE runtime `.credentials.json` /
 * `.claude.json` and collapse into a single Anthropic login (the credential is
 * copied, not symlinked, so the shared runtime is the source of truth). Returns
 * undefined for the default `~/.claude` and any non-authmux config dir, which
 * preserves the plain per-profile runtime.
 */
export function authmuxAccountTag(
  configDirEnv: string | undefined,
  homeDir: string,
): string | undefined {
  if (!configDirEnv) return undefined;
  const resolved = resolve(configDirEnv);
  for (const root of [
    join(homeDir, ".claude-accounts-sessions"),
    join(homeDir, ".claude-accounts"),
  ]) {
    const prefix = root + sep;
    if (resolved.startsWith(prefix)) {
      const name = resolved.slice(prefix.length).split(sep)[0];
      // Filesystem-safe, and can't inject the `profile@tag` separator or a path
      // separator into the runtime dir name. LIMITATION: names differing only in
      // non-`[A-Za-z0-9._-]` characters (e.g. `a@b` vs `a_b`) sanitize to the same
      // tag and would share a runtime. authmux account names are simple, user-chosen
      // ids (`parallel --add <name>`), so this is a theoretical edge, not a live risk.
      if (name) return name.replace(/[^A-Za-z0-9._-]/g, "_");
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// npx degradation notice
// ---------------------------------------------------------------------------

/** "5h48m" / "12m" / "40s" — coarse on purpose, this is a hint, not a clock. */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

export function formatNpxDegraded(failures: NpxEntryFailure[]): string[] {
  const lines: string[] = [];
  for (const f of failures) {
    const reason = f.error.message.replace(
      /^npx fetch (?:failed|skipped) for \S+: /,
      "",
    );
    const outcome =
      f.skills.length > 0
        ? `launching without ${f.skills.join(", ")}`
        : "using cached copy";
    if (f.skipped) {
      const retry =
        f.retryInMs === undefined
          ? "auto-retry later"
          : `auto-retry in ${formatDuration(f.retryInMs)}`;
      lines.push(
        `[cue] skills: ${f.repo} skipped — earlier fetch failed (${reason}), ${retry} — ${outcome}`,
      );
    } else {
      lines.push(`[cue] skills: ${f.repo} unreachable (${reason}) — ${outcome}`);
    }
  }
  if (lines.length > 0) {
    // Always the forcing form: a fetch that just failed has left a marker, so
    // a plain `cue launch` would skip it rather than retry — advertising that
    // command would send the user to a no-op.
    lines.push(
      "[cue] retry the fetch now with: CUE_NPX_FORCE=1 cue launch (or cue doctor)",
    );
  }
  return lines;
}
