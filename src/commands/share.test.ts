import { describe, test, expect } from "bun:test";
import { parseArgs } from "./share";

describe("share parseArgs", () => {
  test("no args → sub: 'help' with default flags cleared", () => {
    const a = parseArgs([]);
    expect(a.sub).toBe("help");
    expect(a.positional).toEqual([]);
    expect(a.json).toBe(false);
    expect(a.yes).toBe(false);
  });

  test("--help as first arg → sub: 'help'", () => {
    expect(parseArgs(["--help"]).sub).toBe("help");
  });

  test("-h as first arg → sub: 'help'", () => {
    expect(parseArgs(["-h"]).sub).toBe("help");
  });

  test("unknown first arg → sub: 'help' (no crash)", () => {
    expect(parseArgs(["foobar"]).sub).toBe("help");
  });

  test("flag as first arg → sub: 'help' (flags are not subcommands)", () => {
    // --json before a subcommand → falls through default, returns help
    expect(parseArgs(["--json"]).sub).toBe("help");
  });

  test("all six valid subcommands are recognized", () => {
    const valid = ["install", "list", "remove", "push", "search", "update"] as const;
    for (const sub of valid) {
      expect(parseArgs([sub]).sub).toBe(sub);
    }
  });

  test("positional arg after subcommand is captured", () => {
    const a = parseArgs(["install", "jane/repo"]);
    expect(a.sub).toBe("install");
    expect(a.positional).toEqual(["jane/repo"]);
  });

  test("multiple positional args are all captured", () => {
    const a = parseArgs(["search", "medusa", "backend"]);
    expect(a.positional).toEqual(["medusa", "backend"]);
  });

  test("--json flag after subcommand sets json: true", () => {
    expect(parseArgs(["list", "--json"]).json).toBe(true);
  });

  test("--yes flag sets yes: true", () => {
    expect(parseArgs(["install", "--yes"]).yes).toBe(true);
  });

  test("-y flag sets yes: true", () => {
    expect(parseArgs(["push", "-y"]).yes).toBe(true);
  });

  test("flags and positional args can be interleaved", () => {
    const a = parseArgs(["install", "--yes", "user/repo@v1", "--json"]);
    expect(a.sub).toBe("install");
    expect(a.yes).toBe(true);
    expect(a.json).toBe(true);
    expect(a.positional).toEqual(["user/repo@v1"]);
  });

  test("--help as first arg: remaining args are not processed", () => {
    // --help short-circuits before the flag loop, so --json stays false
    const a = parseArgs(["--help", "--json"]);
    expect(a.sub).toBe("help");
    expect(a.json).toBe(false);
  });

  test("unknown flags after subcommand are silently ignored", () => {
    const a = parseArgs(["list", "--totally-unknown"]);
    expect(a.sub).toBe("list");
    expect(a.positional).toEqual([]);
    expect(a.json).toBe(false);
  });

  test("remove subcommand with target and --json", () => {
    const a = parseArgs(["remove", "user/repo", "--json"]);
    expect(a.sub).toBe("remove");
    expect(a.positional).toEqual(["user/repo"]);
    expect(a.json).toBe(true);
  });

  test("update subcommand with no target is valid (updates all)", () => {
    const a = parseArgs(["update"]);
    expect(a.sub).toBe("update");
    expect(a.positional).toEqual([]);
  });

  test("list subcommand collects no positional args from flags", () => {
    const a = parseArgs(["list", "--json", "--yes"]);
    expect(a.sub).toBe("list");
    expect(a.positional).toEqual([]);
    expect(a.json).toBe(true);
    expect(a.yes).toBe(true);
  });
});
