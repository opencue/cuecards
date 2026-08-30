import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Rewrite = { source: string; destination: string };
type VercelConfig = { buildCommand: string; rewrites: Rewrite[] };
type WebPackage = { scripts: Record<string, string> };

const webDir = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(webDir, "vercel.json"), "utf8")) as VercelConfig;
const webPackage = JSON.parse(readFileSync(join(webDir, "package.json"), "utf8")) as WebPackage;

function rewrittenTo(path: string): string | undefined {
  return config.rewrites.find(({ source }) => {
    const pattern = source.replace(/:[A-Za-z][A-Za-z0-9_]*\*/g, ".*");
    return new RegExp(`^${pattern}$`).test(path);
  })?.destination;
}

describe("Vercel routing", () => {
  test("builds the hosted dashboard in static demo mode", () => {
    expect(config.buildCommand).toContain("VITE_CUE_MODE=demo");
  });

  test("generates demo data without escaping the Vercel project root", () => {
    expect(webPackage.scripts["gen-demo-data"]).toBe(
      "bun scripts/dashboard-demo-data.ts > public/demo-data.json",
    );
    expect(existsSync(join(webDir, "scripts/dashboard-demo-data.ts"))).toBeTrue();
  });

  test("routes BetterAuth suffixes while reserving the other API functions", () => {
    expect(rewrittenTo("/api/auth/ok")).toBe("/api/auth?__cue_auth_path=:path*");
    expect(rewrittenTo("/api/auth/sign-up/email")).toBe("/api/auth?__cue_auth_path=:path*");
    expect(rewrittenTo("/api/v1/me")).toBeUndefined();
    expect(rewrittenTo("/api/v1/community")).toBeUndefined();
  });

  test("keeps the SPA fallback for browser routes", () => {
    expect(rewrittenTo("/")).toBe("/index.html");
    expect(rewrittenTo("/studio/settings")).toBe("/index.html");
  });

  test("ships every hosted API handler protected by the routing rule", () => {
    for (const relativePath of ["api/auth.ts", "api/v1/me.ts", "api/v1/community.ts"]) {
      expect(existsSync(join(webDir, relativePath))).toBeTrue();
    }
  });

  test("uses Node ESM-compatible extensions throughout the server import graph", () => {
    const roots = ["api", "lib", "scripts"];
    const files = roots.flatMap((root) =>
      readdirSync(join(webDir, root), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
        .map((entry) => join(entry.parentPath, entry.name)),
    );

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
        expect(match[1], `${file}: ${match[1]}`).toEndWith(".js");
      }
    }
  });
});
