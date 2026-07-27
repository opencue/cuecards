import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import type { ProfileDoc, RepoEvidence } from "./profile-match";
import {
  buildMatchPrompt,
  deepCacheKey,
  deepMatchDisabled,
  deepMatchProfiles,
  parsePicks,
} from "./profile-match-llm";

// The cache lives under XDG_CACHE_HOME; redirect it so tests never touch the
// user's real one.
const cacheHome = mkdtempSync(join(tmpdir(), "cue-deep-"));
const originalCache = process.env.XDG_CACHE_HOME;
process.env.XDG_CACHE_HOME = cacheHome;
afterAll(() => {
  if (originalCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalCache;
  rmSync(cacheHome, { recursive: true, force: true });
});

function evidence(terms: Record<string, number>, sources: Record<string, string> = {}): RepoEvidence {
  return {
    terms: new Map(Object.entries(terms)),
    reasons: new Map(Object.keys(terms).map((t) => [t, `because ${t}`])),
    sources: new Map(
      Object.keys(terms).map((t) => [t, (sources[t] ?? "dependency") as RepoEvidence["sources"] extends Map<string, infer V> ? V : never]),
    ),
  };
}

const docs: ProfileDoc[] = [
  { name: "rust", description: "Rust development", terms: new Map([["rust", 4]]) },
  { name: "python", description: "Python development", terms: new Map([["python", 4]]) },
  { name: "ros2", description: "ROS 2 robot control", terms: new Map([["robot", 2]]) },
];

describe("deepMatchDisabled", () => {
  test("respects the off switches", () => {
    for (const v of ["0", "off", "false", "OFF"]) {
      expect(deepMatchDisabled({ CUE_PROFILE_MATCH_DEEP: v })).toBe(true);
    }
  });

  test("defaults to enabled", () => {
    expect(deepMatchDisabled({})).toBe(false);
    expect(deepMatchDisabled({ CUE_PROFILE_MATCH_DEEP: "1" })).toBe(false);
  });
});

describe("deepCacheKey", () => {
  test("is stable for the same evidence and profiles", () => {
    const a = deepCacheKey(evidence({ rust: 3, cargo: 3 }), docs);
    const b = deepCacheKey(evidence({ rust: 3, cargo: 3 }), docs);
    expect(a).toBe(b);
  });

  test("does not depend on term insertion order", () => {
    const a = deepCacheKey(evidence({ rust: 3, cargo: 3 }), docs);
    const b = deepCacheKey(evidence({ cargo: 3, rust: 3 }), docs);
    expect(a).toBe(b);
  });

  test("changes when the evidence changes", () => {
    const a = deepCacheKey(evidence({ rust: 3 }), docs);
    const b = deepCacheKey(evidence({ python: 3 }), docs);
    expect(a).not.toBe(b);
  });

  test("changes when a profile description changes", () => {
    const edited = docs.map((d) => (d.name === "rust" ? { ...d, description: "something else" } : d));
    expect(deepCacheKey(evidence({ rust: 3 }), docs)).not.toBe(deepCacheKey(evidence({ rust: 3 }), edited));
  });

  // Keying on cwd would miss two checkouts of the same project, and a moved
  // repo would re-pay for an answer that hasn't changed.
  test("is independent of any path", () => {
    const key = deepCacheKey(evidence({ rust: 3 }), docs);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("buildMatchPrompt", () => {
  const prompt = buildMatchPrompt(
    evidence({ rust: 3, robot: 3 }, { robot: "language" }),
    docs,
    [{ name: "rust", strength: 0.8, score: 8, matchedTerms: ["rust"], reason: "matches rust" }],
  );

  test("groups evidence by source", () => {
    expect(prompt).toContain("dependency:");
    expect(prompt).toContain("language:");
  });

  test("lists every profile with its description", () => {
    for (const d of docs) expect(prompt).toContain(`- ${d.name}: ${d.description}`);
  });

  test("shows the lexical ranking as fallible input, not as the answer", () => {
    expect(prompt).toContain("which may be wrong");
    expect(prompt).toContain("rust (0.80)");
  });

  test("states the response format and the escape hatch", () => {
    expect(prompt).toContain("PICK:");
    expect(prompt).toContain("PICK: none");
  });

  test("tells the model to ignore the noise the lexical pass had to be taught", () => {
    expect(prompt).toContain("CLAUDE.md");
    expect(prompt).toContain("metadata");
  });
});

describe("parsePicks", () => {
  const known = new Set(["rust", "python", "ros2"]);

  test("parses name and reason", () => {
    const out = parsePicks("PICK: rust | Cargo.toml and .rs files\nPICK: python | scripts", known);
    expect(out).toEqual([
      { name: "rust", reason: "Cargo.toml and .rs files" },
      { name: "python", reason: "scripts" },
    ]);
  });

  test("a bare name still parses, with a placeholder reason", () => {
    expect(parsePicks("PICK: rust", known)).toEqual([{ name: "rust", reason: "model pick" }]);
  });

  test("PICK: none is an empty answer, not a failure", () => {
    expect(parsePicks("PICK: none", known)).toEqual([]);
  });

  test("drops unknown names", () => {
    expect(parsePicks("PICK: rust | ok\nPICK: imaginary | no", known)).toEqual([
      { name: "rust", reason: "ok" },
    ]);
  });

  test("dedupes a repeated pick", () => {
    expect(parsePicks("PICK: rust | a\nPICK: rust | b", known)).toEqual([{ name: "rust", reason: "a" }]);
  });

  // Signalling failure matters: the caller keeps the lexical ranking instead of
  // replacing it with nothing.
  test("returns null when no PICK line is present", () => {
    expect(parsePicks("Sure! Here are some profiles you might like.", known)).toBeNull();
  });

  test("returns null when every name is unknown", () => {
    expect(parsePicks("PICK: nope | x\nPICK: alsonope | y", known)).toBeNull();
  });

  test("ignores prose around the picks", () => {
    expect(parsePicks("Here you go:\n\nPICK: python | it is python\n\nHope that helps!", known)).toEqual([
      { name: "python", reason: "it is python" },
    ]);
  });
});

describe("deepMatchProfiles fail-open", () => {
  const lexical = [{ name: "rust", strength: 0.8, score: 8, matchedTerms: ["rust"], reason: "matches rust" }];

  test("returns the lexical ranking when disabled by env", async () => {
    const prev = process.env.CUE_PROFILE_MATCH_DEEP;
    process.env.CUE_PROFILE_MATCH_DEEP = "0";
    try {
      const r = await deepMatchProfiles({ evidence: evidence({ rust: 3 }), docs, lexical });
      expect(r.classified).toBe(false);
      expect(r.matches).toEqual(lexical);
      expect(r.reason).toContain("disabled");
    } finally {
      if (prev === undefined) delete process.env.CUE_PROFILE_MATCH_DEEP;
      else process.env.CUE_PROFILE_MATCH_DEEP = prev;
    }
  });

  test("returns the lexical ranking when there are no profiles", async () => {
    const r = await deepMatchProfiles({ evidence: evidence({ rust: 3 }), docs: [], lexical });
    expect(r.classified).toBe(false);
    expect(r.matches).toEqual(lexical);
  });

  test("returns the lexical ranking when the directory offers no evidence", async () => {
    const r = await deepMatchProfiles({ evidence: evidence({}), docs, lexical });
    expect(r.classified).toBe(false);
    expect(r.matches).toEqual(lexical);
  });
});
