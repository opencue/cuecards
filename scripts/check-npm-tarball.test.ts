import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-npm-tarball.sh", import.meta.url));

function check(source: string, integrity = "sha512-correct", version = "1.2.3", packFailures = 1) {
  const dir = mkdtempSync(join(tmpdir(), "cue-npm-check-test-"));
  try {
    writeFileSync(join(dir, "sleep"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(dir, "npm"), `#!/bin/bash
set -eu
echo "$*" >> "$LOG"
command="$1"; shift
case "$command" in
  pack)
    count="$(grep -c '^pack ' "$LOG")"
    if (( count <= PACK_FAILURES )); then echo "not available" >&2; exit 1; fi
    [[ "$1" == cue-ai@1.2.3 ]]
    while [[ "$1" != --pack-destination ]]; do shift; done
    touch "$2/cue-ai-1.2.3.tgz"
    echo '[{"filename":"cue-ai-1.2.3.tgz","integrity":"sha512-correct"}]'
    ;;
  install)
    [[ "$1" == --prefix ]]
    prefix="$2"; shift 2
    for last; do :; done
    [[ "$*" == *--ignore-scripts* && "$last" == *.tgz ]]
    mkdir -p "$prefix/node_modules/.bin"
    printf '#!/bin/bash\\n[[ "$1" == --version ]] && echo %s\\n' "$CLI_VERSION" > "$prefix/node_modules/.bin/cue"
    chmod +x "$prefix/node_modules/.bin/cue"
    ;;
  *) exit 9 ;;
esac
`, { mode: 0o755 });
    const result = Bun.spawnSync(["bash", script, "1.2.3", source, integrity], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LOG: join(dir, "log"), CLI_VERSION: version, PACK_FAILURES: String(packFailures) },
    });
    return { ...result, log: readFileSync(join(dir, "log"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("installs the local tarball and checks the CLI version", () => {
  const result = check("/tmp/cue-ai-1.2.3.tgz");
  expect(result.exitCode).toBe(0);
  expect(result.log).toContain(" /tmp/cue-ai-1.2.3.tgz");
  expect(check("/tmp/cue-ai-1.2.3.tgz", "", "1.2.4").exitCode).not.toBe(0);
});

test("retries only the exact registry download when npm is still processing it", () => {
  const result = check("registry");
  expect(result.exitCode).toBe(0);
  expect(result.log.match(/^pack cue-ai@1\.2\.3 /gm)).toHaveLength(2);
  expect(result.log.match(/^install /gm)).toHaveLength(1);
});

test("rejects a different registry tarball without installing it", () => {
  const result = check("registry", "sha512-different");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("integrity");
  expect(result.log).not.toContain("install");
});

test("stops retrying when the registry never makes the package available", () => {
  const result = check("registry", "sha512-correct", "1.2.3", 100);
  expect(result.exitCode).not.toBe(0);
  expect(result.log.match(/^pack /gm)).toHaveLength(20);
  expect(result.log).not.toContain("install");
});
