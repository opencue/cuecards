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

const pinCases = [[40, false], [10, false], [10, true]] as const;
test.each(pinCases)("profile installs resolve %i-character pins (rate limited: %s)", (length, rateLimited) => {
  const bin = mkdtempSync(join(tmpdir(), "cue-profile-pin-test-"));
  try {
    const npx = join(bin, "npx");
    const argsFile = join(bin, "args");
    writeFileSync(npx, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_FILE"\nexit 0\n');
    chmodSync(npx, 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ARGS_FILE: argsFile };
    const ref = "1".repeat(40);
    const gh = join(bin, "gh");
    writeFileSync(gh, `#!/bin/sh\nprintf '%s\\n' '${ref}'\n`, { mode: 0o755 });
    const resolver = new URL("../lib/resolver-npx.ts", import.meta.url).pathname;
    const result = Bun.spawnSync([
      "bun", "-e",
      `import { npxFetchMany } from ${JSON.stringify(resolver)};
        globalThis.fetch = async (url) => {
          if (${length} === 40 || url !== "https://api.github.com/repos/NagyVikt/claude-blog/commits/${ref.slice(0, length)}") throw new Error("Unexpected API request");
          if (${rateLimited}) return new Response(null, { status: 403 });
          return Response.json({ sha: "${ref}" });
        };
        await npxFetchMany("NagyVikt/claude-blog", "git@${ref.slice(0, length)}", ["blog-brief"], ${JSON.stringify(bin)});`,
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
