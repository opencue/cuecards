import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReexecCommand,
  detectActiveAgent,
  detectActiveProfile,
  findActiveCodexRollout,
  summon,
} from "./summon";
import { loadProfile } from "../lib/profile-loader";
import { getSkillDependencies } from "../lib/skill-dependencies";
import { existsSync, readdirSync } from "node:fs";

// `resources/skills` is a git submodule. The mcp_status assertion below reads a
// skill's `requires_mcps` from disk; without it checked out (`git submodule
// update --init`) the deps come back empty and every skill reads "ok". Skip
// rather than fail spuriously.
const SKILLS_PRESENT = existsSync(join(import.meta.dir, "../../resources/skills/skills"));

/**
 * Find a live (profile with an MCP-gated skill, other profile supplying that
 * skill's MCPs) pairing. Returns null when no such pairing exists.
 */
async function findMcpGatedPair(): Promise<
  { summonProfile: string; skillId: string; deps: string[]; provider: string } | null
> {
  const names = readdirSync(join(import.meta.dir, "../../profiles"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const loaded = new Map<string, Awaited<ReturnType<typeof loadProfile>>>();
  for (const n of names) {
    try {
      loaded.set(n, await loadProfile(n));
    } catch {
      // Unloadable profile — not this test's problem; profile-loader has its own.
    }
  }

  for (const [name, profile] of loaded) {
    for (const s of profile.skills.local) {
      // Keep the raw ids: summon reports `missing:<id>` with original casing.
      const deps = [...new Set(getSkillDependencies(s.id).map((d) => d.mcpId))];
      if (deps.length === 0) continue;
      for (const [providerName, provider] of loaded) {
        if (providerName === name) continue;
        const ids = new Set(provider.mcps.map((m) => m.id.toLowerCase()));
        if (deps.every((d) => ids.has(d.toLowerCase()))) {
          return { summonProfile: name, skillId: s.id, deps, provider: providerName };
        }
      }
    }
  }
  return null;
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "cue-summon-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("detectActiveProfile", () => {
  test("prefers CUE_ACTIVE_PROFILE, then CUE_PROFILE", () => {
    // Arrange / Act / Assert
    expect(detectActiveProfile({ CUE_ACTIVE_PROFILE: "a", CUE_PROFILE: "b" } as NodeJS.ProcessEnv)).toBe("a");
    expect(detectActiveProfile({ CUE_PROFILE: "b" } as NodeJS.ProcessEnv)).toBe("b");
  });

  test("falls back to the CLAUDE_CONFIG_DIR runtime path", () => {
    const env = { CLAUDE_CONFIG_DIR: "/home/u/.config/cue/runtime/core+skill-writer/claude" } as NodeJS.ProcessEnv;
    expect(detectActiveProfile(env)).toBe("core+skill-writer");
  });

  test("falls back to the CODEX_HOME runtime path", () => {
    const env = {
      CODEX_HOME: "/home/u/.config/cue/runtime/ads-manager+coolify/codex",
    } as NodeJS.ProcessEnv;
    expect(detectActiveProfile(env)).toBe("ads-manager+coolify");
  });

  test("returns null when nothing identifies the session", () => {
    expect(detectActiveProfile({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("Codex warm handoff", () => {
  test("detects Codex from CUE_AGENT before weaker harness signals", () => {
    expect(
      detectActiveAgent({
        CUE_AGENT: "codex",
        CLAUDE_CONFIG_DIR: "/tmp/claude",
      } as NodeJS.ProcessEnv),
    ).toBe("codex");
    expect(detectActiveAgent({} as NodeJS.ProcessEnv)).toBe("claude");
  });

  test("finds the active rollout under CODEX_HOME", async () => {
    const threadId = "123e4567-e89b-12d3-a456-426614174000";
    const rollout = join(
      dir,
      "sessions",
      "2026",
      "08",
      "23",
      `rollout-2026-08-23T12-00-00-${threadId}.jsonl`,
    );
    await mkdir(join(rollout, ".."), { recursive: true });
    await writeFile(rollout, "{}\n");

    expect(
      findActiveCodexRollout({
        CODEX_HOME: dir,
        CODEX_THREAD_ID: threadId,
      } as NodeJS.ProcessEnv),
    ).toBe(rollout);
  });

  test("builds an explicit Cue launch with transcript handoff", () => {
    const result = buildReexecCommand({
      agent: "codex",
      profile: "ads-manager+coolify",
      handoffPath: "/tmp/old rollout.jsonl",
    });
    expect(result.mode).toBe("transcript-handoff");
    expect(result.command).toContain(
      "cue launch codex --cue-profile 'ads-manager+coolify' --cue-full",
    );
    expect(result.command).toContain("/tmp/old rollout.jsonl");
  });

  test("Claude uses native continuation under the requested profile", () => {
    const result = buildReexecCommand({
      agent: "claude",
      profile: "vercel",
    });
    expect(result).toEqual({
      command:
        "cue launch claude --cue-profile 'vercel' --cue-full -- --continue",
      mode: "native",
    });
  });
});

describe("summon", () => {
  test("explicit profile arg overrides an auto-detect signal", async () => {
    // Arrange: a dir that WOULD auto-detect vercel...
    await writeFile(join(dir, "vercel.json"), "{}");
    // Act: ...but an explicit profile is passed.
    const r = await summon({
      cwd: dir,
      profile: "core",
      active: null,
      agent: "claude",
      noPin: true,
      env: {},
    });
    // Assert
    expect(r.profile).toBe("core");
    expect(r.detected).toBe(false);
    expect(r.agent).toBe("claude");
    expect(r.resume_mode).toBe("native");
    expect(r.reexec_cmd).toBe(
      "cue launch claude --cue-profile 'core' --cue-full -- --continue",
    );
    expect(r.skills.length).toBeGreaterThan(0);
    expect(
      r.skills.every(
        (s) =>
          s.id.length > 0 &&
          typeof s.mcp_status === "string" &&
          typeof s.loaded === "boolean",
      ),
    ).toBe(true);
  });

  test("combines the active and requested profiles without duplicates", async () => {
    const r = await summon({
      cwd: dir,
      profile: "coolify",
      active: "core+coolify",
      agent: "codex",
      withActive: true,
      noPin: true,
      env: {},
    });

    expect(r.requested_profile).toBe("coolify");
    expect(r.profile).toBe("core+coolify");
    expect(r.agent).toBe("codex");
    expect(r.resume_mode).toBe("fresh");
    expect(r.reexec_cmd).toBe(
      "cue launch codex --cue-profile 'core+coolify' --cue-full",
    );
    expect(r.skills.some((skill) => skill.loaded)).toBe(true);
  });

  test("auto-detects vercel from vercel.json + @vercel deps", async () => {
    // Arrange
    await writeFile(join(dir, "vercel.json"), "{}");
    await writeFile(join(dir, "next.config.js"), "");
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "15", vercel: "39" } }));
    // Act
    const r = await summon({ cwd: dir, active: null, noPin: true });
    // Assert
    expect(r.profile).toBe("vercel");
    expect(r.detected).toBe(true);
    expect(r.confidence ?? 0).toBeGreaterThanOrEqual(0.9);
    expect(r.persona.length).toBeGreaterThan(0);
  });

  test("throws when no profile resolves from an empty dir", async () => {
    await expect(summon({ cwd: dir, active: null, noPin: true })).rejects.toThrow();
  });

  test("throws on an unknown explicit profile", async () => {
    await expect(summon({ cwd: dir, profile: "does-not-exist-xyz", active: null })).rejects.toThrow(/unknown profile/);
  });

  test("writes the .cue.profile pin by default, skips it with noPin", async () => {
    // Arrange / Act
    const r1 = await summon({ cwd: dir, profile: "vercel", active: null });
    // Assert
    expect(r1.pin_written).toBe(true);
    expect(r1.pin_path).toBe(join(dir, ".cue.profile"));
    expect((await readFile(join(dir, ".cue.profile"), "utf8")).trim()).toBe("vercel");

    const r2 = await summon({ cwd: dir, profile: "vercel", active: null, noPin: true });
    expect(r2.pin_written).toBe(false);
  });

  test("dry-run computes a result without writing the pin", async () => {
    const r = await summon({ cwd: dir, profile: "vercel", active: null, dryRun: true });
    expect(r.pin_written).toBe(false);
    expect(r.pin_previous).toBeNull();
    await expect(stat(join(dir, ".cue.profile"))).rejects.toThrow();
  });

  test("re-pinning the same profile is a no-op, not a clobber", async () => {
    // Arrange: already pinned to vercel
    await writeFile(join(dir, ".cue.profile"), "vercel\n");
    // Act
    const r = await summon({ cwd: dir, profile: "vercel", active: null });
    // Assert: no rewrite, but the prior pin is surfaced
    expect(r.pin_written).toBe(false);
    expect(r.pin_previous).toBe("vercel");
  });

  test("re-pinning a different profile surfaces the replaced pin", async () => {
    // Arrange: pinned to a different profile
    await writeFile(join(dir, ".cue.profile"), "core\n");
    // Act
    const r = await summon({ cwd: dir, profile: "vercel", active: null });
    // Assert: written, and the previous pin is reported (not silently clobbered)
    expect(r.pin_written).toBe(true);
    expect(r.pin_previous).toBe("core");
    expect((await readFile(join(dir, ".cue.profile"), "utf8")).trim()).toBe("vercel");
  });

  test.skipIf(!SKILLS_PRESENT)("mcp_status reflects the active session's loaded MCPs", async () => {
    // The pairing is derived from live profile data, not hardcoded. This test
    // used to pin browser/lightpanda + core; 18570880 (#121) dropped the
    // lightpanda MCP from every profile that pinned it, so the assertion named
    // a pairing that no longer existed and failed for a reason unrelated to
    // what it tests. The behaviour under test is mcp_status resolution, so
    // derive any still-valid pairing and assert against that.
    const pair = await findMcpGatedPair();
    // Loud rather than a silent skip: if nothing is satisfiable, that is itself
    // worth a human look, not a vacuous green.
    expect(pair).not.toBeNull();
    const { summonProfile, skillId, deps, provider } = pair!;

    const find = (skills: { id: string; mcp_status: string }[]) =>
      skills.find((s) => s.id === skillId);
    const missing = `missing:${deps.join(",")}`;
    const opts = { cwd: dir, profile: summonProfile, noPin: true };

    const noActive = await summon({ ...opts, active: null });
    const withProvider = await summon({ ...opts, active: provider });

    expect(find(noActive.skills)?.mcp_status).toBe(missing);
    expect(find(withProvider.skills)?.mcp_status).toBe("ok");
  });
});
