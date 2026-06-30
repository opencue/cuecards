import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { normalizeUvxGitServers, salientInstallError } from "./uvx-installer";
import type { McpServerConfig } from "./runtime-materializer";

const localBin = (b: string) => join(homedir(), ".local", "bin", b);

const stubs = (overrides: {
  binExists?: (b: string) => boolean;
  uvOnPath?: () => boolean;
  install?: (gitUrl: string, binary: string) => { ok: boolean; stderr: string };
  seedAssets?: (gitUrl: string, binary: string, assets: string[]) => string[];
}) => ({
  binExists: overrides.binExists ?? (() => false),
  uvOnPath: overrides.uvOnPath ?? (() => true),
  install: overrides.install ?? (() => ({ ok: true, stderr: "" })),
  seedAssets: overrides.seedAssets ?? (() => []),
  warn: () => { /* swallow */ },
});

describe("normalizeUvxGitServers", () => {
  test("passes non-uvx entries through unchanged", () => {
    const servers: Record<string, McpServerConfig> = {
      drawio: { command: "npx", args: ["-y", "@drawio/mcp"] },
      gbrain: { command: "~/.local/bin/gbrain.sh" },
    };
    const { normalized, report } = normalizeUvxGitServers(servers, stubs({}));
    expect(normalized).toEqual(servers);
    expect(report).toEqual({ installed: [], reused: [], skipped: [], seeded: [] });
  });

  test("passes uvx entries without git+ source through unchanged", () => {
    const servers: Record<string, McpServerConfig> = {
      pypi: { command: "uvx", args: ["--from", "trendradar-mcp", "trendradar-mcp"] },
    };
    const { normalized, report } = normalizeUvxGitServers(servers, stubs({}));
    expect(normalized).toEqual(servers);
    expect(report.installed).toEqual([]);
    expect(report.reused).toEqual([]);
  });

  test("rewrites git+ entry to local binary when already installed", () => {
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://github.com/sansan0/TrendRadar.git", "trendradar-mcp"],
        env: { FOO: "bar" },
      },
    };
    const calls: string[] = [];
    const { normalized, report } = normalizeUvxGitServers(servers, stubs({
      binExists: (b) => { calls.push(`exists:${b}`); return true; },
      install: () => { throw new Error("install should not be called when binary exists"); },
    }));
    expect(normalized.trendradar).toEqual({
      command: localBin("trendradar-mcp"),
      args: [],
      env: { FOO: "bar" },
    });
    expect(report.reused).toEqual(["trendradar"]);
    expect(report.installed).toEqual([]);
    expect(calls).toEqual(["exists:trendradar-mcp"]);
  });

  test("installs missing binary and rewrites entry", () => {
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://github.com/sansan0/TrendRadar.git", "trendradar-mcp"],
        env: {},
      },
    };
    let installCalled: { gitUrl?: string; binary?: string } = {};
    const { normalized, report } = normalizeUvxGitServers(servers, stubs({
      binExists: () => false,
      install: (gitUrl, binary) => {
        installCalled = { gitUrl, binary };
        return { ok: true, stderr: "" };
      },
    }));
    expect(installCalled).toEqual({
      gitUrl: "git+https://github.com/sansan0/TrendRadar.git",
      binary: "trendradar-mcp",
    });
    expect(normalized.trendradar.command).toBe(localBin("trendradar-mcp"));
    expect(normalized.trendradar.args).toEqual([]);
    expect(report.installed).toEqual(["trendradar"]);
  });

  test("falls back to raw uvx when uv is missing", () => {
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://github.com/sansan0/TrendRadar.git", "trendradar-mcp"],
      },
    };
    const warnings: string[] = [];
    const { normalized, report } = normalizeUvxGitServers(servers, {
      binExists: () => false,
      uvOnPath: () => false,
      install: () => { throw new Error("install should not be called when uv missing"); },
      warn: (m) => warnings.push(m),
    });
    expect(normalized.trendradar).toEqual(servers.trendradar);
    expect(report.skipped).toEqual([{ id: "trendradar", reason: "uv-missing" }]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("uv");
  });

  test("falls back to raw uvx when install fails", () => {
    const servers: Record<string, McpServerConfig> = {
      bad: {
        command: "uvx",
        args: ["--from", "git+https://example.invalid/x.git", "bad-mcp"],
      },
    };
    const warnings: string[] = [];
    const { normalized, report } = normalizeUvxGitServers(servers, {
      binExists: () => false,
      uvOnPath: () => true,
      install: () => ({ ok: false, stderr: "fatal: repository not found" }),
      warn: (m) => warnings.push(m),
    });
    expect(normalized.bad).toEqual(servers.bad);
    expect(report.skipped).toEqual([{ id: "bad", reason: "install-failed" }]);
    expect(warnings[0]).toContain("repository not found");
  });

  test("collapses uv install firehose to the salient error line", () => {
    const firehose = [
      "Resolved 99 packages in 45ms",
      "Installed 99 packages in 61ms",
      " + aiohappyeyeballs==2.6.2",
      " + aiohttp==3.14.1",
      " + trendradar==6.10.0 (from git+https://example.invalid/x.git)",
      "error: Executable already exists: trendradar (use `--force` to overwrite)",
    ].join("\n");
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://example.invalid/x.git", "trendradar-mcp"],
      },
    };
    const warnings: string[] = [];
    normalizeUvxGitServers(servers, {
      binExists: () => false,
      uvOnPath: () => true,
      install: () => ({ ok: false, stderr: firehose }),
      warn: (m) => warnings.push(m),
    });
    expect(warnings[0]).toContain("Executable already exists");
    expect(warnings[0]).not.toContain("aiohappyeyeballs");
    expect(warnings[0]).not.toContain("aiohttp");
    expect(warnings[0]).not.toContain("Resolved 99 packages");
    expect(warnings[0]).not.toContain("Installed 99 packages");
  });

  test("salientInstallError keeps a lone non-noise line and handles empty", () => {
    expect(salientInstallError("fatal: repository not found")).toBe(
      "fatal: repository not found",
    );
    expect(salientInstallError("")).toBe("(no stderr)");
    expect(salientInstallError("Resolved 1 package in 2ms\n + foo==1.0")).toBe(
      "Resolved 1 package in 2ms",
    );
  });

  test("preserves extra uvx args around --from", () => {
    const servers: Record<string, McpServerConfig> = {
      x: {
        command: "uvx",
        args: ["--python", "3.12", "--from", "git+https://example.com/x.git", "x-mcp", "--verbose"],
      },
    };
    const { normalized } = normalizeUvxGitServers(servers, stubs({ binExists: () => true }));
    expect(normalized.x.command).toBe(localBin("x-mcp"));
    // Pre-`--from` and post-binary args are preserved (order: pre then post).
    expect(normalized.x.args).toEqual(["--python", "3.12", "--verbose"]);
  });

  test("seeds repo-root assets after fresh install for known git URLs", () => {
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://github.com/sansan0/TrendRadar.git", "trendradar-mcp"],
      },
    };
    const seedCalls: { gitUrl: string; binary: string; assets: string[] }[] = [];
    const { report } = normalizeUvxGitServers(servers, stubs({
      binExists: () => false,
      install: () => ({ ok: true, stderr: "" }),
      seedAssets: (gitUrl, binary, assets) => {
        seedCalls.push({ gitUrl, binary, assets });
        return assets; // pretend we copied all of them
      },
    }));
    expect(seedCalls).toEqual([{
      gitUrl: "git+https://github.com/sansan0/TrendRadar.git",
      binary: "trendradar-mcp",
      assets: ["config"],
    }]);
    expect(report.seeded).toEqual([{ id: "trendradar", assets: ["config"] }]);
  });

  test("heals existing install missing repo-root assets on reuse path", () => {
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://github.com/sansan0/TrendRadar.git", "trendradar-mcp"],
      },
    };
    const { report } = normalizeUvxGitServers(servers, stubs({
      binExists: () => true, // binary already on disk
      seedAssets: (_gitUrl, _binary, assets) => assets, // assets were missing, now copied
    }));
    expect(report.reused).toEqual(["trendradar"]);
    expect(report.seeded).toEqual([{ id: "trendradar", assets: ["config"] }]);
  });

  test("does not seed when git URL is not in the asset table", () => {
    const servers: Record<string, McpServerConfig> = {
      other: {
        command: "uvx",
        args: ["--from", "git+https://example.com/other.git", "other-mcp"],
      },
    };
    let seedCalled = false;
    const { report } = normalizeUvxGitServers(servers, stubs({
      binExists: () => true,
      seedAssets: () => { seedCalled = true; return []; },
    }));
    expect(seedCalled).toBe(false);
    expect(report.seeded).toEqual([]);
  });

  test("does not record seed when seeder copies nothing (assets already present)", () => {
    const servers: Record<string, McpServerConfig> = {
      trendradar: {
        command: "uvx",
        args: ["--from", "git+https://github.com/sansan0/TrendRadar.git", "trendradar-mcp"],
      },
    };
    const { report } = normalizeUvxGitServers(servers, stubs({
      binExists: () => true,
      seedAssets: () => [], // nothing copied — already healthy
    }));
    expect(report.seeded).toEqual([]);
  });

  test("only spawns uv once for many git+ entries", () => {
    const servers: Record<string, McpServerConfig> = {
      a: { command: "uvx", args: ["--from", "git+https://example.com/a.git", "a"] },
      b: { command: "uvx", args: ["--from", "git+https://example.com/b.git", "b"] },
      c: { command: "uvx", args: ["--from", "git+https://example.com/c.git", "c"] },
    };
    let uvChecks = 0;
    normalizeUvxGitServers(servers, {
      binExists: () => true, // skip install path
      uvOnPath: () => { uvChecks++; return true; },
      install: () => ({ ok: true, stderr: "" }),
      warn: () => { /* swallow */ },
    });
    // All entries hit the binExists fast path, so uvOnPath shouldn't be touched.
    expect(uvChecks).toBe(0);
  });
});
