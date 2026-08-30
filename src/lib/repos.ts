/**
 * Source-repo provenance for the studio Profiles "Repos" tab — the GitHub
 * repositories a profile's skills, MCPs, plugins and workflows originate from,
 * with live star counts.
 *
 * cue has no machine-readable repo field per component, so the mapping is a
 * curated catalog: each entry declares what it `provides` (namespaces / MCP ids
 * / plugin names), and `reposForProfile` keeps only the entries a given profile
 * actually contains. Every repo is a real GitHub repo so its star count is a
 * live fetch (cached + fail-soft), satisfying the "auto-update the stars" ask.
 */

export type RepoKind = "profile" | "skill" | "mcp" | "plugin" | "workflow" | "cli";

interface RepoProvides {
  /** Skill namespaces (first path segment) this repo is the source of. */
  ns?: string[];
  /** MCP server ids this repo ships. */
  mcps?: string[];
  /** Plugin names (bare, no @marketplace) this repo ships. */
  plugins?: string[];
}

export interface RepoCatalogEntry {
  /** "owner/name" — the GitHub slug. */
  repo: string;
  desc: string;
  provides: RepoProvides;
  kinds: RepoKind[];
}

export interface RepoEntry {
  repo: string;
  url: string;
  desc: string;
  kinds: RepoKind[];
  /** Live GitHub stargazer count, or null when it couldn't be fetched. */
  stars: number | null;
}

/**
 * Curated provenance catalog. Every `repo` is a real GitHub slug so the star
 * fetch resolves; entries the active profile doesn't contain are filtered out.
 */
export const REPO_CATALOG: RepoCatalogEntry[] = [
  {
    repo: "opencue/cuecards",
    desc: "The cue runtime — profiles, the meta toolkit and smart-loader.",
    provides: { ns: ["meta", "caveman", "plan", "review", "gstack", "github", "design"] },
    kinds: ["profile", "skill"],
  },
  {
    repo: "anthropics/skills",
    desc: "npx skill bundle — pdf, docx and pptx authoring.",
    provides: { ns: ["npx"] },
    kinds: ["skill"],
  },
  {
    repo: "lightpanda-io/browser",
    desc: "Fast headless browser, exposed as an MCP server.",
    provides: { ns: ["browser"], mcps: ["lightpanda"] },
    kinds: ["mcp", "skill"],
  },
  {
    repo: "upstash/context7",
    desc: "Up-to-date, version-specific library docs as an MCP server.",
    provides: { ns: ["tools"], mcps: ["context7"] },
    kinds: ["mcp", "skill"],
  },
  {
    repo: "thedotmack/claude-mem",
    desc: "Persistent memory plugin — skills under the plugin/ namespace.",
    provides: { plugins: ["claude-mem"] },
    kinds: ["plugin"],
  },
  {
    repo: "coollabsio/coolify",
    desc: "Self-hosted deploy platform — the upstream behind cue's coolify MCP.",
    provides: { mcps: ["coolify"] },
    kinds: ["mcp", "skill"],
  },
  {
    repo: "supabase/supabase",
    desc: "Open-source Postgres backend — exposed as an MCP server.",
    provides: { mcps: ["supabase"] },
    kinds: ["mcp", "skill"],
  },
  {
    repo: "vercel/vercel",
    desc: "Deploy + host web apps — the vercel Claude Code plugin's upstream.",
    provides: { plugins: ["vercel"] },
    kinds: ["plugin"],
  },
];

/** Strip a plugin id's `@marketplace` suffix → its bare name. */
function pluginName(id: string): string {
  const at = id.indexOf("@");
  return at > 0 ? id.slice(0, at) : id;
}

/**
 * Keep only catalog entries the profile actually contains: a repo matches when
 * it provides a namespace the profile has, an MCP it connects, or a plugin it
 * wires. Pure + exported so it's unit-testable without a network round-trip.
 */
export function reposForProfile(opts: {
  namespaces: Iterable<string>;
  mcpIds: Iterable<string>;
  pluginIds: Iterable<string>;
}): RepoCatalogEntry[] {
  const ns = new Set(opts.namespaces);
  const mcps = new Set(opts.mcpIds);
  const plugins = new Set([...opts.pluginIds].map(pluginName));
  return REPO_CATALOG.filter((r) => {
    const p = r.provides;
    if (p.ns?.some((n) => ns.has(n))) return true;
    if (p.mcps?.some((m) => mcps.has(m))) return true;
    if (p.plugins?.some((pl) => plugins.has(pl))) return true;
    return false;
  });
}

// ── live star counts ────────────────────────────────────────────────────────
// One GitHub API GET per repo, cached 6h, fail-soft. The unauthenticated rate
// limit (60/hr) is ample for a handful of repos behind the cache.

const STAR_TTL_MS = 6 * 60 * 60 * 1000;
const starCache = new Map<string, { ts: number; stars: number | null }>();

/** Fetch one repo's stargazer count, cached + fail-soft (null on any error). */
export async function fetchStars(repo: string, now: number): Promise<number | null> {
  const cached = starCache.get(repo);
  if (cached && now - cached.ts < STAR_TTL_MS) return cached.stars;
  let stars: number | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { "User-Agent": "cue-studio", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const body = (await res.json()) as { stargazers_count?: number };
      if (typeof body.stargazers_count === "number") stars = body.stargazers_count;
    }
  } catch {
    // offline / timeout / rate-limited → null this cycle. Keep any prior value
    // so a transient failure doesn't blank a previously-known count.
    if (cached) return cached.stars;
  }
  starCache.set(repo, { ts: now, stars });
  return stars;
}

/** Resolve a matched catalog into display rows with live star counts. */
export async function resolveRepoStars(matched: RepoCatalogEntry[], now: number): Promise<RepoEntry[]> {
  const settled = await Promise.allSettled(matched.map((r) => fetchStars(r.repo, now)));
  return matched.map((r, i) => {
    const s = settled[i];
    return {
      repo: r.repo,
      url: `https://github.com/${r.repo}`,
      desc: r.desc,
      kinds: r.kinds,
      stars: s && s.status === "fulfilled" ? s.value : null,
    };
  });
}
