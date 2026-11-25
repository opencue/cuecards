import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommunityReport } from "../lib/community-eval/result";
import { run } from "./community-eval";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const arm = { score: 2, durationMs: 500, inputTokens: 900, cachedInputTokens: 100, outputTokens: 80, codegraphUsed: false };
const pair = { off: arm, on: { ...arm, codegraphUsed: true } };
const report: CommunityReport = {
  version: 1, benchmark: "codegraph-v1", model: "gpt-5.4",
  codexVersion: "0.172.0", codegraphVersion: "1.6.4", pairs: [pair, pair],
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cue-benchmark-test-"));
  roots.push(root);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const calls: string[] = [];
  const deps = {
    measure: async (model: string) => { calls.push(model); return report; },
    credentials: () => ({ token: "test-token", apiUrl: "https://cuecards.cc" }),
    request: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return Response.json({ ok: true, data: { accepted: true } });
    },
    stdout: (text: string) => { stdout.push(text); },
    stderr: (text: string) => { stderr.push(text); },
  };
  return { path: join(root, "report.json"), deps, calls, requests, stdout, stderr };
}

test("run previews the named budget and does not spend or upload without separate consent", async () => {
  const { path, deps, calls, requests, stdout } = fixture();
  const args = ["run", "--model", "gpt-5.4", "--out", path];
  expect(await run(args, deps)).toBe(0);
  expect(stdout.join("")).toContain("4 Codex runs");
  expect(calls).toEqual([]);
  expect(await run([...args, "--yes"], deps)).toBe(0);
  expect(calls).toEqual(["gpt-5.4"]);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(report);
  expect(stdout.join("")).toContain("Correct answers: without CodeGraph 4/6, with CodeGraph 4/6");
  expect(requests).toEqual([]);
  expect(await run([...args, "--yes"], deps)).toBe(1);
  expect(await run(["run", "--model", "gpt-5.4", "--out", join(path, "missing.json"), "--yes"], deps)).toBe(1);
  expect(calls).toHaveLength(1);
});

test("run explains unsupported setup without printing arbitrary runner output", async () => {
  const { path, deps, stderr } = fixture();
  const args = ["run", "--model", "gpt-5.4", "--yes", "--out", path];
  for (const reason of ["BENCHMARK_CHATGPT_LOGIN_REQUIRED", "private provider output"]) {
    expect(await run(args, { ...deps, measure: async () => { throw new Error(reason); } })).toBe(1);
  }
  expect(stderr.join("")).toContain("BENCHMARK_CHATGPT_LOGIN_REQUIRED");
  expect(stderr.join("")).toContain("BENCHMARK_RUN_FAILED");
  expect(stderr.join("")).not.toContain("private provider output");
  expect(() => readFileSync(path)).toThrow();
});

test("submit previews exact payload and destination; only explicit consent can POST it", async () => {
  const { path, deps, calls, requests, stdout } = fixture();
  writeFileSync(path, JSON.stringify(report));
  const args = ["submit", path];
  expect(await run(args, { ...deps, credentials: () => { throw new Error("must not read auth in preview"); } })).toBe(0);
  expect(stdout.join("")).toContain("https://cuecards.cc/api/v1/benchmarks");
  expect(stdout.join("")).toContain(JSON.stringify(report, null, 2));
  expect(requests).toHaveLength(0);
  expect(await run([...args, "--yes"], deps)).toBe(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.init).toMatchObject({ method: "POST", redirect: "error", body: JSON.stringify(report) });
  expect(calls).toHaveLength(0);
  expect(await run([...args, "--yes"], {
    ...deps,
    request: async () => Response.json({ ok: true, data: { accepted: false } }),
  })).toBe(0);
  expect(stdout.join("")).toContain("Already contributed");
});

test("submit rejects private data, oversized files and credentials for other origins before network", async () => {
  const { path, deps, requests, stderr } = fixture();
  const args = ["submit", path, "--yes"];
  for (const value of [{ ...report, transcript: "private" }, "x".repeat(4096)]) {
    writeFileSync(path, JSON.stringify(value));
    expect(await run(args, deps)).toBe(1);
  }
  writeFileSync(path, JSON.stringify(report));
  expect(await run(args, { ...deps, credentials: () => ({ apiUrl: "https://other.invalid", token: "never-send" }) })).toBe(1);
  expect(requests).toHaveLength(0);
  expect(stderr.join("")).not.toContain("private");
  expect(stderr.join("")).not.toContain("never-send");
});
