import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileYamlPath } from "../lib/profile-loader";
import { run } from "./import-profile";

let dir: string;
let manifestPath: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cue-harnesskit-"));
  manifestPath = join(dir, "manifest.json");
  stdout = "";
  stderr = "";
  spyOn(process.stdout, "write").mockImplementation(chunk => { stdout += chunk; return true; });
  spyOn(process.stderr, "write").mockImplementation(chunk => { stderr += chunk; return true; });
});

afterEach(() => {
  mock.restore();
  rmSync(dir, { force: true, recursive: true });
});

// Mirrors the fields serialized by HarnessKit's crates/hk-core/src/kits/manifest.rs.
function extension(kind: string, name: string, id: string, assetPath: string) {
  return {
    name, kind, source_extension_id: id, asset_path: assetPath, position: 0,
    content_hash: `sha256:${"0".repeat(64)}`, source_url: "https://example.test/?token=not-for-output",
  };
}

function writeManifest(overrides: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    kit_format_version: 1,
    kit_id: "46a5a749-4dac-4ad8-9920-88bf8c5a4ecf",
    name: "sample-kit",
    description: "private-description",
    created_at: "2026-01-01T00:00:00Z",
    exported_from: "HarnessKit",
    extensions: [
      extension("skill", "formatter", "a", "assets/ext-a/"),
      extension("mcp", "docs", "b", "assets/ext-b/mcp.json"),
    ],
    config_files: [
      { agent: "claude", category: "rules", filename: "CLAUDE.md", asset_path: "assets/config-claude-rules/000-CLAUDE.md", position: 0 },
      { agent: "claude", category: "memory", filename: "MEMORY.md", asset_path: "assets/config-claude-memory/001-MEMORY.md", position: 1 },
    ],
    secrets_stripped: ["b"],
    ...overrides,
  });
  writeFileSync(manifestPath, body);
  return body;
}

test("previews the native v1 manifest without opening, fetching or writing any assets", async () => {
  const body = writeManifest();
  const fetch = spyOn(globalThis, "fetch");
  expect(await run(["--harnesskit", manifestPath])).toBe(0);
  expect(stdout).toContain('HarnessKit import preview: "sample-kit"');
  expect(stdout).toContain('Candidate skills.local: "formatter"');
  expect(stdout).toContain('Candidate mcps: "docs"');
  expect(stdout).toContain('Candidate rules: "CLAUDE.md"');
  expect(stdout).toContain('Unmapped memory: "MEMORY.md"');
  expect(stdout).toContain("Nothing written.");
  expect(stdout).not.toContain("not-for-output");
  expect(stdout).not.toContain("private-description");
  expect(fetch).not.toHaveBeenCalled();
  expect(readdirSync(dir)).toEqual(["manifest.json"]);
  expect(readFileSync(manifestPath, "utf8")).toBe(body);
});

test("reports unsupported entries, unsafe archive paths and collisions without installing", async () => {
  writeManifest({ extensions: [
    extension("skill", "formatter", "a", "assets/ext-a/"),
    extension("skill", "Formatter", "b", "assets/ext-b/"),
    extension("cli", "bundle", "c", "assets/ext-a/"),
    extension("hook", "unsafe-hook", "h", "assets/ext-h/hook.json"),
    extension("skill", "outside", "d", "assets/../../not-for-output"),
  ] });
  expect(await run([manifestPath, "--harnesskit"])).toBe(0);
  expect(stdout).toContain('Collision skills.local: "Formatter"');
  expect(stdout).toContain("Collision archive path at extension #3");
  expect(stdout).toContain('Unmapped cli: "bundle"');
  expect(stdout).toContain('Unmapped hook: "unsafe-hook"');
  expect(stdout).toContain("Unsafe asset at extension #5");
  expect(stdout).not.toContain("not-for-output");
  expect(readdirSync(dir)).toEqual(["manifest.json"]);
});

test("reports a profile-name collision without modifying the existing profile", async () => {
  writeManifest({ name: "core" });
  const profile = profileYamlPath("core");
  const before = readFileSync(profile, "utf8");
  expect(await run(["--harnesskit", manifestPath])).toBe(0);
  expect(stdout).toContain('Collision existing profile: "core"');
  expect(readFileSync(profile, "utf8")).toBe(before);
});

test("rejects remote sources, application flags and output paths without writes", async () => {
  writeManifest();
  const fetch = spyOn(globalThis, "fetch");
  for (const args of [
    ["https://example.test/manifest.json"],
    ["//host/share/manifest.json"],
    ["owner/repo"],
    [manifestPath, "--apply"],
    [manifestPath, "--name", "another-profile"],
    [manifestPath, "--sha256", "digest"],
    [manifestPath, "--output", join(dir, "outfile")],
  ]) {
    expect(await run(["--harnesskit", ...args])).toBe(1);
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(readdirSync(dir)).toEqual(["manifest.json"]);
  expect(stderr).toContain("local HarnessKit manifest");
  expect(stderr).toContain("preview only");
});

test("rejects a missing format, unsupported version or malformed manifest before preview", async () => {
  for (const overrides of [
    { kit_format_version: undefined },
    { kit_format_version: 2 },
    { config_files: null },
    { extensions: [{ name: "formatter", kind: "skill" }] },
  ]) {
    writeManifest(overrides);
    expect(await run(["--harnesskit", manifestPath])).toBe(1);
  }
  expect(stdout).toBe("");
  expect(stderr).toContain("HarnessKit manifest");
});

test("dispatches preview through the Cue CLI and blocks apply", () => {
  writeManifest();
  const args = [process.execPath, join(import.meta.dir, "..", "index.ts"), "import", "--harnesskit", manifestPath];
  const preview = Bun.spawnSync(args);
  expect(preview.exitCode).toBe(0);
  expect(preview.stdout.toString()).toContain("Nothing written.");
  const apply = Bun.spawnSync([...args, "--apply"]);
  expect(apply.exitCode).toBe(1);
  expect(apply.stderr.toString()).toContain("preview only");
  expect(readdirSync(dir)).toEqual(["manifest.json"]);
});
