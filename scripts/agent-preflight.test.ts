import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runPreflight(status: string, failInstall = false) {
  const root = mkdtempSync(join(tmpdir(), "cue-preflight-test-"));
  const bin = join(root, "bin");
  const realBin = join(root, "real-bin");
  const log = join(root, "steps");
  mkdirSync(bin);
  mkdirSync(realBin);
  mkdirSync(join(root, "web"));
  writeFileSync(join(root, "status"), status);
  writeFileSync(log, "");
  writeFileSync(join(bin, "git"), `#!/bin/sh
case "$*" in
  "rev-parse --show-toplevel") printf '%s\\n' "$FIXTURE" ;;
  "submodule status --recursive") cat "$FIXTURE/status" ;;
  "submodule update --init --recursive --checkout")
    printf '%s\\n' submodules >>"$FIXTURE/steps"
    printf '%s\\n' ' abc resources/skills' >"$FIXTURE/status"
    ;;
  *) exit 97 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, "bun"), `#!/bin/sh
[ "$HOME" = "$FIXTURE" ] || exit 14
exec "$FIXTURE/real-bin/bun" "$@"
`, { mode: 0o755 });
  writeFileSync(join(bin, "node"), `#!/bin/sh
[ "$HOME" = "$FIXTURE" ] || exit 14
exec "$FIXTURE/real-bin/node" "$@"
`, { mode: 0o755 });
  writeFileSync(join(bin, "npm"), `#!/bin/sh
printf '%s:%s\\n' "$PWD" "$*" >>"$FIXTURE/steps"
`, { mode: 0o755 });
  writeFileSync(join(realBin, "node"), `#!/bin/sh
if [ "$1" = "-p" ]; then printf '%s\\n' "$0"; exit 0; fi
[ "$1" = "check" ] && [ "$HOME" != "$FIXTURE" ]
`, { mode: 0o755 });
  writeFileSync(join(realBin, "bun"), `#!/bin/sh
if [ "$1" = "-p" ]; then printf '%s\\n' "$0"; exit 0; fi
printf '%s:%s\\n' "$PWD" "$*" >>"$FIXTURE/steps"
if [ "$*" = "install --frozen-lockfile" ] && [ "$FAIL_INSTALL" = 1 ]; then exit 12; fi
if [ "$1" = run ] && { [ "$HOME" = "$FIXTURE" ] || [ -n "$CODEX_HOME" ]; }; then exit 13; fi
if [ "$1" = run ]; then node check; fi
`, { mode: 0o755 });
  try {
    const result = Bun.spawnSync(["bash", join(import.meta.dir, "agent-preflight.sh")], {
      cwd: root,
      env: {
        ...process.env,
        HOME: root,
        CODEX_HOME: join(root, "host-codex"),
        PATH: `${bin}:/usr/bin:/bin`,
        FIXTURE: root,
        FAIL_INSTALL: failInstall ? "1" : "0",
      },
    });
    return {
      code: result.exitCode,
      steps: readFileSync(log, "utf8").replaceAll(root, ".").trim().split("\n").filter(Boolean),
      output: result.stdout.toString() + result.stderr.toString(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("hydrates a fresh checkout before running isolated Cue checks", () => {
  const result = runPreflight("-abc resources/skills\n");
  expect(result.code, result.output).toBe(0);
  expect(result.steps).toEqual([
    "submodules",
    ".:install --frozen-lockfile",
    "./web:ci --include=dev --no-audit --no-fund",
    ".:run typecheck",
    ".:run lint",
    ".:run test",
    ".:run test:critical:coverage",
  ]);
});

test("does not switch an already initialized submodule with a different revision", () => {
  const result = runPreflight("+abc resources/skills\n");
  expect(result.code).toBe(1);
  expect(result.steps).toEqual([]);
  expect(result.output).toContain("recorded revisions");
});

test("does not test an incomplete dependency install", () => {
  const result = runPreflight(" abc resources/skills\n", true);
  expect(result.code).not.toBe(0);
  expect(result.steps).toEqual([".:install --frozen-lockfile"]);
});
