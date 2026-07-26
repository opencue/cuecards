import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { estimateTokens, materializedClaudeMdTokens, firedSkills } from "./profile-metrics";

// ---------------------------------------------------------------------------
// estimateTokens — pure function
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  test("empty string returns 0", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("4 characters returns 1 token (exact boundary)", () => {
    expect(estimateTokens("abcd")).toBe(1);
  });

  test("5 characters returns 2 tokens (ceil)", () => {
    expect(estimateTokens("abcde")).toBe(2);
  });

  test("1 character returns 1 token", () => {
    expect(estimateTokens("x")).toBe(1);
  });

  test("matches Math.ceil(length / 4) for a range of lengths", () => {
    for (const n of [1, 2, 3, 4, 7, 8, 9, 16, 100, 400, 401]) {
      expect(estimateTokens("x".repeat(n))).toBe(Math.ceil(n / 4));
    }
  });
});

// ---------------------------------------------------------------------------
// materializedClaudeMdTokens + firedSkills — use configDir() at call time,
// so setting XDG_CONFIG_HOME in beforeAll is enough; no dynamic import needed.
// ---------------------------------------------------------------------------

let tmpDir: string;
let savedXdg: string | undefined;
let cueDir: string;
const analyticsPath = () => join(cueDir, "analytics.jsonl");

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-metrics-"));
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpDir;
  cueDir = join(tmpDir, "cue");
  mkdirSync(cueDir, { recursive: true });
});

afterAll(() => {
  if (savedXdg !== undefined) process.env.XDG_CONFIG_HOME = savedXdg;
  else delete process.env.XDG_CONFIG_HOME;
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Remove analytics file between tests to start clean
  try { rmSync(analyticsPath()); } catch { /* ok if absent */ }
});

describe("materializedClaudeMdTokens", () => {
  test("returns null when runtime dir does not exist", () => {
    expect(materializedClaudeMdTokens("nonexistent-selector")).toBeNull();
  });

  test("returns token count when CLAUDE.md exists", () => {
    const claudeMdPath = join(cueDir, "runtime", "test-sel", "claude", "CLAUDE.md");
    mkdirSync(join(cueDir, "runtime", "test-sel", "claude"), { recursive: true });
    writeFileSync(claudeMdPath, "x".repeat(40)); // 40 chars = 10 tokens
    const result = materializedClaudeMdTokens("test-sel");
    expect(result).toBe(10);
  });
});

describe("firedSkills", () => {
  test("returns empty set when analytics.jsonl is absent", () => {
    const result = firedSkills("core");
    expect(result.size).toBe(0);
  });

  test("returns empty set when file contains no skill_hit events", () => {
    writeFileSync(
      analyticsPath(),
      '{"event":"start","profile":"core","ts":"2025-01-01T00:00:00.000Z"}\n',
    );
    expect(firedSkills("core").size).toBe(0);
  });

  test("collects skill ids from matching skill_hit events", () => {
    writeFileSync(
      analyticsPath(),
      [
        JSON.stringify({ event: "skill_hit", profile: "core", skill: "meta/analyze", ts: new Date().toISOString() }),
        JSON.stringify({ event: "skill_hit", profile: "core", skill: "meta/help", ts: new Date().toISOString() }),
      ].join("\n") + "\n",
    );
    const result = firedSkills("core");
    expect(result.has("meta/analyze")).toBe(true);
    expect(result.has("meta/help")).toBe(true);
  });

  test("composite selector matches skill fired under any component", () => {
    writeFileSync(
      analyticsPath(),
      JSON.stringify({
        event: "skill_hit",
        profile: "skill-writer",
        skill: "meta/skill-creator",
        ts: new Date().toISOString(),
      }) + "\n",
    );
    // "core+skill-writer" shares the "skill-writer" component with the event's profile
    const result = firedSkills("core+skill-writer");
    expect(result.has("meta/skill-creator")).toBe(true);
  });

  test("events from unrelated profile are excluded", () => {
    writeFileSync(
      analyticsPath(),
      JSON.stringify({
        event: "skill_hit",
        profile: "other-profile",
        skill: "meta/analyze",
        ts: new Date().toISOString(),
      }) + "\n",
    );
    const result = firedSkills("core");
    expect(result.has("meta/analyze")).toBe(false);
  });

  test("events older than windowDays are excluded", () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      analyticsPath(),
      JSON.stringify({ event: "skill_hit", profile: "core", skill: "meta/analyze", ts: oldDate }) + "\n",
    );
    // Default windowDays=30, event is 31 days old
    const result = firedSkills("core", 30);
    expect(result.has("meta/analyze")).toBe(false);
  });

  test("events within windowDays are included", () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      analyticsPath(),
      JSON.stringify({ event: "skill_hit", profile: "core", skill: "meta/analyze", ts: recentDate }) + "\n",
    );
    const result = firedSkills("core", 30);
    expect(result.has("meta/analyze")).toBe(true);
  });

  test("malformed JSON lines are skipped without throwing", () => {
    writeFileSync(
      analyticsPath(),
      [
        "not-valid-json",
        JSON.stringify({ event: "skill_hit", profile: "core", skill: "meta/help", ts: new Date().toISOString() }),
      ].join("\n") + "\n",
    );
    const result = firedSkills("core");
    expect(result.has("meta/help")).toBe(true);
  });

  test("events with no profile field are included (no profile filter)", () => {
    writeFileSync(
      analyticsPath(),
      JSON.stringify({ event: "skill_hit", skill: "meta/help", ts: new Date().toISOString() }) + "\n",
    );
    const result = firedSkills("core");
    // No profile in event → evComps.size === 0 → included unconditionally
    expect(result.has("meta/help")).toBe(true);
  });
});
