import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  GENERATED_AAS_PROFILE_MARKER,
  parseAasCatalog,
  parseAasTaxonomy,
  planAasCatalog,
  planAasProfiles,
  writeAasProfiles,
  type AasSkill,
} from "./aas-profile-organizer";

function skill(
  id: string,
  category: string,
  tags: string[] = [],
  risk: AasSkill["risk"] = "safe",
): AasSkill {
  return {
    id,
    name: id,
    description: `${id} guidance`,
    category,
    path: `skills/${id}`,
    risk,
    tags,
  };
}

describe("AAS profile organizer", () => {
  test("validates the declarative taxonomy boundary", () => {
    const general = {
      id: "general",
      inherits: "core",
      summary: "Fallback domain",
      categories: [],
      keywords: [],
    };

    expect(parseAasTaxonomy({ version: 1, domains: [general] })).toEqual([general]);
    expect(() => parseAasTaxonomy({
      version: 1,
      domains: [
        general,
        { ...general, id: "one", categories: ["shared"] },
        { ...general, id: "two", categories: ["shared"] },
      ],
    })).toThrow("belongs to more than one domain");
  });

  test("validates catalog entries at the boundary", () => {
    const parsed = parseAasCatalog([
      {
        id: "typescript",
        name: "TypeScript",
        description: "Typed TypeScript guidance",
        category: "super-code",
        path: "skills/typescript",
        risk: "safe",
        tags: ["typescript"],
      },
      {
        id: "path-traversal",
        path: "../outside",
        risk: "safe",
      },
      {
        id: "unknown-risk",
        path: "skills/unknown-risk",
        risk: "mystery",
      },
    ]);

    expect(parsed.invalidEntries).toBe(2);
    expect(parsed.skills).toEqual([
      expect.objectContaining({ id: "typescript", risk: "safe" }),
    ]);
  });

  test("assigns every eligible skill once and excludes unsafe catalog entries", () => {
    const plans = planAasProfiles([
      skill("fastapi-api", "backend", ["fastapi", "api"]),
      skill("react-ui", "frontend", ["react", "ui"], "none"),
      skill("postgres-tuning", "database", ["postgres", "sql"]),
      skill("unsafe-exploit", "security", ["exploit"], "offensive"),
      skill("credential-dumper", "security", ["credentials"], "critical"),
    ]);
    const assigned = plans.flatMap((plan) => plan.skills.map((entry) => entry.id));

    expect(assigned.sort()).toEqual(["fastapi-api", "postgres-tuning", "react-ui"]);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect(plans.find((plan) => plan.name === "aas-backend")?.inherits).toBe("backend");
    expect(plans.find((plan) => plan.name === "aas-frontend")?.inherits).toBe("frontend");
    expect(plans.find((plan) => plan.name === "aas-database")?.inherits).toBe("postgres");
  });

  test("audits every assignment and quarantines ambiguous or unmatched skills", () => {
    const organization = planAasCatalog([
      skill("fastapi-api", "backend", ["fastapi", "api"]),
      skill("browser-security", "uncategorized", ["browser", "security"]),
      skill("mystery-thing", "uncategorized"),
    ]);

    expect(organization.assignments).toHaveLength(3);
    expect(organization.assignments.find((entry) => entry.skillId === "fastapi-api"))
      .toEqual(expect.objectContaining({
        profileName: "aas-backend",
        group: "backend",
        method: "category",
        confidence: "high",
        reviewRequired: false,
      }));
    expect(organization.assignments.find((entry) => entry.skillId === "browser-security"))
      .toEqual(expect.objectContaining({
        group: "review",
        method: "ambiguous",
        confidence: "low",
        margin: 0,
        reviewRequired: true,
      }));
    expect(organization.assignments.find((entry) => entry.skillId === "mystery-thing"))
      .toEqual(expect.objectContaining({
        group: "review",
        method: "fallback",
        confidence: "low",
        reviewRequired: true,
      }));
    expect(organization.profiles.some((plan) => plan.catalog.reviewRequired === true)).toBe(true);
  });

  test("balances split profiles instead of creating a tiny tail chunk", () => {
    const plans = planAasProfiles(
      Array.from({ length: 25 }, (_, index) =>
        skill(`postgres-tool-${index}`, "database", ["postgres", "sql"])),
    );

    expect(plans.map((plan) => plan.skills.length)).toEqual([13, 12]);
    expect(plans.every((plan) => plan.skills.length >= 6)).toBe(true);
  });

  test("flags exact long-description duplicates as possible variants without dropping them", () => {
    const description = "Shared vendor-neutral workflow description long enough for conservative duplicate detection.";
    const first = { ...skill("alpha-tool", "backend"), description };
    const second = { ...skill("beta-tool", "backend"), description };
    const organization = planAasCatalog([first, second]);

    expect(organization.possibleVariantGroups).toEqual([{
      canonicalSkillId: "alpha-tool",
      variantSkillIds: ["beta-tool"],
    }]);
    expect(organization.assignments).toHaveLength(2);
  });

  test("splits broad domains into named capability profiles", () => {
    const skills = [
      ...Array.from({ length: 8 }, (_, index) =>
        skill(`minimal-ui-${index}`, "design-it", ["minimalism", "typography"])),
      ...Array.from({ length: 8 }, (_, index) =>
        skill(`cyber-ui-${index}`, "design-it", ["cyberpunk", "retro"])),
      ...Array.from({ length: 8 }, (_, index) =>
        skill(`spatial-ui-${index}`, "design-it", ["spatial", "3d"])),
      ...Array.from({ length: 5 }, (_, index) =>
        skill(`accessibility-audit-${index}`, "design", ["accessibility", "audit"])),
    ];

    const plans = planAasProfiles(skills);

    expect(plans.map((plan) => plan.name)).toEqual([
      "aas-design-depth-spatial",
      "aas-design-expressive-retro",
      "aas-design-minimal-editorial",
      "aas-design-systems-quality",
    ]);
    expect(plans.every((plan) => plan.skills.length <= 24)).toBe(true);
    expect(plans.every((plan) => plan.description.length <= 200)).toBe(true);
    expect(plans.every((plan) => !/Catalog-organized|Generated by cue|part \d/i.test(plan.description)))
      .toBe(true);
    expect(plans.find((plan) => plan.name === "aas-design-systems-quality")?.description)
      .toContain("accessibility");
  });

  test("writes pinned profiles and only refreshes files owned by the generator", () => {
    const root = mkdtempSync(join(tmpdir(), "cue-aas-profiles-"));
    try {
      const plans = planAasProfiles([
        skill("fastapi-api", "backend", ["fastapi", "api"]),
      ]);
      const revision = "0123456789abcdef0123456789abcdef01234567";
      const first = writeAasProfiles(plans, {
        profilesDir: root,
        sourceRevision: revision,
      });
      const yamlPath = join(root, "aas-backend", "profile.yaml");
      const written = parseYaml(readFileSync(yamlPath, "utf8")) as any;

      expect(first).toEqual({ created: ["aas-backend"], updated: [], removed: [], skipped: [] });
      expect(readFileSync(yamlPath, "utf8")).toStartWith(GENERATED_AAS_PROFILE_MARKER);
      expect(written.kind).toBe("overlay");
      expect(written.description).toContain("API");
      expect(written.description).not.toContain("Generated by cue");
      expect(written.kind).toBe("overlay");
      expect(written.catalog).toEqual({
        source: "agentic-awesome-skills",
        group: "backend",
        capability: "general",
        generated: true,
        discoverability: "search",
      });
      expect(written.skills.npx).toEqual([{
        repo: "sickn33/agentic-awesome-skills",
        pin: `git@${revision}`,
        skills: ["fastapi-api"],
      }]);

      writeFileSync(yamlPath, "name: aas-backend\ndescription: hand-written\n");
      const second = writeAasProfiles(plans, {
        profilesDir: root,
        sourceRevision: revision,
      });
      expect(second.skipped).toEqual(["aas-backend"]);
      expect(readFileSync(yamlPath, "utf8")).toContain("hand-written");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prunes stale generator-owned profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "cue-aas-prune-"));
    try {
      const revision = "0123456789abcdef0123456789abcdef01234567";
      const plans = planAasProfiles([
        skill("fastapi-api", "backend", ["fastapi", "api"]),
      ]);
      writeAasProfiles(plans, { profilesDir: root, sourceRevision: revision });

      const result = writeAasProfiles([], {
        profilesDir: root,
        sourceRevision: revision,
        pruneStaleGenerated: true,
      });

      expect(result.removed).toEqual(["aas-backend"]);
      expect(() => readFileSync(join(root, "aas-backend", "profile.yaml"), "utf8")).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
