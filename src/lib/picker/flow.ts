/**
 * v2 picker flow: suggestion card → (optional) stack palette → launch.
 *
 * The card answers "what should I run here?" from `lib/stack-suggest`; the
 * palette is the one escape hatch where the whole catalogue lives. This module
 * owns the I/O (tally loading, `.cue.profile` writes, combo recording) and
 * keeps the two surfaces themselves pure.
 */

import * as p from "@clack/prompts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recordCombo } from "../combo-history";
import { resolveMatchContext } from "../profile-match";
import { deepMatchProfiles, hasWarmDeepMatch, warmDeepMatchCache } from "../profile-match-llm";
import {
  mergeSignals,
  pathSignals,
  suggestStacks,
  type StackSuggestion,
  type SuggestMatch,
  type SuggestSignal,
} from "../stack-suggest";
import { CardPrompt, type CardSuggestion } from "./card";
import { buildPaletteRows, PRIORITY_SECTIONS, StackPalettePrompt } from "./palette";
import { dedupeSelectorParts } from "./selector";
import {
  EMPTY_TALLY,
  formatStackTotals,
  unionTallyCounts,
  type ProfileTally,
} from "./tally";
import type { PickerInput, PickerOption, PickerOutput } from "./types";

/**
 * How many suggestions the card can cycle through.
 *
 * The engine's own default is 3, which was right when every suggestion came
 * from a hand-curated source and the fourth would have been padding. With
 * generic matching behind them there is a real ranked tail, so pressing Tab
 * keeps landing on something the directory actually justifies.
 */
const SUGGESTION_LIMIT = 8;

/**
 * Whether the suggestion-first picker is active. On by default; `CUE_PICKER=
 * classic` (also `v1` / `legacy`) restores the two-screen flow while v2 beds in.
 */
export function pickerV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CUE_PICKER ?? "").trim().toLowerCase();
  return !(v === "classic" || v === "v1" || v === "legacy");
}

/**
 * Selectable, non-composite profile rows from a picker option list. Dividers
 * are section furniture, composites (`a+b`) are synthesized stack rows, and the
 * Default entry is a composite too — the palette lists real profiles only, and
 * duplicates (a profile shown in both Suggested and All) collapse to the first
 * occurrence, which carries the richer hint.
 */
export function flattenProfileRows(options: PickerOption[]): PickerOption[] {
  const out: PickerOption[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    if (o.divider === true) continue;
    if (o.value.includes("+")) continue;
    if (seen.has(o.value)) continue;
    seen.add(o.value);
    out.push(o);
  }
  return out;
}

export async function runPickerV2(input: PickerInput): Promise<PickerOutput> {
  const profiles = flattenProfileRows(input.options);
  const known = new Set(profiles.map((o) => o.value));
  const labelOf = (value: string) =>
    profiles.find((o) => o.value === value)?.label ?? value;

  // cwd detection + workspace path conventions, merged the way detectProfileV2
  // merges its own rules. Path probing is best-effort.
  let detected: SuggestSignal[] = (input.detected ?? []).map((d) => ({
    name: d.name,
    confidence: d.confidence,
    reasons: [...d.reasons],
  }));
  try {
    detected = mergeSignals(detected, pathSignals(input.cwd));
  } catch {
    /* an unreadable cwd just means fewer signals */
  }
  detected = detected.filter((d) => known.has(d.name));

  // Generic repo→profile matches. The curated sources cover 19 of 85 profiles;
  // this scores every profile's own vocabulary against the directory so
  // cycling through suggestions keeps finding relevant stacks instead of
  // running out. Best-effort — no matches just means a shorter list.
  //
  // The model reranks this, but ONLY from cache. A launch must never wait on a
  // network round-trip: a warm entry (the usual case, since a repo's shape is
  // stable for weeks) is read in ~1ms, and a cold one serves the lexical answer
  // now while a detached process fills the cache for next time.
  let matched: SuggestMatch[] = [];
  try {
    const ctx = resolveMatchContext(input.cwd);
    if (ctx) {
      let ranked = ctx.matches;
      if (hasWarmDeepMatch(ctx.evidence, ctx.docs)) {
        const deep = await deepMatchProfiles({ evidence: ctx.evidence, docs: ctx.docs, lexical: ctx.matches });
        if (deep.classified) ranked = deep.matches;
      } else {
        warmDeepMatchCache(input.cwd);
      }
      matched = ranked
        .filter((m) => known.has(m.name))
        .slice(0, SUGGESTION_LIMIT)
        .map((m) => ({ name: m.name, strength: m.strength, reason: m.reason }));
    }
  } catch {
    /* a directory we can't read yields no matches, not an error */
  }

  const suggestions = suggestStacks({
    profiles,
    detected,
    companions: input.companions,
    recents: input.recents,
    recentsAreCwdScoped: input.recentsAreCwdScoped,
    combos: input.combos,
    pairSuggestions: input.pairSuggestions,
    featured: input.featured,
    matched,
    defaultSelector: input.defaultSelector,
    limit: SUGGESTION_LIMIT,
  });
  // Belt and braces: the engine only returns nothing when it was handed
  // nothing, but the card must always have something to show.
  const ranked: StackSuggestion[] =
    suggestions.length > 0
      ? suggestions
      : profiles.length > 0
        ? [{ parts: [profiles[0]!.value], score: 0, reasons: ["first available profile"], origin: "default" }]
        : [];

  // ── resource tallies ──────────────────────────────────────────────────────
  const tallies = new Map<string, ProfileTally>();
  const loadTallies = async (values: string[]): Promise<void> => {
    if (!input.resourceTally) return;
    await Promise.all(
      values
        .filter((v) => !tallies.has(v))
        .map(async (v) => {
          try {
            tallies.set(v, await input.resourceTally!(v));
          } catch {
            /* this row simply renders without counts */
          }
        }),
    );
  };
  await loadTallies([...new Set(ranked.flatMap((s) => s.parts))]);

  const toView = (s: StackSuggestion): CardSuggestion => {
    const picked = s.parts.map((v) => tallies.get(v));
    const totals = formatStackTotals(unionTallyCounts(picked.map((t) => t ?? EMPTY_TALLY)));
    const pending = picked.some((t) => t === undefined) ? " …" : "";
    return {
      parts: s.parts,
      labels: s.parts.map(labelOf),
      reasons: s.reasons,
      totals: totals ? `${totals}${pending}` : "",
      alwaysOn: picked.reduce((sum, t) => sum + (t?.alwaysOn ?? 0), 0),
    };
  };

  const pinAllowed = input.noPin !== true;
  let pin = pinAllowed;
  let index = 0;
  let selection: string[] | undefined;

  // ── card ⇄ palette loop ───────────────────────────────────────────────────
  while (selection === undefined) {
    const views = ranked.map(toView);
    // Nothing to suggest (a bare install, or every profile filtered out) — skip
    // the card and open the catalogue directly rather than showing an empty
    // answer the user can only dismiss.
    let action: string | symbol = "edit";
    if (views.length > 0) {
      const card = new CardPrompt({
        cwd: input.cwd,
        suggestions: views,
        pin,
        pinDisabled: !pinAllowed,
      });
      card.index = Math.min(index, Math.max(0, views.length - 1));
      action = (await card.prompt()) as string | symbol;
      index = card.index;
      pin = card.pin;
      if (p.isCancel(action)) {
        p.cancel("cancelled");
        process.exit(130);
      }
    }
    if (action === "launch") {
      const parts = views[index]?.parts ?? [];
      // Defensive: a card can only submit with a suggestion on screen, so an
      // empty pick means state drifted — re-prompt instead of pinning "".
      if (parts.length > 0) {
        selection = parts;
        break;
      }
      continue;
    }

    // Everything else opens the palette, seeded with the shown suggestion.
    const rows = buildPaletteRows({
      profiles,
      suggested: views[index]?.parts ?? [],
      detected,
      recents: input.recents,
      featured: input.featured,
    });
    const firstAllRow = rows.find((r) => !PRIORITY_SECTIONS.includes(r.section))?.value;
    const palette = new StackPalettePrompt({
      rows,
      selected: views[index]?.parts ?? [],
      query: "",
      tallies,
      cursorAt: action === "all" ? firstAllRow : undefined,
      onNeedTally: (value) => {
        void loadTallies([value]);
      },
    });
    const picked = await palette.prompt();
    if (palette.hardCancel) {
      p.cancel("cancelled");
      process.exit(130);
    }
    if (p.isCancel(picked)) continue; // esc → back to the card
    const chosen = picked as string[];
    if (chosen.length > 0) {
      await loadTallies(chosen);
      selection = chosen;
    }
  }

  // ── confirm, pin, report ──────────────────────────────────────────────────
  const parts = dedupeSelectorParts(selection);
  const choice = parts.join("+");

  try {
    recordCombo(parts, new Date().toISOString(), undefined, input.cwd);
  } catch {
    /* logging must never block a launch */
  }

  let pinned = false;
  if (pinAllowed && pin) {
    try {
      await writeFile(join(input.cwd, ".cue.profile"), `${choice}\n`);
      pinned = true;
    } catch (err) {
      p.log.warn(`could not pin here: ${(err as Error).message}`);
    }
  }

  if (input.details) {
    try {
      const lines = await input.details(choice);
      for (const line of lines) {
        if (line.length > 0) p.log.message(line);
      }
    } catch (err) {
      p.log.warn(`details unavailable: ${(err as Error).message}`);
    }
  }

  p.outro(`profile: ${parts.map(labelOf).join(" + ")}${pinned ? " (pinned)" : ""}`);
  return { profile: choice, pinned };
}
