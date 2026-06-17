import { describe, expect, test } from "bun:test";

import {
  buildUniversalSuggestions,
  computeAffinityMap,
  parseComposite,
  suggestPartnersFor,
  suggestionsByProfile,
  UNIVERSAL_COMPANIONS,
} from "./pair-suggestions";

const row = (profile: string, ts = "2026-05-28T00:00:00Z"): string =>
  JSON.stringify({ ts, profile, cwd: "/x", session_id: `${ts}-${profile}` });

const lines = (...rows: string[]) => () => rows;

describe("parseComposite", () => {
  test("splits on + and trims empties", () => {
    expect(parseComposite("a+b+c")).toEqual(["a", "b", "c"]);
    expect(parseComposite("a")).toEqual(["a"]);
    expect(parseComposite("+a+ +b+")).toEqual(["a", "b"]);
    expect(parseComposite("")).toEqual([]);
  });
});

describe("computeAffinityMap", () => {
  test("ignores rows without a profile field", () => {
    const reader = lines(
      JSON.stringify({ ts: "t", cwd: "/x", session_id: "s" }), // no profile
      row("a"),
    );
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(1);
  });

  test("counts solo picks toward `picks` but never as partners", () => {
    const reader = lines(row("a"), row("a"), row("a"));
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(3);
    expect(m.get("a")?.partners.size).toBe(0);
  });

  test("composite picks contribute pairwise co-occurrence in both directions", () => {
    const reader = lines(row("a+b"), row("a+b"), row("a+c"));
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(3);
    expect(m.get("b")?.picks).toBe(2);
    expect(m.get("c")?.picks).toBe(1);
    expect(m.get("a")?.partners.get("b")).toBe(2);
    expect(m.get("a")?.partners.get("c")).toBe(1);
    expect(m.get("b")?.partners.get("a")).toBe(2);
    expect(m.get("c")?.partners.get("a")).toBe(1);
  });

  test("malformed JSONL lines are skipped, valid ones still aggregate", () => {
    const reader = lines("{this is not json", row("a+b"), "", "   ", row("a"));
    const m = computeAffinityMap(reader);
    expect(m.get("a")?.picks).toBe(2);
    expect(m.get("b")?.picks).toBe(1);
  });
});

describe("suggestPartnersFor", () => {
  test("returns top partners sorted by affinity DESC (after default 0.5 floor)", () => {
    // a picked 15 times: 9 with b (60%, passes), 5 with c (33%, below floor),
    //                    1 with d (7%, below floor). Default minAffinity=0.5
    //                    so only b makes the cut.
    const reader = lines(
      ...Array(9).fill(row("a+b")),
      ...Array(5).fill(row("a+c")),
      row("a+d"),
    );
    const m = computeAffinityMap(reader);
    const sug = suggestPartnersFor("a", m);
    expect(sug.map((s) => s.name)).toEqual(["b"]);
    expect(sug[0]!.affinity).toBeCloseTo(9 / 15, 3);
  });

  test("sort tie-break: equal affinity → higher count, then alpha", () => {
    // a picked 4 times: 2 with b (50%), 2 with c (50%), 2 with d (50%) —
    // all three tie on affinity 0.5. Tie-break is count DESC then name asc.
    // All have count=2, so order should be alphabetical: b, c, d.
    const reader = lines(
      row("a+b+c"),
      row("a+b+c"),
      row("a+d"),
      row("a+d"),
    );
    const m = computeAffinityMap(reader);
    const sug = suggestPartnersFor("a", m);
    expect(sug.map((s) => s.name)).toEqual(["b", "c", "d"]);
  });

  test("filters by minCount and minAffinity", () => {
    const reader = lines(
      ...Array(9).fill(row("a+b")),
      ...Array(5).fill(row("a+c")),
      row("a+d"),
    );
    const m = computeAffinityMap(reader);
    // Force c out via affinity floor: c affinity is 5/15 ≈ 0.33
    expect(suggestPartnersFor("a", m, { minAffinity: 0.4 }).map((s) => s.name)).toEqual(["b"]);
    // Force d in via count floor relaxation (d count=1)
    expect(
      suggestPartnersFor("a", m, { minCount: 1, minAffinity: 0 }).map((s) => s.name),
    ).toEqual(["b", "c", "d"]);
  });

  test("returns empty when profile has fewer picks than minCount", () => {
    const reader = lines(row("a+b"));
    const m = computeAffinityMap(reader);
    expect(suggestPartnersFor("a", m, { minCount: 5 })).toEqual([]);
  });

  test("returns empty for unknown profile", () => {
    const m = computeAffinityMap(lines(row("a")));
    expect(suggestPartnersFor("ghost", m)).toEqual([]);
  });

  test("respects limit", () => {
    // a picked 3 times, each composite includes one of b/c/d — each partner
    // has count=1, affinity=1/3 ≈ 0.33. We override the floors to admit
    // all three so the limit truncation is the only filter left.
    const reader = lines(row("a+b"), row("a+c"), row("a+d"));
    const m = computeAffinityMap(reader);
    const relaxed = { minCount: 1, minAffinity: 0 };
    expect(suggestPartnersFor("a", m, relaxed).length).toBe(3);
    expect(suggestPartnersFor("a", m, { ...relaxed, limit: 2 }).length).toBe(2);
  });
});

describe("suggestionsByProfile", () => {
  test("returns one entry per profile with non-empty suggestions", () => {
    const reader = lines(
      ...Array(3).fill(row("a+b")),
      ...Array(3).fill(row("a+b")),
      row("solo"),
    );
    const m = computeAffinityMap(reader);
    const all = suggestionsByProfile(m);
    expect([...all.keys()].sort()).toEqual(["a", "b"]);
    expect(all.get("a")?.[0]?.name).toBe("b");
    expect(all.get("b")?.[0]?.name).toBe("a");
    expect(all.get("solo")).toBeUndefined();
  });
});

describe("buildUniversalSuggestions", () => {
  const known = (...names: string[]) => new Set(names);

  test("featured come first in declared order, capped, and filtered to installed", () => {
    const out = buildUniversalSuggestions({
      featured: ["improver", "ghost", "secops", "builder", "maker", "studio", "ops"],
      affinity: computeAffinityMap(lines()),
      known: known("improver", "secops", "builder", "maker", "studio", "ops"),
    });
    // `ghost` dropped (not installed); default cap 5 keeps the first five real ones,
    // so `ops` (sixth) is excluded.
    expect(out).toEqual([
      { name: "improver", origin: "featured" },
      { name: "secops", origin: "featured" },
      { name: "builder", origin: "featured" },
      { name: "maker", origin: "featured" },
      { name: "studio", origin: "featured" },
    ]);
  });

  test("frequency fills the rest, highest picks first, above the floor", () => {
    const affinity = computeAffinityMap(
      lines(
        ...Array(10).fill(row("skill-writer")),
        ...Array(5).fill(row("core")),
        ...Array(2).fill(row("rare")), // below default minFrequentPicks=3
      ),
    );
    const out = buildUniversalSuggestions({
      featured: [],
      affinity,
      known: known("skill-writer", "core", "rare"),
    });
    expect(out).toEqual([
      { name: "skill-writer", origin: "frequent" },
      { name: "core", origin: "frequent" },
    ]);
  });

  test("a profile that is both featured and frequent appears once, as featured", () => {
    const affinity = computeAffinityMap(lines(...Array(10).fill(row("improver"))));
    const out = buildUniversalSuggestions({
      featured: ["improver"],
      affinity,
      known: known("improver"),
    });
    expect(out).toEqual([{ name: "improver", origin: "featured" }]);
  });

  test("empty featured + empty history yields nothing", () => {
    expect(
      buildUniversalSuggestions({ featured: [], affinity: new Map(), known: new Set() }),
    ).toEqual([]);
  });

  test("caps and the frequency floor are configurable", () => {
    const affinity = computeAffinityMap(
      lines(...Array(5).fill(row("a")), ...Array(4).fill(row("b")), ...Array(3).fill(row("c"))),
    );
    const out = buildUniversalSuggestions({
      featured: ["f1", "f2"],
      affinity,
      known: known("f1", "f2", "a", "b", "c"),
      maxFeatured: 1,
      maxFrequent: 1,
      minFrequentPicks: 4,
    });
    // featured cap 1 → f1; frequency cap 1 with floor 4 → a (5 picks, highest).
    expect(out).toEqual([
      { name: "f1", origin: "featured" },
      { name: "a", origin: "frequent" },
    ]);
  });

  test("no heavy companion is pinned globally by default", () => {
    expect(UNIVERSAL_COMPANIONS).toEqual([]);
    const affinity = computeAffinityMap(lines(...Array(5).fill(row("a"))));
    const out = buildUniversalSuggestions({
      featured: ["f1"],
      affinity,
      known: known("f1", "a", "gstack"),
    });
    expect(out).toEqual([
      { name: "f1", origin: "featured" },
      { name: "a", origin: "frequent" },
    ]);
  });

  test("a featured heavy profile can still be offered explicitly", () => {
    const gstack = "gstack";
    const out = buildUniversalSuggestions({
      featured: [gstack],
      affinity: new Map(),
      known: known(gstack),
    });
    expect(out).toEqual([{ name: gstack, origin: "featured" }]);
  });

  test("pinned companions close the list when configured, after featured/frequent", () => {
    const pinned = "lightweight-helper";
    const affinity = computeAffinityMap(lines(...Array(5).fill(row("a"))));
    const out = buildUniversalSuggestions({
      featured: ["f1"],
      affinity,
      known: known("f1", "a", pinned),
      pinnedCompanions: [pinned],
    });
    expect(out).toEqual([
      { name: "f1", origin: "featured" },
      { name: "a", origin: "frequent" },
      { name: pinned, origin: "pinned" },
    ]);
  });

  test("a pinned companion that isn't installed is silently dropped", () => {
    const out = buildUniversalSuggestions({
      featured: ["f1"],
      affinity: new Map(),
      known: known("f1"), // gstack not installed
      pinnedCompanions: ["lightweight-helper"],
    });
    expect(out).toEqual([{ name: "f1", origin: "featured" }]);
  });

  test("a pinned companion already in featured keeps its featured origin (de-duped)", () => {
    const gstack = "gstack";
    const out = buildUniversalSuggestions({
      featured: [gstack],
      affinity: new Map(),
      known: known(gstack),
      pinnedCompanions: [gstack],
    });
    expect(out).toEqual([{ name: gstack, origin: "featured" }]);
  });
});
