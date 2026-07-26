import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dir, "..", "..");

/** Tracked text surfaces that make factual claims about cue. */
const FACT_FILES = ["llms.txt", "docs/llms.txt", "README.md", "docs/index.md"];

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// Count of *shipped* profiles — i.e. what package.json's files[] entry for
// profile.yaml under each profiles subdirectory actually packs, and what the
// docs are making a claim about. Derived from `git ls-files` rather than a
// directory listing on purpose: an untracked scratch profile someone is
// experimenting with on their own disk (e.g. profiles/importedprofile/) must
// not fail a test about documented facts. Fails loudly instead of falling
// back to a disk count if git can't answer — a silent fallback would
// reintroduce exactly the disk-state flakiness this is meant to remove.
function shippedProfileCount(): number {
  const result = spawnSync("git", ["ls-files", "profiles/*/profile.yaml"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not determine the shipped profile count from git: ` +
        `\`git ls-files profiles/*/profile.yaml\` ${result.error ? `failed to run (${result.error.message})` : `exited ${result.status}`}. ` +
        `stderr: ${result.stderr?.toString().trim() ?? "(none)"}`,
    );
  }
  return result.stdout
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean).length;
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
    const actual = shippedProfileCount();
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
