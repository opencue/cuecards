import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProfile } from "./profile-loader";
import {
  ProfileAlreadyExists,
  assignDomain,
  bucketSkills,
  generateProfile,
  scanInstalledSkills,
  tokenize,
  writeGeneratedProfile,
  type DiscoveredSkill,
} from "./profile-generator";

let scratchRoot: string;
let profilesRoot: string;
let priorProfilesDir: string | undefined;

beforeEach(async () => {
  scratchRoot = await mkdtemp(join(tmpdir(), "soul-profile-generator-"));
  profilesRoot = join(scratchRoot, "profiles");
  priorProfilesDir = process.env.SOUL_PROFILES_DIR;
  process.env.SOUL_PROFILES_DIR = profilesRoot;
});

afterEach(async () => {
  if (priorProfilesDir === undefined) {
    delete process.env.SOUL_PROFILES_DIR;
  } else {
    process.env.SOUL_PROFILES_DIR = priorProfilesDir;
  }
  await rm(scratchRoot, { recursive: true, force: true });
});

describe("profile-generator heuristic", () => {
  test("tokenize normalizes descriptions into unique lower-case tokens", () => {
    expect(tokenize("API-route, API route; Storefront!")).toEqual([
      "api",
      "route",
      "storefront",
    ]);
  });

  test("assignDomain buckets obvious frontend and backend skills", () => {
    const frontend = makeSkill(
      "local",
      "building-storefronts",
      "Build React storefront UI with a Vite web frontend.",
      "medusa/building-storefronts",
    );
    const backend = makeSkill(
      "local",
      "stripe-webhooks",
      "Implement backend API route webhooks and auth.",
      "stripe/stripe-webhooks",
    );

    expect(assignDomain(frontend).domain).toBe("frontend");
    expect(assignDomain(backend).domain).toBe("backend");
  });

  test("cross-cutting commit and lint skills are marked core", () => {
    const skill = makeSkill(
      "local",
      "caveman-commit",
      "Write commit messages and lint staged files.",
      "caveman/caveman-commit",
    );

    const assignment = assignDomain(skill);

    expect(assignment.domain).toBe("core");
    expect(assignment.crossCutting).toBe(true);
  });
});

describe("generateProfile", () => {
  test("writes schema-valid YAML and excludes core skills as base candidates", async () => {
    const skills: DiscoveredSkill[] = [
      makeSkill(
        "local",
        "building-storefronts",
        "Build React storefront UI.",
        "medusa/building-storefronts",
      ),
      makeSkill(
        "local",
        "caveman-commit",
        "Write commit messages for changed files.",
        "caveman/caveman-commit",
      ),
      {
        origin: "npx",
        name: "pdf",
        description: "Parse PDF docs and render pages.",
        repo: "anthropics/skills",
        sourceKind: "npx",
      },
      {
        origin: "plugin",
        name: "mem-search",
        description: "Create frontend UI snippets.",
        plugin: "claude-mem",
        pluginStatus: "enabled",
      },
      {
        origin: "plugin",
        name: "disabled-helper",
        description: "Create frontend UI snippets.",
        plugin: "disabled-plugin",
        pluginStatus: "disabled",
      },
    ];

    const generated = generateProfile({
      name: "test-gen",
      assignments: bucketSkills(skills),
    });
    const path = await writeGeneratedProfile(generated);

    const text = await readFile(path, "utf8");
    expect(text).toContain("# core: caveman/caveman-commit");
    expect(text).toContain("medusa/building-storefronts");
    expect(text).toContain("anthropics/skills");
    expect(text).toContain("claude-mem");

    const resolved = await loadProfile("test-gen");
    expect(resolved.name).toBe("test-gen");
    // Resolved form normalizes string refs to { id } objects.
    expect(resolved.skills.local).toEqual([{ id: "medusa/building-storefronts" }]);
    expect(resolved.skills.npx).toEqual([
      { repo: "anthropics/skills", skills: ["pdf"] },
    ]);
    // Plugins move to top-level with @<marketplace> qualifier.
    expect(resolved.plugins).toEqual([{ id: "claude-mem@claude-plugins-official" }]);
  });

  test("does not overwrite an existing profile unless force is set", async () => {
    const generated = generateProfile({
      name: "existing",
      assignments: [],
    });
    await writeGeneratedProfile(generated);

    let caught: unknown;
    try {
      await writeGeneratedProfile(generated);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProfileAlreadyExists);
    await writeGeneratedProfile(generated, { force: true });
  });
});

describe("scanInstalledSkills fallback", () => {
  test("scans local skills and npx _source metadata from fixture roots", async () => {
    const localRoot = join(scratchRoot, "skills", "skills");
    const npxRoot = join(scratchRoot, "claude-skills");
    await writeSkill(
      join(localRoot, "medusa", "building-with-medusa"),
      "building-with-medusa",
      "Medusa backend API route workflow.",
    );
    await writeSkill(
      join(npxRoot, "pdf"),
      "pdf",
      "PDF document rendering.",
      "anthropics/skills",
    );

    const scan = await scanInstalledSkills({
      skillsRoot: localRoot,
      npxRoots: [npxRoot],
      pluginsRoot: join(scratchRoot, "plugins"),
      claudeConfigPath: join(scratchRoot, ".claude.json"),
    });

    expect(scan.skills.map((skill) => skill.name).sort()).toEqual([
      "building-with-medusa",
      "pdf",
    ]);
    expect(scan.skills.find((skill) => skill.name === "pdf")?.repo).toBe(
      "anthropics/skills",
    );
  });
});

function makeSkill(
  origin: "local",
  name: string,
  description: string,
  localRef: string,
): DiscoveredSkill;
function makeSkill(
  origin: "local" | "npx" | "plugin",
  name: string,
  description: string,
  localRef?: string,
): DiscoveredSkill {
  return {
    origin,
    name,
    description,
    localRef,
  };
}

async function writeSkill(
  dir: string,
  name: string,
  description: string,
  source?: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const sourceLine = source ? `_source: ${source}\n` : "";
  await writeFile(
    join(dir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      sourceLine.trimEnd(),
      "---",
      "",
      `# ${name}`,
      "",
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
    "utf8",
  );
}
