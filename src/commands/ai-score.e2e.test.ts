/**
 * E2e tests for `cue ai` and `cue score`.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CUE_BIN = join(import.meta.dir, "../index.ts");

function cue(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CUE_BIN, ...args], {
    encoding: "utf8",
    timeout: 15000,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("cue ai", () => {
  test("matches python-api for python/fastapi description", () => {
    const res = cue(["ai", "python fastapi sqlalchemy"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("python-api");
  });

  test("matches rust for rust/cargo description", () => {
    const res = cue(["ai", "rust cargo async cli tool"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("rust");
  });

  test("matches frontend for react/tailwind description", () => {
    const res = cue(["ai", "react tailwind vite frontend"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("frontend");
  });

  test("matches nextjs for next.js description", () => {
    const res = cue(["ai", "next.js app router server components"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("nextjs");
  });

  test("matches go-api for golang description", () => {
    const res = cue(["ai", "golang gin api"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("go-api");
  });

  test("matches video for ffmpeg/video description", () => {
    const res = cue(["ai", "video ffmpeg frames"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("video");
  });

  test("shows help with no args", () => {
    const res = cue(["ai"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage");
  });

  test("handles no-match gracefully", () => {
    const res = cue(["ai", "xyznonexistent"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("No matching");
  });
});

describe("cue score", () => {
  test("scores a specific profile", () => {
    const res = cue(["score", "--profile", "core"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("core");
    expect(res.stdout).toContain("/100");
  });

  test("--all shows all profiles ranked", () => {
    const res = cue(["score", "--all"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Profile Scores");
    expect(res.stdout).toContain("core");
    expect(res.stdout).toContain("backend");
  });

  test("--json returns valid JSON", () => {
    const res = cue(["score", "--profile", "rust", "--json"]);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout);
    expect(data.profile).toBe("rust");
    expect(data.grade).toMatch(/^[A-F][+-]?$/);
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
    expect(data.tokens).toBeGreaterThan(0);
  });

  test("--markdown outputs shields.io badge", () => {
    const res = cue(["score", "--profile", "backend", "--markdown"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("img.shields.io/badge/cue_score");
  });

  test("--badge generates SVG file", () => {
    const res = cue(["score", "--profile", "core", "--badge", "/tmp/cue-test-badge.svg"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Badge saved");

    const { readFileSync, unlinkSync } = require("node:fs");
    const svg = readFileSync("/tmp/cue-test-badge.svg", "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("core");
    unlinkSync("/tmp/cue-test-badge.svg");
  });
});
