import { describe, expect, test } from "bun:test";
import { getCliIcon, getMcpIcon, getRepoIcon, getSkillIcon } from "./brand-icons";

// ---------------------------------------------------------------------------
// getSkillIcon
// ---------------------------------------------------------------------------

describe("getSkillIcon", () => {
  test("returns null for an entirely unknown skill slug", () => {
    expect(getSkillIcon("totally-unknown-skill-xyz-no-match")).toBeNull();
  });

  test("returns an absolute path for 'coolify' (maps to _icons/coolify-brand.png)", () => {
    const p = getSkillIcon("coolify");
    // The icon file ships with the repo; if it exists we get a string path.
    // If someone deletes the file the test gracefully fails rather than throwing.
    expect(p).not.toBeNull();
    expect(typeof p).toBe("string");
    expect(p!.endsWith("coolify-brand.png")).toBe(true);
  });

  test("returns an absolute path for 'github' (maps to _icons/github.png)", () => {
    const p = getSkillIcon("github");
    expect(p).not.toBeNull();
    expect(p!.endsWith("github.png")).toBe(true);
  });

  test("returns null for a slug that is NOT in the brand map and has no assets dir", () => {
    // Pick a slug that is plausible but not in any mapping.
    expect(getSkillIcon("fictional-tool-no-assets")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getMcpIcon
// ---------------------------------------------------------------------------

describe("getMcpIcon", () => {
  test("returns null for an entirely unknown MCP id", () => {
    expect(getMcpIcon("totally-unknown-mcp-xyz-no-match")).toBeNull();
  });

  test("returns an absolute path for 'coolify' (maps to resources/icons/coolify-brand.png)", () => {
    const p = getMcpIcon("coolify");
    expect(p).not.toBeNull();
    expect(typeof p).toBe("string");
    expect(p!.endsWith("coolify-brand.png")).toBe(true);
  });

  test("returns an absolute path for 'medusadocs' (maps to resources/icons/medusa.png)", () => {
    const p = getMcpIcon("medusadocs");
    expect(p).not.toBeNull();
    expect(p!.endsWith("medusa.png")).toBe(true);
  });

  test("returns an absolute path for 'obsidian-vault' (maps to resources/icons/obsidian.png)", () => {
    const p = getMcpIcon("obsidian-vault");
    expect(p).not.toBeNull();
    expect(p!.endsWith("obsidian.png")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getRepoIcon
// ---------------------------------------------------------------------------

describe("getRepoIcon", () => {
  test("returns null for an org that has no icon file", () => {
    expect(getRepoIcon("totally-unknown-org-xyz/some-repo")).toBeNull();
  });

  test("extracts the org from 'org/repo' format and finds docker.png", () => {
    const p = getRepoIcon("docker/compose");
    // docker.png ships with the repo
    expect(p).not.toBeNull();
    expect(p!.endsWith("docker.png")).toBe(true);
  });

  test("works when no slash is present (org only)", () => {
    // getRepoIcon("docker") → org = "docker" → should find docker.png
    const p = getRepoIcon("docker");
    expect(p).not.toBeNull();
    expect(p!.endsWith("docker.png")).toBe(true);
  });

  test("returns null for an org-only string with no matching icon", () => {
    expect(getRepoIcon("completely-unknown-org-xyz")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCliIcon
// ---------------------------------------------------------------------------

describe("getCliIcon", () => {
  test("returns null for a CLI tool not in the map", () => {
    expect(getCliIcon("completely-unknown-cli-xyz")).toBeNull();
  });

  test("returns an absolute path for 'python' (python.png ships with repo)", () => {
    const p = getCliIcon("python");
    expect(p).not.toBeNull();
    expect(p!.endsWith("python.png")).toBe(true);
  });

  test("returns an absolute path for 'docker' (docker.png ships with repo)", () => {
    const p = getCliIcon("docker");
    expect(p).not.toBeNull();
    expect(p!.endsWith("docker.png")).toBe(true);
  });

  test("returns an absolute path for 'cargo' (maps to rust.png)", () => {
    const p = getCliIcon("cargo");
    expect(p).not.toBeNull();
    expect(p!.endsWith("rust.png")).toBe(true);
  });

  test("aliases pip → python.png", () => {
    const p = getCliIcon("pip");
    expect(p).not.toBeNull();
    expect(p!.endsWith("python.png")).toBe(true);
  });

  test("aliases npm → nodejs.png", () => {
    const p = getCliIcon("npm");
    expect(p).not.toBeNull();
    expect(p!.endsWith("nodejs.png")).toBe(true);
  });
});
