import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fetchCompanionFiles } from "./companion-fetch";
import { previewSkillUpdate, readSourceFile, skillContentDigest, trackInstalledSkills } from "./skill-source";

const installed = "a".repeat(40);
const latest = "b".repeat(40);
const rootTree = "c".repeat(40);
const skillTree = "d".repeat(40);
const skillMd = "# Example\n";
const skillBlob = createHash("sha1").update(`blob ${Buffer.byteLength(skillMd)}\0${skillMd}`).digest("hex");
const repo = "owner/repo";
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), "cue-skill-provenance-"));
  dirs.push(path);
  writeFileSync(join(path, "SKILL.md"), skillMd);
  return path;
};
const dirs: string[] = [];
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

const mockCommit = { sha: installed, commit: { tree: { sha: rootTree } } };
const listing = [{ name: "SKILL.md", path: "demo/SKILL.md", sha: skillBlob, type: "file" as const, download_url: null }];
const tree = (rows: [string, string, string][]) => ({
  truncated: false, tree: rows.map(([path, mode, sha]) => ({ path, mode, sha })),
});

function install(path: string) {
  return fetchCompanionFiles(repo, "demo", path, {
    fetcher: {
      listDir(_repo, _path, ref) {
        expect(ref).toBe(installed);
        return listing;
      },
      downloadFile() { throw new Error("nothing should download"); },
    },
    requestSource: endpoint => {
      expect(endpoint).toBe("repos/owner/repo/commits/HEAD");
      return mockCommit;
    },
  });
}

test("records immutable provenance even for a skill with no companions", () => {
  const path = dir();
  expect(install(path)).toEqual({ fetched: [], errors: [] });
  expect(readSourceFile(path)).toEqual({
    repo, skillPath: "demo", ref: installed, sha256: skillContentDigest(path),
  });
  expect(skillContentDigest(path)).toMatch(/^[a-f0-9]{64}$/);
});

test("does not claim the resolved commit for a different installed SKILL.md", () => {
  const path = dir();
  writeFileSync(join(path, "SKILL.md"), "# Other\n");
  install(path);
  expect(readSourceFile(path)?.sha256).toBeUndefined();
});

test("tracks a verified exact path, not an ambiguous repository match", () => {
  const verified = dir();
  const ambiguous = dir();
  const other = "# Other\n";
  const otherBlob = createHash("sha1").update(`blob ${Buffer.byteLength(other)}\0${other}`).digest("hex");
  writeFileSync(join(ambiguous, "SKILL.md"), other);
  const request = (endpoint: string) => {
    if (endpoint === `repos/${repo}/commits/${installed}`) return mockCommit;
    expect(endpoint).toBe(`repos/${repo}/git/trees/${rootTree}?recursive=1`);
    return tree([
      ["arbitrary/pack/demo/SKILL.md", "100644", skillBlob],
      ["other/SKILL.md", "100644", otherBlob],
      ["duplicate/SKILL.md", "100644", otherBlob],
    ]);
  };
  trackInstalledSkills(repo, installed, [verified, ambiguous], request);
  expect(readSourceFile(verified)?.skillPath).toBe("arbitrary/pack/demo");
  expect(readSourceFile(ambiguous)).toBeNull();
});

test("shows exact upstream file changes and local drift without changing the install", () => {
  const path = dir();
  install(path);
  const originalSource = readFileSync(join(path, ".source"), "utf8");
  writeFileSync(join(path, "SKILL.md"), "# Local edit\n");
  const nextRoot = "e".repeat(40);
  const nextTree = "f".repeat(40);
  const base = "repos/owner/repo/";
  const mapped = new Map<string, unknown>([
    [`commits/${installed}`, mockCommit],
    ["commits/HEAD", { sha: latest, commit: { tree: { sha: nextRoot } } }],
    [`git/trees/${rootTree}`, tree([["demo", "040000", skillTree]])],
    [`git/trees/${nextRoot}`, tree([["demo", "040000", nextTree]])],
    [`git/trees/${skillTree}?recursive=1`, tree([
      ["SKILL.md", "100644", skillBlob], ["old.md", "100644", installed],
    ])],
    [`git/trees/${nextTree}?recursive=1`, tree([
      ["SKILL.md", "100644", latest], ["scripts/run", "100755", rootTree],
    ])],
  ]);
  expect(previewSkillUpdate(path, endpoint => mapped.get(endpoint.slice(base.length)))).toEqual({
    repo, skillPath: "demo", from: installed, to: latest, localModified: true,
    added: ["scripts/run"], modified: ["SKILL.md"], removed: ["old.md"],
  });
  expect(readFileSync(join(path, ".source"), "utf8")).toBe(originalSource);
  expect(readFileSync(join(path, "SKILL.md"), "utf8")).toBe("# Local edit\n");
});

test("legacy tracking remains readable and cannot silently claim an exact preview baseline", () => {
  const path = dir();
  writeFileSync(join(path, ".source"), "owner/repo::demo@v1");
  expect(readSourceFile(path)).toEqual({ repo, skillPath: "demo", ref: "v1" });
  expect(() => previewSkillUpdate(path, () => { throw new Error("unexpected network"); }))
    .toThrow("exact provenance");
});

test.skipIf(process.platform === "win32")("CLI preview only requests upstream metadata and does not modify the install", () => {
  const home = dir();
  const skill = join(home, ".claude", "skills", "demo");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), skillMd);
  install(skill);
  const marker = readFileSync(join(skill, ".source"), "utf8");
  writeFileSync(join(home, "gh"),
    `#!/bin/sh\n[ "$4" = "repos/${repo}/commits/HEAD" ] || exit 9\nprintf '%s\\n' '${JSON.stringify(mockCommit)}'\n`,
    { mode: 0o700 });
  // Make fallback fail closed rather than permitting a real network request.
  writeFileSync(join(home, "curl"), "#!/bin/sh\nexit 9\n", { mode: 0o700 });
  const result = spawnSync(process.execPath,
    ["run", join(import.meta.dir, "../index.ts"), "skills", "update", "demo", "--preview", "--json"],
    {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env, HOME: home, CUE_REPO_ROOT: home, XDG_CACHE_HOME: join(home, "cache"), CUE_OFFLINE: "0",
        PATH: `${home}:${process.env.PATH}` },
    });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    repo, skillPath: "demo", from: installed, to: installed, localModified: false, added: [], modified: [], removed: [],
  });
  expect(readdirSync(skill).sort()).toEqual([".source", "SKILL.md"]);
  expect(readFileSync(join(skill, ".source"), "utf8")).toBe(marker);
  expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(skillMd);
});
