import { spawnSync } from "node:child_process";
import type { RepositorySnapshot } from "./handoff";

export const MAX_GUARDEX_HANDOFF_PATHS = 32;

export interface GuardexHandoffScope {
  claimed_paths: string[];
  dirty_paths: string[];
  truncated: boolean;
}

export interface HandoffFileOwnership {
  file: string;
  status: "unclaimed" | "same-lane" | "other-lane";
  owner?: { branch: string; agent: string };
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 &&
    !/[\x00-\x1f\x7f\\:]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}

function context(repo: RepositorySnapshot, paths: string[] = []): Record<string, unknown> | undefined {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.GIT_OPTIONAL_LOCKS = "0";
  const result = spawnSync("gx", ["context", "--json", "--max-bytes", "20000", "--", ...paths], {
    cwd: repo.root, env, encoding: "utf8", timeout: 12_000, maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) return;
  try {
    const data = JSON.parse(result.stdout);
    if (data?.complete === true && data.worktree === repo.root && data.branch === repo.branch) return data;
  } catch { /* no live evidence */ }
}

/** Automatically summarize an isolated sender lane; never capture primary-checkout edits. */
export function captureGuardexScope(repo: RepositorySnapshot): GuardexHandoffScope | undefined {
  if (!repo.branch?.startsWith("agent/")) return;
  const live = context(repo);
  if (live?.onPrimaryCheckout !== false || typeof live.agent !== "string" || !live.agent ||
      !Array.isArray(live.locks) || !Array.isArray(live.dirty)) return;
  const claimed = [...new Set(live.locks.filter(safePath))];
  const dirty = [...new Set(live.dirty.filter(safePath))];
  const all = [...new Set([...claimed, ...dirty])];
  const scope = new Set(all.slice(0, MAX_GUARDEX_HANDOFF_PATHS));
  return {
    claimed_paths: claimed.filter((path) => scope.has(path)),
    dirty_paths: dirty.filter((path) => scope.has(path)),
    truncated: scope.size < all.length || !live.locks.every(safePath) || !live.dirty.every(safePath),
  };
}

/** Missing, mismatched, or incomplete output never means a file is unclaimed. */
export function checkGuardexOwnership(
  repo: RepositorySnapshot, scope: GuardexHandoffScope,
): HandoffFileOwnership[] | undefined {
  const paths = [...new Set([...scope.claimed_paths, ...scope.dirty_paths])];
  if (!paths.length || paths.length > MAX_GUARDEX_HANDOFF_PATHS || !paths.every(safePath)) return;
  const live = context(repo, paths);
  if (!Array.isArray(live?.ownership) || live.ownership.length !== paths.length) return;
  const rows = new Map<string, HandoffFileOwnership>();
  for (const row of live.ownership) {
    if (!row || !paths.includes(row.file) || rows.has(row.file)) return;
    const { file, owner } = row;
    if (owner === null) {
      rows.set(file, { file, status: "unclaimed" });
    } else {
      if (!owner || typeof owner.branch !== "string" || !owner.branch ||
          typeof owner.agent !== "string" || !owner.agent ||
          owner.branch.length > 1024 || owner.agent.length > 256) return;
      const sameLane = owner.branch === repo.branch && owner.agent === live.agent;
      rows.set(file, { file, status: sameLane ? "same-lane" : "other-lane",
        owner: { branch: owner.branch, agent: owner.agent } });
    }
  }
  return [...rows.values()];
}
