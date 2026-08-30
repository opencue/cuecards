/**
 * `cue sync` — propagate profile-source edits into materialized runtimes.
 *
 * After you edit a `profiles/<name>/profile.yaml` (or a shared skill), the
 * runtimes already materialized under ~/.config/cue/runtime keep serving their
 * cached CLAUDE.md/skills until each is next launched. `cue sync` refreshes them
 * now so the change lands everywhere without hunting down which combos use it:
 *
 *   - single-profile runtimes (`core`, `gstack`)         → rebuilt in place now
 *   - composite (`a+b`) or per-account (`…@acct`) runtimes → `.cue-hash` dropped
 *     so the next launch rebuilds them with the launcher's own canonical combo/
 *     account resolution (rebuilding those here risks mis-ordering the combo or
 *     crossing account credentials — cheap to defer, expensive to get wrong).
 *
 * Usage:
 *   cue sync                 Refresh every materialized runtime
 *   cue sync <name>...       Only the named runtime keys (e.g. core gstack+core)
 *   cue sync --dry-run|-n    Show what would change, write nothing
 *   cue sync -h | --help
 *
 * Exit: 0 on success, 1 if any target failed.
 */

import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { configDir } from "../lib/config-paths";
import { listProfiles, loadProfile } from "../lib/profile-loader";
import {
  RUNTIME_AGENTS,
  type RuntimeAgent,
  expandSkillWildcards,
  prepareRuntime,
  resolveClaudeCredentialsSource,
  runtimeAgentSubdir,
  runtimeDirFor,
} from "../lib/runtime-install";

const RUNTIME_ROOT = join(configDir(), "runtime");

type Action = "rebuilt" | "cached" | "invalidated" | "failed" | "planned" | "skipped";

interface SyncResult {
  key: string;
  action: Action;
  detail?: string;
}

/**
 * A runtime key is rebuildable-in-place only when it maps 1:1 to a single
 * source profile. Composite (`a+b`) and per-account (`…@acct`) keys are left to
 * the launcher's canonical resolution — see the module header.
 */
export function isRebuildableInPlace(key: string, sourceProfiles: ReadonlySet<string>): boolean {
  if (key.includes("+") || key.includes("@")) return false;
  return sourceProfiles.has(key);
}

function agentsPresent(key: string): RuntimeAgent[] {
  return RUNTIME_AGENTS.filter((a) =>
    existsSync(join(RUNTIME_ROOT, key, runtimeAgentSubdir(a))),
  );
}

async function dropHashes(key: string, agents: RuntimeAgent[]): Promise<void> {
  for (const agent of agents) {
    await rm(join(RUNTIME_ROOT, key, runtimeAgentSubdir(agent), ".cue-hash"), { force: true });
  }
}

function printHelp(): void {
  process.stdout.write(`cue sync — refresh materialized runtimes after editing a profile source

Usage:
  cue sync                Rebuild/refresh every materialized runtime
  cue sync <name>...      Only the named runtime keys (e.g. core gstack+core)
  cue sync --dry-run, -n  Show what would change, write nothing

Single-profile runtimes rebuild in place; composite (a+b) and per-account
(…@acct) runtimes are marked stale and rebuild on their next launch.
`);
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return 0;
  }

  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const names = args.filter((a) => !a.startsWith("-"));

  if (!existsSync(RUNTIME_ROOT)) {
    process.stdout.write("No materialized runtimes yet — nothing to sync.\n");
    return 0;
  }

  const allKeys = readdirSync(RUNTIME_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const targets = names.length > 0 ? names : allKeys;

  const sourceProfiles = new Set(await listProfiles());
  const results: SyncResult[] = [];

  for (const key of targets) {
    const agents = agentsPresent(key);
    if (agents.length === 0) {
      results.push({ key, action: "skipped", detail: "no materialized runtime" });
      continue;
    }

    // Composite / per-account keys: defer to the next launch's resolver.
    if (!isRebuildableInPlace(key, sourceProfiles)) {
      if (dryRun) {
        results.push({ key, action: "planned", detail: "invalidate → rebuilds on next launch" });
        continue;
      }
      try {
        await dropHashes(key, agents);
        results.push({ key, action: "invalidated", detail: "rebuilds on next launch" });
      } catch (err) {
        results.push({ key, action: "failed", detail: err instanceof Error ? err.message : String(err) });
      }
      continue;
    }

    // Single source profile: rebuild in place now.
    if (dryRun) {
      results.push({ key, action: "planned", detail: "rebuild in place" });
      continue;
    }
    try {
      await dropHashes(key, agents); // force a fresh build regardless of hash
      const profile = await loadProfile(key);
      await expandSkillWildcards(profile);
      let rebuilt = false;
      for (const agent of agents) {
        const out = await prepareRuntime({
          profile,
          agent,
          runtimeKey: key,
          credentialsSource:
            agent === "claude-code"
              // `key` is the runtimeKey passed above, so this is exactly the
              // dir this iteration will write — a `cue sync` run from inside a
              // cue session must not overlay that runtime onto itself.
              ? await resolveClaudeCredentialsSource({
                healFromRuntime: false,
                runtimeDir: runtimeDirFor(key, agent),
              })
              : undefined,
        });
        rebuilt = rebuilt || out.rebuilt;
      }
      results.push({ key, action: rebuilt ? "rebuilt" : "cached" });
    } catch (err) {
      results.push({ key, action: "failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  const icon: Record<Action, string> = {
    rebuilt: "🔁",
    cached: "✓",
    invalidated: "🕓",
    failed: "✗",
    planned: "•",
    skipped: "–",
  };
  for (const r of results) {
    process.stdout.write(`  ${icon[r.action]}  ${r.key}${r.detail ? ` — ${r.detail}` : ""}\n`);
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.action] = (acc[r.action] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  process.stdout.write(
    `\n${dryRun ? "Dry run — " : ""}${results.length} runtime(s)${summary ? `: ${summary}` : ""}\n`,
  );
  if (dryRun && results.length > 0) {
    process.stdout.write("Run without --dry-run to apply.\n");
  }

  return results.some((r) => r.action === "failed") ? 1 : 0;
}
