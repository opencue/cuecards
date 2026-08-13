import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runInstall, runUninstall, shimInstalled, resolveCueInvocation, resolveHookShell } from "./shell";
import { shimDir, fishDropInPath } from "../lib/shim-dir";

let fakeHome: string;
let err: string;

/** Silence install output and capture it for assertions. */
const sinks = () => ({
  out: () => {},
  err: (s: string) => { err += s; },
});

const localBin = (agent: string) => join(fakeHome, ".local", "bin", agent);
const shim = (agent: string) => join(shimDir(fakeHome), agent);

const CUE_SHIM = '#!/usr/bin/env bash\nexec cue launch claude "$@"\n';
const REAL_BINARY = `#!/usr/bin/env bash\n# a real wrapper, not ours\nexec /opt/anthropic/claude "$@"\n`;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), "cue-shell-"));
  await mkdir(join(fakeHome, ".local", "bin"), { recursive: true });
  err = "";
});
afterEach(async () => { await rm(fakeHome, { recursive: true, force: true }); });

describe("shell install", () => {
  test("writes claude and codex shims into cue's own shim dir", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [shimDir(fakeHome), "/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
      writeRc: false,
      ...sinks(),
    });
    expect(rc).toBe(0);

    // Assert on `launch <agent>` (present in both the bare and absolute-path
    // shim forms) rather than the exact invocation token, which depends on
    // whether `cue` is resolvable on the test runner's PATH.
    expect(await readFile(shim("claude"), "utf8")).toContain("launch claude");
    expect(await readFile(shim("codex"), "utf8")).toContain("launch codex");

    const st = await stat(shim("claude"));
    expect((st.mode & 0o111) !== 0).toBe(true); // executable
  });

  test("only shims agents that have a real binary behind them", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [shimDir(fakeHome)],
      realClaude: "/usr/bin/claude",
      realCodex: null, // codex not installed on this machine
      writeRc: false,
      ...sinks(),
    });
    expect(rc).toBe(0);
    expect(await readFile(shim("claude"), "utf8")).toContain("launch claude");
    await expect(stat(shim("codex"))).rejects.toThrow();
  });

  // The regression that motivated the shim dir: ~/.local/bin/claude is the
  // native installer's symlink to the real binary, and is often the ONLY
  // claude on PATH. Overwriting it left cue with nothing to exec.
  test("never touches a non-cue ~/.local/bin/claude", async () => {
    await writeFile(localBin("claude"), REAL_BINARY);
    await chmod(localBin("claude"), 0o755);

    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [shimDir(fakeHome), join(fakeHome, ".local", "bin")],
      realClaude: localBin("claude"),
      realCodex: null,
      writeRc: false,
      ...sinks(),
    });

    expect(rc).toBe(0);
    expect(await readFile(localBin("claude"), "utf8")).toBe(REAL_BINARY);
  });

  test("removes a legacy cue shim from ~/.local/bin", async () => {
    await writeFile(localBin("claude"), CUE_SHIM);
    await chmod(localBin("claude"), 0o755);

    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [shimDir(fakeHome), "/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: null,
      writeRc: false,
      ...sinks(),
    });

    expect(rc).toBe(0);
    // Left in place it would shadow the real binary the new shim needs to exec.
    await expect(stat(localBin("claude"))).rejects.toThrow();
  });

  test("refuses, and writes nothing, when no real agent binary exists", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: [shimDir(fakeHome)],
      realClaude: null,
      realCodex: null,
      writeRc: false,
      ...sinks(),
    });

    expect(rc).toBe(1);
    expect(err).toContain("nothing behind it");
    // A shim with no real binary behind it is exactly the breakage being fixed.
    await expect(stat(shimDir(fakeHome))).rejects.toThrow();
  });

  test("warns instead of failing when the shim dir is not on PATH", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: ["/usr/bin"], // shim dir absent
      realClaude: "/usr/bin/claude",
      realCodex: null,
      writeRc: false,
      ...sinks(),
    });

    // The shims are inert until PATH changes, so writing them early is safe —
    // and this run may be the one that adds the line.
    expect(rc).toBe(0);
    expect(err).toContain("not on PATH");
    expect(await readFile(shim("claude"), "utf8")).toContain("launch claude");
  });

  test("warns when the real binary's dir shadows the shim dir", async () => {
    const rc = await runInstall({
      homeDir: fakeHome,
      pathDirs: ["/usr/bin", shimDir(fakeHome)], // wrong order
      realClaude: "/usr/bin/claude",
      realCodex: null,
      writeRc: false,
      ...sinks(),
    });

    expect(rc).toBe(0);
    expect(err).toContain("shadows the shim");
  });
});

describe("shell install — PATH configuration", () => {
  const installFish = () => runInstall({
    homeDir: fakeHome,
    pathDirs: ["/usr/bin"],
    realClaude: "/usr/bin/claude",
    realCodex: null,
    shell: "fish",
    ...sinks(),
  });

  test("creates the fish drop-in without asking", async () => {
    await installFish();
    const body = await readFile(fishDropInPath(fakeHome), "utf8");
    expect(body).toContain(shimDir(fakeHome));
  });

  test("running install twice does not duplicate the fish line", async () => {
    await installFish();
    await installFish();
    const body = await readFile(fishDropInPath(fakeHome), "utf8");
    expect(body.split(shimDir(fakeHome)).length - 1).toBe(1);
  });

  test("leaves a foreign fish drop-in alone", async () => {
    const target = fishDropInPath(fakeHome);
    await mkdir(join(fakeHome, ".config", "fish", "conf.d"), { recursive: true });
    await writeFile(target, "# hand-written, not ours\n");

    await installFish();

    expect(await readFile(target, "utf8")).toBe("# hand-written, not ours\n");
    expect(err).toContain("leaving it alone");
  });

  const installBash = (opts: { yes?: boolean; confirm?: () => Promise<boolean> } = {}) => runInstall({
    homeDir: fakeHome,
    pathDirs: ["/usr/bin"],
    realClaude: "/usr/bin/claude",
    realCodex: null,
    shell: "bash",
    ...opts,
    ...sinks(),
  });

  test("does not touch .bashrc without confirmation", async () => {
    await writeFile(join(fakeHome, ".bashrc"), "# mine\n");
    await installBash({ confirm: async () => false });
    expect(await readFile(join(fakeHome, ".bashrc"), "utf8")).toBe("# mine\n");
    expect(err).toContain("not on PATH");
  });

  test("appends to .bashrc once when confirmed", async () => {
    await writeFile(join(fakeHome, ".bashrc"), "# mine\n");
    await installBash({ yes: true });
    await installBash({ yes: true });
    const body = await readFile(join(fakeHome, ".bashrc"), "utf8");
    expect(body).toContain("# mine");
    expect(body.split(shimDir(fakeHome)).length - 1).toBe(1);
  });

  test("--no-rc writes nothing and prints the line", async () => {
    await runInstall({
      homeDir: fakeHome,
      pathDirs: ["/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: null,
      shell: "fish",
      writeRc: false,
      ...sinks(),
    });
    await expect(stat(fishDropInPath(fakeHome))).rejects.toThrow();
    expect(err).toContain("fish_add_path");
  });
});

describe("shell uninstall", () => {
  test("removes the shims and the fish drop-in", async () => {
    await runInstall({
      homeDir: fakeHome,
      pathDirs: ["/usr/bin"],
      realClaude: "/usr/bin/claude",
      realCodex: "/usr/bin/codex",
      shell: "fish",
      ...sinks(),
    });

    const rc = await runUninstall({ homeDir: fakeHome, ...sinks() });
    expect(rc).toBe(0);
    await expect(stat(shim("claude"))).rejects.toThrow();
    await expect(stat(shim("codex"))).rejects.toThrow();
    await expect(stat(fishDropInPath(fakeHome))).rejects.toThrow();
  });

  // Deleting this path on a native install would take out the user's whole
  // Claude installation, so uninstall reports it and lets them decide.
  test("reports but never deletes a legacy ~/.local/bin shim", async () => {
    await writeFile(localBin("claude"), CUE_SHIM);
    const rc = await runUninstall({ homeDir: fakeHome, ...sinks() });
    expect(rc).toBe(0);
    expect(await readFile(localBin("claude"), "utf8")).toBe(CUE_SHIM);
    expect(err).toContain("legacy cue shim remains");
  });

  test("leaves a foreign fish drop-in alone", async () => {
    const target = fishDropInPath(fakeHome);
    await mkdir(join(fakeHome, ".config", "fish", "conf.d"), { recursive: true });
    await writeFile(target, "# hand-written, not ours\n");
    await runUninstall({ homeDir: fakeHome, ...sinks() });
    expect(await readFile(target, "utf8")).toBe("# hand-written, not ours\n");
  });
});

describe("shimInstalled", () => {
  test("false when no shim exists", () => {
    expect(shimInstalled(fakeHome)).toBe(false);
  });

  test("true for a shim in cue's shim dir", async () => {
    await mkdir(shimDir(fakeHome), { recursive: true });
    await writeFile(shim("claude"), CUE_SHIM);
    expect(shimInstalled(fakeHome)).toBe(true);
  });

  test("true for the `cue shell install` absolute-path format", async () => {
    await mkdir(shimDir(fakeHome), { recursive: true });
    await writeFile(shim("claude"), '#!/usr/bin/env bash\nexec "/home/u/Documents/cue/bin/cue" launch claude "$@"\n');
    expect(shimInstalled(fakeHome)).toBe(true);
  });

  // Keeps `cue init`'s "not activated yet" hint correct mid-migration.
  test("still recognizes a legacy ~/.local/bin shim", async () => {
    await writeFile(localBin("claude"), CUE_SHIM);
    expect(shimInstalled(fakeHome)).toBe(true);
  });

  test("false for a non-cue claude on PATH", async () => {
    await writeFile(localBin("claude"), REAL_BINARY);
    expect(shimInstalled(fakeHome)).toBe(false);
  });

  test("is agent-aware", async () => {
    await mkdir(shimDir(fakeHome), { recursive: true });
    await writeFile(shim("codex"), '#!/usr/bin/env bash\nexec cue launch codex "$@"\n');
    expect(shimInstalled(fakeHome, "codex")).toBe(true);
    expect(shimInstalled(fakeHome, "claude")).toBe(false);
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
