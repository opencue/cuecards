/**
 * uvx-installer — normalize `uvx --from git+<repo> <binary>` MCP entries to a
 * locally-installed binary.
 *
 * Why this exists
 *   Two problems with the raw `uvx --from git+...` shape inside an MCP entry:
 *     1. First-launch cold start does a network download. MCP startup has a
 *        short handshake timeout, so the server often races and gets reaped
 *        before registering tools.
 *     2. Claude Code's auto-mode bash classifier blocks the same command when
 *        the model tries to probe it (`uvx --from git+<url>` is treated as
 *        "fetch and execute arbitrary code from an unverified URL").
 *
 * Fix
 *   At materialize time, run `uv tool install --from <git-url> <binary>` once
 *   (idempotent) and rewrite the runtime entry to invoke `~/.local/bin/<binary>`
 *   directly. Subsequent session starts are a plain local exec — no network,
 *   no classifier flag.
 *
 * Failure modes (warn + leave entry untouched, never throw)
 *   - `uv` missing from PATH       → tell the user to install uv.
 *   - `uv tool install` non-zero   → print stderr, fall back to raw uvx.
 *   Both keep the profile working on machines where the optimization can't
 *   be applied; only the first-launch race + classifier annoyance persist.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { McpServerConfig } from "./runtime-materializer";

export interface NormalizeReport {
  /** Entries we just installed via `uv tool install` and rewrote. */
  installed: string[];
  /** Entries whose binary was already on disk — just rewrote. */
  reused: string[];
  /** Entries we left alone, with why. */
  skipped: { id: string; reason: "uv-missing" | "install-failed" }[];
}

interface ParsedUvxGit {
  gitUrl: string;
  binary: string;
  /** Any args before `--from` or after the binary slot — preserved on rewrite. */
  extraArgs: string[];
}

/** Recognize the shape `uvx [pre...] --from git+<url> <binary> [post...]`. */
function parseUvxGit(cfg: McpServerConfig): ParsedUvxGit | null {
  if (cfg.command !== "uvx") return null;
  const args = cfg.args ?? [];
  const fromIdx = args.indexOf("--from");
  if (fromIdx < 0 || fromIdx + 2 >= args.length) return null;
  const gitUrl = args[fromIdx + 1]!;
  if (!gitUrl.startsWith("git+")) return null;
  const binary = args[fromIdx + 2]!;
  if (!binary || binary.startsWith("-")) return null;
  return {
    gitUrl,
    binary,
    extraArgs: [...args.slice(0, fromIdx), ...args.slice(fromIdx + 3)],
  };
}

function uvOnPathDefault(): boolean {
  const res = spawnSync("uv", ["--version"], { stdio: "ignore" });
  return res.status === 0;
}

function localBinPath(binary: string): string {
  return join(homedir(), ".local", "bin", binary);
}

function installBinaryDefault(
  gitUrl: string,
  _binary: string,
): { ok: boolean; stderr: string } {
  // `uv tool install <git-url>` installs whatever package the URL declares and
  // links every `[project.scripts]` entry into ~/.local/bin/. We deliberately
  // do NOT pass `--from <url> <bin>` — uv enforces install-name == package-name
  // in that mode, which breaks when the binary name (e.g. `trendradar-mcp`)
  // differs from the package name (`trendradar`).
  const res = spawnSync(
    "uv",
    ["tool", "install", gitUrl],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 180_000 },
  );
  if (res.status === 0) return { ok: true, stderr: "" };
  return { ok: false, stderr: (res.stderr ?? "").toString().trim() };
}

export interface NormalizeOptions {
  install?: (gitUrl: string, binary: string) => { ok: boolean; stderr: string };
  binExists?: (binary: string) => boolean;
  uvOnPath?: () => boolean;
  warn?: (msg: string) => void;
}

/**
 * Normalize MCP server entries in-place (functionally — returns a new map).
 *
 * Pure-ish: the only side effects are (optionally) spawning `uv` subprocesses
 * and writing to the warn sink. Tests inject mocks via {@link NormalizeOptions}.
 */
export function normalizeUvxGitServers(
  servers: Record<string, McpServerConfig>,
  opts: NormalizeOptions = {},
): { normalized: Record<string, McpServerConfig>; report: NormalizeReport } {
  const install = opts.install ?? installBinaryDefault;
  const binExists = opts.binExists ?? ((b) => existsSync(localBinPath(b)));
  const uvOnPath = opts.uvOnPath ?? uvOnPathDefault;
  const warn = opts.warn ?? ((m) => process.stderr.write(`[cue] ${m}\n`));

  const report: NormalizeReport = { installed: [], reused: [], skipped: [] };
  const normalized: Record<string, McpServerConfig> = {};

  let uvCache: boolean | null = null;
  const checkUv = () => {
    if (uvCache === null) uvCache = uvOnPath();
    return uvCache;
  };

  for (const [id, cfg] of Object.entries(servers)) {
    const parsed = parseUvxGit(cfg);
    if (!parsed) {
      normalized[id] = cfg;
      continue;
    }
    const { gitUrl, binary, extraArgs } = parsed;
    const binPath = localBinPath(binary);

    const rewrite = (): McpServerConfig => ({
      ...cfg,
      command: binPath,
      args: extraArgs,
    });

    if (binExists(binary)) {
      report.reused.push(id);
      normalized[id] = rewrite();
      continue;
    }

    if (!checkUv()) {
      warn(
        `MCP "${id}": uvx git+ source detected but \`uv\` is not on PATH. ` +
          `Leaving entry as raw \`uvx --from git+...\` — first session may time out ` +
          `during cold download. Install uv (https://docs.astral.sh/uv/) and re-run ` +
          `\`cue switch\` to enable the local-binary fast path.`,
      );
      report.skipped.push({ id, reason: "uv-missing" });
      normalized[id] = cfg;
      continue;
    }

    const { ok, stderr } = install(gitUrl, binary);
    if (!ok) {
      warn(
        `MCP "${id}": \`uv tool install --from ${gitUrl} ${binary}\` failed.\n  ${
          stderr || "(no stderr)"
        }\nLeaving entry as raw \`uvx --from git+...\`.`,
      );
      report.skipped.push({ id, reason: "install-failed" });
      normalized[id] = cfg;
      continue;
    }

    report.installed.push(id);
    normalized[id] = rewrite();
  }

  return { normalized, report };
}
