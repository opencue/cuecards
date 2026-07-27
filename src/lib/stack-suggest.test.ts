import { describe, expect, test } from "bun:test";

import {
  COMPANION_AUTO_CONFIDENCE,
  DETECT_MIN_CONFIDENCE,
  MAX_STACK_PARTS,
  mergeSignals,
  pathSignals,
  suggestStacks,
  type PathProbe,
  type SuggestProfile,
} from "./stack-suggest";

const profiles: SuggestProfile[] = [
  { value: "core", label: "core" },
  { value: "rust", label: "🦀 rust", autoSelect: [] },
  { value: "rust-core", label: "rust-core" },
  { value: "secops", label: "🔒 secops" },
  { value: "python", label: "🐍 python" },
  { value: "medusa-next", label: "medusa-next", conflicts: ["medusa-vite"] },
  { value: "medusa-vite", label: "medusa-vite" },
  { value: "higgsfield", label: "higgsfield" },
  { value: "improver", label: "improver" },
];

describe("suggestStacks", () => {
  test("ranks a strong cwd detection above history and featured picks", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "rust", confidence: 0.9, reasons: ["Cargo.toml"] }],
      recents: [{ name: "python", sessions: 4, lastUsed: "2026-07-25T10:00:00Z" }],
      recentsAreCwdScoped: true,
      featured: ["improver"],
    });
    expect(out[0]?.parts).toEqual(["rust"]);
    expect(out[0]?.origin).toBe("detected");
    expect(out[0]?.reasons[0]).toBe("90% match — Cargo.toml");
    expect(out.map((s) => s.origin)).toContain("recent");
  });

  test("drops detections below the confidence floor", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "python", confidence: DETECT_MIN_CONFIDENCE - 0.01, reasons: ["stray file"] }],
      defaultSelector: "core",
    });
    expect(out.map((s) => s.parts.join("+"))).toEqual(["core"]);
  });

  test("never returns an empty list when a Default exists, and says why", () => {
    const out = suggestStacks({ profiles, defaultSelector: "core" });
    expect(out).toHaveLength(1);
    expect(out[0]?.parts).toEqual(["core"]);
    expect(out[0]?.reasons[0]).toBe("no clear signal in this directory");
  });

  test("returns nothing when handed nothing", () => {
    expect(suggestStacks({ profiles: [] })).toEqual([]);
  });

  test("grows a stack with strongly-detected companions and names them", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "rust", confidence: 0.9, reasons: ["Cargo.toml"] }],
      companions: [
        { profile: "higgsfield", reason: "12 image assets", confidence: COMPANION_AUTO_CONFIDENCE },
        { profile: "python", reason: "weak hunch", confidence: 0.3 },
      ],
    });
    expect(out[0]?.parts).toEqual(["rust", "higgsfield"]);
    expect(out[0]?.reasons).toContain("+ higgsfield (12 image assets)");
    // Below the companion threshold — not stacked.
    expect(out[0]?.parts).not.toContain("python");
  });

  test("adds the top historical partner", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "rust", confidence: 0.9, reasons: ["Cargo.toml"] }],
      pairSuggestions: new Map([["rust", ["secops"]]]),
    });
    expect(out[0]?.parts).toEqual(["rust", "secops"]);
  });

  test("never stacks conflicting profiles", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "medusa-next", confidence: 0.9, reasons: ["next.config.ts"] }],
      companions: [{ profile: "medusa-vite", reason: "vite.config.ts", confidence: 0.9 }],
    });
    expect(out[0]?.parts).toEqual(["medusa-next"]);
  });

  test("caps a stack at MAX_STACK_PARTS", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "rust", confidence: 0.9, reasons: ["Cargo.toml"] }],
      companions: [
        { profile: "higgsfield", reason: "assets", confidence: 0.9 },
        { profile: "python", reason: "py", confidence: 0.9 },
        { profile: "improver", reason: "x", confidence: 0.9 },
      ],
    });
    expect(out[0]?.parts.length).toBe(MAX_STACK_PARTS);
  });

  test("surfaces a previously-confirmed combo with its use count", () => {
    const out = suggestStacks({
      profiles,
      combos: [{ parts: ["python", "secops"], count: 4, lastUsed: "2026-07-20T00:00:00Z" }],
    });
    expect(out[0]?.parts).toEqual(["python", "secops"]);
    expect(out[0]?.reasons[0]).toBe("you launched this stack 4×");
  });

  test("a stack confirmed in this directory outranks a more-used foreign one", () => {
    const out = suggestStacks({
      profiles,
      combos: [
        { parts: ["python", "secops"], count: 6, here: 0, lastUsed: "2026-07-25T00:00:00Z" },
        { parts: ["rust", "secops"], count: 1, here: 1, lastUsed: "2026-07-20T00:00:00Z" },
      ],
    });
    expect(out[0]?.parts).toEqual(["rust", "secops"]);
    expect(out[0]?.reasons[0]).toBe("you launched this stack 1× here");
    expect(out[1]?.reasons[0]).toBe("you launched this stack 6× in other directories");
  });

  test("a foreign-only stack is named as such and ranks below a cwd recent", () => {
    const out = suggestStacks({
      profiles,
      combos: [{ parts: ["python", "secops"], count: 6, here: 0 }],
      recents: [{ name: "rust", sessions: 1, lastUsed: "2026-07-25T00:00:00Z" }],
      recentsAreCwdScoped: true,
    });
    expect(out[0]?.parts[0]).toBe("rust");
    const foreign = out.find((s) => s.origin === "combo");
    expect(foreign?.reasons[0]).toBe("you launched this stack 6× in other directories");
  });

  test("ignores unknown profile names everywhere", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "ghost", confidence: 0.99, reasons: ["nope"] }],
      combos: [{ parts: ["ghost", "phantom"], count: 9 }],
      recents: [{ name: "ghost", sessions: 9, lastUsed: "2026-07-26T00:00:00Z" }],
      defaultSelector: "core",
    });
    expect(out.map((s) => s.parts.join("+"))).toEqual(["core"]);
  });

  test("deduplicates stacks with the same parts, keeping the strongest source", () => {
    const out = suggestStacks({
      profiles,
      detected: [{ name: "rust", confidence: 0.9, reasons: ["Cargo.toml"] }],
      recents: [{ name: "rust", sessions: 9, lastUsed: "2026-07-26T00:00:00Z" }],
    });
    expect(out.filter((s) => s.parts.join("+") === "rust")).toHaveLength(1);
    expect(out[0]?.origin).toBe("detected");
  });

  test("honors the limit and is deterministic across runs", () => {
    const input = {
      profiles,
      detected: [
        { name: "rust", confidence: 0.9, reasons: ["Cargo.toml"] },
        { name: "python", confidence: 0.8, reasons: ["pyproject.toml"] },
      ],
      featured: ["improver"],
      defaultSelector: "core",
      limit: 2,
    };
    const a = suggestStacks(input);
    const b = suggestStacks(input);
    expect(a).toHaveLength(2);
    expect(a).toEqual(b);
    expect(a[0]?.parts).toEqual(["rust"]);
  });

  test("cwd-scoped recents outrank global ones and say so", () => {
    const cwdScoped = suggestStacks({
      profiles,
      recents: [{ name: "python", sessions: 2, lastUsed: "2026-07-26T00:00:00Z" }],
      recentsAreCwdScoped: true,
    });
    const global = suggestStacks({
      profiles,
      recents: [{ name: "python", sessions: 2, lastUsed: "2026-07-26T00:00:00Z" }],
    });
    expect(cwdScoped[0]!.score).toBeGreaterThan(global[0]!.score);
    expect(cwdScoped[0]?.reasons[0]).toContain("last used in this repo");
    expect(global[0]?.reasons[0]).toContain("you use this often");
  });
});

describe("mergeSignals", () => {
  test("keeps the highest confidence and unions reasons", () => {
    const merged = mergeSignals(
      [{ name: "rust", confidence: 0.6, reasons: ["Cargo.toml"] }],
      [{ name: "rust", confidence: 0.9, reasons: ["src/main.rs", "Cargo.toml"] }],
    );
    expect(merged).toEqual([
      { name: "rust", confidence: 0.9, reasons: ["Cargo.toml", "src/main.rs"] },
    ]);
  });

  test("sorts by confidence, then name, and tolerates undefined lists", () => {
    const merged = mergeSignals(undefined, [
      { name: "zebra", confidence: 0.5, reasons: [] },
      { name: "alpha", confidence: 0.5, reasons: [] },
      { name: "top", confidence: 0.9, reasons: [] },
    ]);
    expect(merged.map((s) => s.name)).toEqual(["top", "alpha", "zebra"]);
  });
});

/** Probe stub: `files` are the paths that exist, `entries` the cwd listing. */
function probe(files: string[], entries: string[] = []): PathProbe {
  return {
    exists: (p) => files.some((f) => p.endsWith(f)),
    list: () => entries,
  };
}

describe("pathSignals", () => {
  test("recognizes a medusa shop and picks the storefront flavor", () => {
    const next = pathSignals("/home/u/Documents/medusa-shops/acme", probe(["next.config.ts"]));
    expect(next.map((s) => s.name)).toEqual(["medusa-stack", "medusa-next"]);
    expect(next[0]?.reasons[0]).toBe("medusa-shops/acme");

    const vite = pathSignals("/home/u/Documents/medusa-shops/acme", probe(["vite.config.ts"]));
    expect(vite.map((s) => s.name)).toEqual(["medusa-stack", "medusa-vite"]);
  });

  test("skips the medusa base template", () => {
    expect(pathSignals("/x/medusa-shops/base-template", probe([]))).toEqual([]);
  });

  test("maps a websites/ child to frontend", () => {
    const out = pathSignals("/home/u/Documents/websites/portfolio", probe([]));
    expect(out).toEqual([
      { name: "frontend", confidence: 0.55, reasons: ["websites/portfolio"] },
    ]);
  });

  test("detects wordpress, ros2, n8n and obsidian markers", () => {
    expect(pathSignals("/p", probe(["wp-config.php"]))[0]?.name).toBe("wordpress");
    expect(pathSignals("/p", probe(["package.xml", "CMakeLists.txt"]))[0]?.name).toBe("ros2");
    expect(pathSignals("/p", probe([".n8n"]))[0]?.name).toBe("n8n");
    expect(pathSignals("/p", probe([".obsidian"]))[0]?.name).toBe("research");
  });

  test("flags terraform directories", () => {
    const out = pathSignals("/p", probe([], ["main.tf", "variables.tf"]));
    expect(out.map((s) => s.name)).toContain("ops");
  });

  test("suggests docs-writer only for prose-only directories", () => {
    const prose = pathSignals("/p", probe([], ["a.md", "b.md", "c.md"]));
    expect(prose.map((s) => s.name)).toContain("docs-writer");

    const mixed = pathSignals("/p", probe([], ["a.md", "b.md", "c.md", "index.ts"]));
    expect(mixed.map((s) => s.name)).not.toContain("docs-writer");

    const tooFew = pathSignals("/p", probe([], ["a.md", "b.md"]));
    expect(tooFew.map((s) => s.name)).not.toContain("docs-writer");
  });

  test("returns nothing for an ordinary directory", () => {
    expect(pathSignals("/home/u/projects/thing", probe([], ["index.ts"]))).toEqual([]);
  });
});
