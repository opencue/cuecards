import { describe, expect, test } from "bun:test";
import { filterPublicProfiles, profilePublicSkills, projectPublicProfile, publicAasCommit, publicAasRepo, readPublicAasSkillIds } from "./public-profiles";

const builder = {
  id: "builder", description: "Build across stacks.", icon: "🔧", extends: [], publicSkillIds: [], aasSkillIds: [],
};
const api = {
  id: "aas-backend-api-design", description: "REST and GraphQL contracts.", icon: "📚", extends: ["backend"], publicSkillIds: ["review/api-tester"], aasSkillIds: [],
};
const publicSkillIds = new Set(api.publicSkillIds);

describe("public profile roster", () => {
  test("projects public metadata without exposing prompts or tool configs", () => {
    expect(projectPublicProfile("aas-backend-api-design", {
      name: "aas-backend-api-design", description: "REST and\n GraphQL contracts.", icon: "📚",
      inherits: "backend", persona: "not exported", mcps: [{ secret: true }],
      skills: { local: ["review/api-tester", "private/hidden", "other/not-published", { path: "/tmp/local" }] },
    }, publicSkillIds)).toEqual(api);
    expect(projectPublicProfile("builder", { name: "builder", description: builder.description, icon: builder.icon }, publicSkillIds)).toEqual(builder);
    expect(() => projectPublicProfile("; pwd", {}, publicSkillIds)).toThrow();
    expect(() => projectPublicProfile("builder", { name: "different" }, publicSkillIds)).toThrow();
  });

  test("separates public skills from transitive parents, deduplicating shared and direct skills", () => {
    const parent = { ...builder, id: "backend", extends: ["core"], publicSkillIds: ["review/api-tester", "github/github"] };
    const core = { ...builder, id: "core", extends: ["backend"], publicSkillIds: ["github/github", "meta/cue-usage"] };
    const { direct, inherited } = profilePublicSkills(api, [api, parent, core]);
    expect(direct.map(skill => skill.label)).toEqual(["review/api-tester"]);
    expect(inherited.map(skill => skill.label)).toEqual(["github/github", "meta/cue-usage"]);
    expect(direct[0]?.href).toBe("https://github.com/opencue/skills/tree/main/skills/review/api-tester");
  });

  test("exposes only indexed AAS paths from the one reviewed repo and immutable pin", () => {
    const index = readPublicAasSkillIds([
      { id: "c4-context", path: "skills/c4-context" },
      { id: "wrong-path", path: "skills/../private/wrong-path" },
      { id: "unrelated", path: "skills/unrelated" },
    ]);
    const profile = projectPublicProfile("architect", {
      name: "architect",
      skills: { npx: [
        { repo: publicAasRepo, pin: `git@${publicAasCommit}`, skills: ["c4-context", "wrong-path", "unindexed"] },
        { repo: publicAasRepo, pin: "main", skills: ["unrelated"] },
        { repo: "other/repo", pin: `git@${publicAasCommit}`, skills: ["unrelated"] },
      ] },
    }, publicSkillIds, index);
    expect(profile.aasSkillIds).toEqual(["c4-context"]);
    expect(profilePublicSkills(profile, [profile]).direct[0]?.href)
      .toBe(`https://github.com/${publicAasRepo}/tree/${publicAasCommit}/skills/c4-context`);
  });

  test("searches profile IDs, purpose, parent, and character names", () => {
    const all = [builder, api];
    expect(filterPublicProfiles(all, "graphql backend", "all")).toEqual([api]);
    expect(filterPublicProfiles(all, "the builder", "featured")).toEqual([builder]);
    expect(filterPublicProfiles(all, "", "extensions")).toEqual([api]);
    expect(filterPublicProfiles(all, "", "bundled")).toEqual([builder]);
  });

  test("curated tasks narrow the full roster and compose with search and profile type", () => {
    const all = [builder, api];
    expect(filterPublicProfiles(all, "", "all")).toEqual(all);
    expect(filterPublicProfiles(all, "", "all", "build")).toEqual(all);
    expect(filterPublicProfiles(all, "graphql", "extensions", "build")).toEqual([api]);
    expect(filterPublicProfiles(all, "graphql", "bundled", "build")).toEqual([]);
    expect(filterPublicProfiles(all, "", "all", "ship")).toEqual([]);
  });
});
