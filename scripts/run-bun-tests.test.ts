import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const posixTest = process.platform === "win32" ? test.skip : test;

function withFakeBun(
  script: string,
  check: (run: (timeout: string) => ReturnType<typeof spawnSync>, dir: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "cue-bun-test-runner-"));
  writeFileSync(join(dir, "bun"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  try {
    check((timeout) => spawnSync(
      "node",
      [join(import.meta.dir, "run-bun-tests.mjs"), "some.test.ts", "--coverage"],
      {
        cwd: dir,
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, CUE_TEST_TIMEOUT_MS: timeout },
        encoding: "utf8",
        timeout: 9_000,
      },
    ), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

posixTest("forwards Bun arguments and preserves a normal test failure", () => {
  withFakeBun('printf "%s\\n" "$@"; exit 23', (run) => {
    const result = run("5000");
    expect(result.status).toBe(23);
    expect(result.stdout?.toString().trim().split("\n")).toEqual([
      "test", "--timeout", "30000", "some.test.ts", "--coverage",
    ]);
  });
});

posixTest("rejects an invalid whole-run deadline before starting Bun", () => {
  withFakeBun('echo "Bun ran"', (run) => {
    const result = run("not-a-duration");
    expect(result.status).toBe(2);
    expect(result.stderr?.toString()).toContain("CUE_TEST_TIMEOUT_MS");
    expect(result.stdout?.toString()).toBe("");
  });
});

function checkProcessCleanup(script: string, exitCode: number) {
  withFakeBun(
    script,
    (run, dir) => {
      let verified = false;
      try {
        const result = run("1500");
        expect(result.status).toBe(exitCode);
        if (exitCode === 124) expect(result.stderr?.toString()).toContain("timed out");
        const pids = readFileSync(join(dir, "pids"), "utf8").trim().split(" ").map(Number);
        for (const pid of pids) {
          const status = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
          expect(status.stdout.trim()).toMatch(/^(?:Z.*)?$/);
        }
        verified = true;
      } finally {
        if (!verified) {
          try {
            for (const pid of readFileSync(join(dir, "pids"), "utf8").trim().split(" ").map(Number)) {
              if (pid > 1) try { process.kill(pid, "SIGKILL"); } catch { /* fixture already exited */ }
            }
          } catch { /* fixture never started */ }
        }
      }
    },
  );
}

posixTest("times out an unresponsive Bun and its subprocess", () => {
  checkProcessCleanup('trap "" TERM; sleep 25 & printf "%s %s\\n" "$$" "$!" > pids; wait', 124);
}, 12_000);

posixTest("cleans up subprocesses even when Bun exits before them", () => {
  checkProcessCleanup('sleep 25 >/dev/null 2>&1 & printf "%s %s\\n" "$$" "$!" > pids; exit 0', 0);
}, 12_000);
