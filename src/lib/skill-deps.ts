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
 * Topological sort (Kahn's algorithm). Throws on cycle.
 */
export function topologicalSort(graph: Map<string, string[]>): string[] {
  const inDegree = new Map<string, number>();
  for (const [node] of graph) inDegree.set(node, 0);
  for (const [, deps] of graph) {
    for (const dep of deps) {
      if (!inDegree.has(dep)) inDegree.set(dep, 0);
      // dep must be loaded before the node that depends on it
    }
  }
  // In our graph, edges go from node → its deps (node depends on dep).
  // For topo sort, dep must come before node. So in-degree counts how many
  // nodes depend on a given node (i.e. how many times it appears as a dep).
  for (const [, deps] of graph) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }
  // Wait — we want load order: deps first. Reverse the edge direction for Kahn's.
  // Actually: node depends on dep means dep must load first.
  // Let's recompute: in-degree of a node = number of its own dependencies.
  const inDeg = new Map<string, number>();
  const allNodes = new Set<string>();
  for (const [node, deps] of graph) {
    allNodes.add(node);
    for (const d of deps) allNodes.add(d);
  }
  for (const n of allNodes) inDeg.set(n, 0);
  // Edge: node → dep means "node depends on dep", so for load order
  // we reverse: dep → node. In-degree of node = number of deps it has.
  for (const [node, deps] of graph) {
    inDeg.set(node, deps.length);
  }

  const queue: string[] = [];
  for (const [n, d] of inDeg) {
    if (d === 0) queue.push(n);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    result.push(n);
    // For each node that depends on n, decrement its in-degree
    for (const [node, deps] of graph) {
      if (deps.includes(n)) {
        const newDeg = inDeg.get(node)! - 1;
        inDeg.set(node, newDeg);
        if (newDeg === 0) queue.push(node);
      }
    }
  }

  if (result.length < allNodes.size) {
    throw new Error("Cycle detected in skill dependency graph");
  }
  return result;
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
