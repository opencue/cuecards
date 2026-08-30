/**
 * Symmetric conflict resolution for profile selections.
 *
 * Extracted from `lib/picker` so the suggestion engine (`lib/stack-suggest`) can
 * reuse it without depending on the TUI module. `lib/picker` re-exports both
 * functions, so every existing `import { buildConflictMap } from "./picker"`
 * keeps resolving.
 */

/** Anything that can declare a conflict: a picker row, a companion, a profile. */
export interface ConflictDeclaring {
  value: string;
  conflicts?: string[];
}

/**
 * Build a symmetric conflict map from a list of options. Declaring `A.conflicts
 * = [B]` on either side blocks both A→B and B→A so authors only have to write
 * the relationship once.
 */
export function buildConflictMap(
  options: readonly ConflictDeclaring[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const o of options) {
    for (const c of o.conflicts ?? []) {
      if (!map.has(o.value)) map.set(o.value, new Set());
      map.get(o.value)!.add(c);
      if (!map.has(c)) map.set(c, new Set());
      map.get(c)!.add(o.value);
    }
  }
  return map;
}

/**
 * Resolve conflicts in a candidate selection. First-toggled wins: if A and
 * its conflict B are both in the list, the entry appearing later is dropped.
 * Used both by the live render (to mask blocked toggles) and at confirm time
 * (to guarantee the returned list never contains a conflict pair).
 */
export function resolveConflicts(
  selection: readonly string[],
  conflictMap: Map<string, Set<string>>,
): string[] {
  const out: string[] = [];
  for (const v of selection) {
    const blocked = out.some((kept) => conflictMap.get(kept)?.has(v));
    if (!blocked) out.push(v);
  }
  return out;
}
