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
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { McpServerConfig } from "./runtime-materializer";

/**
 * Repo-root assets to seed into the venv's site-packages after `uv tool install`.
 *
 * Some upstream packages (e.g. TrendRadar) ship runtime config at the repo root
 * rather than inside the python package. `uv tool install` only copies the
 * package, so the binary then fails at startup looking for `<site-packages>/X/`.
 * For each known git URL, we sparse-clone the listed top-level dirs and copy
 * them next to the installed package. Idempotent: skipped if target exists.
 */
const REPO_ROOT_ASSETS: Record<string, string[]> = {
  "git+https://github.com/sansan0/TrendRadar.git": ["config"],
};

export interface NormalizeReport {
  /** Entries we just installed via `uv tool install` and rewrote. */
  installed: string[];
  /** Entries whose binary was already on disk — just rewrote. */
  reused: string[];
  /** Entries we left alone, with why. */
  skipped: { id: string; reason: "uv-missing" | "install-failed" }[];
  /** Entries whose repo-root assets we just seeded into site-packages. */
  seeded: { id: string; assets: string[] }[];
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

/**
 * Collapse `uv tool install` stderr to its salient line(s).
 *
 * On failure uv dumps a package-resolution firehose (`Resolved N packages`,
 * `Installed N packages`, and one ` + pkg==ver` line per dependency) followed
 * by the actual `error:`. Logging all of it on every launch/profile-switch
 * buries the one useful line under ~100 lines of noise. Keep the non-progress
 * lines (capped to the last 3), falling back to the first line when uv emitted
 * only progress.
 */
export function salientInstallError(stderr: string): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  if (lines.length === 0) return "(no stderr)";
  // Drop uv's progress chatter and per-package add/remove/update lines.
  const progress =
    /^(Resolved|Installed|Prepared|Audited|Downloading|Building|Built|Updating|Bytecode) /;
  const pkgLine = /^\s*[+\-~]\s/; // " + pkg==1.0" / " - pkg" / " ~ pkg" (uv indents)
  const salient = lines.filter((l) => !progress.test(l) && !pkgLine.test(l));
  const pick = salient.length > 0 ? salient.slice(-3) : [lines[0]];
  return pick.join("\n  ");
}

/**
 * Default seeder: sparse-clones `gitUrl` and copies each repo-root `asset` dir
 * into the site-packages of the venv that owns `binary`. No-op for any asset
 * already present. Returns the list of asset names actually copied.
 */
function seedRepoRootAssetsDefault(
  gitUrl: string,
  binary: string,
  assets: string[],
): string[] {
  const seeded: string[] = [];
  const sitePackages = resolveSitePackages(binary);
  if (!sitePackages) return seeded;

  const missing = assets.filter((a) => !existsSync(join(sitePackages, a)));
  if (missing.length === 0) return seeded;

  const cloneUrl = gitUrl.startsWith("git+") ? gitUrl.slice("git+".length) : gitUrl;
  const tmp = mkdtempSync(join(tmpdir(), "cue-uvx-seed-"));
  try {
    const clone = spawnSync(
      "git",
      ["clone", "--depth=1", "--filter=blob:none", "--sparse", cloneUrl, "repo"],
      { cwd: tmp, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 120_000 },
    );
    if (clone.status !== 0) return seeded;

    const sparse = spawnSync(
      "git",
      ["-C", "repo", "sparse-checkout", "set", ...missing],
      { cwd: tmp, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 60_000 },
    );
    if (sparse.status !== 0) return seeded;

    for (const asset of missing) {
      const src = join(tmp, "repo", asset);
      if (!existsSync(src)) continue;
      cpSync(src, join(sitePackages, asset), { recursive: true });
      seeded.push(asset);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return seeded;
}

/**
 * Find the site-packages dir for a `uv tool install`-ed binary by resolving the
 * symlink at ~/.local/bin/<binary> and walking up to the venv's
 * lib/python<X.Y>/site-packages/. Returns null if anything is off.
 */
function resolveSitePackages(binary: string): string | null {
  const linkPath = localBinPath(binary);
  if (!existsSync(linkPath)) return null;
  let real: string;
  try {
    real = realpathSync(linkPath);
  } catch {
    return null;
  }
  // real = <venv>/bin/<binary> → venv root is two dirs up.
  const venvRoot = dirname(dirname(real));
  const libDir = join(venvRoot, "lib");
  if (!existsSync(libDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(libDir);
  } catch {
    return null;
  }
  const pyDir = entries.find((e) => e.startsWith("python"));
  if (!pyDir) return null;
  const sp = join(libDir, pyDir, "site-packages");
  return existsSync(sp) ? sp : null;
}

export interface NormalizeOptions {
  install?: (gitUrl: string, binary: string) => { ok: boolean; stderr: string };
  binExists?: (binary: string) => boolean;
  uvOnPath?: () => boolean;
  warn?: (msg: string) => void;
  /** Seed repo-root assets into the venv's site-packages. Returns names copied. */
  seedAssets?: (gitUrl: string, binary: string, assets: string[]) => string[];
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
  const seedAssets = opts.seedAssets ?? seedRepoRootAssetsDefault;

  const report: NormalizeReport = { installed: [], reused: [], skipped: [], seeded: [] };
  const normalized: Record<string, McpServerConfig> = {};

  const trySeed = (id: string, gitUrl: string, binary: string): void => {
    const assets = REPO_ROOT_ASSETS[gitUrl];
    if (!assets || assets.length === 0) return;
    const copied = seedAssets(gitUrl, binary, assets);
    if (copied.length > 0) report.seeded.push({ id, assets: copied });
  };

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
      trySeed(id, gitUrl, binary);
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
        `MCP "${id}": \`uv tool install ${gitUrl}\` failed (looking for binary "${binary}").\n  ${
          salientInstallError(stderr)
        }\nLeaving entry as raw \`uvx --from git+...\`.`,
      );
      report.skipped.push({ id, reason: "install-failed" });
      normalized[id] = cfg;
      continue;
    }

    report.installed.push(id);
    trySeed(id, gitUrl, binary);
    normalized[id] = rewrite();
  }

  return { normalized, report };
}
