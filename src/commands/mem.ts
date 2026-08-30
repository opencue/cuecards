/**
 * `cue mem` — inspect and manage per-profile claude-mem memory stores.
 *
 *   cue mem [status]         list each profile's data dir, ports, and DB size
 *   cue mem path <profile>   print the resolved CLAUDE_MEM_DATA_DIR for a profile
 *   cue mem ports            show the worker/server port registry
 *   cue mem seed <profile>   copy the shared ~/.claude-mem store into a profile
 *                            (--from <dir> to pick a source, --force to overwrite)
 *
 * Background: cue points the claude-mem plugin at an isolated, SQLite-only store
 * per profile (see lib/claude-mem-env.ts), so memories never bleed across roles.
 * New profiles start EMPTY by design; `seed` ports your existing global history
 * into one profile when you want continuity instead of a clean slate.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { claudeMemDataDir, portsForSlot, registryPath } from "../lib/claude-mem-env";
import { configDir } from "../lib/config-paths";
import { listProfiles } from "../lib/profile-loader";

/** SQLite files that make up one claude-mem store. */
const DB_FILES = ["claude-mem.db", "claude-mem.db-wal", "claude-mem.db-shm"];

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    printHelp();
    return 0;
  }

  const sub = args[0] ?? "status";
  const rest = args.slice(1);

  switch (sub) {
    case "status":
      return runStatus();
    case "path":
      return runPath(rest);
    case "ports":
      return runPorts();
    case "seed":
      return runSeed(rest);
    default:
      process.stderr.write(`cue mem: unknown subcommand "${sub}"\n\n`);
      printHelp(process.stderr);
      return 1;
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function runStatus(): Promise<number> {
  const home = homedir();
  const registry = readRegistry(home);

  // Union of: base profiles, registry-assigned profiles, and on-disk stores —
  // so combo/merge aliases (e.g. "a+b") and seeded profiles also show up, not
  // just standalone profile.yaml entries.
  const names = new Set<string>(await safeListProfiles());
  for (const n of Object.keys(registry.slots)) names.add(n);
  const profilesRoot = join(home, ".claude-mem", "profiles");
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  }
  const profiles = [...names].sort();

  process.stdout.write("\nclaude-mem per-profile stores\n");
  process.stdout.write(`${"─".repeat(64)}\n`);
  if (process.env.CUE_CLAUDE_MEM_ISOLATE === "0") {
    process.stdout.write("⚠️  isolation OFF for this shell (CUE_CLAUDE_MEM_ISOLATE=0)\n\n");
  }

  let shown = 0;
  for (const name of profiles) {
    const dir = claudeMemDataDir(name, home);
    const slot = registry.slots[name];
    const ports = slot === undefined ? null : portsForSlot(slot);
    const dbPath = join(dir, "claude-mem.db");
    const onDisk = existsSync(dbPath);
    // Only list profiles that have a store or an assigned port — skip the long
    // tail of never-launched profiles so the table stays scannable.
    if (!onDisk && ports === null) continue;
    shown++;

    const size = onDisk ? formatBytes(statSync(dbPath).size) : "—";
    const portStr = ports ? `${ports.worker}/${ports.server}` : "unassigned";
    const worker = workerState(dir);
    process.stdout.write(
      `\n  ${name}\n` +
        `    dir    ${dir}\n` +
        `    db     ${size}${onDisk ? "" : "  (empty — fresh)"}\n` +
        `    ports  ${portStr}  (worker/server)\n` +
        `    worker ${worker}\n`,
    );
  }

  if (shown === 0) {
    process.stdout.write("\n  (no per-profile stores yet — launch a profile to create one)\n");
  }
  process.stdout.write(
    `\nSeed a profile from your global history:  cue mem seed <profile>\n\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// path
// ---------------------------------------------------------------------------

function runPath(rest: string[]): number {
  const name = rest.find((a) => !a.startsWith("-"));
  if (!name) {
    process.stderr.write("cue mem path: expected a <profile>\n");
    return 1;
  }
  process.stdout.write(`${claudeMemDataDir(name, homedir())}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// ports
// ---------------------------------------------------------------------------

function runPorts(): number {
  const home = homedir();
  const registry = readRegistry(home);
  const entries = Object.entries(registry.slots).sort((a, b) => a[1] - b[1]);
  process.stdout.write(`\nport registry  (${registryPath(home)})\n`);
  process.stdout.write(`${"─".repeat(48)}\n`);
  if (entries.length === 0) {
    process.stdout.write("  (empty — no profile has been launched yet)\n\n");
    return 0;
  }

  // Detect duplicate slots — the one failure mode of the registry (two new
  // profiles racing their first launch). Worth flagging loudly.
  const slotCounts = new Map<number, number>();
  for (const [, slot] of entries) slotCounts.set(slot, (slotCounts.get(slot) ?? 0) + 1);

  for (const [name, slot] of entries) {
    const p = portsForSlot(slot);
    const dupe = (slotCounts.get(slot) ?? 0) > 1 ? "  ⚠️ COLLISION" : "";
    process.stdout.write(`  ${String(p.worker).padEnd(6)} ${String(p.server).padEnd(6)}  ${name}${dupe}\n`);
  }
  if ([...slotCounts.values()].some((n) => n > 1)) {
    process.stdout.write(
      `\n  ⚠️  Two profiles share a slot. Edit ${registryPath(home)} to give one a free slot,\n` +
        "      then restart that profile's claude-mem worker.\n",
    );
  }
  process.stdout.write("\n");
  return 0;
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

async function runSeed(rest: string[]): Promise<number> {
  const force = rest.includes("--force");
  const fromIdx = rest.indexOf("--from");
  const fromArg = fromIdx >= 0 ? rest[fromIdx + 1] : undefined;
  const name = rest.find((a, i) => !a.startsWith("-") && rest[i - 1] !== "--from");

  if (!name) {
    process.stderr.write("cue mem seed: expected a <profile>\n");
    return 1;
  }

  // Accept base profiles AND combo/merge aliases (e.g. "a+b+c"), which have a
  // runtime dir but no standalone profile.yaml in listProfiles().
  const known = await safeListProfiles();
  const hasRuntime = existsSync(join(configDir(), "runtime", name));
  if (known.length > 0 && !known.includes(name) && !hasRuntime) {
    process.stderr.write(
      `cue mem seed: no profile or runtime named "${name}" (run \`cue list\`)\n`,
    );
    return 1;
  }

  const home = homedir();
  const source = fromArg ?? join(home, ".claude-mem");
  const sourceDb = join(source, "claude-mem.db");
  if (!existsSync(sourceDb)) {
    process.stderr.write(`cue mem seed: no claude-mem.db at ${source}\n`);
    return 1;
  }

  const target = claudeMemDataDir(name, home);
  const targetDb = join(target, "claude-mem.db");
  if (existsSync(targetDb) && !force) {
    process.stderr.write(
      `cue mem seed: ${name} already has a store at ${target}\n` +
        "  Refusing to overwrite. Re-run with --force to replace it.\n",
    );
    return 1;
  }

  mkdirSync(target, { recursive: true });

  // The source store may be live (a running session's worker holds the WAL), so
  // a raw file copy can capture a torn snapshot. `VACUUM INTO` produces one
  // consistent .db file even under concurrent writes — prefer it, fall back to a
  // file copy only if the SQLite binding is unavailable.
  const snapshot = snapshotDb(sourceDb, targetDb);
  if (snapshot.ok) {
    process.stdout.write(
      `Seeded ${name} ← ${source}\n` +
        `  consistent snapshot (${snapshot.method}), ${formatBytes(snapshot.bytes)} → ${targetDb}\n`,
    );
    return 0;
  }

  // Fallback: copy db + WAL + shm together. Best-effort; warn about consistency.
  let copied = 0;
  let bytes = 0;
  for (const file of DB_FILES) {
    const src = join(source, file);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(target, file));
    copied++;
    bytes += statSync(src).size;
  }
  process.stdout.write(
    `Seeded ${name} ← ${source}\n` +
      `  ${copied} file(s), ${formatBytes(bytes)} → ${target}  (${snapshot.reason})\n` +
      "  ⚠️  File copy, not a live-consistent snapshot — seed again when no session\n" +
      "      is writing the source if the copy looks off.\n",
  );
  return 0;
}

/**
 * Snapshot a (possibly live) SQLite DB into `dest` as a single consistent file
 * via `VACUUM INTO`. Returns ok:false (with a reason) if bun:sqlite isn't
 * available so the caller can fall back to a plain file copy.
 */
function snapshotDb(
  srcDb: string,
  destDb: string,
): { ok: true; method: string; bytes: number } | { ok: false; reason: string } {
  try {
    // Lazy-require, never a top-level `import ... from "bun:sqlite"`: a static
    // import gets hoisted into the node-target bundle and crashes the published
    // CLI on boot with ERR_UNSUPPORTED_ESM_URL_SCHEME (node can't load a `bun:`
    // URL). bun: builtins resolve under bun; under node this throws and we fall
    // back to ok:false below (the caller does a plain file copy instead).
    const { Database } = require("bun:sqlite");
    const db = new Database(srcDb, { readonly: true });
    try {
      // VACUUM INTO refuses to overwrite — clear any stale target first.
      if (existsSync(destDb)) rmSync(destDb, { force: true });
      db.exec(`VACUUM INTO '${destDb.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    return { ok: true, method: "VACUUM INTO", bytes: statSync(destDb).size };
  } catch (err) {
    return { ok: false, reason: `snapshot unavailable: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface Registry {
  version: number;
  slots: Record<string, number>;
}

function readRegistry(home: string): Registry {
  const path = registryPath(home);
  try {
    if (!existsSync(path)) return { version: 1, slots: {} };
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Registry> | null;
    if (!raw || typeof raw.slots !== "object" || raw.slots === null) {
      return { version: 1, slots: {} };
    }
    return { version: raw.version ?? 1, slots: raw.slots as Record<string, number> };
  } catch {
    return { version: 1, slots: {} };
  }
}

async function safeListProfiles(): Promise<string[]> {
  try {
    return await listProfiles();
  } catch {
    return [];
  }
}

/** Read claude-mem's worker.pid and report whether that process is alive. */
function workerState(dataDir: string): string {
  const pidFile = join(dataDir, "worker.pid");
  if (!existsSync(pidFile)) return "stopped";
  try {
    const raw = readFileSync(pidFile, "utf8").trim();
    const pid = raw.startsWith("{") ? (JSON.parse(raw) as { pid?: number }).pid : Number(raw);
    if (!pid) return "stopped";
    process.kill(pid, 0); // throws if the process is gone
    return `running (pid ${pid})`;
  } catch {
    return "stopped";
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function printHelp(stream: Pick<NodeJS.WriteStream, "write"> = process.stdout): void {
  stream.write(
    [
      "Usage:",
      "  cue mem [status]          per-profile data dir, ports, and DB size",
      "  cue mem path <profile>    print a profile's CLAUDE_MEM_DATA_DIR",
      "  cue mem ports             show the worker/server port registry",
      "  cue mem seed <profile>    copy the shared ~/.claude-mem store into a profile",
      "",
      "Flags (seed):",
      "  --from <dir>   source store (default ~/.claude-mem)",
      "  --force        overwrite an existing per-profile store",
      "",
      "Each profile gets an isolated, SQLite-only claude-mem store. New profiles",
      "start empty; `seed` ports your global history into one. Opt out of isolation",
      "for a shell with CUE_CLAUDE_MEM_ISOLATE=0.",
      "",
    ].join("\n"),
  );
}
