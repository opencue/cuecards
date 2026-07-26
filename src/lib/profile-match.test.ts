import { describe, expect, test } from "bun:test";

import {
  MATCH_MIN_STRENGTH,
  STRONG_MATCH_SCORE,
  type MatchProbe,
  loadProfileDocs,
  matchProfiles,
  matchProfilesForCwd,
  repoEvidence,
} from "./profile-match";

/**
 * A fake filesystem. Keys are absolute-ish paths; directory listings are
 * derived from the keys so tests only describe files.
 */
function probeFor(files: Record<string, string>): MatchProbe {
  return {
    exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    read: (p) => files[p] ?? null,
    list: (p) => {
      const prefix = `${p}/`;
      const out = new Set<string>();
      for (const f of Object.keys(files)) {
        if (!f.startsWith(prefix)) continue;
        out.add(f.slice(prefix.length).split("/")[0]!);
      }
      return [...out];
    },
  };
}

const PROFILES = "/p";

/** A small profile library covering the shapes that matter. */
const profileFiles: Record<string, string> = {
  [`${PROFILES}/rust/profile.yaml`]: `
name: rust
description: All-in-one Rust profile — async, web, CLI, embedded
skills:
  local:
    - rust/async-tokio
    - rust/serde
    - rust/axum-api
`,
  [`${PROFILES}/ros2/profile.yaml`]: `
name: ros2
description: "ROS 2 robot control via rosbridge — robotics tooling over WebSocket"
skills:
  local:
    - robotics/urdf-tools
`,
  [`${PROFILES}/medusa-dev/profile.yaml`]: `
name: medusa-dev
description: Medusa commerce backend and storefront development
skills:
  local:
    - medusa/medusa-reference
mcps:
  - medusadocs
`,
  // The giant. Mentions nearly every term the others do — the size-damping case.
  [`${PROFILES}/everything/profile.yaml`]: `
name: everything
description: Rust robot medusa commerce async serde axum tokio urdf robotics storefront backend
skills:
  local:
    - rust/async-tokio
    - rust/serde
    - rust/axum-api
    - robotics/urdf-tools
    - medusa/medusa-reference
    - extra/one
    - extra/two
    - extra/three
`,
  // Ignored: leading underscore.
  [`${PROFILES}/_cache/profile.yaml`]: `name: _cache\ndescription: not a real profile`,
  // Ignored: unparseable.
  [`${PROFILES}/broken/profile.yaml`]: `name: [unclosed`,
};

const probe = probeFor(profileFiles);
const docs = loadProfileDocs(PROFILES, probe);

describe("loadProfileDocs", () => {
  test("reads every real profile and skips underscore dirs", () => {
    expect(docs.map((d) => d.name).sort()).toEqual(["everything", "medusa-dev", "ros2", "rust"]);
  });

  test("a broken profile.yaml is skipped, not fatal", () => {
    expect(docs.some((d) => d.name === "broken")).toBe(false);
    expect(docs.length).toBeGreaterThan(0);
  });

  test("vocabulary comes from name, description and skill ids", () => {
    const rust = docs.find((d) => d.name === "rust")!;
    expect(rust.terms.has("rust")).toBe(true);
    expect(rust.terms.has("tokio")).toBe(true); // from skill id
    expect(rust.terms.has("embedded")).toBe(true); // from description
  });

  test("the profile's own name outweighs a description word", () => {
    const rust = docs.find((d) => d.name === "rust")!;
    expect(rust.terms.get("rust")!).toBeGreaterThan(rust.terms.get("embedded")!);
  });
});

describe("repoEvidence", () => {
  test("reads dependencies from package.json, scope included", () => {
    const ev = repoEvidence(
      "/r",
      probeFor({ "/r/package.json": JSON.stringify({ dependencies: { "@medusajs/medusa": "1" } }) }),
    );
    expect(ev.terms.has("medusa")).toBe(true);
    expect(ev.terms.has("medusajs")).toBe(true);
    expect(ev.sources.get("medusa")).toBe("dependency");
  });

  test("a malformed package.json contributes nothing and doesn't throw", () => {
    const ev = repoEvidence("/r", probeFor({ "/r/package.json": "{{{ not json" }));
    expect(ev.terms.has("medusa")).toBe(false);
  });

  test("one distinctive file settles a language; a common one needs two", () => {
    const one = repoEvidence("/r", probeFor({ "/r/robot.urdf": "" }));
    expect(one.terms.has("robot")).toBe(true);

    const strayPy = repoEvidence("/r", probeFor({ "/r/hack.py": "", "/r/main.ts": "" }));
    expect(strayPy.terms.has("python")).toBe(false);

    const realPy = repoEvidence("/r", probeFor({ "/r/a.py": "", "/r/b.py": "" }));
    expect(realPy.terms.has("python")).toBe(true);
  });

  test("universal scaffolding never becomes evidence", () => {
    const ev = repoEvidence(
      "/home/me/Documents/thing",
      probeFor({
        "/home/me/Documents/thing/CLAUDE.md": "",
        "/home/me/Documents/thing/README.md": "",
        "/home/me/Documents/thing/src/x.ts": "",
        "/home/me/Documents/thing/docs/y.md": "",
      }),
    );
    for (const noise of ["claude", "readme", "src", "docs", "document"]) {
      expect(ev.terms.has(noise)).toBe(false);
    }
  });

  test("the containing path is not evidence", () => {
    // `~/Documents/<x>` used to make every project match docs-writer.
    const ev = repoEvidence("/home/me/Documents/rust-thing", probeFor({ "/home/me/Documents/rust-thing/a.md": "" }));
    expect(ev.terms.has("rust")).toBe(false);
  });

  test("finds a nested manifest only when the root declares none", () => {
    const nested = repoEvidence(
      "/r",
      probeFor({ "/r/app/package.json": JSON.stringify({ dependencies: { "@medusajs/medusa": "1" } }) }),
    );
    expect(nested.terms.has("medusa")).toBe(true);

    const rootDeclares = repoEvidence(
      "/r",
      probeFor({
        "/r/package.json": JSON.stringify({ dependencies: { tokio: "1" } }),
        "/r/app/package.json": JSON.stringify({ dependencies: { "@medusajs/medusa": "1" } }),
      }),
    );
    expect(rootDeclares.terms.has("tokio")).toBe(true);
    expect(rootDeclares.terms.has("medusa")).toBe(false);
  });
});

describe("matchProfiles", () => {
  const match = (files: Record<string, string>) => matchProfiles(repoEvidence("/r", probeFor(files)), docs);

  test("a Rust repo matches the rust profile", () => {
    const m = match({ "/r/Cargo.toml": "[dependencies]\ntokio = \"1\"\nserde = \"1\"\n", "/r/main.rs": "" });
    expect(m[0]!.name).toBe("rust");
  });

  test("a ROS workspace matches ros2 off a single urdf", () => {
    const m = match({ "/r/robot.urdf": "" });
    expect(m.map((x) => x.name)).toContain("ros2");
  });

  test("a shop with its manifest in app/ still matches medusa", () => {
    const m = match({ "/r/app/package.json": JSON.stringify({ dependencies: { "@medusajs/medusa": "1" } }) });
    expect(m.map((x) => x.name)).toContain("medusa-dev");
  });

  // The whole point of size damping: `everything` shares every term with
  // `rust`, so without it breadth alone would win each directory.
  test("a broad profile does not outrank the specific one it contains", () => {
    const m = match({ "/r/Cargo.toml": "[dependencies]\ntokio = \"1\"\n", "/r/main.rs": "" });
    const rust = m.findIndex((x) => x.name === "rust");
    const everything = m.findIndex((x) => x.name === "everything");
    expect(rust).toBeGreaterThanOrEqual(0);
    if (everything >= 0) expect(rust).toBeLessThan(everything);
  });

  // The corroboration rule. Filenames alone used to make every repo in the
  // workspace match whichever profile happened to share a scaffolding word.
  test("filename evidence alone never carries a match", () => {
    expect(match({ "/r/robot.md": "", "/r/notes.md": "" })).toEqual([]);
  });

  test("a directory with nothing to say matches nothing", () => {
    // Not "matches its loudest noise at strength 1.0" — the bug that absolute
    // scoring replaced relative-to-top-hit normalization to fix.
    expect(match({ "/r/notes.md": "", "/r/todo.txt": "" })).toEqual([]);
  });

  test("strength is absolute, so a weak match reads as weak", () => {
    const m = match({ "/r/robot.urdf": "" });
    const ros = m.find((x) => x.name === "ros2")!;
    expect(ros.strength).toBeGreaterThanOrEqual(MATCH_MIN_STRENGTH);
    expect(ros.strength).toBeLessThanOrEqual(1);
    expect(ros.score / STRONG_MATCH_SCORE).toBeCloseTo(Math.min(1, ros.strength), 5);
  });

  test("results are sorted strongest-first and carry a reason", () => {
    const m = match({ "/r/Cargo.toml": "[dependencies]\ntokio = \"1\"\n", "/r/main.rs": "" });
    expect(m.length).toBeGreaterThan(0);
    expect([...m].sort((a, b) => b.score - a.score)).toEqual(m);
    expect(m[0]!.reason.length).toBeGreaterThan(0);
    expect(m[0]!.matchedTerms.length).toBeGreaterThan(0);
  });

  test("no profiles or no evidence yields no matches", () => {
    expect(matchProfiles(repoEvidence("/r", probeFor({})), docs)).toEqual([]);
    expect(matchProfiles(repoEvidence("/r", probeFor({ "/r/main.rs": "" })), [])).toEqual([]);
  });
});

describe("matchProfilesForCwd", () => {
  test("honors the limit", () => {
    const files = { "/r/Cargo.toml": "[dependencies]\ntokio = \"1\"\n", "/r/main.rs": "" };
    const all = matchProfilesForCwd("/r", { root: PROFILES, probe: probeFor({ ...profileFiles, ...files }) });
    const one = matchProfilesForCwd("/r", {
      root: PROFILES,
      probe: probeFor({ ...profileFiles, ...files }),
      limit: 1,
    });
    expect(one.length).toBeLessThanOrEqual(1);
    expect(one.length).toBeLessThanOrEqual(all.length);
  });

  test("an unreadable tree returns no matches rather than throwing", () => {
    const exploding: MatchProbe = {
      exists: () => { throw new Error("nope"); },
      list: () => { throw new Error("nope"); },
      read: () => { throw new Error("nope"); },
    };
    expect(matchProfilesForCwd("/r", { root: PROFILES, probe: exploding })).toEqual([]);
  });
});
