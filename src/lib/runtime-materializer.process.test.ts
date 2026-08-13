import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const worker = join(repoRoot, "test", "helpers", "runtime-materialize-worker.ts");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runWorker(runtimeRoot: string) {
  const child = Bun.spawn([process.execPath, worker, runtimeRoot], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr || `worker exited ${exitCode}`);
  return JSON.parse(stdout) as { runtimeDir: string; rebuilt: boolean };
}

describe("materializeRuntime cross-process locking", () => {
  test("two processes serialize one rebuild and one cache hit", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "cue-runtime-process-"));
    roots.push(runtimeRoot);

    const [first, second] = await Promise.all([runWorker(runtimeRoot), runWorker(runtimeRoot)]);

    expect([first.rebuilt, second.rebuilt].sort()).toEqual([false, true]);
    expect(first.runtimeDir).toBe(second.runtimeDir);
    expect(await readFile(join(first.runtimeDir, ".cue-hash"), "utf8")).toMatch(/^[a-f0-9]{64}$/);
    await expect(lstat(`${first.runtimeDir}.lock`)).rejects.toThrow();
  });
});
