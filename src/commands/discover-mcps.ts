/**
 * `cue discover mcps` — discover MCP server repos on GitHub.
 *
 * Extracted from discover.ts. Imports shared utilities from ./discover;
 * discover.ts imports cmdDiscoverMcps back from here.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANSI, colorize as wrap, colorStars, tierColorFor } from "../lib/discover-format";
import { addMcpToProfileSync } from "../lib/discover-market-profile-yaml";
import { repoRoot } from "../lib/repo-root";
import type { GemRepo, GitHubRepoItem } from "./discover";
import { suggestProfiles, getActiveProfile, ghSearch } from "./discover";

// ---------------------------------------------------------------------------
// Discover MCP servers on GitHub
// ---------------------------------------------------------------------------

const MCP_SEARCH_QUERIES = [
  { q: `"@modelcontextprotocol/sdk" in:file filename:package.json`, label: "MCP SDK in package.json" },
  { q: `topic:mcp-server`, label: "topic:mcp-server" },
  { q: `"McpServer" in:file extension:ts`, label: "McpServer class in .ts" },
  { q: `"StdioServerTransport" in:file extension:ts`, label: "StdioServerTransport in .ts" },
  { q: `topic:model-context-protocol`, label: "topic:model-context-protocol" },
];

interface McpResult {
  full_name: string;
  name: string;
  description: string;
  stars: number;
  pushed_at: string;
  topics: string[];
  url: string;
  server_name: string;
  stdio_command: string;
  score: number;
  suggested_profiles: string[];
}

/** Alias so callers that work with raw GitHub search items are clearly typed. */
type RawMcpCandidate = GitHubRepoItem;

function scoreMcp(item: RawMcpCandidate): number {
  const now = Date.now();
  const pushed = item.pushed_at ? new Date(item.pushed_at).getTime() : now;
  const daysSincePush = (now - pushed) / 86400000;
  let score = 0;
  score += 3 * Math.exp(-daysSincePush / 60);
  score += Math.min(2.5, Math.log(1 + (item.stargazers_count ?? 0)) * 0.5);
  if (item.description) score += 1;
  const topics: string[] = item.topics ?? [];
  if (topics.includes("mcp-server") || topics.includes("model-context-protocol")) score += 2;
  if (item.stargazers_count >= 50) score += 2;
  if (daysSincePush > 365) score -= 3;
  return Math.max(0, Math.round(score * 10) / 10);
}

/**
 * Suggest cue profiles for an MCP candidate using the same logic as suggestProfiles.
 * Delegates to suggestProfiles to avoid duplicating the weighting/guard logic.
 */
function suggestMcpProfiles(item: RawMcpCandidate): string[] {
  return suggestProfiles({
    description: item.description ?? "",
    topics: item.topics ?? [],
    name: item.name,
    language: item.language ?? "",
  } as GemRepo);
}

function extractMcpMeta(fullName: string, repoName: string): { server_name: string; stdio_command: string } {
  // Try to get package.json for bin/name
  const pkgRes = spawnSync("gh", ["api", `repos/${fullName}/contents/package.json`, "--jq", ".content"], {
    encoding: "utf8", timeout: 10000,
  });
  let serverName = repoName.replace(/^mcp-/, "").replace(/-mcp$/, "").replace(/-server$/, "");
  let stdioCommand = `npx ${repoName}`;

  if (pkgRes.status === 0 && pkgRes.stdout.trim()) {
    try {
      const pkg = JSON.parse(Buffer.from(pkgRes.stdout.trim(), "base64").toString("utf8"));
      if (pkg.name) serverName = pkg.name.replace(/^@[^/]+\//, "").replace(/^mcp-/, "").replace(/-mcp$/, "").replace(/-server$/, "");
      if (pkg.bin) {
        const binName = typeof pkg.bin === "string" ? repoName : Object.keys(pkg.bin)[0] ?? repoName;
        stdioCommand = `npx -y ${pkg.name ?? repoName}`;
        if (binName !== repoName && typeof pkg.bin !== "string") stdioCommand = `npx -y ${pkg.name ?? repoName}`;
      } else if (pkg.scripts?.start) {
        stdioCommand = `npx -y ${pkg.name ?? repoName}`;
      }
    } catch { /* keep defaults */ }
  }
  return { server_name: serverName, stdio_command: stdioCommand };
}

export async function cmdDiscoverMcps(opts: { limit: number; minScore: number; json: boolean; profile?: string; install: boolean; dryRun: boolean }): Promise<number> {
  process.stderr.write(`🔍 Searching GitHub for MCP server repos...\n\n`);

  const seen = new Set<string>();
  const results: McpResult[] = [];

  process.stderr.write(`  ⏳ Running ${MCP_SEARCH_QUERIES.length} search quer${MCP_SEARCH_QUERIES.length === 1 ? "y" : "ies"} in parallel...\n`);
  const allMcpItems = (await Promise.all(
    MCP_SEARCH_QUERIES.map(({ q }) => ghSearch(q, Math.min(30, opts.limit))),
  )).flat();

  for (const item of allMcpItems) {
    if (results.length >= opts.limit) break;
    if (seen.has(item.full_name)) continue;
    seen.add(item.full_name);
    const score = scoreMcp(item);
    if (score < opts.minScore) continue;
    const profiles = suggestMcpProfiles(item);
    if (opts.profile && !profiles.includes(opts.profile)) continue;

    const { server_name, stdio_command } = extractMcpMeta(item.full_name, item.name);
    results.push({
      full_name: item.full_name,
      name: item.name,
      description: item.description ?? "",
      stars: item.stargazers_count ?? 0,
      pushed_at: item.pushed_at ?? "",
      topics: item.topics ?? [],
      url: item.html_url ?? `https://github.com/${item.full_name}`,
      server_name,
      stdio_command,
      score,
      suggested_profiles: profiles,
    });
  }

  results.sort((a, b) => b.score - a.score);
  const display = results.slice(0, opts.limit);

  if (opts.json) {
    process.stdout.write(JSON.stringify(display, null, 2) + "\n");
    return 0;
  }

  if (display.length === 0) {
    process.stdout.write(`\n  No MCP servers found matching criteria.\n`);
    return 0;
  }

  process.stdout.write(`\n  🎯 ${wrap(ANSI.bold, `Found ${display.length} MCP server(s)`)}\n\n`);

  for (const mcp of display) {
    const starsStr = colorStars(mcp.stars);
    process.stdout.write(`  ${wrap(ANSI.magenta, "[MCP]")} ${wrap(ANSI.bold, mcp.full_name)}  ${starsStr}  ${wrap(tierColorFor(mcp.score), `s:${mcp.score}`)}\n`);
    if (mcp.description) process.stdout.write(`       ${mcp.description.slice(0, 80)}\n`);
    process.stdout.write(`       ${wrap(ANSI.cyan, `name: ${mcp.server_name}`)}  ${wrap(ANSI.dim, `cmd: ${mcp.stdio_command}`)}\n`);
    process.stdout.write(`       ${wrap(ANSI.cyan, `→ ${mcp.suggested_profiles.join(", ")}`)}\n\n`);
  }

  if (opts.install) {
    const targetProfile = opts.profile ?? getActiveProfile() ?? "core";
    const profileYaml = join(repoRoot(), "profiles", targetProfile, "profile.yaml");
    if (!existsSync(profileYaml)) {
      process.stderr.write(`  ⚠️  Profile "${targetProfile}" not found at ${profileYaml}\n`);
      return 1;
    }

    let added = 0;
    for (const mcp of display) {
      if (opts.dryRun) {
        const current = readFileSync(profileYaml, "utf8");
        if (current.includes(`- ${mcp.server_name}`)) {
          process.stdout.write(`  ⏭  ${mcp.server_name} already in ${targetProfile}\n`);
        } else {
          process.stdout.write(`  [dry-run] Would add "${mcp.server_name}" to ${targetProfile}/profile.yaml mcps:\n`);
          added++;
        }
        continue;
      }
      const wasAdded = addMcpToProfileSync(profileYaml, mcp.server_name);
      if (wasAdded) {
        added++;
        process.stdout.write(`  ✅ Added ${mcp.server_name} to ${targetProfile}\n`);
      } else {
        process.stdout.write(`  ⏭  ${mcp.server_name} already in ${targetProfile}\n`);
      }
    }
    process.stdout.write(`\n  Done: ${added} MCP(s) ${opts.dryRun ? "would be " : ""}added to ${targetProfile}\n`);
  }

  return 0;
}
