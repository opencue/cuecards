/**
 * Shared `claude --print` classifier — one lightweight, isolated, fail-open LLM
 * call that any cue feature can make.
 *
 * This machinery grew inside `skill-subset.ts` for one caller. It is subtle in
 * ways that are expensive to rediscover — the ephemeral config dir, the
 * credential copy-back race, the shared timeout budget across the binary
 * fallback — so the second caller (the profile matcher) reuses it rather than
 * growing a parallel copy that drifts.
 *
 * Contract, in the order it matters:
 *
 *   1. **Never throws, never rejects.** Spawn failure, non-zero exit, timeout,
 *      missing binary — all resolve to `{ ok: false }`. Callers fail open to
 *      whatever they had without the LLM. A classifier is an optimization; it
 *      is never a gate.
 *   2. **Lightweight spawn.** `--strict-mcp-config` or the child boots every
 *      MCP server in the user's config just to answer one line, and a fast
 *      model because the account default may be a heavyweight reasoner.
 *   3. **Isolated.** An ephemeral `CLAUDE_CONFIG_DIR` keeps the call out of the
 *      user's plugins, hooks and session logs.
 *   4. **Bounded.** The timeout kills the child and settles the promise even if
 *      the child ignores the signal; the binary fallback shares the original
 *      budget rather than stacking a second full timeout on top.
 */

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { findRealClaudeBin } from "./claude-binary";
import { cacheDir } from "./config-paths";

/**
 * CLI args for the classifier spawn. The call must be LIGHTWEIGHT:
 *   - `--strict-mcp-config` — without it the spawned claude boots every MCP
 *     server in the user's config (a dozen npm/python daemons) just to answer
 *     one line. Observed to blow the 30s budget and freeze launches on configs
 *     with many global servers.
 *   - a fast model — the account default may be a heavyweight reasoning model;
 *     classification is a trivial pick-list task. Override with
 *     CUE_SMART_SUBSET_MODEL if the alias isn't available on the account.
 * NOT `--bare`: it skips credential/settings loading and comes back
 * "Not logged in".
 */
export function classifierSpawnArgs(prompt: string): string[] {
  const model = process.env.CUE_SMART_SUBSET_MODEL?.trim() || "haiku";
  return ["--print", "--strict-mcp-config", "--model", model, "-p", prompt];
}

// ---------------------------------------------------------------------------
// Classifier isolation — an ephemeral CLAUDE_CONFIG_DIR for the spawn
// ---------------------------------------------------------------------------

export interface ClassifierHome {
  /** The ephemeral config dir to point CLAUDE_CONFIG_DIR at. */
  home: string;
  /** The real `.credentials.json` we copied from, for the rotation copy-back. */
  credSrc: string | null;
}

/** OAuth token expiry (epoch ms) from a `.credentials.json`, or 0 if unreadable. */
export function credExpiresAt(p: string): number {
  try {
    const v = (JSON.parse(readFileSync(p, "utf8")) as { claudeAiOauth?: { expiresAt?: unknown } })
      ?.claudeAiOauth?.expiresAt;
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Whether to carry the classifier home's credentials back to the source: only
 * when the home token is strictly newer (higher expiresAt). Anthropic rotates
 * the refresh token on every refresh, so a stale copy must never clobber a live
 * source token. Pure so it can be unit-tested. Mirrors the launch.ts rescue guard.
 */
export function shouldCopyBackCreds(homeExpiresAt: number, srcExpiresAt: number): boolean {
  return homeExpiresAt > srcExpiresAt;
}

/**
 * Build an ephemeral CLAUDE_CONFIG_DIR for the classifier spawn so it does NOT
 * load the user's plugins (claude-mem spawns a worker daemon per call), fire
 * their hooks, or append phantom sessions to their logs. Copies the live OAuth
 * credentials from the launch's real config dir in so the call still auths.
 * When no CLAUDE_CONFIG_DIR is set (the common path from Codex-launched cue
 * commands), fall back to ~/.claude as the credential source but still point
 * the child at the minimal ephemeral config. Inheriting the real ~/.claude
 * config lets plugins/hooks fire during a "lightweight" classifier call; in
 * practice that made profile warm-ups start claude-mem workers and marketplace
 * updates during agent launch.
 */
export function setupClassifierHome(): ClassifierHome | null {
  const src = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude");
  try {
    const base = join(cacheDir(), "classifier-home");
    mkdirSync(base, { recursive: true });
    const home = mkdtempSync(join(base, "run-"));
    // Minimal config: no enabledPlugins, no hooks, no mcpServers.
    writeFileSync(join(home, "settings.json"), "{}\n");
    writeFileSync(join(home, ".claude.json"), `${JSON.stringify({ hasCompletedOnboarding: true })}\n`);
    const credSrcFile = join(src, ".credentials.json");
    let credSrc: string | null = null;
    if (existsSync(credSrcFile)) {
      copyFileSync(credSrcFile, join(home, ".credentials.json"));
      credSrc = credSrcFile;
    }
    return { home, credSrc };
  } catch {
    return null;
  }
}

/** Copy back a rotated token if newer, then remove the ephemeral home. Best-effort. */
export function teardownClassifierHome(h: ClassifierHome): void {
  try {
    if (h.credSrc) {
      const homeCred = join(h.home, ".credentials.json");
      // The source may be a SHARED account `.credentials.json` (authmux parallel
      // accounts point CLAUDE_CONFIG_DIR there), read live by other sessions. So
      // this must be atomic: copy into a sibling tmp, re-check freshness (a
      // concurrent launch may have rotated the source since we forked), then
      // rename — a same-dir rename is atomic, so a reader never sees a torn file.
      // Mirrors credentials-sync.ts's writer.
      if (existsSync(homeCred) && shouldCopyBackCreds(credExpiresAt(homeCred), credExpiresAt(h.credSrc))) {
        const tmp = `${h.credSrc}.cue-classifier.${process.pid}.tmp`;
        try {
          copyFileSync(homeCred, tmp);
          // Re-check under the freshest source state before committing the swap.
          if (shouldCopyBackCreds(credExpiresAt(homeCred), credExpiresAt(h.credSrc))) {
            renameSync(tmp, h.credSrc);
          } else {
            rmSync(tmp, { force: true });
          }
        } catch {
          try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
        }
      }
    }
  } catch {
    /* best-effort */
  }
  try {
    rmSync(h.home, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Spawn `claude --print` ASYNC and resolve with its trimmed stdout. Never
 * rejects: on spawn error, non-zero exit, or timeout it resolves
 * `{ status: non-zero }` so the caller fail-opens. The timeout kills the child
 * (SIGTERM, then SIGKILL backstop) and resolves immediately so the Promise
 * always settles even if the child ignores the signal. `configDirOverride`,
 * when set, points the child at an ephemeral CLAUDE_CONFIG_DIR.
 */
function spawnClaude(bin: string, prompt: string, timeoutMs: number, configDirOverride?: string): Promise<{ status: number; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout });
    };

    const env: NodeJS.ProcessEnv = { ...process.env, CUE_BYPASS: "1" };
    if (configDirOverride) env.CLAUDE_CONFIG_DIR = configDirOverride;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, classifierSpawnArgs(prompt), {
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve({ status: 1, stdout: "" });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 500);
      killTimer.unref?.();
      finish(124); // timed out → fail-open
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.on("error", () => finish(1));
    child.on("close", (code) => finish(code ?? 1));
  });
}

export interface ClassifierResult {
  ok: boolean;
  output: string;
}

/**
 * Binaries to try for a classification spawn, best first.
 *
 * The real binary leads, deliberately. This used to spawn the bare name
 * `claude` and trust `CUE_BYPASS` to make cue's shim "transparent" — which it
 * did not, at the time: the flag was documented as a full escape hatch but no
 * reader implemented one, so on any machine with cue's shims first on PATH (the
 * default — `rcSnippet` pins them with `fish_add_path -p`) the spawn re-entered
 * `cue launch`, which folded the child's argv into a new classification prompt
 * and spawned another classifier. `MAX_LAUNCH_DEPTH` bounded the process
 * nesting at 3, so this was waste rather than a runaway: measured before this
 * change, one classifier carried a 67KB command line with the prompt template
 * repeated 10 times, and 7 concurrent classifier processes held ~2.9GB.
 *
 * `cue launch` now honors `CUE_BYPASS` for real (`isBypassEnabled` in
 * `launch.ts` short-circuits straight to exec) and still refuses the argv fold
 * under it, so the loop is cut on both sides. Going straight to the real binary
 * remains the better primary path: it skips a whole `cue launch` boot per
 * classification, and it holds even against an older cue on PATH.
 *
 * The bare name stays as a fallback for the case `findRealClaudeBin()` cannot
 * resolve anything (unusual PATH, or a machine where only a shim exists).
 */
export function classifierBinOrder(): string[] {
  const real = findRealClaudeBin();
  return real ? [real, "claude"] : ["claude"];
}

/**
 * Run one classification. Resolves `{ ok: false }` on every failure path.
 *
 * Tries {@link classifierBinOrder} in order. Later attempts share what's left
 * of the budget — a minimum of 2s each — so repeated timeouts can't stack to
 * several times the stated tolerance and freeze an interactive command.
 */
export async function runClassifier(prompt: string, timeoutMs = 30_000): Promise<ClassifierResult> {
  const startedAt = Date.now();
  const home = setupClassifierHome();
  const configDir = home?.home;
  try {
    let res = { status: 1, stdout: "" };
    for (const bin of classifierBinOrder()) {
      const remaining = Math.max(2_000, timeoutMs - (Date.now() - startedAt));
      res = await spawnClaude(bin, prompt, remaining, configDir);
      if (res.status === 0 && res.stdout.trim()) break;
    }
    if (res.status !== 0 || !res.stdout.trim()) return { ok: false, output: "" };
    return { ok: true, output: res.stdout.trim() };
  } finally {
    if (home) teardownClassifierHome(home);
  }
}
