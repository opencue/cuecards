import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateCondition, filterConditionalSkills, type ConditionalSkill } from "./conditional-skills";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cue-cond-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("evaluateCondition", () => {
  test("has_file matches existing file", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "");
    expect(evaluateCondition({ has_file: "Cargo.toml" }, tmp)).toBe(true);
  });

  test("has_file fails for missing file", () => {
    expect(evaluateCondition({ has_file: "Cargo.toml" }, tmp)).toBe(false);
  });

  test("has_file with glob matches by extension", () => {
    writeFileSync(join(tmp, "report.pdf"), "");
    expect(evaluateCondition({ has_file: "*.pdf" }, tmp)).toBe(true);
  });

  test("has_file array — any match passes", () => {
    writeFileSync(join(tmp, "go.mod"), "");
    expect(evaluateCondition({ has_file: ["Cargo.toml", "go.mod"] }, tmp)).toBe(true);
  });

  test("has_dir matches existing directory", () => {
    mkdirSync(join(tmp, "src"));
    expect(evaluateCondition({ has_dir: "src" }, tmp)).toBe(true);
  });

  test("has_dir with trailing slash", () => {
    mkdirSync(join(tmp, "forms"));
    expect(evaluateCondition({ has_dir: "forms/" }, tmp)).toBe(true);
  });

  test("has_dir and has_file accept ~/ and absolute paths, not only cwd-relative ones", () => {
    // HOME is the temp dir for this check, so `~/…` must resolve there and not under cwd.
    const prevHome = process.env.HOME;
    const elsewhere = mkdtempSync(join(tmpdir(), "cue-cond-cwd-"));
    try {
      process.env.HOME = tmp;
      mkdirSync(join(tmp, "tools", "secret-mcp"), { recursive: true });
      writeFileSync(join(tmp, "token"), "");
      expect(evaluateCondition({ has_dir: "~/tools/secret-mcp" }, elsewhere)).toBe(true);
      expect(evaluateCondition({ has_file: "~/token" }, elsewhere)).toBe(true);
      expect(evaluateCondition({ has_dir: join(tmp, "tools") }, elsewhere)).toBe(true);
      expect(evaluateCondition({ has_dir: "~/nope" }, elsewhere)).toBe(false);
      expect(evaluateCondition({ has_file: "~/nope" }, elsewhere)).toBe(false);
      // A relative path still means the project, never home.
      expect(evaluateCondition({ has_dir: "tools" }, elsewhere)).toBe(false);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  test("has_dir fails for missing dir", () => {
    expect(evaluateCondition({ has_dir: "src" }, tmp)).toBe(false);
  });

  test("env checks environment variable presence", () => {
    process.env.__CUE_TEST_VAR = "1";
    expect(evaluateCondition({ env: "__CUE_TEST_VAR" }, tmp)).toBe(true);
    delete process.env.__CUE_TEST_VAR;
    expect(evaluateCondition({ env: "__CUE_TEST_VAR" }, tmp)).toBe(false);
  });

  test("empty condition always passes", () => {
    expect(evaluateCondition({}, tmp)).toBe(true);
  });

  test("combined conditions require all groups", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "");
    // has_file passes, has_dir fails
    expect(evaluateCondition({ has_file: "Cargo.toml", has_dir: "src" }, tmp)).toBe(false);
    mkdirSync(join(tmp, "src"));
    expect(evaluateCondition({ has_file: "Cargo.toml", has_dir: "src" }, tmp)).toBe(true);
  });
});

describe("filterConditionalSkills", () => {
  test("returns IDs of skills whose conditions pass", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "");
    const skills: ConditionalSkill[] = [
      { id: "rust/cargo-check", when: { has_file: "Cargo.toml" } },
      { id: "go/lint", when: { has_file: "go.mod" } },
      { id: "meta/always", when: {} },
    ];
    const result = filterConditionalSkills(skills, tmp);
    expect(result).toEqual(["rust/cargo-check", "meta/always"]);
  });

  test("empty list returns empty", () => {
    expect(filterConditionalSkills([], tmp)).toEqual([]);
  });
});
