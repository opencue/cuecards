import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findRealAgentBin } from "./claude-binary";

describe("findRealAgentBin", () => {
  let root: string;
  let savedPath: string | undefined;
  let savedXdg: string | undefined;

  const dir = (name: string): string => {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const writeExec = (d: string, name: string, content: string): string => {
    const p = join(d, name);
    writeFileSync(p, content);
    chmodSync(p, 0o755);
    return p;
  };
  const shimContent = '#!/usr/bin/env bash\nexec cue launch claude "$@"\n';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cue-binfind-"));
    savedPath = process.env.PATH;
    savedXdg = process.env.XDG_CONFIG_HOME;
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    rmSync(root, { recursive: true, force: true });
  });

  test("skips a small `cue launch` shim and finds the real binary in a later dir", () => {
    const shimDir = dir("shim");
    writeExec(shimDir, "claude", shimContent);
    const realDir = dir("real");
    const real = writeExec(realDir, "claude", "#!/bin/sh\n" + "x".repeat(600));
    process.env.PATH = `${shimDir}:${realDir}`;
    expect(findRealAgentBin("claude")).toBe(real);
  });

  test("finds a real large binary even when it shares the shim's directory", () => {
    // Regression: the native Claude installer puts the REAL binary in
    // ~/.local/bin — the same dir cue's shim convention uses. Skipping that
    // directory wholesale left zero candidates after the npm package dropped
    // its `claude` bin. Detection must be by content, not by directory.
    const localBin = dir("local-bin");
    const real = writeExec(localBin, "claude", "\x7fELF" + "x".repeat(1000));
    process.env.PATH = localBin;
    expect(findRealAgentBin("claude")).toBe(real);
  });

  test("follows a symlink to the real versioned binary (native installer layout)", () => {
    const versions = dir("versions");
    const target = writeExec(versions, "2.1.198", "\x7fELF" + "x".repeat(1000));
    const localBin = dir("local-bin2");
    const link = join(localBin, "claude");
    symlinkSync(target, link);
    process.env.PATH = localBin;
    expect(findRealAgentBin("claude")).toBe(link);
  });

  test("returns null when only shims exist", () => {
    const shimDir = dir("only-shim");
    writeExec(shimDir, "claude", shimContent);
    process.env.PATH = shimDir;
    expect(findRealAgentBin("claude")).toBeNull();
  });

  test("skips non-executable files", () => {
    const d = dir("noexec");
    const p = join(d, "codex");
    writeFileSync(p, "x".repeat(600));
    chmodSync(p, 0o644);
    process.env.PATH = d;
    expect(findRealAgentBin("codex")).toBeNull();
  });

  test("works for codex too", () => {
    const shimDir = dir("codex-shim");
    writeExec(shimDir, "codex", '#!/usr/bin/env bash\nexec cue launch codex "$@"\n');
    const realDir = dir("codex-real");
    const real = writeExec(realDir, "codex", "#!/bin/sh\n" + "x".repeat(600));
    process.env.PATH = `${shimDir}:${realDir}`;
    expect(findRealAgentBin("codex")).toBe(real);
  });

  // cue owns its shim dir outright, so the directory guard stands on its own —
  // it must hold even when the content heuristic would pass the file through.
  test("skips cue's own shim dir even for a large file", () => {
    process.env.XDG_CONFIG_HOME = root;
    const cueShims = dir(join("cue", "shims"));
    writeExec(cueShims, "claude", "\x7fELF" + "x".repeat(1000));
    const realDir = dir("real-behind");
    const real = writeExec(realDir, "claude", "\x7fELF" + "x".repeat(1000));
    process.env.PATH = `${cueShims}:${realDir}`;
    expect(findRealAgentBin("claude")).toBe(real);
  });

  test("returns null when cue's shim dir is the only entry", () => {
    process.env.XDG_CONFIG_HOME = root;
    const cueShims = dir(join("cue", "shims"));
    writeExec(cueShims, "claude", shimContent);
    process.env.PATH = cueShims;
    expect(findRealAgentBin("claude")).toBeNull();
  });

  // Regression: the old inline /cue\s+launch/i missed this form, because the
  // quote between `cue` and `launch` isn't whitespace — so a source-clone
  // user's legacy shim was returned as the real binary and cue recursed.
  test("skips a legacy shim written in the quoted-absolute-path form", () => {
    const localBin = dir("legacy-abs");
    writeExec(localBin, "claude", '#!/usr/bin/env bash\nexec "/home/u/Documents/cue/bin/cue" launch claude "$@"\n');
    process.env.PATH = localBin;
    expect(findRealAgentBin("claude")).toBeNull();
  });
});
