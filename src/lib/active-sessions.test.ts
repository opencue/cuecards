import { describe, expect, test } from "bun:test";

import {
  isAgentProcess,
  listActiveSessions,
  profileFromConfigDir,
  profileFromCwdPin,
  supportsProcScan,
} from "./active-sessions";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("listActiveSessions", () => {
  test("never throws even on platforms without /proc", () => {
    // On Linux this will return real sessions (or an empty array if none
    // running). On macOS/Windows it returns []. The contract is just
    // "always returns an array of the right shape, never throws."
    const out = listActiveSessions();
    expect(Array.isArray(out)).toBe(true);
    for (const session of out) {
      expect(typeof session.pid).toBe("number");
      expect(typeof session.profile).toBe("string");
      expect(session.profile.length).toBeGreaterThan(0);
    }
  });

  test("excludes the current process even if CUE_PROFILE is set on it", () => {
    const prev = process.env.CUE_PROFILE;
    process.env.CUE_PROFILE = "test-self-exclude";
    try {
      const out = listActiveSessions();
      expect(out.find((s) => s.pid === process.pid)).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CUE_PROFILE;
      else process.env.CUE_PROFILE = prev;
    }
  });
});

describe("supportsProcScan", () => {
  test("returns a boolean that matches the platform expectation", () => {
    const supported = supportsProcScan();
    expect(typeof supported).toBe("boolean");
    if (process.platform !== "linux") {
      expect(supported).toBe(false);
    }
  });
});

describe("isAgentProcess", () => {
  test("comm == claude/codex is always an agent", () => {
    expect(isAgentProcess("claude", "/home/user/bin/claude")).toBe(true);
    expect(isAgentProcess("codex", "/usr/bin/codex --resume")).toBe(true);
  });

  test("node/bun is an agent when cmdline mentions claude or codex", () => {
    expect(isAgentProcess("node", "/usr/bin/node /opt/claude/cli.js")).toBe(true);
    expect(isAgentProcess("bun", "/home/me/.bun/bin/bun /opt/codex/main.ts")).toBe(true);
  });

  test("node/bun without claude/codex in cmdline is not an agent", () => {
    expect(isAgentProcess("node", "/usr/bin/node /opt/vscode/server.js")).toBe(false);
  });

  test("cue's own subcommands are filtered out even when cmdline says claude", () => {
    expect(isAgentProcess("bun", "bun /repo/src/index.ts dashboard")).toBe(false);
    expect(isAgentProcess("bun", "bun /repo/src/index.ts launch claude")).toBe(false);
    expect(isAgentProcess("bun", "bun /repo/src/index.ts skill-report --profile claude-fan")).toBe(false);
  });

  test("anything else is not an agent", () => {
    expect(isAgentProcess("bash", "/bin/bash -c claude")).toBe(false);
    expect(isAgentProcess("sleep", "sleep 30")).toBe(false);
  });
});

describe("profileFromConfigDir", () => {
  test("extracts profile from the canonical cue runtime layout", () => {
    expect(profileFromConfigDir("/home/u/.config/cue/runtime/skill-writer/claude")).toBe("skill-writer");
    expect(profileFromConfigDir("/home/u/.config/cue/runtime/skill-writer/claude/")).toBe("skill-writer");
  });

  test("supports composite profile names (a+b+c)", () => {
    expect(profileFromConfigDir("/home/u/.config/cue/runtime/medusa-vite+backend/claude")).toBe("medusa-vite+backend");
  });

  test("returns null when the path doesn't end in /<profile>/claude", () => {
    expect(profileFromConfigDir("/home/u/.claude")).toBeNull();
    expect(profileFromConfigDir("/home/u/.claude-accounts/account2")).toBeNull();
    expect(profileFromConfigDir(undefined)).toBeNull();
    expect(profileFromConfigDir("")).toBeNull();
  });
});

describe("profileFromCwdPin", () => {
  test("returns the first line of .cue.profile when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-pin-test-"));
    try {
      writeFileSync(join(dir, ".cue.profile"), "skill-writer+ecc\n# comment line\n");
      expect(profileFromCwdPin(dir)).toBe("skill-writer+ecc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null on missing file or empty content", () => {
    const dir = mkdtempSync(join(tmpdir(), "cue-pin-test-"));
    try {
      expect(profileFromCwdPin(dir)).toBeNull();
      writeFileSync(join(dir, ".cue.profile"), "");
      expect(profileFromCwdPin(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null when cwd is null", () => {
    expect(profileFromCwdPin(null)).toBeNull();
  });
});
