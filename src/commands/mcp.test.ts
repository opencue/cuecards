import { describe, test, expect } from "bun:test";
import { parseArgs } from "./mcp";

describe("parseArgs", () => {
  // --- default / empty ---

  test("empty argv returns serve defaults", () => {
    const r = parseArgs([]);
    expect(r.sub).toBe("serve");
    expect(r.positional).toEqual([]);
    expect(r.json).toBe(false);
    expect(r.help).toBe(false);
  });

  // --- help flags ---

  test("--help sets help flag, sub stays serve", () => {
    const r = parseArgs(["--help"]);
    expect(r.help).toBe(true);
    expect(r.sub).toBe("serve");
  });

  test("-h sets help flag", () => {
    const r = parseArgs(["-h"]);
    expect(r.help).toBe(true);
    expect(r.sub).toBe("serve");
  });

  test("--help in non-first position sets help flag", () => {
    const r = parseArgs(["tools", "--help"]);
    expect(r.help).toBe(true);
  });

  // --- subcommands ---

  test("'tools' subcommand", () => {
    const r = parseArgs(["tools"]);
    expect(r.sub).toBe("tools");
    expect(r.help).toBe(false);
  });

  test("'install' subcommand", () => {
    const r = parseArgs(["install"]);
    expect(r.sub).toBe("install");
  });

  test("'test' subcommand", () => {
    const r = parseArgs(["test"]);
    expect(r.sub).toBe("test");
  });

  test("'serve' explicit subcommand", () => {
    const r = parseArgs(["serve"]);
    expect(r.sub).toBe("serve");
    expect(r.positional).toEqual([]);
  });

  // --- positional args ---

  test("unknown first arg goes into positional, sub stays serve", () => {
    const r = parseArgs(["unknowncmd"]);
    expect(r.sub).toBe("serve");
    expect(r.positional).toEqual(["unknowncmd"]);
  });

  test("test subcommand with tool name in positional", () => {
    const r = parseArgs(["test", "cue_status"]);
    expect(r.sub).toBe("test");
    expect(r.positional).toEqual(["cue_status"]);
  });

  test("test subcommand with tool name and JSON args", () => {
    const r = parseArgs(["test", "cue_skill_report", '{"profile":"x"}']);
    expect(r.sub).toBe("test");
    expect(r.positional).toEqual(["cue_skill_report", '{"profile":"x"}']);
  });

  // --- --json flag ---

  test("--json flag sets json true", () => {
    const r = parseArgs(["tools", "--json"]);
    expect(r.sub).toBe("tools");
    expect(r.json).toBe(true);
  });

  test("--json as sole arg falls through to positional (not parsed as flag)", () => {
    // parseArgs only checks --json in the i=1..n loop, so as the first and only
    // arg it is treated like an unknown positional, not a flag.
    const r = parseArgs(["--json"]);
    expect(r.json).toBe(false);
    expect(r.positional).toContain("--json");
  });

  // --- flag interleaving ---

  test("positional args skip flags and --json", () => {
    // only non-flag args after position 1 go into positional
    const r = parseArgs(["test", "--json", "cue_status"]);
    expect(r.sub).toBe("test");
    expect(r.json).toBe(true);
    expect(r.positional).toContain("cue_status");
    expect(r.positional).not.toContain("--json");
  });

  test("-h in later position also sets help", () => {
    const r = parseArgs(["install", "-h"]);
    expect(r.help).toBe(true);
  });
});
