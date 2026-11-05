/**
 * Tests for profile-linter.ts.
 *
 * The suite builds isolated profile, skill, plugin, MCP, and npx-cache roots
 * under tmpdir(). No test reads or mutates the user's real profile state.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasLintErrors,
  lintAllProfiles,
  lintProfile,
  type DiagnosticRuleId,
  type ProfileLinterOptions,
} from "./profile-linter";

let root: string;
let profilesDir: string;
let skillsRoot: string;
let pluginsRoot: string;
let configsRoot: string;
let npxRepoRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cue-profile-linter-"));
  profilesDir = join(root, "profiles");
  skillsRoot = join(root, "skills", "skills");
  pluginsRoot = join(root, "plugins");
  configsRoot = join(root, "mcps", "configs");
  npxRepoRoot = join(root, "repo-root");

  await mkdir(profilesDir, { recursive: true });
  await mkdir(skillsRoot, { recursive: true });
  await mkdir(pluginsRoot, { recursive: true });
  await mkdir(configsRoot, { recursive: true });
  await mkdir(join(npxRepoRoot, "profiles", "_cache", "npx"), { recursive: true });
  await writeMcpConfigs(["drawio"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function opts(overrides: Partial<ProfileLinterOptions> = {}): ProfileLinterOptions {
  return {
    profilesDir,
    skillsRoot,
    pluginsRoot,
    configsRoot,
    repoRoot: npxRepoRoot,
    processEnv: {},
    npxFetch: async (_repo, _pin, skill, destDir) => {
      const dir = join(destDir, skill);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `# ${skill}\n`, "utf8");
    },
    ...overrides,
  };
}

async function writeProfile(name: string, body: string): Promise<void> {
  const dir = join(profilesDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "profile.yaml"), body, "utf8");
}

async function writeLocalSkill(ref: string, opts?: { description?: string | null }): Promise<void> {
  const dir = join(skillsRoot, ref);
  await mkdir(dir, { recursive: true });
  // Default to a router-clean description so tests don't accidentally trip
  // W6/W7. Pass `description: null` to test the bare-bones case explicitly.
  const slug = ref.split("/").pop() ?? ref;
  const description =
    opts?.description === undefined
      ? `Use when user says "${slug}", "do ${slug}", or "run ${slug}". Wraps the ${slug} tool with house-style defaults.`
      : opts.description;
  const frontmatter = description
    ? `---\nname: ${slug}\ndescription: >-\n  ${description}\n---\n`
    : "";
  await writeFile(join(dir, "SKILL.md"), `${frontmatter}# ${ref}\n`, "utf8");
}

async function writePlugin(name: string, slugs: string[]): Promise<void> {
  for (const slug of slugs) {
    const dir = join(pluginsRoot, name, "skills", slug);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `# ${slug}\n`, "utf8");
  }
}

async function writeMcpConfigs(ids: string[]): Promise<void> {
  const servers = Object.fromEntries(
    ids.map((id) => [id, { command: "node", args: [`${id}.js`] }]),
  );
  await writeFile(
    join(configsRoot, "claude.sanitized.json"),
    JSON.stringify({ server_key: "mcpServers", servers }, null, 2),
    "utf8",
  );
  await writeFile(
    join(configsRoot, "codex.sanitized.json"),
    JSON.stringify({ server_key: "mcp_servers", servers: {} }, null, 2),
    "utf8",
  );
}

function rules(result: Awaited<ReturnType<typeof lintProfile>>): DiagnosticRuleId[] {
  return result.issues.map((issue) => issue.rule);
}

describe("lintProfile", () => {
  test("passes a profile whose schema and resolver dry-runs succeed", async () => {
    await writeLocalSkill("meta/find-skills");
    await writePlugin("claude-mem", ["mem-search"]);
    await writeProfile(
      "good",
      [
        "name: good",
        "description: valid profile",
        "skills:",
        "  local: [meta/find-skills]",
        "  npx:",
        "    - repo: anthropics/skills",
        "      skills: [pdf]",
        "plugins: [claude-mem@claude-plugins-official]",
        "mcps: [drawio]",
        "",
      ].join("\n"),
    );

    const result = await lintProfile("good", opts());

    expect(result.issues).toEqual([]);
    expect(hasLintErrors(result)).toBe(false);
    expect(result.checks.map((check) => check.name)).toContain("schema");
    expect(result.checks.map((check) => check.name)).toContain("MCPs");
  });

  test("demotes a local-only MCP (source dir present, absent from sanitized registry) to W9, not E3", async () => {
    // An MCP with a source manifest dir but no sanitized-registry entry is a
    // private/local-only server (wired into the user's own ~/.claude.json), not
    // a dangling reference — warn (W9), like W5 demotes an uninstalled plugin.
    await mkdir(join(root, "mcps", "mcps", "envoult"), { recursive: true });
    await writeFile(join(root, "mcps", "mcps", "envoult", "skills.md"), "# envoult\n", "utf8");
    await writeProfile(
      "priv",
      ["name: priv", "description: private mcp profile", "mcps: [envoult]", ""].join("\n"),
    );

    const result = await lintProfile("priv", opts());

    expect(rules(result).filter((rule) => rule === "W9")).toHaveLength(1);
    expect(rules(result).filter((rule) => rule === "E3")).toHaveLength(0);
  });

  test("still reports E3 for an MCP with neither a registry entry nor a source dir", async () => {
    await writeProfile(
      "dangling",
      ["name: dangling", "description: dangling mcp ref", "mcps: [no-such-mcp]", ""].join("\n"),
    );

    const result = await lintProfile("dangling", opts());

    expect(rules(result).filter((rule) => rule === "E3")).toHaveLength(1);
    expect(rules(result).filter((rule) => rule === "W9")).toHaveLength(0);
  });

  test("reports W1, W2, W3, and W4 warnings", async () => {
    const localRefs: string[] = [];
    for (let i = 0; i < 121; i++) {
      const ref = `bulk/skill-${i}`;
      localRefs.push(ref);
      await writeLocalSkill(ref);
    }
    await writeLocalSkill("meta/pdf");
    await writeMcpConfigs(["m0", "m1", "m2", "m3", "m4", "m5"]);

    await writeProfile("p3", "name: p3\ndescription: root\n");
    await writeProfile("p2", "name: p2\ndescription: p2\ninherits: p3\n");
    await writeProfile("p1", "name: p1\ndescription: p1\ninherits: p2\n");
    await writeProfile(
      "leaf",
      [
        "name: leaf",
        "description: warning fixture",
        "inherits: p1",
        "skills:",
        "  local:",
        ...localRefs.map((ref) => `    - ${ref}`),
        "    - meta/pdf",
        "  npx:",
        "    - repo: anthropics/skills",
        "      skills: [pdf]",
        "mcps: [m0, m1, m2, m3, m4, m5]",
        "",
      ].join("\n"),
    );

    const result = await lintProfile("leaf", opts());

    expect(rules(result)).toContain("W1");
    expect(rules(result)).toContain("W2");
    expect(rules(result)).toContain("W3");
    expect(rules(result)).toContain("W4");
    expect(hasLintErrors(result)).toBe(false);
  });

  test("reports E1 when two profile files declare the same name", async () => {
    await writeProfile("shared", "name: shared\ndescription: primary\n");
    await writeProfile("alias", "name: shared\ndescription: duplicate\n");

    const result = await lintProfile("shared", opts());

    expect(rules(result)).toContain("E1");
    expect(hasLintErrors(result)).toBe(true);
  });

  test("reports E2 for cyclic inheritance", async () => {
    await writeProfile("aa", "name: aa\ndescription: A\ninherits: bb\n");
    await writeProfile("bb", "name: bb\ndescription: B\ninherits: aa\n");

    const result = await lintProfile("aa", opts());

    expect(rules(result)).toContain("E2");
    expect(hasLintErrors(result)).toBe(true);
  });

  test("reports E3 for missing local, npx, plugin, and MCP references", async () => {
    await writeProfile(
      "missing",
      [
        "name: missing",
        "description: missing refs",
        "skills:",
        "  local: [meta/does-not-exist]",
        "  npx:",
        "    - repo: anthropics/skills",
        "      skills: [ghost]",
        "plugins: [not-installed@claude-plugins-official]",
        "mcps: [unknown-mcp]",
        "",
      ].join("\n"),
    );

    const result = await lintProfile(
      "missing",
      opts({
        npxFetch: async () => {
          return;
        },
      }),
    );

    const messages = result.issues.map((issue) => issue.message).join("\n");
    // Plugin-not-installed is demoted to W5 (environmental), so the three
    // genuine resolver errors stay as E3 and the plugin shows up as W5.
    expect(rules(result).filter((rule) => rule === "E3")).toHaveLength(3);
    expect(rules(result).filter((rule) => rule === "W5")).toHaveLength(1);
    expect(messages).toContain("local skill");
    expect(messages).toContain("npx skill");
    expect(messages).toContain("plugin");
    expect(messages).toContain("MCP");
    expect(hasLintErrors(result)).toBe(true);
  });

  test("offline mode skips uncached npx skills instead of erroring", async () => {
    await writeProfile(
      "npxoffline",
      [
        "name: npxoffline",
        "description: npx offline test",
        "skills:",
        "  npx:",
        "    - repo: anthropics/skills",
        "      skills: [ghost-uncached]",
        "",
      ].join("\n"),
    );

    let fetched = false;
    const trackingFetch = async () => {
      fetched = true;
    };

    // Offline (the validate default): an uncached npx skill is a benign skip,
    // not an E3, and the network fetcher is never invoked.
    const offline = await lintProfile(
      "npxoffline",
      opts({ npxOffline: true, npxFetch: trackingFetch }),
    );
    expect(fetched).toBe(false);
    expect(rules(offline).filter((rule) => rule === "E3")).toHaveLength(0);
    const npxCheck = offline.checks.find((check) => check.name === "npx skills");
    expect(npxCheck?.message).toContain("not cached (offline");
    expect(hasLintErrors(offline)).toBe(false);

    // Online (--online): the fetcher IS invoked, preserving fetchability checks.
    fetched = false;
    await lintProfile("npxoffline", opts({ npxOffline: false, npxFetch: trackingFetch }));
    expect(fetched).toBe(true);
  });
});

describe("lintAllProfiles", () => {
  test("validates every non-system profile directory", async () => {
    await writeProfile("alpha", "name: alpha\ndescription: alpha\n");
    await writeProfile("beta", "name: beta\ndescription: beta\n");
    await writeProfile("_examples", "name: skipped\ndescription: skipped\n");

    const results = await lintAllProfiles(opts());

    expect(results.map((result) => result.profileName)).toEqual(["alpha", "beta"]);
  });
});

// ---------------------------------------------------------------------------
// W11: recommends/conflicts collision
// ---------------------------------------------------------------------------
describe("W11 recommends/conflicts collision", () => {
  test("emits W11 when a slug appears in both recommends and conflicts", async () => {
    await writeProfile(
      "clash",
      [
        "name: clash",
        "description: collision fixture",
        "recommends: [partner, rival]",
        "conflicts: [rival]",
        "",
      ].join("\n"),
    );

    const result = await lintProfile("clash", opts());

    expect(rules(result)).toContain("W11");
    const issue = result.issues.find((i) => i.rule === "W11");
    expect(issue?.subject).toBe("rival");
    // 'partner' is in recommends but not in conflicts — no W11 for it
    expect(result.issues.filter((i) => i.rule === "W11")).toHaveLength(1);
    expect(hasLintErrors(result)).toBe(false);
  });

  test("does not emit W11 when recommends and conflicts are disjoint", async () => {
    await writeProfile(
      "clean",
      [
        "name: clean",
        "description: no collision",
        "recommends: [partner]",
        "conflicts: [rival]",
        "",
      ].join("\n"),
    );

    const result = await lintProfile("clean", opts());

    expect(rules(result)).not.toContain("W11");
  });
});

// ---------------------------------------------------------------------------
// W12: duplicate skill slug within the same list
// ---------------------------------------------------------------------------
describe("W12 duplicate skill slug in same list", () => {
  test("emits W12 for a skill listed twice in skills.local", async () => {
    await writeLocalSkill("design/image-to-code");
    await writeLocalSkill("design/minimalist-ui");
    await writeProfile(
      "dupes",
      [
        "name: dupes",
        "description: duplicate local skills",
        "skills:",
        "  local:",
        "    - design/image-to-code",
        "    - design/minimalist-ui",
        "    - design/image-to-code",
        "",
      ].join("\n"),
    );

    const result = await lintProfile("dupes", opts());

    expect(rules(result)).toContain("W12");
    const w12 = result.issues.filter((i) => i.rule === "W12");
    expect(w12).toHaveLength(1);
    expect(w12[0]?.subject).toBe("design/image-to-code");
    expect(hasLintErrors(result)).toBe(false);
  });

  test("does not emit W12 when each local skill slug is unique", async () => {
    await writeLocalSkill("design/image-to-code");
    await writeLocalSkill("design/minimalist-ui");
    await writeProfile(
      "uniq",
      [
        "name: uniq",
        "description: unique local skills",
        "skills:",
        "  local:",
        "    - design/image-to-code",
        "    - design/minimalist-ui",
        "",
      ].join("\n"),
    );

    const result = await lintProfile("uniq", opts());

    expect(rules(result)).not.toContain("W12");
  });

  test("duplicates do not inflate the skill count toward W1", async () => {
    // Create just enough unique skills so that counting duplicates would push
    // past 120, while unique count stays under it.
    const localRefs: string[] = [];
    for (let i = 0; i < 60; i++) {
      const ref = `bulk/skill-${i}`;
      localRefs.push(ref);
      await writeLocalSkill(ref);
    }
    // Duplicate each one — raw count would be 120, but unique count is 60.
    const dupeRefs = [...localRefs, ...localRefs];

    await writeProfile(
      "nodupe-w1",
      [
        "name: nodupe-w1",
        "description: duplicates should not trigger W1",
        "skills:",
        "  local:",
        ...dupeRefs.map((r) => `    - ${r}`),
        "",
      ].join("\n"),
    );

    const result = await lintProfile("nodupe-w1", opts());

    expect(rules(result)).not.toContain("W1");
    // The 60 duplicates each produce a W12
    expect(rules(result).filter((r) => r === "W12")).toHaveLength(60);
  });
});

// ---------------------------------------------------------------------------
// checkResourceRefs: opts isolation (finding: _opts was silently ignored)
// ---------------------------------------------------------------------------
describe("checkResourceRefs: opts-rooted resource validation", () => {
  async function writeResourceFile(subDir: string, name: string): Promise<void> {
    const dir = join(root, subDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), `# ${name}\n`, "utf8");
  }

  test("resolves a playbook ref when playbooksRoot points at a fixture dir", async () => {
    await writeResourceFile("playbooks", "ship-feature.md");
    await writeProfile(
      "pb",
      "name: pb\ndescription: playbook test\nplaybooks: [ship-feature]\n",
    );

    const result = await lintProfile("pb", opts({ playbooksRoot: join(root, "playbooks") }));

    expect(rules(result)).not.toContain("E3");
    const check = result.checks.find((c) => c.name === "playbooks");
    expect(check?.message).toBe("1 resolved");
  });

  test("reports E3 for a missing playbook ref", async () => {
    await writeProfile(
      "pbmiss",
      "name: pbmiss\ndescription: missing playbook\nplaybooks: [nonexistent]\n",
    );

    const result = await lintProfile("pbmiss", opts({ playbooksRoot: join(root, "playbooks-empty") }));

    expect(rules(result)).toContain("E3");
  });

  test("resolves a qualityGate ref (.sh extension) using qualityGatesRoot", async () => {
    await writeResourceFile("quality-gates", "tests-pass.sh");
    await writeProfile(
      "qg",
      "name: qg\ndescription: quality gate test\nqualityGates: [tests-pass]\n",
    );

    const result = await lintProfile("qg", opts({ qualityGatesRoot: join(root, "quality-gates") }));

    expect(rules(result)).not.toContain("E3");
    const check = result.checks.find((c) => c.name === "qualityGates");
    expect(check?.message).toBe("1 resolved");
  });

  test("resolves a persona_includes ref using personasRoot", async () => {
    await writeResourceFile("personas", "integrity-protocol.md");
    await writeProfile(
      "pi",
      "name: pi\ndescription: persona includes test\npersona_includes: [integrity-protocol]\n",
    );

    const result = await lintProfile("pi", opts({ personasRoot: join(root, "personas") }));

    expect(rules(result)).not.toContain("E3");
    const check = result.checks.find((c) => c.name === "persona_includes");
    expect(check?.message).toBe("1 resolved");
  });

  test("resolves an evals ref using evalsRoot", async () => {
    await writeResourceFile("evals", "skill-writing.md");
    await writeProfile(
      "ev",
      "name: ev\ndescription: evals test\nevals: [skill-writing]\n",
    );

    const result = await lintProfile("ev", opts({ evalsRoot: join(root, "evals") }));

    expect(rules(result)).not.toContain("E3");
    const check = result.checks.find((c) => c.name === "evals");
    expect(check?.message).toBe("1 resolved");
  });

  test("resolves rules ref using rulesRoot fixture", async () => {
    await writeResourceFile("rules", "no-eval.md");
    await writeProfile(
      "rl",
      "name: rl\ndescription: rules test\nrules: [no-eval]\n",
    );

    const result = await lintProfile("rl", opts({ rulesRoot: join(root, "rules") }));

    expect(rules(result)).not.toContain("E3");
  });
});
