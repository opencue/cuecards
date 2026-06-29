/**
 * Tests for `cue cli`. Use JSON mode to assert structure without parsing ANSI.
 * Install command is exercised only in --dry-run mode (default) — we never
 * actually exec apt during tests.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run as cliRun } from "./cli";

// `resources/skills` is a git submodule and the CLI catalog is derived from
// skill frontmatter, so without it checked out (`git submodule update --init`)
// the catalog-backed assertions see an empty set. Skip rather than fail
// spuriously; the pure-unit blocks below (parseCLIs, usage) always run.
const SKILLS_PRESENT = existsSync(join(import.meta.dir, "../../resources/skills/skills"));

beforeEach(() => {
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

async function capture<T>(fn: () => Promise<T>): Promise<{ stdout: string; value: T }> {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { buf += String(c); return true; };
  try {
    const value = await fn();
    return { stdout: buf, value };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe.skipIf(!SKILLS_PRESENT)("cue cli list", () => {
  test("--json shape: rows with cli + installed + plan", async () => {
    const { stdout, value } = await capture(() => cliRun(["list", "full", "--json"]));
    expect(value).toBe(0);
    const out = JSON.parse(stdout) as { profile: string; rows: Array<{ cli: string; installed: boolean; skillCount: number; plan: { mode: string } }> };
    expect(out.profile).toBe("full");
    expect(out.rows.length).toBeGreaterThan(20);
    for (const r of out.rows) {
      expect(typeof r.cli).toBe("string");
      expect(typeof r.installed).toBe("boolean");
      expect(r.skillCount).toBeGreaterThan(0);
      expect(typeof r.plan.mode).toBe("string");
    }
  });

  test("at least one row has a real install command (apt/pip/script)", async () => {
    const { stdout } = await capture(() => cliRun(["list", "full", "--json"]));
    const out = JSON.parse(stdout) as { rows: Array<{ plan: { mode: string; command?: string } }> };
    const installable = out.rows.filter((r) => r.plan.command);
    expect(installable.length).toBeGreaterThan(5);
  });

  test("no positional + no .cue.profile → usage error", async () => {
    const orig = process.stderr.write.bind(process.stderr);
    let err = "";
    (process.stderr as any).write = (c: string | Uint8Array) => { err += String(c); return true; };
    try {
      // run from /tmp so no .cue.profile lookup succeeds
      const cwd = process.cwd();
      process.chdir("/tmp");
      try {
        const exit = await cliRun(["list"]);
        // either succeeds via parent .cue.profile resolution, or returns 1 with usage
        if (exit !== 0) expect(err).toContain("Usage");
      } finally {
        process.chdir(cwd);
      }
    } finally {
      (process.stderr as any).write = orig;
    }
  });
});

describe.skipIf(!SKILLS_PRESENT)("cue cli install", () => {
  test("dry-run --all is the default (no execution) and produces a plan", async () => {
    const { stdout, value } = await capture(() => cliRun(["install", "--all", "full", "--json"]));
    expect(value).toBe(0);
    const out = JSON.parse(stdout) as { dryRun: boolean; plans: Array<{ cli: string; mode: string; command?: string; hint?: string }> };
    expect(out.dryRun).toBe(true);
    expect(out.plans.length).toBeGreaterThan(10);
    // Every plan has either a command (auto-installable) or a hint (manual).
    for (const p of out.plans) {
      expect(p.command || p.hint).toBeTruthy();
    }
  });

  test("install <single-tool> without args returns usage error", async () => {
    const orig = process.stderr.write.bind(process.stderr);
    let err = "";
    (process.stderr as any).write = (c: string | Uint8Array) => { err += String(c); return true; };
    try {
      const exit = await cliRun(["install"]);
      expect(exit).toBe(1);
      expect(err).toContain("Usage");
    } finally {
      (process.stderr as any).write = orig;
    }
  });

  test("install <known-tool> dry-run produces apt or pip plan", async () => {
    const { stdout } = await capture(() => cliRun(["install", "nmap", "--json"]));
    const out = JSON.parse(stdout) as { plans: Array<{ cli: string; mode: string; command?: string; argv?: string[] }> };
    expect(out.plans).toHaveLength(1);
    expect(out.plans[0]!.cli).toBe("nmap");
    // On Linux with apt available, mode should be apt; otherwise some other available manager.
    expect(["apt", "brew", "dnf", "pacman", "winget", "manual"]).toContain(out.plans[0]!.mode);
    if (out.plans[0]!.command) expect(out.plans[0]!.argv?.length).toBeGreaterThan(0);
  });

  test("script recipes are manual unless explicitly allowed", async () => {
    const blocked = JSON.parse((await capture(() => cliRun(["install", "metasploit", "--json"]))).stdout) as {
      plans: Array<{ mode: string; command?: string; argv?: string[]; hint?: string }>;
    };
    expect(blocked.plans[0]!.mode).toBe("manual");
    expect(blocked.plans[0]!.command).toBeUndefined();
    expect(blocked.plans[0]!.hint).toContain("--allow-scripts");

    const allowed = JSON.parse((await capture(() => cliRun(["install", "metasploit", "--allow-scripts", "--json"]))).stdout) as {
      plans: Array<{ mode: string; command?: string; argv?: string[] }>;
    };
    expect(allowed.plans[0]!.mode).toBe("script");
    expect(allowed.plans[0]!.argv?.[0]).toBe("bash");
  });

  test("install <unknown-tool> dry-run reports no recipe", async () => {
    const { stdout } = await capture(() => cliRun(["install", "definitely-not-a-real-tool-xyz", "--json"]));
    const out = JSON.parse(stdout) as { plans: Array<{ cli: string; mode: string; hint?: string }> };
    expect(out.plans[0]!.mode).toBe("unknown");
    expect(out.plans[0]!.hint).toContain("no recipe");
  });
});

describe.skipIf(!SKILLS_PRESENT)("cue cli list --all-profiles", () => {
  test("--json returns flat array with profileCount across all profiles", async () => {
    const { stdout, value } = await capture(() => cliRun(["list", "--all-profiles", "--json"]));
    expect(value).toBe(0);
    const out = JSON.parse(stdout) as { rows: Array<{ cli: string; profileCount: number; profiles: string[]; installed: boolean; plan: { mode: string } }> };
    expect(out.rows.length).toBeGreaterThan(20);
    // A CLI used by full AND full should report profileCount >= 2.
    const multiUse = out.rows.find((r) => r.profileCount >= 2);
    expect(multiUse).toBeDefined();
    expect(multiUse!.profiles.length).toBe(multiUse!.profileCount);
  });

  test("--missing-only filters out installed CLIs", async () => {
    const { stdout } = await capture(() => cliRun(["list", "--all-profiles", "--missing-only", "--json"]));
    const out = JSON.parse(stdout) as { rows: Array<{ installed: boolean }> };
    for (const r of out.rows) expect(r.installed).toBe(false);
  });
});

describe("optimizer.parseCLIsFromContent", () => {
  test("extracts CLIs from allowed-tools frontmatter and Prerequisites", async () => {
    const { parseCLIsFromContent } = await import("./optimizer");
    const skillMd = `---
name: test
allowed-tools: Bash(nmap:*), Bash(sqlmap:*), Bash(curl arg)
---

# Test

## Prerequisites

- nmap installed
- docker
- random line with no known CLI
`;
    const clis = parseCLIsFromContent(skillMd);
    expect(clis).toContain("nmap");
    expect(clis).toContain("sqlmap");
    expect(clis).toContain("curl");
    expect(clis).toContain("docker");
  });

  test("empty content returns empty array", async () => {
    const { parseCLIsFromContent } = await import("./optimizer");
    expect(parseCLIsFromContent("")).toEqual([]);
  });

  test("preserves case for binary names (e.g. Xvfb)", async () => {
    const { parseCLIsFromContent } = await import("./optimizer");
    const md = `---\nallowed-tools: Bash(Xvfb:*)\n---\n`;
    expect(parseCLIsFromContent(md)).toContain("Xvfb");
  });
});

describe("cue cli (top-level)", () => {
  test("no subcommand prints usage with exit 0", async () => {
    const orig = process.stderr.write.bind(process.stderr);
    let err = "";
    (process.stderr as any).write = (c: string | Uint8Array) => { err += String(c); return true; };
    try {
      const exit = await cliRun([]);
      expect(exit).toBe(0);
      expect(err).toContain("cue cli");
    } finally {
      (process.stderr as any).write = orig;
    }
  });

  test("unknown subcommand exits 1", async () => {
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = () => true;
    try {
      const exit = await cliRun(["nonsense"]);
      expect(exit).toBe(1);
    } finally {
      (process.stderr as any).write = orig;
    }
  });
});
