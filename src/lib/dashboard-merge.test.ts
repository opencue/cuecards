/**
 * Tests for the merge endpoints on the dashboard server.
 * Mounts createHandler() directly (no port bind), like dashboard.test.ts.
 *
 * Run with: `bun test src/lib/dashboard-merge.test.ts`
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createHandler } from "./dashboard-server";

// Sibling test files set CUE_PROFILES_DIR / SOUL_PROFILES_DIR to a temp dir;
// clear any leak so the dashboard resolves the repo's real profiles/ tree.
beforeEach(() => {
  delete process.env.CUE_PROFILES_DIR;
  delete process.env.SOUL_PROFILES_DIR;
});

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEST_PROFILE = "dash-merge-test";
const TEST_DIR = join(REPO_ROOT, "profiles", TEST_PROFILE);

function post(path: string, body: unknown): Promise<Response> {
  const handler = createHandler();
  return handler(new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("GET /api/v1/profiles/full", () => {
  test("returns an inventory row per profile", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://x/api/v1/profiles/full"));
    const body = (await res.json()) as { ok: boolean; data: any[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    const medusa = body.data.find((r) => r.name === "medusa-dev");
    expect(medusa).toBeTruthy();
    expect(typeof medusa.skills).toBe("number");
    expect(Array.isArray(medusa.conflicts)).toBe(true);
  });
});

describe("POST /api/v1/merge/preview", () => {
  test("rejects fewer than 2 sources", async () => {
    const res = await post("/api/v1/merge/preview", { names: ["medusa-dev"] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test("returns a preview + both rendered modes", async () => {
    const res = await post("/api/v1/merge/preview", {
      names: ["medusa-dev", "designer"],
      name: "commerce",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.preview.skills.length).toBeGreaterThan(0);
    expect(body.data.yaml.static).toContain("inherits: core");
    expect(body.data.yaml.alias).toContain("inherits:");
  });
});

describe("POST /api/v1/merge/save", () => {
  test("rejects an invalid profile name", async () => {
    const res = await post("/api/v1/merge/save", {
      names: ["medusa-dev", "designer"],
      name: "../escape",
    });
    expect(res.status).toBe(400);
  });

  test("writes a profile, then refuses to clobber without force", async () => {
    const first = await post("/api/v1/merge/save", {
      names: ["medusa-dev", "designer"],
      name: TEST_PROFILE,
      mode: "static",
    });
    expect(first.status).toBe(200);
    const fbody = (await first.json()) as { ok: boolean; data: any };
    expect(fbody.ok).toBe(true);
    expect(fbody.data.created).toBe(true);
    expect(existsSync(TEST_DIR)).toBe(true);

    // Re-save without force → blocked.
    const second = await post("/api/v1/merge/save", {
      names: ["medusa-dev", "designer"],
      name: TEST_PROFILE,
    });
    expect(second.status).toBe(400);
    const sbody = (await second.json()) as { ok: boolean; error: string };
    expect(sbody.ok).toBe(false);
    expect(sbody.error).toContain("already exists");

    // With force → overwrites and reports previousYaml.
    const third = await post("/api/v1/merge/save", {
      names: ["medusa-dev", "designer"],
      name: TEST_PROFILE,
      force: true,
    });
    const tbody = (await third.json()) as { ok: boolean; data: any };
    expect(tbody.ok).toBe(true);
    expect(tbody.data.created).toBe(false);
    expect(typeof tbody.data.previousYaml).toBe("string");
  });
});
