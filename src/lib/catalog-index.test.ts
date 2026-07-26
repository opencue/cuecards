import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import {
  MIN_TERM_LENGTH,
  SUGGEST_THRESHOLD,
  WEIGHTS,
  buildIndex,
  idFromSource,
  loadIndex,
  scoreQuery,
  tokenize,
  writeIndex,
  writeMatcherIndex,
} from "./catalog-index";

/**
 * A throwaway skills tree + catalog. Fixtures rather than the real 452-skill
 * library so the assertions stay stable when someone edits a real SKILL.md.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cue-index-"));
  const skills = join(root, "skills");

  const write = (id: string, body: string) => {
    mkdirSync(join(skills, id), { recursive: true });
    writeFileSync(join(skills, id, "SKILL.md"), body);
  };

  write(
    "payments/stripe-best-practices",
    `---
name: stripe-best-practices
description: Use when user says "Stripe", "payment flow", or "checkout". Covers webhooks, idempotency and security. NOT for subscription billing analytics.
requires_mcps: [stripe]
---

# stripe
Body text about payment handling.
`,
  );

  write(
    "deployment/coolify",
    `---
name: coolify
description: >-
  Use when user says "Coolify" or "deploy backend". Env vars, builds, restarts.
---

# coolify
Calls mcp__coolify__deploy under the hood.
`,
  );

  write(
    "eu-funding/ted-tender-search",
    `---
name: ted-tender-search
description: 'Use when user says "find EU tenders" or "közbeszerzés". Queries the TED API.'
tags: [tenders, procurement]
---

# ted
`,
  );

  // No quoted phrases anywhere — exercises the "capability but no triggers" path.
  write(
    "misc/plain-skill",
    `---
name: plain-skill
description: A plain descriptive sentence about widgets with no quoted trigger phrases at all.
---

# plain
`,
  );

  const catalogDir = join(root, "catalog");
  mkdirSync(catalogDir, { recursive: true });
  const catalogFile = join(catalogDir, "catalog.json");
  writeFileSync(
    catalogFile,
    JSON.stringify({
      schema_version: "2.1",
      installed: [
        { name: "stripe-best-practices", category: "payments", source: join(skills, "payments/stripe-best-practices/SKILL.md"), description: "", tags: [], triggers: [], links: [] },
        { name: "coolify", category: "deployment", source: join(skills, "deployment/coolify/SKILL.md"), description: "", tags: [], triggers: [], links: ["hosting"] },
        { name: "ted-tender-search", category: "eu-funding", source: join(skills, "eu-funding/ted-tender-search/SKILL.md"), description: "", tags: ["tenders"], triggers: [], links: [] },
        { name: "plain-skill", category: "misc", source: join(skills, "misc/plain-skill/SKILL.md"), description: "", tags: [], triggers: [], links: [] },
        { name: "ghost", category: "gone", source: join(skills, "gone/ghost/SKILL.md"), description: "A skill whose file was deleted", tags: [], triggers: [], links: [] },
      ],
    }),
  );

  return { root, skills, catalogFile, catalogDir };
}

const fx = fixture();
afterAll(() => rmSync(fx.root, { recursive: true, force: true }));

const index = buildIndex({ catalog: fx.catalogFile, root: fx.skills });
const byId = (id: string) => index.skills.find((s) => s.id === id)!;

describe("buildIndex", () => {
  test("derives ids from the SKILL.md path, not frontmatter name", () => {
    expect(index.skills.map((s) => s.id).sort()).toEqual([
      "deployment/coolify",
      "eu-funding/ted-tender-search",
      "gone/ghost",
      "misc/plain-skill",
      "payments/stripe-best-practices",
    ]);
  });

  test("backfills triggers from quoted phrases in the description", () => {
    // The catalog had `triggers: []` for every entry; these come from prose.
    expect(byId("payments/stripe-best-practices").triggers).toContain("Stripe");
    expect(byId("payments/stripe-best-practices").triggers).toContain("checkout");
    expect(byId("eu-funding/ted-tender-search").triggers).toContain("közbeszerzés");
  });

  test("handles folded (>-) description scalars", () => {
    expect(byId("deployment/coolify").triggers).toContain("Coolify");
  });

  test("extracts anti-scope into notFor", () => {
    expect(byId("payments/stripe-best-practices").notFor.toLowerCase()).toContain("subscription");
  });

  test("collects explicit and implicit MCP dependencies", () => {
    expect(byId("payments/stripe-best-practices").requires.mcps).toEqual(["stripe"]);
    // implicit: mcp__coolify__deploy in the body
    expect(byId("deployment/coolify").requires.mcps).toEqual(["coolify"]);
    expect(byId("misc/plain-skill").requires.mcps).toEqual([]);
  });

  test("a skill with no quoted phrases still gets a capability", () => {
    const plain = byId("misc/plain-skill");
    expect(plain.triggers).toEqual([]);
    expect(plain.capability.length).toBeGreaterThan(0);
  });

  test("keeps an entry whose SKILL.md is unreadable, unenriched", () => {
    const ghost = byId("gone/ghost");
    expect(ghost.description).toBe("A skill whose file was deleted");
    expect(ghost.capability).toBe("");
    expect(ghost.quality).toBe("none");
  });

  test("strips the bash generator's wrapping quotes from descriptions", () => {
    for (const s of index.skills) {
      expect(s.description.startsWith("'")).toBe(false);
      expect(s.description.startsWith('"')).toBe(false);
    }
  });

  test("counts reflect enrichment coverage", () => {
    expect(index.counts.skills).toBe(5);
    expect(index.counts.withTriggers).toBe(3);
    expect(index.counts.withRequires).toBe(2);
  });
});

describe("idFromSource", () => {
  test("returns category/dirname for a well-formed path", () => {
    expect(idFromSource("/r/a/b/SKILL.md", "/r")).toBe("a/b");
  });

  test("rejects paths outside the skills root", () => {
    expect(idFromSource("/elsewhere/a/b/SKILL.md", "/r")).toBeNull();
  });

  test("rejects a path that isn't a SKILL.md", () => {
    expect(idFromSource("/r/a/b/README.md", "/r")).toBeNull();
  });
});

describe("tokenize", () => {
  test("drops stopwords and short tokens", () => {
    expect(tokenize("when the user says deploy")).toEqual(["deploy"]);
  });

  test("keeps accented Hungarian terms", () => {
    expect(tokenize("közbeszerzés pályázat")).toEqual(["közbeszerzés", "pályázat"]);
  });

  test("never emits a term shorter than the index minimum", () => {
    for (const t of tokenize("a bb ccc dddd eeeee")) {
      expect(t.length).toBeGreaterThanOrEqual(MIN_TERM_LENGTH);
    }
  });
});

describe("scoreQuery", () => {
  // The misses that motivated this work: prompts carrying no skill NAME at all,
  // which the old name-only gate could never surface.
  const cases: Array<[string, string]> = [
    ["stripe checkout is broken in the admin", "payments/stripe-best-practices"],
    ["közbeszerzés pályázat keresés", "eu-funding/ted-tender-search"],
    ["deploy backend restarts and env vars", "deployment/coolify"],
  ];

  for (const [query, expected] of cases) {
    test(`"${query}" → ${expected}`, () => {
      const hits = scoreQuery(index, query, { limit: 3 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.entry.id).toBe(expected);
    });
  }

  test("a trigger phrase outscores an incidental description word", () => {
    const hits = scoreQuery(index, "Coolify", { limit: 5 });
    expect(hits[0]!.entry.id).toBe("deployment/coolify");
    expect(hits[0]!.score).toBeGreaterThanOrEqual(WEIGHTS.triggerPhrase);
  });

  test("excluded skills are dropped from results", () => {
    const hits = scoreQuery(index, "Coolify", { exclude: ["deployment/coolify"] });
    expect(hits.some((h) => h.entry.id === "deployment/coolify")).toBe(false);
  });

  test("nothing below the threshold is returned", () => {
    for (const h of scoreQuery(index, "stripe checkout deploy közbeszerzés")) {
      expect(h.score).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
    }
  });

  test("a query matching nothing returns no hits, not an error", () => {
    expect(scoreQuery(index, "zzzz qqqq wwww")).toEqual([]);
  });

  test("results are ordered by descending score", () => {
    const hits = scoreQuery(index, "deploy backend stripe checkout", { limit: 10 });
    const scores = hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  test("explain output names the field that matched", () => {
    const hits = scoreQuery(index, "Coolify", { limit: 1 });
    expect(hits[0]!.matched.some((m) => m.startsWith("trigger:"))).toBe(true);
  });
});

describe("writeIndex / loadIndex", () => {
  test("round-trips through disk", () => {
    const out = join(fx.root, "index.json");
    writeIndex(index, out);
    const back = loadIndex(out);
    expect(back?.counts.skills).toBe(index.counts.skills);
    expect(back?.skills.map((s) => s.id).sort()).toEqual(index.skills.map((s) => s.id).sort());
  });

  test("returns null for a corrupt index rather than throwing", () => {
    const bad = join(fx.root, "corrupt.json");
    writeFileSync(bad, "{ not json");
    expect(loadIndex(bad)).toBeNull();
  });

  test("returns null for valid JSON that isn't an index", () => {
    const bad = join(fx.root, "wrong-shape.json");
    writeFileSync(bad, JSON.stringify({ hello: "world" }));
    expect(loadIndex(bad)).toBeNull();
  });

  test("returns null for a missing file", () => {
    expect(loadIndex(join(fx.root, "nope.json"))).toBeNull();
  });
});

describe("writeMatcherIndex", () => {
  const dir = join(fx.root, "matcher");
  const stats = writeMatcherIndex(index, dir);

  test("emits phrases and terms", () => {
    expect(stats.phrases).toBeGreaterThan(0);
    expect(stats.terms).toBeGreaterThan(0);
  });

  const read = (file: string) => readFileSync(join(dir, file), "utf8");

  test("every row is <key>\\t<weight>\\t<id> — bash only ever sums column 2", () => {
    for (const file of ["phrases.idx", "terms.idx"]) {
      for (const line of read(file).split("\n").filter(Boolean)) {
        const cols = line.split("\t");
        expect(cols).toHaveLength(3);
        expect(Number.isNaN(Number(cols[1]))).toBe(false);
      }
    }
  });

  test("anti-scope terms carry the negative weight", () => {
    const negatives = read("terms.idx").split("\n").filter((l) => l.split("\t")[1] === String(WEIGHTS.notFor));
    expect(negatives.length).toBeGreaterThan(0);
  });

  test("weights.env exports the tunables the hook reads", () => {
    const text = read("weights.env");
    expect(text).toContain(`CUE_IDX_THRESHOLD=${SUGGEST_THRESHOLD}`);
    expect(text).toContain(`CUE_IDX_MIN_TERM=${MIN_TERM_LENGTH}`);
  });
});
