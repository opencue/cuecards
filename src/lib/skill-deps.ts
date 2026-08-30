/**
 * Skill-to-skill dependency graph.
 *
 * Reads `depends:` from SKILL.md frontmatter and builds a DAG for load-order
 * resolution and "why is this skill included?" explanations.
 */

import { readFileSync, existsSync, } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

function skillsRoot(): string {
  return process.env.CUE_SKILLS_ROOT ?? SKILLS_ROOT;
}

/**
 * Read the `depends:` array from a skill's SKILL.md frontmatter.
 */
export function parseDependencies(skillId: string): string[] {
  const path = join(skillsRoot(), skillId, "SKILL.md");
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const depsMatch = fmMatch[1]!.match(/^depends:\s*\[([^\]]*)\]/m);
  if (!depsMatch) return [];
  return depsMatch[1]!.split(",").map(s => s.trim().replace(/['"]/g, "")).filter(Boolean);
}

/**
 * Build an adjacency list: skill → its dependencies.
 */
export function buildDependencyGraph(skillIds: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [...skillIds];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const id = queue.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const deps = parseDependencies(id);
    graph.set(id, deps);
    for (const dep of deps) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return graph;
}

/**
 * Return all paths from any root skill to the given skillId.
 * Each path is an array of skill IDs from root to target.
 */
export function explainWhy(skillId: string, graph: Map<string, string[]>): string[][] {
  const paths: string[][] = [];

  function dfs(current: string, path: string[]): void {
    if (current === skillId && path.length > 1) {
      paths.push([...path]);
      return;
    }
    const deps = graph.get(current);
    if (!deps) return;
    for (const dep of deps) {
      if (path.includes(dep)) continue; // avoid cycles
      path.push(dep);
      dfs(dep, path);
      path.pop();
    }
  }

  for (const [node] of graph) {
    if (node === skillId) continue;
    dfs(node, [node]);
  }

  // Also include direct: if skillId is explicitly in the graph as a root
  if (graph.has(skillId)) {
    paths.push([skillId]);
  }

  return paths;
}
