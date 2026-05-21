/**
 * Tests for `resolvePlugins` (Agent A8).
 *
 * Every test builds a self-contained fake plugins root under `tmpdir()` so we
 * never touch the user's real `~/.claude/plugins/`. The resolver accepts an
 * explicit `pluginsRoot` argument — we pass the temp path there.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedProfile } from "../../../profiles/_types";
import {
  PluginNotInstalled,
  resolvePlugins,
} from "./resolver-plugins";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "soul-resolver-plugins-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Build a fake plugin tree:
 *   <root>/<plugin>/skills/<slug>/SKILL.md
 *
 * Each entry in `slugs` becomes one skill. Pass `slugs: []` to create a
 * plugin dir with an empty `skills/` tree. Pass `skipSkillsDir: true` to
 * create the plugin dir without a `skills/` tree at all.
 */
async function makePlugin(
  pluginsRoot: string,
  plugin: string,
  slugs: string[],
  opts: { skipSkillsDir?: boolean } = {},
): Promise<void> {
  const pluginDir = join(pluginsRoot, plugin);
  if (opts.skipSkillsDir) {
    await mkdir(pluginDir, { recursive: true });
    return;
  }
  const skillsDir = join(pluginDir, "skills");
  await mkdir(skillsDir, { recursive: true });
  for (const slug of slugs) {
    const dir = join(skillsDir, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `# ${slug}\n`, "utf8");
  }
}

/** Build a minimal `ResolvedProfile` carrying the given plugin refs. */
function makeProfile(plugins: string[]): ResolvedProfile {
  return {
    name: "test-profile",
    description: "test fixture",
    agents: ["claude-code"],
    skills: { local: [], npx: [] },
    mcps: [],
    // Plugin ids follow <name>@<marketplace> convention; resolver extracts the
    // part before '@' as the on-disk directory name.
    plugins: plugins.map((id) => ({
      id: id.includes("@") ? id : `${id}@claude-plugins-official`,
    })),
    env: {},
    inheritanceChain: ["test-profile"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolvePlugins", () => {
  test("returns no plans when the profile lists no plugins", async () => {
    const profile = makeProfile([]);
    const plans = await resolvePlugins(profile, { pluginsRoot: root });
    expect(plans).toEqual([]);
  });

  test("resolves a plugin with multiple skills into namespaced LinkPlans", async () => {
    await makePlugin(root, "claude-mem", ["mem-search", "mem-context", "timeline"]);

    const profile = makeProfile(["claude-mem"]);
    const plans = await resolvePlugins(profile, { pluginsRoot: root });

    // Three skills, deterministic sort order (alphabetical).
    expect(plans).toHaveLength(3);

    const targets = plans.map((p) => p.target).sort();
    expect(targets).toEqual([
      ".claude/skills/claude-mem:mem-context/",
      ".claude/skills/claude-mem:mem-search/",
      ".claude/skills/claude-mem:timeline/",
    ]);

    // Every plan must be tagged as a plugin origin and point at a real
    // <root>/<plugin>/skills/<slug> directory.
    for (const plan of plans) {
      expect(plan.origin).toBe("plugin");
      expect(plan.source.startsWith(join(root, "claude-mem", "skills"))).toBe(
        true,
      );
    }
  });

  test("resolves multiple plugins independently, preserving order", async () => {
    await makePlugin(root, "caveman", ["caveman"]);
    await makePlugin(root, "ck", ["build", "check"]);

    const profile = makeProfile(["caveman", "ck"]);
    const plans = await resolvePlugins(profile, { pluginsRoot: root });

    expect(plans.map((p) => p.target)).toEqual([
      ".claude/skills/caveman:caveman/",
      ".claude/skills/ck:build/",
      ".claude/skills/ck:check/",
    ]);
  });

  test("throws PluginNotInstalled with install hint when the plugin dir is missing", async () => {
    const profile = makeProfile(["does-not-exist"]);

    let caught: unknown;
    try {
      await resolvePlugins(profile, { pluginsRoot: root });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PluginNotInstalled);
    const err = caught as PluginNotInstalled;
    expect(err.code).toBe("PLUGIN_NOT_INSTALLED");
    expect(err.plugin).toBe("does-not-exist");
    expect(err.install_hint).toBe("/plugin marketplace add does-not-exist");
    expect(err.pluginsRoot).toBe(root);
    expect(err.message).toContain("/plugin marketplace add does-not-exist");
  });

  test("returns zero plans when the plugin exists but has an empty skills/ dir", async () => {
    await makePlugin(root, "no-skills", []);

    const profile = makeProfile(["no-skills"]);
    const plans = await resolvePlugins(profile, { pluginsRoot: root });

    expect(plans).toEqual([]);
  });

  test("returns zero plans when the plugin exists but ships no skills/ tree at all", async () => {
    await makePlugin(root, "tools-only", [], { skipSkillsDir: true });

    const profile = makeProfile(["tools-only"]);
    const plans = await resolvePlugins(profile, { pluginsRoot: root });

    expect(plans).toEqual([]);
  });

  test("skips skill subdirectories that lack a SKILL.md", async () => {
    // Set up `partial/skills/{real,broken}` where only `real` has SKILL.md.
    const skillsDir = join(root, "partial", "skills");
    await mkdir(join(skillsDir, "real"), { recursive: true });
    await writeFile(join(skillsDir, "real", "SKILL.md"), "# real\n");
    await mkdir(join(skillsDir, "broken"), { recursive: true });
    await writeFile(join(skillsDir, "broken", "README.md"), "# broken\n");

    const profile = makeProfile(["partial"]);
    const plans = await resolvePlugins(profile, { pluginsRoot: root });

    expect(plans).toHaveLength(1);
    expect(plans[0]!.target).toBe(".claude/skills/partial:real/");
  });

  test("honors SOUL_PLUGINS_ROOT when no explicit pluginsRoot is passed", async () => {
    await makePlugin(root, "envplug", ["a"]);

    const previous = process.env.SOUL_PLUGINS_ROOT;
    process.env.SOUL_PLUGINS_ROOT = root;
    try {
      const profile = makeProfile(["envplug"]);
      const plans = await resolvePlugins(profile);
      expect(plans).toHaveLength(1);
      expect(plans[0]!.target).toBe(".claude/skills/envplug:a/");
    } finally {
      if (previous === undefined) delete process.env.SOUL_PLUGINS_ROOT;
      else process.env.SOUL_PLUGINS_ROOT = previous;
    }
  });
});
