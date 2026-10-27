/**
 * `cue discover notify` — notify repo owners via GitHub issues, daily digest
 * posting, and hero badge generation.
 *
 * Extracted from discover.ts. Imports shared utilities from ./discover;
 * discover.ts imports the exported symbols back from here.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ANSI, colorize as wrap } from "../lib/discover-format";
import type { GemCache, GemRepo } from "./discover";
import { cacheFile, scoreGemBreakdown } from "./discover";

// ---------------------------------------------------------------------------
// Notify repo owner via GitHub issue
// ---------------------------------------------------------------------------

const NOTIFY_LOG = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue",
  "discover-notified.json",
);

interface NotifyLog {
  notified: Record<string, { date: string; issueUrl: string }>;
  // Daily digest discussion posts in opencue/cuecards, keyed by YYYY-MM-DD.
  digests?: Record<string, { discussionUrl: string; gems: string[] }>;
}

export function loadNotifyLog(): NotifyLog {
  if (!existsSync(NOTIFY_LOG)) return { notified: {}, digests: {} };
  try {
    const log = JSON.parse(readFileSync(NOTIFY_LOG, "utf8")) as NotifyLog;
    log.digests ??= {};
    return log;
  } catch { return { notified: {}, digests: {} }; }
}

function saveNotifyLog(log: NotifyLog): void {
  mkdirSync(dirname(NOTIFY_LOG), { recursive: true });
  writeFileSync(NOTIFY_LOG, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Daily digest discussion (in opencue/cuecards) — lower-pressure analog to --notify
// ---------------------------------------------------------------------------

const DIGEST_REPO = process.env.CUE_DIGEST_REPO ?? "opencue/cuecards";
const DIGEST_CATEGORY_PREF = ["Discoveries", "Show and tell", "Announcements", "General"];

interface DiscussionTarget { repoId: string; categoryId: string; categoryName: string }

function resolveDiscussionTarget(repo: string): DiscussionTarget | null {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return null;
  const query = `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ id discussionCategories(first:20){ nodes { id name } } } }`;
  const res = spawnSync("gh", [
    "api", "graphql",
    "-f", `query=${query}`,
    "-F", `owner=${owner}`,
    "-F", `name=${name}`,
  ], { encoding: "utf8", timeout: 15000 });
  if (res.status !== 0) return null;
  try {
    const data = JSON.parse(res.stdout);
    const repoNode = data?.data?.repository;
    if (!repoNode?.id) return null;
    const cats: { id: string; name: string }[] = repoNode.discussionCategories?.nodes ?? [];
    if (cats.length === 0) return null;
    for (const pref of DIGEST_CATEGORY_PREF) {
      const hit = cats.find(c => c.name.toLowerCase() === pref.toLowerCase());
      if (hit) return { repoId: repoNode.id, categoryId: hit.id, categoryName: hit.name };
    }
    return { repoId: repoNode.id, categoryId: cats[0]!.id, categoryName: cats[0]!.name };
  } catch { return null; }
}

function buildDigestBody(gems: GemRepo[], date: string): string {
  const byProfile = new Map<string, GemRepo[]>();
  for (const gem of gems) {
    const p = gem.suggested_profiles[0] ?? "core";
    const list = byProfile.get(p) ?? [];
    list.push(gem);
    byProfile.set(p, list);
  }
  const sections: string[] = [];
  for (const profile of [...byProfile.keys()].sort()) {
    const list = byProfile.get(profile)!.sort((a, b) => b.gem_score - a.gem_score);
    const lines = list.map(g => {
      const icon = g.gem_score >= 15 ? "🏆" : g.gem_score >= 8 ? "💎" : "✨";
      const desc = (g.description ?? "").slice(0, 110).replace(/\n+/g, " ");
      const signals: string[] = [];
      if (g.has_skill_md) signals.push("SKILL.md");
      if (g.has_claude_dir) signals.push(".claude/");
      if (g.has_mcp_sdk) signals.push("MCP SDK");
      const sigTag = signals.length ? ` _(${signals.join(", ")})_` : "";
      return `- ${icon} [\`${g.full_name}\`](${g.url}) — ★ ${g.stars} · score ${g.gem_score}${sigTag}\n  ${desc}`;
    }).join("\n");
    sections.push(`### \`${profile}\` (${list.length})\n\n${lines}`);
  }

  return `> Daily digest from [\`cue discover\`](https://github.com/opencue/cuecards) — repos newly indexed on **${date}**, grouped by profile.

cue scans GitHub for high-quality skill repos (\`SKILL.md\`, \`.claude/\`, MCP servers) and routes them into per-profile bundles for users of Claude Code, Codex, and other agents. Today we indexed **${gems.length}** gem(s) across **${byProfile.size}** profile(s).

${sections.join("\n\n")}

---

**Want to be indexed?** Add a \`SKILL.md\` to your repo root or tag it \`topic:claude-skill\`. We scan daily.

**Don't want to be indexed?** Open an issue and we'll exclude your repo.

<sub>Posted by \`cue discover install --digest\`. One post per day.</sub>`;
}

export function postDailyDigest(gems: GemRepo[], opts: { dryRun: boolean }): void {
  if (gems.length === 0) {
    process.stdout.write(`  ⏭  Digest: nothing new to post.\n`);
    return;
  }

  const log = loadNotifyLog();
  const date = new Date().toISOString().split("T")[0]!;
  if (log.digests?.[date]) {
    process.stdout.write(`  ⏭  Digest: already posted today (${log.digests[date].discussionUrl}).\n`);
    return;
  }

  const title = `cue discover — daily digest ${date} (${gems.length} new gem${gems.length === 1 ? "" : "s"})`;
  const body = buildDigestBody(gems, date);

  if (opts.dryRun) {
    process.stdout.write(`  [dry-run] Would post digest to ${DIGEST_REPO} discussions:\n`);
    process.stdout.write(`     Title: ${title}\n`);
    process.stdout.write(`     Body: ${body.length} chars across ${gems.length} gems\n`);
    return;
  }

  const target = resolveDiscussionTarget(DIGEST_REPO);
  if (!target) {
    process.stdout.write(`  ⚠️  Digest: could not resolve discussion category on ${DIGEST_REPO} (discussions enabled? gh auth?). Skipped.\n`);
    return;
  }

  const mutation = `mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){ createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body}){ discussion { url } } }`;
  const res = spawnSync("gh", [
    "api", "graphql",
    "-f", `query=${mutation}`,
    "-F", `repoId=${target.repoId}`,
    "-F", `catId=${target.categoryId}`,
    "-F", `title=${title}`,
    "-F", `body=${body}`,
  ], { encoding: "utf8", timeout: 20000 });

  if (res.status !== 0) {
    process.stdout.write(`  ⚠️  Digest: failed to post — ${res.stderr?.trim().slice(0, 120)}\n`);
    return;
  }

  try {
    const out = JSON.parse(res.stdout);
    const url: string = out?.data?.createDiscussion?.discussion?.url ?? "";
    log.digests ??= {};
    log.digests[date] = { discussionUrl: url, gems: gems.map(g => g.full_name) };
    saveNotifyLog(log);
    process.stdout.write(`  📰 Posted daily digest (${target.categoryName}): ${url}\n`);
  } catch {
    process.stdout.write(`  ⚠️  Digest: posted but couldn't parse response.\n`);
  }
}

// ---------------------------------------------------------------------------
// Hero badge composition — tokscale-style 3-stat row for issues + export pages
// ---------------------------------------------------------------------------

/** URL-encode a shields.io label segment (escape - and _, spaces become _). */
function shieldsEscape(s: string): string {
  return encodeURIComponent(s).replace(/-/g, "--").replace(/_/g, "__").replace(/%20/g, "_");
}

/** Build a shields.io for-the-badge URL with optional logo/labelColor. */
function shieldsBadge(label: string, value: string, color: string, opts: { labelColor?: string; logo?: string } = {}): string {
  const params = new URLSearchParams();
  params.set("style", "for-the-badge");
  if (opts.labelColor) params.set("labelColor", opts.labelColor);
  if (opts.logo) params.set("logo", opts.logo);
  return `https://img.shields.io/badge/${shieldsEscape(label)}-${shieldsEscape(value)}-${color}?${params.toString()}`;
}

/** Tier → palette: { primary, label, tier name } matching the TTY render. */
function tierPalette(score: number): { primary: string; label: string; tier: string } {
  if (score >= 12) return { primary: "8b5cf6", label: "1e1b4b", tier: "PREMIUM" };
  if (score >= 8) return { primary: "06b6d4", label: "0e2a3a", tier: "STRONG" };
  if (score >= 5) return { primary: "eab308", label: "3a2a0e", tier: "WORTH" };
  return { primary: "6b7280", label: "1f2937", tier: "TAIL" };
}

/** Stars magnitude → palette + abbreviated display (1.5K, 15K, etc.). */
function starsPalette(stars: number): { primary: string; display: string } {
  const display = stars >= 1000 ? `★ ${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}K` : `★ ${stars}`;
  if (stars >= 1000) return { primary: "ec4899", display };
  if (stars >= 100) return { primary: "22c55e", display };
  if (stars >= 10) return { primary: "eab308", display };
  return { primary: "6b7280", display };
}

/**
 * Markdown for the tokscale-style 3-badge hero strip:
 *   [ Score: 20.5 (PREMIUM) ]  [ Stars: ★ 15.5K ]  [ Profile: core ]
 * Centered in <p align="center"> for GitHub issue / markdown rendering.
 */
export function buildGemHeroBadges(gem: GemRepo, profile: string): string {
  const t = tierPalette(gem.gem_score);
  const s = starsPalette(gem.stars);
  const scoreBadge = shieldsBadge("Score", `${gem.gem_score} (${t.tier})`, t.primary, { labelColor: "1e1b4b" });
  const starsBadge = shieldsBadge("Stars", s.display, s.primary, { labelColor: "1e1b4b" });
  const profileBadge = shieldsBadge("Profile", profile, "c084fc", { labelColor: "1e1b4b" });
  return `<p align="center">
  <img src="${scoreBadge}" alt="score ${gem.gem_score} (${t.tier})">&nbsp;
  <img src="${starsBadge}" alt="${gem.stars} stars">&nbsp;
  <img src="${profileBadge}" alt="${profile} profile">
</p>`;
}

export function notifyOwner(gem: GemRepo, profile: string, opts: { dryRun?: boolean; force?: boolean } = {}): void {
  const log = loadNotifyLog();
  if (log.notified[gem.full_name] && !opts.force) {
    process.stdout.write(`     ⏭  ${gem.full_name} already notified at ${log.notified[gem.full_name]!.issueUrl}\n`);
    return;
  }

  // Rate limit: max 15 issues per day to stay under GitHub's radar
  const today = new Date().toISOString().split("T")[0]!;
  const todayCount = Object.values(log.notified).filter(n => n.date.startsWith(today)).length;
  if (todayCount >= 15) {
    process.stdout.write(`     🛑 Daily limit reached (${todayCount}/15) — skipping notify to protect your account\n`);
    return;
  }

  // Neutral, dependabot-style title — visual hooks live in the body.
  const t = tierPalette(gem.gem_score);
  const title = `💎 Hidden Gem — your repo was added to cue's "${profile}" profile`;
  const heroBadges = buildGemHeroBadges(gem, profile);
  const readmeBadge = shieldsBadge("cue", `💎 hidden gem`, t.primary, { labelColor: "1e1b4b" });

  // Per-repo evidence — only show signals that actually fired.
  const evidence: string[] = [];
  if (gem.has_skill_md) evidence.push("`SKILL.md` in repo root");
  if (gem.has_claude_dir) evidence.push("`.claude/` directory present");
  if (gem.has_mcp_sdk) evidence.push("uses `@modelcontextprotocol/sdk`");
  const gemTopics = gem.topics.filter(t => ["claude-skill", "claude-code", "mcp-server", "ai-agent", "codex-plugin", "claude-code-skill", "agent-skill"].includes(t));
  if (gemTopics.length) evidence.push(`relevant topic${gemTopics.length > 1 ? "s" : ""}: ${gemTopics.map(t => `\`${t}\``).join(", ")}`);
  if (gem.stars >= 5 && gem.forks > 0 && gem.forks / gem.stars >= 0.1) {
    evidence.push(`${gem.stars}★ / ${gem.forks} forks — genuine reuse ratio`);
  }
  const pushedDays = gem.pushed_at ? Math.floor((Date.now() - new Date(gem.pushed_at).getTime()) / 86400000) : null;
  if (pushedDays !== null && pushedDays < 30) evidence.push(`actively maintained — last push ${pushedDays}d ago`);
  const evidenceList = evidence.length
    ? evidence.map(s => `- ✅ ${s}`).join("\n")
    : "- ✅ matched cue's profile search query";

  // Per-factor score breakdown for the collapsible "How it scored" details.
  const { components } = scoreGemBreakdown(gem);
  const breakdownRows = components
    .map(c => `| ${c.delta > 0 ? "+" : ""}${c.delta.toFixed(1)} | ${c.label} |`)
    .join("\n");

  const body = `> **Automated, one-time notification.** Close this issue to opt out — we'll never open another on this repo.

${heroBadges}

<h2 align="center">💎 Your repo was added to cue's <code>${profile}</code> profile</h2>

[**cue**](https://github.com/opencue/cuecards) scans GitHub for high-quality skill repos and routes them to per-profile bundles for Claude Code & Codex users. \`${gem.full_name}\` cleared the discovery threshold (score **${gem.gem_score}**, tier **${t.tier}**) and is now auto-loaded for everyone on the **\`${profile}\`** profile.

## Install (one line)

\`\`\`bash
cue skills add ${gem.full_name}
\`\`\`

## Why your repo was picked

${evidenceList}

<details>
<summary><strong>How the score was computed</strong> (click to expand)</summary>

| Δ | Factor |
|---:|---|
${breakdownRows}
| **${gem.gem_score}** | **Total** |

[Full scoring rubric →](https://github.com/opencue/cuecards/blob/main/src/commands/discover.ts)

</details>

## Where you appear now

| Channel | Status |
|---|---|
| \`cue discover\` results | ✅ Listed |
| \`cue optimizer\` dashboard | ✅ Shown to all users on \`${profile}\` |
| [\`docs/discovered.md\`](https://github.com/opencue/cuecards/blob/main/docs/discovered.md) | ✅ Indexed |
| GitHub backlink traffic | ✅ Active |

## Optional: README badge

<p align="center">
  <a href="https://github.com/opencue/cuecards"><img src="${readmeBadge}" alt="cue hidden gem"></a>
</p>

\`\`\`markdown
[![cue hidden gem](${readmeBadge})](https://github.com/opencue/cuecards)
\`\`\`

---

<sub>Opened by <a href="https://github.com/opencue/cuecards"><code>cue discover install --notify</code></a>. One issue per repo, ever. To opt out, close this issue or <a href="https://github.com/opencue/cuecards/issues/new">file an issue against cue</a>.</sub>`;

  if (opts.dryRun) {
    process.stdout.write(`\n${wrap(ANSI.bold, "─── DRY RUN ───────────────────────────────────────────────────────────")}\n`);
    process.stdout.write(`${wrap(ANSI.dim, "would post to")} ${wrap(ANSI.bold, "https://github.com/" + gem.full_name + "/issues/new")}\n\n`);
    process.stdout.write(`${wrap(ANSI.bold, "Title:")} ${title}\n\n`);
    process.stdout.write(`${wrap(ANSI.bold, "Body:")}\n${body}\n`);
    process.stdout.write(`${wrap(ANSI.bold, "───────────────────────────────────────────────────────────────────────")}\n`);
    process.stdout.write(`${wrap(ANSI.dim, "(dry-run — no issue created. Remove --dry-run to post.)")}\n\n`);
    return;
  }

  const res = spawnSync("gh", [
    "issue", "create",
    "--repo", gem.full_name,
    "--title", title,
    "--body", body,
  ], { encoding: "utf8", timeout: 15000 });

  if (res.status === 0) {
    const issueUrl = res.stdout.trim();
    process.stdout.write(`     📬 Notified owner: ${issueUrl}\n`);
    log.notified[gem.full_name] = { date: new Date().toISOString(), issueUrl };
    saveNotifyLog(log);
  } else {
    process.stdout.write(`     ⚠️  Could not notify (issues may be disabled, repo private, or no gh auth)\n`);
    if (res.stderr) process.stdout.write(`     ${wrap(ANSI.dim, res.stderr.trim().slice(0, 200))}\n`);
  }
}

/**
 * `cue discover notify <repo>` — open a one-time GitHub issue on a specific
 * gem repo, announcing that cue indexed it. Notify-only — does NOT install
 * the skill, clone, or modify any profile.yaml. Idempotent via NOTIFY_LOG.
 */
export async function cmdNotify(repo: string | undefined, opts: { profile?: string; dryRun: boolean; force: boolean }): Promise<number> {
  if (!repo) {
    process.stderr.write("Usage: cue discover notify <owner/repo> [--profile <name>] [--dry-run] [--force]\n");
    return 1;
  }
  if (!existsSync(cacheFile())) {
    process.stderr.write("No cached gems. Run `cue discover search` first.\n");
    return 1;
  }
  const cache: GemCache = JSON.parse(readFileSync(cacheFile(), "utf8"));
  const gem = cache.gems.find(g => g.full_name.toLowerCase() === repo.toLowerCase());
  if (!gem) {
    process.stderr.write(`Gem "${repo}" not found in cache. Run \`cue discover search\` to refresh, or check spelling.\n`);
    return 1;
  }

  const profile = opts.profile ?? gem.suggested_profiles[0] ?? "core";
  process.stdout.write(`  📬 ${opts.dryRun ? "Dry-run" : "Notifying"}: ${wrap(ANSI.bold, gem.full_name)} → profile ${wrap(ANSI.cyan, profile)}\n`);
  notifyOwner(gem, profile, { dryRun: opts.dryRun, force: opts.force });
  return 0;
}
