/**
 * Tests for the repo provenance matcher — the pure logic behind the studio
 * Profiles "Repos" tab. No network: only `reposForProfile` (the catalog filter)
 * is exercised; the live star fetch is integration-tested via the live endpoint.
 */

import { describe, expect, test } from "bun:test";

import { reposForProfile, REPO_CATALOG } from "./repos";

const slugs = (rs: { repo: string }[]) => rs.map((r) => r.repo).sort();

describe("reposForProfile", () => {
  test("matches a repo by a namespace the profile has", () => {
    const got = reposForProfile({ namespaces: ["meta"], mcpIds: [], pluginIds: [] });
    expect(slugs(got)).toContain("opencue/cuecards");
  });

  test("matches a repo by an MCP id the profile connects", () => {
    const got = reposForProfile({ namespaces: [], mcpIds: ["lightpanda"], pluginIds: [] });
    expect(slugs(got)).toEqual(["lightpanda-io/browser"]);
  });

  test("matches a plugin by its bare name, ignoring the @marketplace suffix", () => {
    const got = reposForProfile({ namespaces: [], mcpIds: [], pluginIds: ["claude-mem@thedotmack"] });
    expect(slugs(got)).toEqual(["thedotmack/claude-mem"]);
  });

  test("npx skills map to the anthropics/skills bundle", () => {
    const got = reposForProfile({ namespaces: ["npx"], mcpIds: [], pluginIds: [] });
    expect(slugs(got)).toContain("anthropics/skills");
  });

  test("profile-specific MCPs/plugins map to their upstream repos", () => {
    // The coolify MCP → the real Coolify repo (the user's pointed-at case).
    expect(slugs(reposForProfile({ namespaces: [], mcpIds: ["coolify"], pluginIds: [] }))).toEqual(["coollabsio/coolify"]);
    expect(slugs(reposForProfile({ namespaces: [], mcpIds: ["supabase"], pluginIds: [] }))).toEqual(["supabase/supabase"]);
    expect(slugs(reposForProfile({ namespaces: [], mcpIds: [], pluginIds: ["vercel@claude-plugins-official"] }))).toEqual(["vercel/vercel"]);
  });

  test("returns nothing for a profile that contains none of the catalog's sources", () => {
    const got = reposForProfile({ namespaces: ["nonexistent-ns"], mcpIds: ["nope"], pluginIds: ["nope@x"] });
    expect(got).toHaveLength(0);
  });

  test("dedupes — a repo matched by both ns and mcp appears once", () => {
    const got = reposForProfile({ namespaces: ["browser"], mcpIds: ["lightpanda"], pluginIds: [] });
    expect(got.filter((r) => r.repo === "lightpanda-io/browser")).toHaveLength(1);
  });

  test("every catalog repo is a real owner/name slug (no spaces, exactly one slash)", () => {
    for (const r of REPO_CATALOG) {
      expect(r.repo).toMatch(/^[^/\s]+\/[^/\s]+$/);
      expect(r.kinds.length).toBeGreaterThan(0);
    }
  });
});
