import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../index.ts", import.meta.url).pathname;

test("catalog searches fork skill descriptions without loading a profile", () => {
  const result = Bun.spawnSync(["bun", cli, "skills", "catalog", "publishing calendar", "--json"], { timeout: 15000 });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual([
    expect.objectContaining({ id: "blog-calendar", repo: "NagyVikt/claude-blog", commit: expect.stringMatching(/^[a-f0-9]{40}$/) }),
  ]);
});

const fullSha = "1".repeat(40);
const prefix = fullSha.slice(0, 10);
const pinCases = [
  [`git@${fullSha}`, 0, fullSha],
  [`git@${prefix}`, 200, fullSha],
  [`git@${prefix}`, 403, fullSha],
  [`git@${prefix}`, 404, fullSha],
  ["tag@v1.2.3", 0, "v1.2.3"],
] as const;
test.each(pinCases)("profile installs honor %s (API status: %i)", (pin, apiStatus, ref) => {
  const bin = mkdtempSync(join(tmpdir(), "cue-profile-pin-test-"));
  try {
    const npx = join(bin, "npx");
    const argsFile = join(bin, "args");
    writeFileSync(npx, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_FILE"\nexit 0\n');
    chmodSync(npx, 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ARGS_FILE: argsFile };
    const gh = join(bin, "gh");
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${fullSha}'\n`, { mode: 0o755 });
    const resolver = new URL("../lib/resolver-npx.ts", import.meta.url).pathname;
    const result = Bun.spawnSync([
      "bun", "-e",
      `import { npxFetchMany } from ${JSON.stringify(resolver)};
        globalThis.fetch = async (url) => {
          if (!${apiStatus} || url !== "https://api.github.com/repos/NagyVikt/claude-blog/commits/${prefix}") throw new Error("Unexpected API request");
          if (${apiStatus} !== 200) return new Response(null, { status: ${apiStatus} });
          return Response.json({ sha: "${fullSha}" });
        };
        await npxFetchMany("NagyVikt/claude-blog", "${pin}", ["blog-brief"], ${JSON.stringify(bin)});`,
    ], { env });
    expect(result.exitCode).toBe(0);
    const args = readFileSync(argsFile, "utf8").split("\n");
    expect(args).toContain(`NagyVikt/claude-blog#${ref}`);
    expect(args).toContain("--copy");
    expect(args).not.toContain("--ref");
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test("catalog install forwards only the selected skill's immutable source", () => {
  const bin = mkdtempSync(join(tmpdir(), "cue-catalog-test-"));
  try {
    const npx = join(bin, "npx");
    writeFileSync(npx, "#!/bin/sh\nprintf '%s\\n' \"$@\"\nexit 42\n");
    chmodSync(npx, 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const result = Bun.spawnSync(["bun", cli, "skills", "catalog", "install", "blog-brief"], { env });
    expect(result.exitCode).toBe(42);
    expect(result.stdout.toString()).toMatch(
      /^skills\nadd\nhttps:\/\/github.com\/NagyVikt\/claude-blog\/tree\/[a-f0-9]{40}\/skills\/blog-brief\n--skill\nblog-brief\n--global\n$/,
    );
    const unknown = Bun.spawnSync(["bun", cli, "skills", "catalog", "install", "nonexistent"], { env });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stdout.toString()).toBe("");
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
