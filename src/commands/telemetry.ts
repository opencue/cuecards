/**
 * `cue telemetry <sub>` — manage local activation telemetry.
 *
 * Telemetry is opt-in. Until `cue telemetry enable` is run, no events are
 * captured. The data never leaves the user's machine; storage is a single
 * `~/.config/cue/analytics.jsonl` log + a small consent record next to it.
 *
 * Sub-actions:
 *   enable    Opt in. Wipes any legacy `analytics.jsonl` from older cue versions.
 *   disable   Opt out. Stops recording. Existing events are retained until `purge`.
 *   status    Show consent state, event count, time window, file location.
 *   purge     Wipe events + dedup tracker. Leaves the consent flag intact.
 *
 * Future sub-actions (Phase 2+): ingest, report, zombies, top, misses.
 */

import { join } from "node:path";
import { homedir } from "node:os";

import {
  analyticsPath,
  consentPath,
  disable,
  enable,
  isEnabled,
  purge,
  statusSummary,
} from "../lib/telemetry-consent";
import { ingest } from "../lib/telemetry-ingest";
import {
  compositeReport,
  missLeaderboard,
  promotionCandidates,
  topSkills,
  zombies as zombiesReport,
} from "../lib/telemetry-report";
import { listProfiles, loadProfile } from "../lib/profile-loader";
import { parseSkillFromDir } from "../lib/skill-router";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function printSchema(): void {
  process.stdout.write(
    [
      "What gets captured (all local, never transmitted):",
      `  ${bold("skill_invoked")}  — structured Skill tool_use events from transcripts`,
      `                  (skill name, session_id, tool_use_id, timestamp)`,
      `  ${bold("skill_miss")}     — user prompts where a trigger phrase matched`,
      `                  but no Skill was invoked (first 80 chars, redacted)`,
      `  ${bold("skill_hit")}      — legacy regex match (SKILL.md reference in transcript)`,
      `  ${bold("start / end")}    — session lifecycle (profile, agent, duration)`,
      "",
      `Storage: ${analyticsPath()}`,
      `Consent flag: ${consentPath()}`,
      "Wipe at any time with `cue telemetry purge`.",
    ].join("\n") + "\n",
  );
}

async function enableCmd(): Promise<number> {
  const result = enable();
  if (result.alreadyEnabled) {
    process.stdout.write(`${yellow("Telemetry is already enabled.")} (no-op)\n`);
    return 0;
  }
  process.stdout.write(`${green("Telemetry enabled.")}\n`);
  if (result.wipedLegacyBytes > 0) {
    process.stdout.write(
      `${dim(`Wiped ${formatBytes(result.wipedLegacyBytes)} of legacy data captured under previous cue versions.`)}\n`,
    );
  }
  process.stdout.write("\n");
  printSchema();
  return 0;
}

async function disableCmd(): Promise<number> {
  const { wasEnabled } = disable();
  if (!wasEnabled) {
    process.stdout.write(`${yellow("Telemetry is already disabled.")} (no-op)\n`);
    return 0;
  }
  process.stdout.write(`${green("Telemetry disabled.")} Existing events retained; run \`cue telemetry purge\` to wipe.\n`);
  return 0;
}

async function statusCmd(args: string[]): Promise<number> {
  const status = statusSummary();
  const asJson = args.includes("--json");
  if (asJson) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
    return 0;
  }

  const headline = status.enabled
    ? green("ENABLED")
    : yellow("DISABLED");
  process.stdout.write(`Telemetry: ${headline}\n`);
  if (status.enabledAt) {
    process.stdout.write(`  enabled at: ${status.enabledAt}\n`);
  }
  if (status.eventCount > 0) {
    process.stdout.write(`  events:     ${status.eventCount}\n`);
    if (status.oldestEventTs) process.stdout.write(`  oldest:     ${status.oldestEventTs}\n`);
    if (status.newestEventTs) process.stdout.write(`  newest:     ${status.newestEventTs}\n`);
    process.stdout.write(`  size:       ${formatBytes(status.fileSizeBytes)}\n`);
  } else {
    process.stdout.write(`  events:     0\n`);
  }
  process.stdout.write(`  file:       ${status.filePath}\n`);

  if (status.hasLegacyData) {
    process.stdout.write(
      `\n${yellow("Legacy data present:")} ${formatBytes(status.legacyDataBytes)} were captured under previous cue versions before opt-in was enforced.\n` +
      `Run \`cue telemetry enable\` to wipe and start fresh, or \`cue telemetry purge\` to wipe without enabling.\n`,
    );
  } else if (!status.enabled) {
    process.stdout.write(`\nRun \`cue telemetry enable\` to opt in.\n`);
  }
  return 0;
}

function parseDuration(raw: string | undefined, fallbackDays: number): number {
  if (!raw) return fallbackDays;
  const m = raw.match(/^(\d+)([dhw]?)$/);
  if (!m) return fallbackDays;
  const n = parseInt(m[1]!, 10);
  switch (m[2]) {
    case "h": return Math.max(1, Math.ceil(n / 24));
    case "w": return n * 7;
    default:  return n; // "d" or bare number
  }
}

/**
 * Build a trigger index from every local skill of every profile that exists
 * on disk. Used by `ingest` for miss detection. We aggregate across profiles
 * because users switch profiles between sessions, and we can't reliably know
 * which profile was active when a transcript was recorded.
 */
async function buildAllProfileTriggers(): Promise<Map<string, string[]>> {
  const triggers = new Map<string, string[]>();
  const skillsRoot = join(
    process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? process.cwd(),
    "resources", "skills", "skills",
  );
  let profileNames: string[] = [];
  try { profileNames = await listProfiles(); } catch { return triggers; }

  for (const name of profileNames) {
    let profile: Awaited<ReturnType<typeof loadProfile>>;
    try { profile = await loadProfile(name); } catch { continue; }
    for (const ref of profile.skills.local ?? []) {
      if (ref.id.includes("*")) continue;
      const slugParts = ref.id.split("/");
      const dir = join(skillsRoot, ...slugParts);
      let parsed: Awaited<ReturnType<typeof parseSkillFromDir>>;
      try { parsed = await parseSkillFromDir(ref.id, dir); } catch { continue; }
      if (parsed.missing || parsed.triggers.length === 0) continue;
      const skillKey = parsed.name;
      const existing = triggers.get(skillKey) ?? [];
      existing.push(...parsed.triggers);
      triggers.set(skillKey, existing);
    }
  }
  return triggers;
}

async function ingestCmd(args: string[]): Promise<number> {
  if (!isEnabled()) {
    process.stderr.write(`${yellow("Telemetry is disabled.")} Run \`cue telemetry enable\` first.\n`);
    return 1;
  }
  const sinceIdx = args.indexOf("--since");
  const sinceDays = parseDuration(sinceIdx >= 0 ? args[sinceIdx + 1] : undefined, 7);
  const noMisses = args.includes("--no-misses");
  const asJson = args.includes("--json");

  const triggers = noMisses ? undefined : await buildAllProfileTriggers();
  if (triggers && !noMisses) {
    process.stdout.write(`${dim(`Loaded ${triggers.size} skills with trigger phrases for miss detection.`)}\n`);
  }

  const projectsDir = join(homedir(), ".claude", "projects");
  const stats = await ingest({ projectsDir, sinceDays, triggers });

  if (asJson) {
    process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(
    `${green("Ingested.")} ${stats.transcriptsScanned} transcript(s) scanned, ` +
    `${bold(String(stats.newInvocations))} new invocation(s), ` +
    `${bold(String(stats.newMisses))} new miss(es), ` +
    `${dim(`${stats.skippedDuplicates} duplicate(s) skipped`)}\n`,
  );
  if (stats.transcriptsScanned === 0) {
    process.stdout.write(
      `${dim(`No transcripts found under ${projectsDir} in the last ${sinceDays} day(s). Run Claude Code at least once, then retry.`)}\n`,
    );
  }
  return 0;
}

async function declaredSkillNamesForProfile(profileName: string | undefined): Promise<Set<string>> {
  const names = new Set<string>();
  const skillsRoot = join(
    process.env.CUE_REPO_ROOT ?? process.env.SOUL_REPO_ROOT ?? process.cwd(),
    "resources", "skills", "skills",
  );
  let profileNames: string[];
  if (profileName) {
    profileNames = [profileName];
  } else {
    try { profileNames = await listProfiles(); } catch { return names; }
  }
  for (const pn of profileNames) {
    let profile: Awaited<ReturnType<typeof loadProfile>>;
    try { profile = await loadProfile(pn); } catch { continue; }
    for (const ref of profile.skills.local ?? []) {
      if (ref.id.includes("*")) continue;
      const slugParts = ref.id.split("/");
      const dir = join(skillsRoot, ...slugParts);
      try {
        const parsed = await parseSkillFromDir(ref.id, dir);
        if (!parsed.missing) names.add(parsed.name);
      } catch { /* skip */ }
    }
  }
  return names;
}

async function reportCmd(args: string[]): Promise<number> {
  const windowDays = parseDuration(getArgValue(args, "--window"), 30);
  const profile = getArgValue(args, "--profile");
  const asJson = args.includes("--json");

  const declared = await declaredSkillNamesForProfile(profile);
  const snapshot = compositeReport(declared, windowDays);

  if (asJson) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n${bold(`Telemetry report (last ${windowDays} day(s))`)}\n`);
  process.stdout.write(`  invocations: ${bold(String(snapshot.totalInvocations))}\n`);
  process.stdout.write(`  misses:      ${bold(String(snapshot.totalMisses))}\n\n`);

  process.stdout.write(`${bold("Top skills")} (most-invoked):\n`);
  if (snapshot.top.length === 0) process.stdout.write(`  ${dim("(no invocations recorded yet)")}\n`);
  for (const entry of snapshot.top) {
    process.stdout.write(`  ${entry.invocations.toString().padStart(5)}× ${entry.skill}\n`);
  }

  process.stdout.write(`\n${bold("Zombies")} (declared in profile${profile ? ` "${profile}"` : ""}, 0 invocations):\n`);
  if (snapshot.zombies.length === 0) process.stdout.write(`  ${dim("(none — every declared skill has been invoked at least once)")}\n`);
  for (const entry of snapshot.zombies.slice(0, 15)) {
    process.stdout.write(`  ${yellow("•")} ${entry.skill}\n`);
  }
  if (snapshot.zombies.length > 15) {
    process.stdout.write(`  ${dim(`(+${snapshot.zombies.length - 15} more)`)}\n`);
  }

  process.stdout.write(`\n${bold("Miss leaderboard")} (trigger matched but Claude picked something else):\n`);
  if (snapshot.misses.length === 0) process.stdout.write(`  ${dim("(no misses recorded yet)")}\n`);
  for (const entry of snapshot.misses) {
    process.stdout.write(`  ${entry.count.toString().padStart(4)}× "${entry.promptRedacted}"  ${dim(`→ ${entry.matchedSkills.slice(0, 3).join(", ")}`)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

async function topCmd(args: string[]): Promise<number> {
  const windowDays = parseDuration(getArgValue(args, "--window"), 30);
  const limit = parseInt(getArgValue(args, "--limit") ?? "20", 10);
  const asJson = args.includes("--json");
  const rows = topSkills(windowDays, limit);
  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`\n${bold(`Top skills (last ${windowDays}d, limit ${limit})`)}\n`);
  if (rows.length === 0) process.stdout.write(`  ${dim("(no invocations recorded)")}\n`);
  for (const r of rows) {
    process.stdout.write(`  ${r.invocations.toString().padStart(5)}× ${r.skill}  ${dim(`last: ${r.lastInvokedTs ?? "never"}`)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

async function zombiesCmd(args: string[]): Promise<number> {
  const windowDays = parseDuration(getArgValue(args, "--window"), 30);
  const profile = getArgValue(args, "--profile");
  const asJson = args.includes("--json");

  const declared = await declaredSkillNamesForProfile(profile);
  const rows = zombiesReport(declared, windowDays);
  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`\n${bold(`Zombie skills (last ${windowDays}d${profile ? `, profile "${profile}"` : ""})`)}\n`);
  if (rows.length === 0) {
    process.stdout.write(`  ${green("✓")} every declared skill has been invoked at least once.\n\n`);
    return 0;
  }
  for (const r of rows) {
    process.stdout.write(`  ${yellow("•")} ${r.skill}\n`);
  }
  process.stdout.write(`\n  ${dim(`${rows.length} zombie(s). Consider removing or rewriting their descriptions.`)}\n\n`);
  return 0;
}

async function promoteCmd(args: string[]): Promise<number> {
  const windowDays = parseDuration(getArgValue(args, "--window"), 30);
  const minInvocations = parseInt(getArgValue(args, "--min") ?? "3", 10);
  const asJson = args.includes("--json");

  // Build profile → declared-skills map by scanning all profiles.
  const declaredByProfile = new Map<string, Set<string>>();
  const profiles = await listProfiles();
  for (const name of profiles) {
    declaredByProfile.set(name, await declaredSkillNamesForProfile(name));
  }

  const rows = promotionCandidates(declaredByProfile, windowDays, minInvocations);
  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(`\n${bold(`Promotion candidates (last ${windowDays}d, min ${minInvocations} invocations)`)}\n`);
  process.stdout.write(`${dim("Skills firing in a profile that doesn't declare them. Smart-loader is doing the work; promote them to the profile so they ship as real Skill() entries.")}\n\n`);
  if (rows.length === 0) {
    process.stdout.write(`  ${dim("(no candidates — smart-loading isn't hot enough yet, or every fired skill is already declared)")}\n\n`);
    return 0;
  }
  for (const r of rows.slice(0, 20)) {
    process.stdout.write(`  ${r.invocations.toString().padStart(4)}× ${r.skill.padEnd(40)} ${dim(`→ add to profile '${r.profile}'`)}\n`);
  }
  if (rows.length > 20) {
    process.stdout.write(`\n  ${dim(`(+${rows.length - 20} more)`)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

async function missesCmd(args: string[]): Promise<number> {
  const windowDays = parseDuration(getArgValue(args, "--window"), 30);
  const limit = parseInt(getArgValue(args, "--limit") ?? "20", 10);
  const asJson = args.includes("--json");
  const rows = missLeaderboard(windowDays, limit);
  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(`\n${bold(`Miss leaderboard (last ${windowDays}d, limit ${limit})`)}\n`);
  if (rows.length === 0) process.stdout.write(`  ${dim("(no misses recorded)")}\n`);
  for (const r of rows) {
    process.stdout.write(`  ${r.count.toString().padStart(4)}× "${r.promptRedacted}"\n`);
    process.stdout.write(`        ${dim(`should have fired: ${r.matchedSkills.slice(0, 5).join(", ")}${r.matchedSkills.length > 5 ? `, +${r.matchedSkills.length - 5} more` : ""}`)}\n`);
  }
  process.stdout.write("\n");
  return 0;
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function purgeCmd(): Promise<number> {
  const result = purge();
  const total = result.removedAnalyticsBytes + result.removedSeenTrackerBytes;
  if (total === 0) {
    process.stdout.write(`${yellow("Nothing to purge.")} (no analytics or seen-tracker files found)\n`);
    return 0;
  }
  process.stdout.write(
    `${green("Purged.")} Removed ${formatBytes(result.removedAnalyticsBytes)} of events and ${formatBytes(result.removedSeenTrackerBytes)} of dedup tracker.\n`,
  );
  if (isEnabled()) {
    process.stdout.write(`${dim("Telemetry remains enabled; new events will accumulate.")}\n`);
  }
  return 0;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: cue telemetry <sub-action>",
      "",
      "Sub-actions:",
      "  enable    Opt in. Wipes legacy data captured under previous cue versions.",
      "  disable   Opt out. Stops recording; retains existing events.",
      "  status    Show consent state, event count, time window, file location.",
      "  purge     Wipe events + dedup tracker. Leaves consent flag intact.",
      "",
      "Phase 2+ (not yet shipped):",
      "  ingest    Backfill events from existing Claude Code transcripts.",
      "  report    Composite report: top skills, zombies, miss leaderboard.",
      "  zombies   List skills in the active profile with 0 invocations.",
      "  top       List most-invoked skills.",
      "  misses    List user prompts that should have triggered a skill but didn't.",
      "  promote   Suggest profile additions for skills repeatedly smart-loaded.",
    ].join("\n") + "\n",
  );
}

export async function run(args: string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "enable":  return enableCmd();
    case "disable": return disableCmd();
    case "status":  return statusCmd(rest);
    case "purge":   return purgeCmd();
    case "ingest":  return ingestCmd(rest);
    case "report":  return reportCmd(rest);
    case "top":     return topCmd(rest);
    case "zombies": return zombiesCmd(rest);
    case "misses":  return missesCmd(rest);
    case "promote": return promoteCmd(rest);
    case undefined:
    case "--help":
    case "-h":
      printUsage();
      return sub === undefined ? 1 : 0;
    default:
      process.stderr.write(`cue telemetry: unknown sub-action "${sub}"\n\n`);
      printUsage();
      return 1;
  }
}
