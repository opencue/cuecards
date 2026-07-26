/**
 * D9 activation check (checkActivation). Injectable opts let us drive it
 * against a throwaway HOME/PATH without touching the real machine.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkActivation } from "./doctor";
import { shimDir } from "../lib/shim-dir";

let home: string;
let binDir: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cue-doctor-"));
  binDir = shimDir(home);
  mkdirSync(binDir, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function writeShim() {
  writeFileSync(join(binDir, "claude"), '#!/usr/bin/env bash\nexec cue launch claude "$@"\n');
}

describe("checkActivation (D9)", () => {
  test("no shim → D9 warning (gating)", () => {
    const issues = checkActivation({ homeDir: home, realBin: "/usr/bin/claude", pathDirs: [binDir, "/usr/bin"] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("D9");
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("shim missing");
    expect(issues[0]!.fix).toBe("cue shell install");
  });

  test("shim + real bin + shim dir first on PATH → healthy", () => {
    writeShim();
    const issues = checkActivation({ homeDir: home, realBin: "/usr/bin/claude", pathDirs: [binDir, "/usr/bin"] });
    expect(issues).toHaveLength(0);
  });

  test("shim + real bin shadowing the shim on PATH → D9 error", () => {
    writeShim();
    const issues = checkActivation({ homeDir: home, realBin: "/usr/bin/claude", pathDirs: ["/usr/bin", binDir] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("D9");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("shadowed");
  });

  test("shim installed but the shim dir is not on PATH → D9 error", () => {
    // New failure mode: cue's shim dir is a directory nothing else puts on
    // PATH, so "installed but never runs" is a real state to catch.
    writeShim();
    const issues = checkActivation({ homeDir: home, realBin: "/usr/bin/claude", pathDirs: ["/usr/bin"] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("D9");
    expect(issues[0]!.severity).toBe("error");
    expect(issues[0]!.message).toContain("not on PATH");
  });

  test("shim but no real claude binary → D9 warning", () => {
    writeShim();
    const issues = checkActivation({ homeDir: home, realBin: null, pathDirs: [binDir] });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("D9");
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("not found");
  });
});
