import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanProject } from "./project-scanner";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-scanner-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function touch(rel: string): void {
  const full = join(tmpDir, rel);
  mkdirSync(join(tmpDir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
  writeFileSync(full, "");
}

describe("scanProject — empty directory", () => {
  test("returns empty arrays and false flags", () => {
    const info = scanProject(tmpDir);
    expect(info.languages).toEqual([]);
    expect(info.frameworks).toEqual([]);
    expect(info.tools).toEqual([]);
    expect(info.hasTests).toBe(false);
    expect(info.hasDocker).toBe(false);
    expect(info.hasCI).toBe(false);
  });
});

describe("scanProject — language detection", () => {
  test("detects TypeScript via tsconfig.json", () => {
    touch("tsconfig.json");
    expect(scanProject(tmpDir).languages).toContain("TypeScript");
  });

  test("detects TypeScript via package.json", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({}));
    expect(scanProject(tmpDir).languages).toContain("TypeScript");
  });

  test("detects Python via pyproject.toml", () => {
    touch("pyproject.toml");
    expect(scanProject(tmpDir).languages).toContain("Python");
  });

  test("detects Python via setup.py", () => {
    touch("setup.py");
    expect(scanProject(tmpDir).languages).toContain("Python");
  });

  test("detects Go via go.mod", () => {
    touch("go.mod");
    expect(scanProject(tmpDir).languages).toContain("Go");
  });

  test("detects Rust via Cargo.toml", () => {
    touch("Cargo.toml");
    expect(scanProject(tmpDir).languages).toContain("Rust");
  });

  test("detects Java via pom.xml", () => {
    touch("pom.xml");
    expect(scanProject(tmpDir).languages).toContain("Java");
  });

  test("detects Java via build.gradle", () => {
    touch("build.gradle");
    expect(scanProject(tmpDir).languages).toContain("Java");
  });

  test("does not duplicate TypeScript when both tsconfig.json and package.json present", () => {
    touch("tsconfig.json");
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({}));
    const langs = scanProject(tmpDir).languages;
    expect(langs.filter((l) => l === "TypeScript").length).toBe(1);
  });
});

describe("scanProject — framework detection", () => {
  test("detects Next.js via next.config.js", () => {
    touch("next.config.js");
    expect(scanProject(tmpDir).frameworks).toContain("Next.js");
  });

  test("detects Next.js via next.config.mjs", () => {
    touch("next.config.mjs");
    expect(scanProject(tmpDir).frameworks).toContain("Next.js");
  });

  test("detects Vite via vite.config.ts", () => {
    touch("vite.config.ts");
    expect(scanProject(tmpDir).frameworks).toContain("Vite");
  });

  test("detects Astro via astro.config.mjs", () => {
    touch("astro.config.mjs");
    expect(scanProject(tmpDir).frameworks).toContain("Astro");
  });

  test("detects Medusa via medusa-config.js", () => {
    touch("medusa-config.js");
    expect(scanProject(tmpDir).frameworks).toContain("Medusa");
  });

  test("detects Prisma via prisma/schema.prisma", () => {
    touch("prisma/schema.prisma");
    expect(scanProject(tmpDir).frameworks).toContain("Prisma");
  });

  test("detects Drizzle via drizzle.config.ts", () => {
    touch("drizzle.config.ts");
    expect(scanProject(tmpDir).frameworks).toContain("Drizzle");
  });

  test("detects React from package.json dependencies", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ dependencies: { react: "^18" } }));
    expect(scanProject(tmpDir).frameworks).toContain("React");
  });

  test("detects Vue from package.json", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ dependencies: { vue: "^3" } }));
    expect(scanProject(tmpDir).frameworks).toContain("Vue");
  });

  test("detects Svelte from package.json", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { svelte: "^4" } }));
    expect(scanProject(tmpDir).frameworks).toContain("Svelte");
  });

  test("detects Node Server from express", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ dependencies: { express: "^4" } }));
    expect(scanProject(tmpDir).frameworks).toContain("Node Server");
  });

  test("detects Node Server from fastify", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ dependencies: { fastify: "^4" } }));
    expect(scanProject(tmpDir).frameworks).toContain("Node Server");
  });
});

describe("scanProject — tool detection", () => {
  test("detects Tailwind via tailwind.config.js", () => {
    touch("tailwind.config.js");
    expect(scanProject(tmpDir).tools).toContain("Tailwind");
  });

  test("detects Tailwind via tailwind.config.ts", () => {
    touch("tailwind.config.ts");
    expect(scanProject(tmpDir).tools).toContain("Tailwind");
  });

  test("detects ESLint via .eslintrc.js", () => {
    touch(".eslintrc.js");
    expect(scanProject(tmpDir).tools).toContain("ESLint");
  });

  test("detects ESLint via eslint.config.js", () => {
    touch("eslint.config.js");
    expect(scanProject(tmpDir).tools).toContain("ESLint");
  });

  test("detects Biome via biome.json", () => {
    touch("biome.json");
    expect(scanProject(tmpDir).tools).toContain("Biome");
  });
});

describe("scanProject — test detection via package.json scripts", () => {
  test("hasTests is true when scripts.test is present", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }),
    );
    expect(scanProject(tmpDir).hasTests).toBe(true);
  });

  test("hasTests is false when scripts.test is absent", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
    );
    expect(scanProject(tmpDir).hasTests).toBe(false);
  });

  test("hasTests is false when package.json has no scripts", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "x" }));
    expect(scanProject(tmpDir).hasTests).toBe(false);
  });
});

describe("scanProject — docker detection", () => {
  test("hasDocker true via Dockerfile", () => {
    touch("Dockerfile");
    expect(scanProject(tmpDir).hasDocker).toBe(true);
  });

  test("hasDocker true via docker-compose.yml", () => {
    touch("docker-compose.yml");
    expect(scanProject(tmpDir).hasDocker).toBe(true);
  });
});

describe("scanProject — CI detection", () => {
  test("hasCI true via .github/workflows directory", () => {
    mkdirSync(join(tmpDir, ".github", "workflows"), { recursive: true });
    expect(scanProject(tmpDir).hasCI).toBe(true);
  });

  test("hasCI true via .gitlab-ci.yml", () => {
    touch(".gitlab-ci.yml");
    expect(scanProject(tmpDir).hasCI).toBe(true);
  });
});

describe("scanProject — deduplication", () => {
  test("each detected item appears at most once", () => {
    // Both pom.xml and build.gradle → Java should appear once
    touch("pom.xml");
    touch("build.gradle");
    const langs = scanProject(tmpDir).languages;
    expect(langs.filter((l) => l === "Java").length).toBe(1);
  });
});
