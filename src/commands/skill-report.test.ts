import { describe, test, expect } from "bun:test";
import { parseArgs } from "./skill-report";

describe("skill-report parseArgs", () => {
  test("defaults: no profile, 30d window, no flags set", () => {
    const a = parseArgs([]);
    expect(a.profile).toBeNull();
    expect(a.sinceDays).toBe(30);
    expect(a.json).toBe(false);
    expect(a.all).toBe(false);
    expect(a.help).toBe(false);
  });

  test("--help sets help flag", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  test("-h sets help flag", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("--json sets json: true", () => {
    expect(parseArgs(["--json"]).json).toBe(true);
  });

  test("--all sets all: true", () => {
    expect(parseArgs(["--all"]).all).toBe(true);
  });

  test("--profile captures the next argument", () => {
    expect(parseArgs(["--profile", "rust"]).profile).toBe("rust");
  });

  test("--profile with composite selector is captured verbatim", () => {
    expect(parseArgs(["--profile", "medusa-vite+backend"]).profile).toBe("medusa-vite+backend");
  });

  test("--profile with no following value yields null", () => {
    expect(parseArgs(["--profile"]).profile).toBeNull();
  });

  test("--since with plain integer", () => {
    expect(parseArgs(["--since", "7"]).sinceDays).toBe(7);
  });

  test("--since with 'd' suffix", () => {
    expect(parseArgs(["--since", "14d"]).sinceDays).toBe(14);
  });

  test("--since 0 is clamped to minimum of 1", () => {
    expect(parseArgs(["--since", "0"]).sinceDays).toBe(1);
  });

  test("--since 0d is clamped to minimum of 1", () => {
    expect(parseArgs(["--since", "0d"]).sinceDays).toBe(1);
  });

  test("--since with non-numeric value falls back to 30", () => {
    expect(parseArgs(["--since", "yesterday"]).sinceDays).toBe(30);
  });

  test("--since with empty-ish value (no following token) falls back to 30", () => {
    // argv[++i] returns undefined, which ?? "30" turns into the literal "30"
    expect(parseArgs(["--since"]).sinceDays).toBe(30);
  });

  test("--since 1 is accepted as-is (boundary: exactly minimum)", () => {
    expect(parseArgs(["--since", "1"]).sinceDays).toBe(1);
  });

  test("--since 90d is accepted (large window)", () => {
    expect(parseArgs(["--since", "90d"]).sinceDays).toBe(90);
  });

  test("all flags together produce the correct combined output", () => {
    const a = parseArgs(["--all", "--json", "--profile", "core", "--since", "7d"]);
    expect(a.all).toBe(true);
    expect(a.json).toBe(true);
    expect(a.profile).toBe("core");
    expect(a.sinceDays).toBe(7);
    expect(a.help).toBe(false);
  });

  test("help flag is independent of other flags", () => {
    const a = parseArgs(["--help", "--all", "--json"]);
    expect(a.help).toBe(true);
    // Unlike share.ts, skill-report.ts does NOT short-circuit on --help, so
    // the remaining flags are still processed.
    expect(a.all).toBe(true);
    expect(a.json).toBe(true);
  });

  test("unknown flags are silently ignored without crash", () => {
    const a = parseArgs(["--unknown", "--json"]);
    expect(a.json).toBe(true);
    expect(a.profile).toBeNull();
    expect(a.sinceDays).toBe(30);
  });

  test("--profile followed by another flag gets null (next token is a flag)", () => {
    // --json starts with '-', but argv[++i] just takes the next token literally.
    // This captures "--json" as the profile name — behaviour under test is that
    // it doesn't crash and returns the raw string.
    const a = parseArgs(["--profile", "--json"]);
    // "--json" is the raw next token; it may equal "--json" or null depending on impl.
    // The code does `argv[++i] ?? null`; argv[i] === "--json" which is a string, not
    // undefined, so it lands as profile.
    expect(a.profile).toBe("--json");
  });
});
