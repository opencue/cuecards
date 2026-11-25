import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import browseListings from "../web/src/fork-skill-listings.json";
import catalog from "../web/src/skill-catalog.json";
import type { ForkSkill } from "../web/src/skill-catalog";

const commitPattern = /^[a-f0-9]{40}$/;
const catalogFile = new URL("../web/src/skill-catalog.json", import.meta.url);
const profileFile = new URL("../profiles/nagyvikt-skills/profile.yaml", import.meta.url);
const browseFile = new URL("../web/src/fork-skill-listings.json", import.meta.url);
const browseRepo = "NagyVikt/claude-blog";
type GitEntry = { path: string; mode: string; type: string; sha: string };
type GitTree = { truncated: boolean; tree: GitEntry[] };
type BrowseListings = Record<string, string> & { commit: string };

export function refreshForkSkills(skills: ForkSkill[], github: (endpoint: string) => unknown): ForkSkill[] {
  const responses = new Map<string, unknown>();
  const candidatePins = new Map<string, string>();
  function get<T>(endpoint: string): T {
    if (!responses.has(endpoint)) responses.set(endpoint, github(endpoint));
    return responses.get(endpoint) as T;
  }
  function treeAt(repo: string, commit: string): GitEntry[] {
    const { tree, truncated } = get<GitTree>(`repos/${repo}/git/trees/${commit}?recursive=1`);
    if (truncated || !Array.isArray(tree)) throw new Error(`Incomplete Git tree for ${repo}@${commit}`);
    return tree;
  }

  for (const skill of skills) {
    const { repo, directory, commit, id } = skill;
    if (!/^NagyVikt\/[\w-]+$/.test(repo) || !/^[a-z\d-]+$/.test(id)
      || directory !== `skills/${id}` || !commitPattern.test(commit)) {
      throw new Error("Invalid fork skill catalog entry");
    }
    const head = get<{ sha: string }>(`repos/${repo}/commits/HEAD`).sha;
    if (typeof head !== "string" || !commitPattern.test(head)) throw new Error(`Invalid source commit for ${repo}`);
    if (commit === head) continue;

    const previous = treeAt(repo, commit);
    const latest = treeAt(repo, head);
    const folder = (tree: GitEntry[]) => tree.find(entry => entry.type === "tree" && entry.path === directory)?.sha;
    const candidate = folder(latest);
    if (!candidate || !folder(previous)) throw new Error(`Missing skill directory: ${repo}/${directory}`);
    if (candidate === folder(previous)) continue;

    const files = latest.filter(entry => entry.path.startsWith(`${directory}/`) && entry.type !== "tree");
    if (!files.some(entry => entry.path === `${directory}/SKILL.md`)
      || files.some(entry => entry.type !== "blob" || entry.mode !== "100644" || !entry.path.endsWith(".md"))) {
      throw new Error(`${repo}/${directory} must contain only regular Markdown files; review manually.`);
    }
    const license = (tree: GitEntry[]) => tree.find(entry => entry.path === "LICENSE" && entry.mode === "100644")?.sha;
    if (!license(previous) || license(previous) !== license(latest)) throw new Error(`Check changed license for ${repo}`);
    const comparison = get<{ status: string }>(`repos/${repo}/compare/${commit}...${head}?per_page=1`);
    if (comparison.status !== "ahead") throw new Error(`Source history changed for ${repo}; review manually.`);

    candidatePins.set(repo, head);
  }
  return skills.map(skill => ({ ...skill, commit: candidatePins.get(skill.repo) ?? skill.commit }));
}

export function refreshBrowseListings(
  listings: BrowseListings,
  installed: string[],
  github: (endpoint: string) => unknown,
): BrowseListings {
  const { commit, ...summaries } = listings;
  const head = (github(`repos/${browseRepo}/commits/HEAD`) as { sha: string }).sha;
  if (!commitPattern.test(commit) || !commitPattern.test(head)) throw new Error("Invalid browse-only commit");
  if (commit === head) return listings;

  function treeAt(ref: string): GitEntry[] {
    const { tree, truncated } = github(`repos/${browseRepo}/git/trees/${ref}?recursive=1`) as GitTree;
    if (truncated || !Array.isArray(tree)) throw new Error(`Incomplete browse-only Git tree at ${ref}`);
    return tree;
  }
  function skillFiles(tree: GitEntry[]): Map<string, string> {
    const files = new Map<string, string>();
    for (const entry of tree) {
      const id = /^skills\/([a-z\d-]+)\/SKILL\.md$/.exec(entry.path)?.[1];
      if (!id || id === "commit" || installed.includes(id)) continue;
      if (entry.type !== "blob" || entry.mode !== "100644" || !commitPattern.test(entry.sha)) {
        throw new Error(`Invalid browse-only skill file: ${id}`);
      }
      files.set(id, entry.sha);
    }
    return files;
  }
  const previous = treeAt(commit);
  const latest = treeAt(head);
  const before = skillFiles(previous);
  const after = skillFiles(latest);
  if (!after.size) throw new Error("No browse-only skill files; review manually");
  if (before.size === after.size && [...after].every(([id, sha]) => before.get(id) === sha)) return listings;
  const license = (tree: GitEntry[]) => tree.find(entry => entry.path === "LICENSE" && entry.mode === "100644")?.sha;
  if (!license(previous) || license(previous) !== license(latest)) throw new Error("Check changed browse-only license");
  const comparison = github(`repos/${browseRepo}/compare/${commit}...${head}?per_page=1`) as { status: string };
  if (comparison.status !== "ahead") throw new Error("Browse-only source history changed; review manually");

  const result: BrowseListings = { commit: head };
  for (const [id, sha] of [...after].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const previousSummary = Object.hasOwn(summaries, id) ? summaries[id] : undefined;
    if (before.get(id) === sha && previousSummary) {
      result[id] = previousSummary;
      continue;
    }
    const { encoding, content } = github(`repos/${browseRepo}/git/blobs/${sha}`) as {
      encoding: string; content: string;
    };
    if (encoding !== "base64" || typeof content !== "string" || content.length > 180_000) {
      throw new Error(`Invalid browse-only description source: ${id}`);
    }
    const file = Buffer.from(content, "base64").toString("utf8");
    const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file)?.[1];
    const description = yaml ? (Bun.YAML.parse(yaml) as { description?: unknown } | null)?.description : undefined;
    result[id] = (typeof description === "string" && description.replace(/\s+/g, " ").trim().slice(0, 240))
      || previousSummary || "Read this skill’s instructions at the source.";
  }
  return result;
}

export function renderForkProfile(skills: ForkSkill[]): string {
  const repos = new Map<string, { commit: string; ids: string[] }>();
  for (const { repo, commit, id } of skills) {
    const entry = repos.get(repo) ?? { commit, ids: [] };
    if (entry.commit !== commit) throw new Error(`Conflicting commits for ${repo}`);
    entry.ids.push(id);
    repos.set(repo, entry);
  }
  return [
    "# Generated by scripts/refresh-fork-skills.ts from web/src/skill-catalog.json.",
    "name: nagyvikt-skills",
    "kind: overlay",
    'description: "Selected skills from the NagyVikt GitHub forks at reviewed versions."',
    "inherits: core",
    "skills:",
    "  npx:",
    ...[...repos].flatMap(([repo, entry]) => [
      `    - repo: ${JSON.stringify(repo)}`,
      `      pin: git@${entry.commit}`,
      `      skills: [${entry.ids.map(id => JSON.stringify(id)).join(", ")}]`,
    ]),
    "",
  ].join("\n");
}

if (import.meta.main) {
  const responses = new Map<string, unknown>();
  function github(endpoint: string): unknown {
    if (!responses.has(endpoint)) {
      responses.set(endpoint, JSON.parse(execFileSync("gh", ["api", endpoint], {
        encoding: "utf8", timeout: 30_000, maxBuffer: 16_000_000,
      })));
    }
    return responses.get(endpoint);
  }
  const updated = refreshForkSkills(catalog, github);
  const browse = refreshBrowseListings(browseListings, catalog.filter(skill => skill.repo === browseRepo).map(skill => skill.id), github);
  const changes = updated.flatMap((skill, index) => {
    const previous = catalog[index];
    return previous.commit === skill.commit ? [] : [
      `- \`${skill.id}\`: [review source changes](https://github.com/${skill.repo}/compare/${previous.commit}...${skill.commit})`,
    ];
  });
  const write = process.argv.includes("--write");
  if (write && changes.length) {
    const profile = renderForkProfile(updated);
    writeFileSync(catalogFile, `${JSON.stringify(updated, null, 2)}\n`);
    writeFileSync(profileFile, profile);
  }
  if (browse.commit !== browseListings.commit) {
    changes.push(`- Browse-only blog catalog: [review source changes](https://github.com/${browseRepo}/compare/${browseListings.commit}...${browse.commit})`);
    if (write) writeFileSync(browseFile, `${JSON.stringify(browse, null, 2)}\n`);
  }
  console.log(changes.join("\n") || "No fork skill changes found.");
}
