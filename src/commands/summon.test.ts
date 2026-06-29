import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { summon, detectActiveProfile, REEXEC_CMD } from "./summon";
import { existsSync } from "node:fs";

// `resources/skills` is a git submodule. The mcp_status assertion below reads a
// skill's `requires_mcps` from disk; without it checked out (`git submodule
// update --init`) the deps come back empty and every skill reads "ok". Skip
// rather than fail spuriously.
const SKILLS_PRESENT = existsSync(join(import.meta.dir, "../../resources/skills/skills"));

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

  test("returns null when nothing identifies the session", () => {
    expect(detectActiveProfile({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("summon", () => {
  test("explicit profile arg overrides an auto-detect signal", async () => {
    // Arrange: a dir that WOULD auto-detect vercel...
    await writeFile(join(dir, "vercel.json"), "{}");
    // Act: ...but an explicit profile is passed.
    const r = await summon({ cwd: dir, profile: "core", active: null, noPin: true });
    // Assert
    expect(r.profile).toBe("core");
    expect(r.detected).toBe(false);
    expect(r.reexec_cmd).toBe(REEXEC_CMD);
    expect(r.skills.length).toBeGreaterThan(0);
    expect(r.skills.every((s) => s.id.length > 0 && typeof s.mcp_status === "string")).toBe(true);
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
    // browser/lightpanda needs the `lightpanda` MCP; core loads it.
    const lp = (skills: { id: string; mcp_status: string }[]) =>
      skills.find((s) => s.id === "browser/lightpanda");

    const noActive = await summon({ cwd: dir, profile: "vercel", active: null, noPin: true });
    const withCore = await summon({ cwd: dir, profile: "vercel", active: "core", noPin: true });

    expect(lp(noActive.skills)?.mcp_status).toBe("missing:lightpanda");
    expect(lp(withCore.skills)?.mcp_status).toBe("ok");
  });
});
