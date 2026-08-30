import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Locks the model-route-nudge UserPromptSubmit hook classifier. The hook
// classifies a prompt by task hardness and prints ONE short routing line
// (🧠 HARD / 🔍 EASY-SEARCH / ⚙️ MECHANICAL), or stays silent. It must always
// exit 0 (a non-zero exit blocks the prompt) and stay silent on ambiguous
// prompts (it fans out to every cue profile/user, so noise = token regression).

const SCRIPT = join(import.meta.dir, "model-route-nudge.sh");

// Throttle cache lives under $XDG_RUNTIME_DIR — give each run a fresh dir so
// tests can't silence each other via the 300s/session throttle.
let runtimeDir: string;

beforeEach(async () => {
  runtimeDir = await mkdtemp(join(tmpdir(), "cue-mrn-"));
});

afterEach(async () => {
  await rm(runtimeDir, { recursive: true, force: true });
});

type Class = "hard" | "search" | "mechanical" | "silent";

function run(prompt: string, sessionId = "s1"): { out: string; code: number | null } {
  const payload = JSON.stringify({ prompt, session_id: sessionId });
  const r = spawnSync("bash", [SCRIPT], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
  });
  return { out: r.stdout ?? "", code: r.status };
}

function classify(out: string): Class {
  if (out.startsWith("🧠")) return "hard";
  if (out.startsWith("🔍")) return "search";
  if (out.startsWith("⚙️")) return "mechanical";
  return "silent";
}

// [label, prompt, expectedClass]. Each case gets a unique session id (its
// index) so the throttle never crosses cases.
const CASES: Array<[string, string, Class]> = [
  // --- HARD (keep the main session / Opus) ---
  ["plan refactor", "plan the auth refactor across the codebase", "hard"],
  ["design schema", "design the database schema and decide on indexes", "hard"],
  ["architect verb", "let's architect the new ingestion pipeline", "hard"],
  ["security", "is there a security vulnerability in this endpoint", "hard"],
  ["root cause", "debug why is the login flow failing", "hard"],
  ["which approach", "which approach should we take for caching", "hard"],
  ["rethink", "rethink the whole permissions model", "hard"],

  // --- EASY / SEARCH (delegate to a Sonnet subagent) ---
  ["search npm", "search npm for a date formatting library", "search"],
  ["scrape+summarize", "scrape the pricing page and summarize it", "search"],
  ["find package", "find a package that does fuzzy string matching", "search"],
  ["find docs", "find the docs for the stripe webhook api", "search"],
  ["look up", "look up the syntax for a github actions matrix", "search"],

  // --- MECHANICAL (delegate to a cheap subagent) ---
  ["rename", "rename getUser to fetchUser everywhere", "mechanical"],
  ["bump version", "bump the version to 2.1.0", "mechanical"],
  ["typo", "fix the typo in the readme", "mechanical"],

  // --- false positives that MUST stay silent (the costly ones to get wrong) ---
  ["design a button", "design a button", "silent"],
  ["design a spinner", "design a loading spinner", "silent"],
  ["read arch.md", "read the architecture.md file", "silent"],
  ["arch diagram", "update the architecture diagram", "silent"],
  ["insecurity", "i have insecurity about this code", "silent"],
  ["what is going", "what is going on here", "silent"],
  ["find a bug", "find a bug in this function", "silent"],
  ["find leak", "find a memory leak in the worker", "silent"],

  // --- plain chat (silent) ---
  ["thanks", "thanks, that looks good", "silent"],
  ["greeting", "hello there friend", "silent"],
];

describe("model-route-nudge hook classifier", () => {
  CASES.forEach(([label, prompt, expected], i) => {
    test(`${label} → ${expected}`, () => {
      const { out, code } = run(prompt, `case-${i}`);
      expect(code).toBe(0); // never blocks a prompt
      expect(classify(out)).toBe(expected);
      // confident-match-only: at most one line of output, ever.
      expect(out.split("\n").filter(Boolean).length).toBeLessThanOrEqual(1);
    });
  });

  test("throttle: a 2nd matching prompt in the same session is silent", () => {
    const first = run("plan the migration strategy", "throttled");
    const second = run("plan the rollback strategy too", "throttled");
    expect(classify(first.out)).toBe("hard");
    expect(classify(second.out)).toBe("silent");
  });

  test("distinct sessions are not throttled against each other", () => {
    const a = run("plan the migration", "sessA");
    const b = run("plan the migration", "sessB");
    expect(classify(a.out)).toBe("hard");
    expect(classify(b.out)).toBe("hard");
  });

  test("[skip-route] suppresses the nudge for that turn", () => {
    const { out, code } = run("plan the auth refactor [skip-route]", "skip");
    expect(code).toBe(0);
    expect(classify(out)).toBe("silent");
  });

  test("sub-12-char prompts are silent", () => {
    const { out, code } = run("plan it", "short");
    expect(code).toBe(0);
    expect(classify(out)).toBe("silent");
  });

  test("HARD wins over SEARCH when a prompt mentions both", () => {
    // "plan how to search the index" is HARD — never delegate the judgment.
    const { out } = run("plan how to search the index", "mixed");
    expect(classify(out)).toBe("hard");
  });

  test("empty / missing prompt is silent and exits 0", () => {
    const r = spawnSync("bash", [SCRIPT], {
      input: JSON.stringify({ session_id: "none" }),
      encoding: "utf8",
      env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
    });
    expect(r.status).toBe(0);
    expect(classify(r.stdout ?? "")).toBe("silent");
  });
});
