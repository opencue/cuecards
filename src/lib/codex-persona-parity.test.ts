/**
 * Codex routing parity: a profile's persona (e.g. the core "Model routing"
 * block) must reach BOTH agents' memory files — CLAUDE.md for claude-code and
 * AGENTS.md for codex. The persona is the portable layer of the model-routing
 * feature; the model-route-nudge hook is Claude-only (Codex has no
 * UserPromptSubmit equivalent), so this guards the part Codex actually gets.
 *
 * Standalone file (not folded into runtime-materializer.test.ts) to avoid a
 * cross-agent file lock on that test.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { materializeRuntime } from "./runtime-materializer";
import type { ResolvedProfile } from "../../profiles/_types";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "cue-persona-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const MARKER = "## Model routing — route by task hardness";

const profile: ResolvedProfile = {
  name: "persona-parity-test",
  description: "test",
  agents: ["claude-code", "codex"],
  skills: { local: [], npx: [] },
  mcps: [],
  plugins: [],
  env: {},
  inheritanceChain: ["persona-parity-test"],
  // persona is read via (profile as any).persona by the materializer.
  persona: `${MARKER}\n  delegate EASY/SEARCH work to a Sonnet subagent`,
} as ResolvedProfile;

const common = {
  runtimeRoot: "",
  skillSourceLookup: async (id: string) => `/fake/skills/${id}`,
  mcpRegistry: {},
  userClaudeMd: "",
};

describe("persona reaches both agents' memory files", () => {
  test("claude-code → CLAUDE.md contains the persona", async () => {
    const out = await materializeRuntime({ ...common, runtimeRoot: join(root, "rt"), profile, agent: "claude-code" });
    const md = await readFile(join(out.runtimeDir, "CLAUDE.md"), "utf8");
    expect(md).toContain(MARKER);
  });

  test("codex → AGENTS.md contains the persona (routing parity)", async () => {
    const out = await materializeRuntime({ ...common, runtimeRoot: join(root, "rt"), profile, agent: "codex" });
    const md = await readFile(join(out.runtimeDir, "AGENTS.md"), "utf8");
    expect(md).toContain(MARKER);
  });
});
