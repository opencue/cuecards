/**
 * `soul launch <agent>` — the hot path.
 *
 * Flow: resolve(cwd) → if none, runPicker() → materializeRuntime() → exec.
 *
 * Bypass paths:
 *   --cue-profile <name>   force this profile
 *   --cue-pick             always open picker (ignore pins)
 *   --dry-run              everything except the final exec; prints env
 *
 * Recursion guard via CUE_LAUNCHING=1 in child env.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { loadProfile, listProfiles } from "../lib/profile-loader";
import { resolveProfileForCwd } from "../lib/cwd-resolver";
import { runPicker, type PickerOption } from "../lib/picker";
import { materializeRuntime } from "../lib/runtime-materializer";
import { resolveLocalSkill, listAllSkillIds } from "../lib/resolver-local";
import { detectKittyTerminal, kittyPlaceholderLabel, transmitKittyImage } from "../lib/kitty-image";
import type { ResolvedProfile } from "../../profiles/_types";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  agent: "claude" | "codex" | null;
  override: string | null;
  forcePick: boolean;
  dryRun: boolean;
  rematerialize: boolean;
  passthrough: string[];
}

function parse(args: string[]): ParsedArgs {
  let agent: ParsedArgs["agent"] = null;
  let override: string | null = null;
  let forcePick = false;
  let dryRun = false;
  let rematerialize = false;
  const passthrough: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (i === 0 && (a === "claude" || a === "codex")) {
      agent = a;
    } else if (a === "--cue-profile") {
      override = args[++i] ?? null;
    } else if (a === "--cue-pick") {
      forcePick = true;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--rematerialize") {
      rematerialize = true;
    } else {
      passthrough.push(a!);
    }
  }
  return { agent, override, forcePick, dryRun, rematerialize, passthrough };
}

// ---------------------------------------------------------------------------
// Config dir helper
// ---------------------------------------------------------------------------

function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "cue")
    : join(homedir(), ".config", "cue");
}

// ---------------------------------------------------------------------------
// Exec helper — spawn with inherited stdio so interactive sessions work
// ---------------------------------------------------------------------------

function execAgent(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((res) => {
    const child = spawn(bin, args, { env, stdio: "inherit" });
    child.on("exit", (code) => res(code ?? 0));
    child.on("error", () => res(127));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Expand the wildcard `* /*` skill ref (slash-escaped here to avoid closing
 * this JSDoc) to the full set of installed local skill IDs. Mutates
 * `profile.skills.local` in place. Other refs are preserved and any
 * wildcards inherit the original ref's metadata (agents scoping, etc.).
 *
 * Used by both the launch hot path and the picker `details` callback so the
 * shown summary matches what materializeRuntime will actually link.
 */
async function expandWildcards(profile: ResolvedProfile): Promise<void> {
  if (!profile.skills.local.some((s) => s.id === "*/*")) return;
  const allIds = await listAllSkillIds();
  const wildcard = profile.skills.local.find((s) => s.id === "*/*")!;
  const existing = new Set(profile.skills.local.filter((s) => s.id !== "*/*").map((s) => s.id));
  profile.skills.local = [
    ...profile.skills.local.filter((s) => s.id !== "*/*"),
    ...allIds.filter((id) => !existing.has(id)).map((id) => ({ ...wildcard, id })),
  ];
}

/**
 * Compact human-readable summary of what a profile would load. Each returned
 * string is one line in the picker's post-pick log block.
 *
 * Goals:
 *   - skills: just the count (full lists run to 100+ entries; not useful inline)
 *   - mcps / plugins: name list, truncated past `LIST_TRUNCATE` with a count
 *   - omit empty sections so terse profiles stay terse
 */
const LIST_TRUNCATE = 8;

export function formatProfileSummary(profile: ResolvedProfile): string[] {
  const lines: string[] = [];
  const localCount = profile.skills.local.length;
  const npxCount = profile.skills.npx.length;
  const totalSkills = localCount + npxCount;
  if (totalSkills > 0) {
    const breakdown = npxCount > 0 ? ` (${localCount} local, ${npxCount} npx)` : "";
    lines.push(`skills    ${totalSkills}${breakdown}`);
  }
  if (profile.mcps.length > 0) {
    lines.push(`mcps      ${truncateList(profile.mcps.map((m) => m.id))}`);
  }
  if (profile.plugins.length > 0) {
    lines.push(`plugins   ${truncateList(profile.plugins.map((pl) => pl.id))}`);
  }
  return lines;
}

function truncateList(items: string[], max = LIST_TRUNCATE): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")}, +${items.length - max} more`;
}

/**
 * Sort picker options: pinned profile first, "full" second, rest alphabetical.
 * Pure function so tests don't need filesystem.
 */
export function sortProfileOptions(opts: PickerOption[], pinnedProfile?: string): PickerOption[] {
  return [...opts].sort((a, b) => {
    if (a.value === pinnedProfile) return -1;
    if (b.value === pinnedProfile) return 1;
    if (a.value === "full") return -1;
    if (b.value === "full") return 1;
    return a.value.localeCompare(b.value);
  });
}

async function listProfileOptions(pinnedProfile?: string): Promise<PickerOption[]> {
  const names = await listProfiles();
  const opts: PickerOption[] = [];
  const kitty = await detectKittyTerminal();
  const profilesRoot = process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR ?? join(
    resolve(new URL(import.meta.url).pathname, "..", "..", ".."),
    "profiles",
  );
  // Stable per-process image IDs (1..255) for kitty's 256-color FG-encoded
  // placeholder protocol. We have at most a handful of iconImage profiles, so
  // overflow isn't a concern in practice — assert anyway in transmitKittyImage.
  let nextImageId = 1;
  for (const name of names) {
    try {
      const p = await loadProfile(name);
      let iconLabel: string;
      if (kitty && p.iconImage && nextImageId <= 255) {
        const imgPath = resolve(profilesRoot, name, p.iconImage);
        const id = nextImageId++;
        // Transmit + virtual placement; placeholder text in the label triggers
        // the actual paint when @clack/prompts renders the option.
        transmitKittyImage(imgPath, id, 2, 1);
        iconLabel = kittyPlaceholderLabel(id, 2, 1);
      } else if (p.icon) {
        iconLabel = p.icon;
      } else {
        iconLabel = "";
      }
      const label = iconLabel ? `${iconLabel} ${name}` : name;
      opts.push({ value: name, label, hint: p.description });
    } catch {
      opts.push({ value: name, label: name, hint: "" });
    }
  }
  return sortProfileOptions(opts, pinnedProfile);
}

async function loadMcpRegistry(agent: "claude-code" | "codex"): Promise<Record<string, unknown>> {
  const file = agent === "claude-code" ? "claude.sanitized.json" : "codex.sanitized.json";
  const root = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(
    new URL(import.meta.url).pathname,
    "..",
    "..",
    "..",
  );
  const path = join(root, "resources", "mcps", "configs", file);
  try {
    const text = await readFile(path, "utf8");
    const raw = JSON.parse(text) as { servers?: Record<string, unknown> };
    return raw.servers ?? {};
  } catch {
    return {};
  }
}

async function readSharedClaudeMd(profile?: { name: string; inheritanceChain?: string[] }): Promise<string> {
  const root = process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? resolve(
    new URL(import.meta.url).pathname, "..", "..", "..",
  );
  const baseDir = join(root, "resources", "claude-md");
  const { readdir: rd } = await import("node:fs/promises");
  const parts: string[] = [];

  // Helper: read all .md files from a directory (sorted)
  async function readLayer(dir: string): Promise<void> {
    try {
      const files = (await rd(dir)).filter(f => f.endsWith(".md")).sort();
      for (const f of files) {
        try { parts.push(await readFile(join(dir, f), "utf8")); } catch { /* skip */ }
      }
    } catch { /* dir doesn't exist — skip */ }
  }

  // Layer 1: _always/ (all profiles)
  await readLayer(join(baseDir, "_always"));

  // Layer 2: inheritance chain layers (e.g. _core/ if profile inherits core)
  if (profile?.inheritanceChain) {
    for (const ancestor of profile.inheritanceChain) {
      if (ancestor === profile.name) continue; // skip self, handled in layer 3
      await readLayer(join(baseDir, `_${ancestor}`));
    }
  }

  // Layer 3: profile-specific layer
  if (profile?.name) {
    await readLayer(join(baseDir, profile.name));
  }

  return parts.length ? parts.join("\n") + "\n" : "";
}

async function buildUserClaudeMd(profile: ResolvedProfile, agent: "claude-code" | "codex"): Promise<string> {
  let content = await readSharedClaudeMd(profile) + await readUserClaudeMd(agent);

  // First-time profile suggestion: if no .cue-profile in cwd, inject marker
  const cueProfilePath = join(process.cwd(), ".cue-profile");
  if (!existsSync(cueProfilePath)) {
    content += "\n<!-- cue:first-time-suggest -->\n" +
      "## ⚡ First-Time Setup\n\n" +
      "No `.cue-profile` is pinned to this directory. Before answering the user's first message, " +
      "quickly scan this repo (package.json, Cargo.toml, Dockerfile, etc.) and suggest the best " +
      "profile from `cue list`. Present your suggestion in 3-4 lines with reasoning, then offer " +
      "to pin it with `echo <name> > .cue-profile`. After suggesting, proceed with the user's request.\n\n" +
      "Available profiles:\n```\n" +
      (await getProfileListForStamp()) +
      "```\n\n";
  }

  return content;
}

async function getProfileListForStamp(): Promise<string> {
  try {
    const names = await listProfiles();
    const lines: string[] = [];
    for (const name of names.slice(0, 15)) {
      const yamlPath = join(process.env.CUE_PROFILES_DIR ?? join(resolve(import.meta.dirname, "..", ".."), "profiles"), name, "profile.yaml");
      try {
        const content = readFileSync(yamlPath, "utf8");
        const iconMatch = content.match(/^icon:\s*["']?(.+?)["']?\s*$/m);
        const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
        const icon = iconMatch?.[1] ?? " ";
        const desc = descMatch?.[1]?.slice(0, 60) ?? "";
        lines.push(`${icon} ${name} — ${desc}`);
      } catch {
        lines.push(`  ${name}`);
      }
    }
    return lines.join("\n") + "\n";
  } catch {
    return "";
  }
}

async function readUserClaudeMd(agent: "claude-code" | "codex"): Promise<string> {
  const path =
    agent === "claude-code"
      ? join(homedir(), ".claude", "CLAUDE.md")
      : join(homedir(), ".codex", "AGENTS.md");
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function findRealBinary(name: string): Promise<string | null> {
  const shimDir = join(homedir(), ".local", "bin");
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (resolve(dir) === resolve(shimDir)) continue;
    const candidate = join(dir, name);
    try {
      const { stat } = await import("node:fs/promises");
      const st = await stat(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // not in this dir
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  // Recursion guard
  if (process.env.CUE_LAUNCHING === "1") {
    process.stderr.write(
      "cue: shim recursion detected — check PATH ordering (~/.local/bin must precede the real claude/codex location)\n",
    );
    return 2;
  }

  const parsed = parse(args);
  if (!parsed.agent) {
    process.stderr.write("cue launch: missing agent (use 'claude' or 'codex')\n");
    return 1;
  }
  const agentKind = parsed.agent === "claude" ? "claude-code" : "codex";

  // Resolve profile.
  const cwd = process.cwd();
  // Normalize paths (resolve symlinks, strip trailing slashes) so an explicit
  // CLAUDE_CONFIG_DIR=$HOME/.claude (or $HOME/.claude/) doesn't trigger
  // account-alias mode.
  const ccd = process.env.CLAUDE_CONFIG_DIR;
  let isAccountAlias = false;
  if (ccd) {
    const defaultDir = resolve(homedir(), ".claude");
    const setDir = resolve(ccd);
    isAccountAlias = setDir !== defaultDir;
  }
  const existingResolved = await resolveProfileForCwd({
    cwd,
    homeDir: homedir(),
    configDir: configDir(),
    override: parsed.override,
  });
  // Force picker if --cue-pick OR (account alias AND no explicit --cue-profile).
  // Explicit --cue-profile always wins.
  const forcePicker = parsed.forcePick || (isAccountAlias && !parsed.override);
  const resolved = forcePicker ? { source: "none" as const } : existingResolved;
  const existingProfile = existingResolved.source !== "none"
    ? (existingResolved as { source: string; profile: string }).profile
    : undefined;

  let profileName: string;
  // The picker's `details` callback loads + expands the chosen profile so the
  // shown summary matches reality. We stash it here so the post-picker path
  // can reuse it instead of re-loading from disk.
  let cachedProfile: ResolvedProfile | undefined;
  if (resolved.source === "none") {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        "cue launch: no profile resolved and stdin is not a TTY; pass --cue-profile <name>\n",
      );
      return 1;
    }
    const options = await listProfileOptions(existingProfile);
    const picked = await runPicker({
      cwd,
      options,
      noPin: isAccountAlias,
      details: async (name) => {
        const loaded = await loadProfile(name);
        await expandWildcards(loaded);
        cachedProfile = loaded;
        return formatProfileSummary(loaded);
      },
    });
    profileName = picked.profile;
  } else {
    profileName = (resolved as { source: string; profile: string }).profile;
  }

  // Load + materialize. Reuse the picker-cached profile when available.
  let profile: ResolvedProfile;
  if (cachedProfile && cachedProfile.name === profileName) {
    profile = cachedProfile;
  } else {
    // Try manifest cache first (skips YAML parse + inheritance resolution)
    const profilesDir = join(
      process.env.CUE_REPO_ROOT ?? resolve(new URL(import.meta.url).pathname, "..", "..", ".."),
      "profiles",
    );
    let fromCache = false;
    try {
      const { getCachedManifest } = await import("../lib/manifest-cache");
      const cached = getCachedManifest(profileName, profilesDir);
      if (cached) {
        profile = cached;
        fromCache = true;
      }
    } catch { /* cache miss — fall through */ }

    if (!fromCache) {
      try {
        profile = await loadProfile(profileName);
      } catch (err) {
        process.stderr.write(`cue launch: ${(err as Error).message}\n`);
        return 1;
      }
      await expandWildcards(profile);

      // Populate manifest cache for next launch
      try {
        const { putCachedManifest } = await import("../lib/manifest-cache");
        putCachedManifest(profile, profilesDir);
      } catch { /* non-fatal */ }
    }
  }

  // Detect pre-set CLAUDE_CONFIG_DIR (e.g. from claude-account2 alias) as credentials source.
  const credentialsSource = agentKind === "claude-code"
    ? (process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"))
    : undefined;

  // Skill conflict detection is opt-in via `cue skills conflicts` — the
  // regex-based detector produces too many false positives on natural-language
  // SKILL.md prose to be useful as an inline launch-time warning.

  // --rematerialize: force rebuild by deleting the hash file first
  if (parsed.rematerialize) {
    const { rm: rmFile } = await import("node:fs/promises");
    const hashPath = join(configDir(), "runtime", profileName, agentKind === "claude-code" ? "claude" : "codex", ".cue-hash");
    try { await rmFile(hashPath, { force: true }); } catch { /* ok */ }
  }

  const runtime = await materializeRuntime({
    profile,
    agent: agentKind,
    runtimeRoot: join(configDir(), "runtime"),
    skillSourceLookup: (id) => resolveLocalSkill(id),
    mcpRegistry: await loadMcpRegistry(agentKind),
    userClaudeMd: await buildUserClaudeMd(profile, agentKind),
    credentialsSource,
  });

  // Auto-doctor on first build: warn about missing CLIs/MCPs
  if (runtime.rebuilt) {
    try {
      const { existsSync } = await import("node:fs");
      const doctorFlag = join(configDir(), "runtime", profileName, ".doctor-done");
      if (!existsSync(doctorFlag)) {
        const { spawnSync } = await import("node:child_process");
        const res = spawnSync(process.argv[0]!, [join(import.meta.dir, "../index.ts"), "doctor", "--quiet"], {
          encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"],
        });
        if (res.stdout?.includes("❌") || res.stdout?.includes("missing")) {
          process.stderr.write("\x1b[33m⚠ cue doctor found issues. Run `cue doctor --fix` to repair.\x1b[0m\n");
        }
        const { writeFileSync } = await import("node:fs");
        writeFileSync(doctorFlag, new Date().toISOString());
      }
    } catch { /* non-fatal */ }
  }

  // --rematerialize: report and exit (no exec)
  if (parsed.rematerialize) {
    process.stdout.write(
      JSON.stringify({
        profile: profileName,
        agent: agentKind,
        runtimeDir: runtime.runtimeDir,
        rebuilt: runtime.rebuilt,
        hash: runtime.hash,
      }, null, 2) + "\n",
    );
    process.stdout.write(runtime.rebuilt ? "✅ Rematerialized.\n" : "ℹ️  Already up to date.\n");
    return 0;
  }

  const envKey = agentKind === "claude-code" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [envKey]: runtime.runtimeDir,
    CUE_LAUNCHING: "1",
  };

  if (parsed.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          profile: profileName,
          agent: agentKind,
          runtimeDir: runtime.runtimeDir,
          rebuilt: runtime.rebuilt,
          hash: runtime.hash,
          env: { [envKey]: childEnv[envKey] },
          command: [parsed.agent, ...parsed.passthrough],
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  // Exec the real agent binary.
  const realBin = await findRealBinary(parsed.agent);
  if (!realBin) {
    process.stderr.write(
      `cue launch: couldn't find the real '${parsed.agent}' binary on PATH=${process.env.PATH}\n`,
    );
    return 127;
  }

  // Token budget warning — accurate measurement, actionable advice
  const skillCount = profile.skills.local.length;

  // Skill → MCP dependency check (non-fatal)
  try {
    const { detectMissingDependencies } = await import("../lib/skill-dependencies");
    const skillIds = profile.skills.local.map((s: any) => s.id);
    const mcpIds = profile.mcps.map((m: any) => m.id);
    const missing = detectMissingDependencies(profileName, skillIds, mcpIds);
    if (missing.length > 0) {
      const unique = [...new Set(missing.map(m => m.mcpId))];
      process.stderr.write(`\n⚠️  Missing MCP${unique.length > 1 ? "s" : ""}: ${unique.join(", ")}\n`);
      for (const m of missing.slice(0, 3)) {
        process.stderr.write(`   ${m.skillId} → needs "${m.mcpId}" (${m.source})\n`);
      }
      if (missing.length > 3) process.stderr.write(`   …and ${missing.length - 3} more\n`);
      process.stderr.write(`   Fix: cue mcps add ${unique[0]} --profile ${profileName}\n\n`);
    }
  } catch { /* non-fatal */ }

  if (skillCount > 5) {
    try {
      const { readFileSync, existsSync: ex } = await import("node:fs");
      const skillsRoot = join(
        process.env.CUE_REPO_ROOT ?? resolve(new URL(import.meta.url).pathname, "..", "..", ".."),
        "resources", "skills", "skills",
      );
      let totalChars = 0;
      const heaviest: { id: string; tokens: number }[] = [];

      for (const s of profile.skills.local) {
        const p = join(skillsRoot, s.id, "SKILL.md");
        try {
          const size = readFileSync(p, "utf8").length;
          const tokens = Math.ceil(size / 4);
          totalChars += size;
          heaviest.push({ id: s.id, tokens });
        } catch { /* skip */ }
      }

      const totalTokens = Math.ceil(totalChars / 4);

      if (totalTokens > 8000) {
        heaviest.sort((a, b) => b.tokens - a.tokens);
        const top3 = heaviest.slice(0, 3);
        const level = totalTokens > 20000 ? "🔴" : totalTokens > 12000 ? "🟡" : "🟠";

        process.stderr.write(`\n${level} Token overhead: ~${(totalTokens / 1000).toFixed(1)}K tokens (${skillCount} skills)\n`);
        process.stderr.write(`   Heaviest: ${top3.map(s => `${s.id.split("/").pop()} (${(s.tokens/1000).toFixed(1)}K)`).join(", ")}\n`);

        if (totalTokens > 20000) {
          process.stderr.write(`   💡 This costs ~$0.06/message in context. Run \`cue skills audit\` to trim.\n`);
        }
        process.stderr.write("\n");
      }
    } catch { /* non-fatal */ }
  }

  // First-run: prompt to star the repo (once ever, non-blocking)
  try {
    const { maybePromptStar } = await import("../lib/star-prompt");
    await maybePromptStar();
  } catch { /* non-fatal */ }

  // Analytics: record session start
  try {
    const { recordEvent } = await import("../lib/analytics");
    const startTs = new Date().toISOString();
    recordEvent({ ts: startTs, event: "start", profile: profileName, agent: agentKind, cwd: process.cwd() });
    // Record end on exit
    process.on("exit", () => {
      try {
        const duration_s = Math.round((Date.now() - new Date(startTs).getTime()) / 1000);
        recordEvent({ ts: new Date().toISOString(), event: "end", profile: profileName, agent: agentKind, cwd: process.cwd(), duration_s });
      } catch { /* best-effort */ }
      // Sync refreshed credentials back to source so next launch has valid tokens
      if (credentialsSource) {
        try {
          const { copyFileSync, existsSync: ex } = require("node:fs");
          const runtimeCreds = join(runtime.runtimeDir, ".credentials.json");
          const sourceCreds = join(credentialsSource, ".credentials.json");
          if (ex(runtimeCreds)) {
            copyFileSync(runtimeCreds, sourceCreds);
          }
        } catch { /* best-effort */ }
      }
    });
  } catch { /* analytics non-fatal */ }

  return execAgent(realBin, parsed.passthrough, childEnv);
}
