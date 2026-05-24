import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { normalizeUvxGitServers } from "./uvx-installer";
import type { McpServerConfig } from "./runtime-materializer";

const localBin = (b: string) => join(homedir(), ".local", "bin", b);

const stubs = (overrides: {
  binExists?: (b: string) => boolean;
  uvOnPath?: () => boolean;
  install?: (gitUrl: string, binary: string) => { ok: boolean; stderr: string };
}) => ({
  binExists: overrides.binExists ?? (() => false),
  uvOnPath: overrides.uvOnPath ?? (() => true),
  install: overrides.install ?? (() => ({ ok: true, stderr: "" })),
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
    expect(report).toEqual({ installed: [], reused: [], skipped: [] });
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
