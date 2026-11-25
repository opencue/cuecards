import { describe, expect, test } from "bun:test";
import { filterPublicProfiles, projectPublicProfile } from "./public-profiles";

const builder = {
  id: "builder", description: "Build across stacks.", icon: "🔧", extends: [],
};
const api = {
  id: "aas-backend-api-design", description: "REST and GraphQL contracts.", icon: "📚", extends: ["backend"],
};

describe("public profile roster", () => {
  test("projects public metadata without exposing prompts or tool configs", () => {
    expect(projectPublicProfile("aas-backend-api-design", {
      name: "aas-backend-api-design", description: "REST and\n GraphQL contracts.", icon: "📚",
      inherits: "backend", persona: "not exported", mcps: [{ secret: true }],
    })).toEqual(api);
    expect(projectPublicProfile("builder", { name: "builder", description: builder.description, icon: builder.icon })).toEqual(builder);
    expect(() => projectPublicProfile("; pwd", {})).toThrow();
    expect(() => projectPublicProfile("builder", { name: "different" })).toThrow();
  });

  test("searches profile IDs, purpose, parent, and character names", () => {
    const all = [builder, api];
    expect(filterPublicProfiles(all, "graphql backend", "all")).toEqual([api]);
    expect(filterPublicProfiles(all, "the builder", "featured")).toEqual([builder]);
    expect(filterPublicProfiles(all, "", "extensions")).toEqual([api]);
    expect(filterPublicProfiles(all, "", "bundled")).toEqual([builder]);
  });
});
