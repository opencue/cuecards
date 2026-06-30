import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInstall, runUninstall, shimInstalled, resolveCueInvocation, resolveHookShell } from "./shell";

let fakeHome: string;
beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "cue-shell-"));
  await mkdir(join(fakeHome, ".local", "bin"), { recursive: true });
});
afterEach(async () => { await rm(fakeHome, { recursive: true, force: true }); });

describe("shell install", () => {
  test("writes claude and codex shims with correct content", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [join(fakeHome, ".local", "bin"), "/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
    });
    expect(rc).toBe(0);

    // Assert on `launch <agent>` (present in both the bare and absolute-path
    // shim forms) rather than the exact invocation token, which depends on
    // whether `cue` is resolvable on the test runner's PATH.
    const claudeShim = await readFile(join(fakeHome, ".local", "bin", "claude"), "utf8");
    expect(claudeShim).toContain("launch claude");
    const codexShim = await readFile(join(fakeHome, ".local", "bin", "codex"), "utf8");
    expect(codexShim).toContain("launch codex");

    const st = await stat(join(fakeHome, ".local", "bin", "claude"));
    expect((st.mode & 0o111) !== 0).toBe(true); // executable
  });

  test("refuses to install when ~/.local/bin is not before real binary on PATH", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: ["/usr/bin", join(fakeHome, ".local", "bin")], // wrong order
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
    });
    expect(rc).toBe(1);
  });

  test("uninstall removes shims, leaves bin dir", async () => {
    await runInstall({
      homeDir: fakeHome,
      pathDirs: [join(fakeHome, ".local", "bin"), "/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
    });
    const rc = await runUninstall({ homeDir: fakeHome });
    expect(rc).toBe(0);
    await expect(stat(join(fakeHome, ".local", "bin", "claude"))).rejects.toThrow();
  });
});

describe("shimInstalled", () => {
  const shimPath = () => join(fakeHome, ".local", "bin", "claude");

  test("false when no shim exists", () => {
    expect(shimInstalled(fakeHome)).toBe(false);
  });

  test("true for the runInstall() bare format (exec cue launch claude)", async () => {
    await writeFile(shimPath(), '#!/usr/bin/env bash\nexec cue launch claude "$@"\n');
    expect(shimInstalled(fakeHome)).toBe(true);
  });

  test("true for the `cue shell install` absolute-path format", async () => {
    // This is the exact format run(["install"]) writes — the case the original
    // `cue launch` substring check false-negatived on.
    await writeFile(shimPath(), '#!/usr/bin/env bash\nexec "/home/u/Documents/cue/bin/cue" launch claude "$@"\n');
    expect(shimInstalled(fakeHome)).toBe(true);
  });

  test("false for a non-cue claude on PATH", async () => {
    await writeFile(shimPath(), '#!/usr/bin/env bash\nexec /opt/anthropic/claude "$@"\n');
    expect(shimInstalled(fakeHome)).toBe(false);
  });
});

describe("resolveCueInvocation", () => {
  test("returns bare `cue` when an executable cue is resolvable on PATH (npm-global case)", async () => {
    const binDir = join(fakeHome, "pathbin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "cue"), "#!/bin/sh\n");
    await chmod(join(binDir, "cue"), 0o755);
    expect(resolveCueInvocation({ pathDirs: [binDir] })).toBe("cue");
  });

  test("ignores a non-executable cue on PATH and falls back to the abspath", async () => {
    const binDir = join(fakeHome, "pathbin2");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "cue"), "not executable\n"); // no chmod +x
    const repoRoot = join(fakeHome, "repo2");
    await mkdir(join(repoRoot, "bin"), { recursive: true });
    await writeFile(join(repoRoot, "bin", "cue"), "#!/usr/bin/env bun\n");
    const out = resolveCueInvocation({ pathDirs: [binDir], repoRoot });
    expect(out).toBe(`"${join(repoRoot, "bin", "cue")}"`);
  });

  test("falls back to a quoted absolute path when cue is not on PATH (source clone)", async () => {
    const repoRoot = join(fakeHome, "repo");
    await mkdir(join(repoRoot, "bin"), { recursive: true });
    await writeFile(join(repoRoot, "bin", "cue"), "#!/usr/bin/env bun\n");
    const emptyDir = join(fakeHome, "empty");
    await mkdir(emptyDir, { recursive: true });
    const out = resolveCueInvocation({ pathDirs: [emptyDir], repoRoot });
    expect(out).toBe(`"${join(repoRoot, "bin", "cue")}"`);
    // Either form must keep the `launch claude` substring intact downstream.
    expect(`exec ${out} launch claude "$@"`).toContain("launch claude");
  });
});

describe("resolveHookShell", () => {
  test("honors an explicit shell argument over the login shell", () => {
    expect(resolveHookShell("bash", "/usr/bin/fish")).toBe("bash");
  });

  test("falls back to the login shell when no explicit shell is provided", () => {
    expect(resolveHookShell(undefined, "/usr/bin/fish")).toBe("fish");
  });
});
