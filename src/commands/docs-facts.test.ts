import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Tracked text surfaces that make factual claims about cue. */
const FACT_FILES = ["llms.txt", "docs/llms.txt", "README.md", "docs/index.md"];

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("documented facts match reality", () => {
  test("the pin file is spelled .cue.profile everywhere", () => {
    for (const f of FACT_FILES) {
      expect(read(f)).not.toContain(".cue-profile");
    }
  });

  test("the repo slug is opencue/cuecards everywhere", () => {
    for (const f of [...FACT_FILES, "scripts/update-repo-topics.sh"]) {
      expect(read(f)).not.toContain("opencue/claude-code-skills");
    }
  });

  test("the stated profile count matches profiles/*/profile.yaml", () => {
    const actual = readdirSync(join(REPO_ROOT, "profiles"), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("_"))
      .filter(d => {
        try {
          readFileSync(join(REPO_ROOT, "profiles", d.name, "profile.yaml"));
          return true;
        } catch {
          return false;
        }
      }).length;
    // Guards against the drift that produced "16" in llms.txt and "69" in the
    // README while the real number was 85.
    for (const f of FACT_FILES) {
      const text = read(f);
      for (const stale of ["16 profiles", "69 ready-made", "see all 69"]) {
        expect(text).not.toContain(stale);
      }
      // Broader net: catch any "16 ... profiles" phrasing (e.g. "16 shipped
      // profiles"), not just the exact strings above, so a future rewording
      // of the stale count can't slip past the literal-string checks.
      expect(/\b16\b(?:\s+\S+){0,3}\s+profiles\b/i.test(text)).toBe(false);
      if (/\bprofiles ship by default\b/.test(text)) {
        expect(text).toContain(`${actual} profiles ship by default`);
      }
    }
  });
});
