/**
 * End-to-end tests for the Tier 1 hook.
 *
 * These run the real script against the real skill tree on purpose: the bug
 * this rewrite fixes was a gate that looked correct in isolation and silently
 * never fired in practice. Assertions stay loose (does the right skill appear
 * at all) so ordinary edits to a SKILL.md don't break the suite.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { buildIndex, tokenize, writeMatcherIndex } from "./catalog-index";

const REPO = join(import.meta.dir, "..", "..");
const HOOK = join(REPO, "resources", "hooks", "smart-loader-suggest.sh");
const LOOKUP = join(REPO, "resources", "skills", "skills", "meta", "smart-loader", "scripts", "smart-lookup.sh");

const tmp = mkdtempSync(join(tmpdir(), "cue-hook-"));
const matcher = join(tmp, "skill-index");
const journal = join(tmp, "journal.jsonl");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Everything the hook and smart-lookup would otherwise read out of
 * `$HOME/Documents/cue`, pinned to THIS checkout instead.
 *
 * Two separate things were wrong without it. A CI runner has no
 * `~/Documents/cue`, so both scripts resolved an absent skill tree and printed
 * nothing — every assertion here compared against "". And on a developer's
 * machine the ambient cue install leaks in the other direction: whoever has
 * `stripe-best-practices` in their active profile watches `--exclude-loaded`
 * correctly drop the very skill three of these tests assert gets surfaced.
 *
 * `HOME` goes to the throwaway dir for the same reason — it is what
 * smart-lookup falls back to for the active profile (pin file, then the
 * runtime settings that decide which MCPs count as available), and a test that
 * says something different depending on which profile you happen to have
 * loaded is not a test.
 */
const HERMETIC: Record<string, string> = {
  HOME: tmp,
  XDG_RUNTIME_DIR: tmp,
  CUE_SMART_LOOKUP: LOOKUP,
  CUE_CATALOG: join(REPO, "resources", "skills", "catalog", "catalog.json"),
  CUE_SKILLS_ROOT: join(REPO, "resources", "skills", "skills"),
  CUE_SKILL_INDEX_DIR: matcher,
  CUE_ACTIVE_PROFILE: "",
  CLAUDE_CONFIG_DIR: "",
};

let session = 0;

interface Run {
  stdout: string;
  ms: number;
}

function runHook(prompt: string, env: Record<string, string> = {}): Run {
  session += 1;
  const payload = JSON.stringify({ prompt, session_id: `test-${session}`, cwd: "/tmp/cue-hook-test" });
  const started = Date.now();
  const res = spawnSync("bash", [HOOK], {
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      ...HERMETIC,
      CUE_RESOLVE_JOURNAL: journal,
      ...env,
    },
  });
  return { stdout: res.stdout ?? "", ms: Date.now() - started };
}

beforeAll(() => {
  // The hook reads whatever `cue resolve --rebuild` last wrote. Build it here
  // so the test doesn't depend on the developer having run the command.
  writeMatcherIndex(
    buildIndex({
      catalog: join(REPO, "resources", "skills", "catalog", "catalog.json"),
      root: join(REPO, "resources", "skills", "skills"),
    }),
    matcher,
  );
});

describe("smart-loader-suggest hook", () => {
  test("the index files it depends on exist after a build", () => {
    expect(existsSync(join(matcher, "phrases.idx"))).toBe(true);
    expect(existsSync(join(matcher, "terms.idx"))).toBe(true);
    expect(existsSync(join(matcher, "weights.env"))).toBe(true);
  });

  // The regression that motivated the rewrite: not one token here is a skill
  // name or category, so the old name-only gate exited before matching.
  test("surfaces a skill from a prompt containing no skill name", () => {
    const { stdout } = runHook("a fizetes nem megy az adminban, checkout es webhook hibas");
    expect(stdout).toContain("Available skills");
    expect(stdout.toLowerCase()).toContain("stripe");
  });

  test("matches accented Hungarian trigger phrases", () => {
    const { stdout } = runHook("közbeszerzés pályázat keresés");
    expect(stdout).toContain("Available skills");
    expect(stdout).toContain("eu-funding/");
  });

  test("flags a skill whose MCP the active profile lacks", () => {
    const { stdout } = runHook("deploy the backend to coolify and check the logs");
    expect(stdout).toContain("deployment/coolify");
    expect(stdout).toContain("needs MCP");
  });

  test("points at cue resolve for the full ranking", () => {
    const { stdout } = runHook("deploy the backend to coolify and check the logs");
    expect(stdout).toContain("cue resolve");
  });

  test("promotes only actual invocations, not repeatedly surfaced suggestions", () => {
    const row = (stage: string) => JSON.stringify({
      ts: "2026-08-27T00:00:00.000Z",
      id: "deployment/coolify",
      cwd: "/tmp/cue-hook-test",
      profile: "",
      tier: 1,
      score: 0,
      stage,
    });
    writeFileSync(journal, `${row("surfaced")}\n${row("surfaced")}\n${row("surfaced")}\n`);
    expect(runHook("deploy the backend to coolify and check the logs").stdout).not.toContain("keep it");

    writeFileSync(journal, `${row("invoked")}\n${row("invoked")}\n${row("invoked")}\n`);
    expect(runHook("deploy the backend to coolify and check the logs").stdout).toContain("keep it");
  });

  test("stays inside the 200ms budget", () => {
    // Warm up first: the very first invocation in a fresh process pays for
    // page cache and shell startup that no real session pays twice, and it was
    // enough to push a 100ms hook over the line intermittently.
    runHook("warm up the caches with a throwaway prompt about coolify");
    // The contract at the top of the hook is <200ms *p95*, so the median is
    // what to assert. Holding all three samples to it asserts p100 instead,
    // and the tail is close enough to the line to lose that bet: sampled 12
    // runs on a developer box and got a 106ms median against a 175ms max. A
    // shared CI runner has a longer tail than that, and a perf test that goes
    // red on someone else's noisy neighbour teaches people to ignore it.
    const ms = [
      runHook("deploy the backend to coolify and check the logs"),
      runHook("stripe checkout payment webhook signature"),
      runHook("közbeszerzés pályázat keresés"),
    ]
      .map((r) => r.ms)
      .sort((a, b) => a - b);
    expect(ms[1]).toBeLessThan(200);
    // The tail still has to stay in the same order of magnitude — this is what
    // catches an actual regression, e.g. falling back to smart-lookup's ~6s
    // search path instead of taking the --annotate shortcut.
    expect(ms[2]).toBeLessThan(1000);
  });

  // The hook re-implements tokenize()/foldPlural() in awk because it can't call
  // into TypeScript. If the two drift, matching fails silently — which is the
  // exact failure mode this whole feature exists to fix. These two assert the
  // fold happens on both sides: a singular prompt against a plural description
  // and vice versa.
  test("a singular prompt term matches a plural index term", () => {
    expect(tokenize("webhook")).toEqual(tokenize("webhooks"));
    const { stdout } = runHook("stripe checkout payment webhook signature");
    expect(stdout.toLowerCase()).toContain("stripe");
  });

  test("a plural prompt term matches a singular index term", () => {
    const { stdout } = runHook("stripe checkouts payments webhooks signatures");
    expect(stdout.toLowerCase()).toContain("stripe");
  });

  test("says nothing for a prompt too short to carry signal", () => {
    expect(runHook("hi").stdout).toBe("");
  });

  test("says nothing when no skill is relevant", () => {
    expect(runHook("please rename this variable to something shorter").stdout).toBe("");
  });

  // Slow on purpose: without the index there are no ids to annotate, so this
  // falls back to smart-lookup's search path — which greps every SKILL.md body
  // and takes seconds. That cost is exactly why the indexed gate exists; the
  // generous timeout documents it rather than hiding it.
  test("falls back and still exits clean when the index is missing", () => {
    const { stdout } = runHook("deploy the backend to coolify", {
      CUE_SKILL_INDEX_DIR: join(tmp, "does-not-exist"),
    });
    // Legacy gate still matches the literal skill name, so this degrades in
    // recall rather than failing.
    expect(stdout).toContain("coolify");
  }, 30_000);

  test("never emits output when smart-lookup is unavailable", () => {
    const { stdout } = runHook("deploy the backend to coolify", {
      CUE_SMART_LOOKUP: join(tmp, "no-such-script.sh"),
    });
    expect(stdout).toBe("");
  });
});

describe("smart-lookup --annotate", () => {
  const annotate = (...ids: string[]) =>
    spawnSync("bash", [LOOKUP, "--annotate", ...ids], {
      encoding: "utf8",
      env: { ...process.env, ...HERMETIC },
    }).stdout ?? "";

  test("returns the 5-column TSV contract the search path uses", () => {
    const rows = annotate("deployment/coolify").trim().split("\n").filter(Boolean);
    expect(rows.length).toBe(1);
    expect(rows[0]!.split("\t")).toHaveLength(5);
  });

  test("reports missing MCPs", () => {
    const [, , , , status] = annotate("deployment/coolify").trim().split("\t");
    expect(status).toMatch(/^(ok|missing:)/);
  });

  test("strips the description key from plain YAML scalars", () => {
    const desc = annotate("eu-funding/ted-tender-search").split("\t")[3] ?? "";
    expect(desc.startsWith("description:")).toBe(false);
    expect(desc.startsWith("'")).toBe(false);
  });

  test("silently skips ids that don't resolve to a SKILL.md", () => {
    expect(annotate("no/such-skill").trim()).toBe("");
  });

  test("is fast enough for the hook path", () => {
    const started = Date.now();
    annotate("deployment/coolify", "stripe/stripe-webhooks", "eu-funding/ted-tender-search");
    expect(Date.now() - started).toBeLessThan(200);
  });
});
