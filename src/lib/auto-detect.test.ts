import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectProfileV2 } from "./auto-detect";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cue-detect-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("detectProfileV2", () => {
  test("prioritizes the Ads domain from the repository name", () => {
    const out = detectProfileV2("/tmp/google-ads-manager");
    expect(out[0]?.profile).toBe("google-ads");
    expect(out.map((x) => x.profile)).toContain("ads-manager");
    const google = out.find((item) => item.profile === "google-ads");
    const alternative = out.find((item) => item.profile === "claude-ads");
    expect(google?.evidence?.[0]?.family).toBe(alternative?.evidence?.[0]?.family);
  });

  test("generic marketing campaigns do not become Google Ads projects", () => {
    const out = detectProfileV2("/tmp/marketing-campaign");
    expect(out[0]?.profile).toBe("marketing");
    expect(out[0]?.profile).not.toBe("google-ads");
  });
  test("Cargo.toml → rust with 0.9 confidence", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "[package]");
    const results = detectProfileV2(tmp);
    const rust = results.find(r => r.profile === "rust");
    expect(rust).toBeDefined();
    expect(rust!.confidence).toBe(0.9);
    expect(rust!.reasons).toContain("Cargo.toml");
  });

  test("Cargo.toml + src/main.rs → rust, corroborated above the lone-signal base", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "[package]");
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/main.rs"), "fn main() {}");
    const results = detectProfileV2(tmp);
    const rust = results.find(r => r.profile === "rust");
    expect(rust).toBeDefined();
    expect(rust!.reasons).toContain("src/main.rs");
    // Two corroborating signals (Cargo.toml + src/main.rs) lift confidence
    // above the 0.9 lone-signal base, capped at 0.97.
    expect(rust!.confidence).toBeGreaterThan(0.9);
    expect(rust!.confidence).toBeLessThanOrEqual(0.97);
    // `rust-cli` was a phantom profile (no profiles/rust-cli on disk) — gone now.
    expect(results.find(r => r.profile === "rust-cli")).toBeUndefined();
  });

  test("package.json with next → nextjs 0.9", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { next: "14.0.0" } }));
    const results = detectProfileV2(tmp);
    const nextjs = results.find(r => r.profile === "nextjs");
    expect(nextjs).toBeDefined();
    expect(nextjs!.confidence).toBe(0.9);
  });

  test("package.json with react (no next) → frontend 0.8", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { react: "18.0.0" } }));
    const results = detectProfileV2(tmp);
    const frontend = results.find(r => r.profile === "frontend");
    expect(frontend).toBeDefined();
    expect(frontend!.confidence).toBe(0.8);
  });

  test("Vite config and dependency → vite outranks generic frontend", () => {
    writeFileSync(join(tmp, "vite.config.ts"), "export default {}");
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ dependencies: { react: "18.0.0" }, devDependencies: { vite: "7.0.0" } }),
    );
    const results = detectProfileV2(tmp);
    expect(results[0]?.profile).toBe("vite");
    expect(results.find((result) => result.profile === "frontend")).toBeDefined();
  });

  test("package.json with no framework → backend 0.6", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { express: "4.0.0" } }));
    const results = detectProfileV2(tmp);
    const backend = results.find(r => r.profile === "backend");
    expect(backend).toBeDefined();
    expect(backend!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  test("go.mod → go-api 0.8", () => {
    writeFileSync(join(tmp, "go.mod"), "module example.com/app");
    const results = detectProfileV2(tmp);
    const goApi = results.find(r => r.profile === "go-api");
    expect(goApi).toBeDefined();
    expect(goApi!.confidence).toBe(0.8);
  });

  test("empty dir returns empty", () => {
    const results = detectProfileV2(tmp);
    expect(results).toEqual([]);
  });

  test("generic OMX session state is not fleet-control repository evidence", () => {
    mkdirSync(join(tmp, ".omx"));
    expect(
      detectProfileV2(tmp).find((result) => result.profile === "fleet-control"),
    ).toBeUndefined();
  });

  test("an explicit fleet marker still suggests fleet-control", () => {
    mkdirSync(join(tmp, ".colony"));
    expect(
      detectProfileV2(tmp).find((result) => result.profile === "fleet-control"),
    ).toBeDefined();
  });

  test("medusa-config.ts → medusa-dev 0.9", () => {
    writeFileSync(join(tmp, "medusa-config.ts"), "export default {}");
    const results = detectProfileV2(tmp);
    const medusa = results.find(r => r.profile === "medusa-dev");
    expect(medusa).toBeDefined();
    expect(medusa!.confidence).toBe(0.9);
  });

  test("@medusajs/* dep + vite → medusa-vite storefront", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { "@medusajs/js-sdk": "2.0.0", vite: "5.0.0" },
    }));
    const results = detectProfileV2(tmp);
    const vite = results.find(r => r.profile === "medusa-vite");
    expect(vite).toBeDefined();
  });

  test("Medusa + Next storefront outranks the generic Next.js signal", () => {
    writeFileSync(join(tmp, "next.config.ts"), "export default {}");
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ dependencies: { "@medusajs/js-sdk": "2.0.0", next: "15.0.0" } }),
    );
    expect(detectProfileV2(tmp)[0]?.profile).toBe("medusa-next");
  });

  test("corroborating signals boost confidence above the lone-signal base", () => {
    // next.config.* alone is 0.85; package.json `next` alone is 0.9. Together
    // they corroborate and should clear the lone-signal 0.9.
    writeFileSync(join(tmp, "next.config.ts"), "export default {}");
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    const results = detectProfileV2(tmp);
    const nextjs = results.find(r => r.profile === "nextjs");
    expect(nextjs).toBeDefined();
    expect(nextjs!.confidence).toBeGreaterThan(0.9);
    expect(nextjs!.confidence).toBeLessThanOrEqual(0.97);
  });

  test("confidence never exceeds the 0.97 cap", () => {
    writeFileSync(join(tmp, "go.mod"), "module x");
    writeFileSync(join(tmp, "go.sum"), "");
    writeFileSync(join(tmp, "main.go"), "package main");
    mkdirSync(join(tmp, "cmd"));
    mkdirSync(join(tmp, "internal"));
    const results = detectProfileV2(tmp);
    for (const r of results) expect(r.confidence).toBeLessThanOrEqual(0.97);
  });

  test("package.json with stripe dep → stripe profile suggested", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { stripe: "14.0.0" },
    }));
    const results = detectProfileV2(tmp);
    const stripe = results.find(r => r.profile === "stripe");
    expect(stripe).toBeDefined();
    // Above the picker's SUGGESTED_MIN_CONFIDENCE (0.5) so it actually shows,
    // below SUGGESTED_AUTO_PICK_CONFIDENCE (0.7) so it never hijacks Enter.
    expect(stripe!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(stripe!.confidence).toBeLessThan(0.7);
    expect(stripe!.reasons.join(" ")).toContain("stripe");
    expect(results[0]?.profile).toBe("stripe");
  });

  test("package.json with @aws-sdk/client-s3 → aws profile suggested", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { "@aws-sdk/client-s3": "3.0.0" },
    }));
    const results = detectProfileV2(tmp);
    const aws = results.find(r => r.profile === "aws");
    expect(aws).toBeDefined();
    expect(aws!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  test("service deps ride alongside the framework profile, not above it", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { next: "14.0.0", stripe: "14.0.0" },
    }));
    const results = detectProfileV2(tmp);
    const nextjs = results.find(r => r.profile === "nextjs");
    const stripe = results.find(r => r.profile === "stripe");
    expect(nextjs).toBeDefined();
    expect(stripe).toBeDefined();
    expect(nextjs!.confidence).toBeGreaterThan(stripe!.confidence);
  });

  test("scoped service deps match by prefix (@supabase/, @slack/)", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { "@supabase/supabase-js": "2.0.0" },
      devDependencies: { "@slack/web-api": "7.0.0" },
    }));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "supabase")).toBeDefined();
    expect(results.find(r => r.profile === "slack")).toBeDefined();
    expect(results[0]?.profile).not.toBe("backend");
  });

  test("Playwright tooling suggests browser above generic backend", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      devDependencies: { "@playwright/test": "1.50.0" },
    }));
    const results = detectProfileV2(tmp);
    expect(results[0]?.profile).toBe("browser");
  });

  test("a Coolify project marker outranks generic Docker backend", () => {
    mkdirSync(join(tmp, ".coolify"));
    writeFileSync(join(tmp, ".coolify/config.json"), "{}");
    writeFileSync(join(tmp, "docker-compose.yml"), "services: {}");
    expect(detectProfileV2(tmp)[0]?.profile).toBe("coolify");
  });

  test("no service dep → no service profile suggested", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { express: "4.0.0" },
    }));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "stripe")).toBeUndefined();
    expect(results.find(r => r.profile === "aws")).toBeUndefined();
  });

  test("react-native dep → react-native profile outranks generic frontend", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { react: "18.0.0", "react-native": "0.74.0" },
    }));
    const results = detectProfileV2(tmp);
    const rn = results.find(r => r.profile === "react-native");
    const frontend = results.find(r => r.profile === "frontend");
    expect(rn).toBeDefined();
    expect(frontend).toBeDefined();
    expect(rn!.confidence).toBeGreaterThan(frontend!.confidence);
  });

  test("results sorted by confidence descending, max 5", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "");
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/main.rs"), "");
    writeFileSync(join(tmp, "go.mod"), "");
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { next: "14" } }));
    mkdirSync(join(tmp, ".github"));
    mkdirSync(join(tmp, ".github/workflows"));
    const results = detectProfileV2(tmp);
    expect(results.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.confidence).toBeLessThanOrEqual(results[i - 1]!.confidence);
    }
  });
});


describe("detectProfileV2 — Python deps", () => {
  test("multiple Python source files suggest python without a manifest", () => {
    writeFileSync(join(tmp, "main.py"), "print('hello')\n");
    writeFileSync(join(tmp, "worker.py"), "def run(): pass\n");

    const results = detectProfileV2(tmp);
    const python = results.find((result) => result.profile === "python");
    expect(python).toBeDefined();
    expect(python!.confidence).toBeGreaterThanOrEqual(0.8);
    expect(python!.reasons.join(" ")).toContain(".py");
  });

  test("nested Python source files suggest python without a manifest or git repository", () => {
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src", "main.py"), "print('hello')\n");
    writeFileSync(join(tmp, "src", "worker.py"), "def run(): pass\n");

    const results = detectProfileV2(tmp);
    expect(results.find((result) => result.profile === "python")).toMatchObject({
      confidence: 0.85,
    });
  });

  test("one stray Python helper does not redefine another project", () => {
    writeFileSync(join(tmp, "Cargo.toml"), "[package]\nname='app'\n");
    writeFileSync(join(tmp, "release.py"), "print('release')\n");

    const results = detectProfileV2(tmp);
    expect(results[0]?.profile).toBe("rust");
    expect(results.find((result) => result.profile === "python")).toBeUndefined();
  });

  test("a substantial secondary language stays below the primary manifest", () => {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ dependencies: { express: "4" } }),
    );
    mkdirSync(join(tmp, "src"));
    mkdirSync(join(tmp, "tools"));
    for (let index = 0; index < 50; index += 1) {
      writeFileSync(join(tmp, "src", `module-${index}.ts`), "export {};\n");
    }
    for (let index = 0; index < 10; index += 1) {
      writeFileSync(join(tmp, "tools", `job-${index}.py`), "pass\n");
    }

    const results = detectProfileV2(tmp);
    expect(results[0]?.profile).toBe("backend");
    expect(results.find((result) => result.profile === "python")?.confidence).toBe(
      0.55,
    );
  });

  test("requirements.txt with boto3 → aws suggested, python outranks it", () => {
    writeFileSync(join(tmp, "requirements.txt"), "boto3==1.34.0\n");
    const results = detectProfileV2(tmp);
    const aws = results.find(r => r.profile === "aws");
    const python = results.find(r => r.profile === "python");
    expect(aws).toBeDefined();
    expect(aws!.confidence).toBeGreaterThanOrEqual(0.5);
    expect(aws!.confidence).toBeLessThan(0.7);
    expect(python).toBeDefined();
    expect(python!.confidence).toBeGreaterThan(aws!.confidence);
  });

  test("Jetson Python dependencies select jetson above generic python", () => {
    writeFileSync(
      join(tmp, "requirements.txt"),
      "jetson-stats==4.3.2\njetson-containers==0.4.2\n",
    );

    const results = detectProfileV2(tmp);
    const jetson = results.find((result) => result.profile === "jetson");
    const python = results.find((result) => result.profile === "python");

    expect(jetson).toBeDefined();
    expect(python).toBeDefined();
    expect(results[0]?.profile).toBe("jetson");
    expect(jetson!.confidence).toBeGreaterThan(python!.confidence);
    expect(jetson!.reasons.join(" ")).toContain("jetson");
  });

  test("version specifiers, extras, and comments are stripped", () => {
    writeFileSync(join(tmp, "requirements.txt"), [
      "# payments",
      "stripe==7.0.0",
      "psycopg2-binary>=2.9 ; python_version >= '3.8'",
      "uvicorn[standard]~=0.29",
      "",
    ].join("\n"));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "stripe")).toBeDefined();
    expect(results.find(r => r.profile === "postgres")).toBeDefined();
  });

  test("pyproject.toml [project] dependencies → supabase suggested", () => {
    writeFileSync(join(tmp, "pyproject.toml"), [
      "[project]",
      'name = "myapp"',
      "dependencies = [",
      '  "supabase>=2.0",',
      '  "httpx",',
      "]",
    ].join("\n"));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "supabase")).toBeDefined();
  });

  test("PEP 503 normalization: slack_sdk matches slack-sdk", () => {
    writeFileSync(join(tmp, "requirements.txt"), "slack_sdk==3.27.0\n");
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "slack")).toBeDefined();
  });

  test("python files without service deps suggest no service profiles", () => {
    writeFileSync(join(tmp, "requirements.txt"), "requests==2.31.0\nflask\n");
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "aws")).toBeUndefined();
    expect(results.find(r => r.profile === "stripe")).toBeUndefined();
  });
});

describe("detectProfileV2 — monorepo workspaces", () => {
  test("child package manifests are scanned when the root has no manifest", () => {
    mkdirSync(join(tmp, "ui"));
    writeFileSync(join(tmp, "ui/package.json"), JSON.stringify({
      dependencies: { react: "19.0.0" },
      devDependencies: { vite: "7.0.0" },
    }));

    const results = detectProfileV2(tmp);
    expect(results.find((result) => result.profile === "vite")).toBeDefined();
    expect(results.find((result) => result.profile === "frontend")).toBeDefined();
  });

  test("workspace Next.js app outranks generic root package tooling", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      private: true,
      dependencies: { turbo: "2.0.0" },
      workspaces: ["apps/*"],
    }));
    mkdirSync(join(tmp, "apps/web"), { recursive: true });
    writeFileSync(join(tmp, "apps/web/package.json"), JSON.stringify({
      dependencies: { next: "15.0.0", react: "19.0.0" },
    }));
    expect(detectProfileV2(tmp)[0]?.profile).toBe("nextjs");
  });

  test("workspaces glob: packages/*/package.json deps surface at the root", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      private: true,
      workspaces: ["packages/*"],
    }));
    mkdirSync(join(tmp, "packages/api"), { recursive: true });
    writeFileSync(join(tmp, "packages/api/package.json"), JSON.stringify({
      dependencies: { stripe: "14.0.0" },
    }));
    const results = detectProfileV2(tmp);
    const stripe = results.find(r => r.profile === "stripe");
    expect(stripe).toBeDefined();
    expect(stripe!.reasons.join(" ")).toContain("workspace");
  });

  test("pnpm-workspace.yaml globs are honored", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ private: true }));
    writeFileSync(join(tmp, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n');
    mkdirSync(join(tmp, "apps/web"), { recursive: true });
    writeFileSync(join(tmp, "apps/web/package.json"), JSON.stringify({
      dependencies: { "@aws-sdk/client-s3": "3.0.0" },
    }));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "aws")).toBeDefined();
  });

  test("exact workspace paths (no glob) are scanned too", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      private: true,
      workspaces: { packages: ["apps/web"] },
    }));
    mkdirSync(join(tmp, "apps/web"), { recursive: true });
    writeFileSync(join(tmp, "apps/web/package.json"), JSON.stringify({
      dependencies: { "@supabase/supabase-js": "2.0.0" },
    }));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "supabase")).toBeDefined();
  });

  test("packages/ without a workspaces declaration is NOT scanned", () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { express: "4.0.0" },
    }));
    mkdirSync(join(tmp, "packages/api"), { recursive: true });
    writeFileSync(join(tmp, "packages/api/package.json"), JSON.stringify({
      dependencies: { stripe: "14.0.0" },
    }));
    const results = detectProfileV2(tmp);
    expect(results.find(r => r.profile === "stripe")).toBeUndefined();
  });
});

describe("detectProfileV2 — environment key names", () => {
  test("service-specific env keys suggest their profiles without reading values", () => {
    writeFileSync(
      join(tmp, ".env.example"),
      "STRIPE_SECRET_KEY=replace-me\nCOOLIFY_API_TOKEN=replace-me\n",
    );

    const results = detectProfileV2(tmp);
    expect(results.find((result) => result.profile === "stripe")).toBeDefined();
    expect(results.find((result) => result.profile === "coolify")).toBeDefined();
    expect(results.flatMap((result) => result.reasons).join(" ")).not.toContain("replace-me");
  });

  test("generic env keys do not invent service profiles", () => {
    writeFileSync(join(tmp, ".env"), "API_KEY=secret\nDATABASE_URL=secret\n");

    const results = detectProfileV2(tmp);
    expect(results.find((result) => result.profile === "stripe")).toBeUndefined();
    expect(results.find((result) => result.profile === "coolify")).toBeUndefined();
  });
});
