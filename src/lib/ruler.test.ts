import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  gatherRules,
  concatRules,
  applyRuler,
  revertRuler,
  updateGitignore,
  revertGitignore,
  runAutoRuler,
  isRulerAutoEnabled,
  RULER_MARKER,
} from "./ruler";
import type { AgentAdapter } from "./agent-adapters";

// --- Isolation: pin CUE_REPO_ROOT to a tmp fixture so gatherRules reads OUR
// rule files, not the repo's resources/rules/ or a shell-leaked env value
// (see memory: cue-tests-ambient-env-leak / cue-test-env-isolation).
let repo: string; // fixture repo root (holds resources/rules/)
let work: string; // target project dir for apply/revert
const ORIG_CUE_REPO_ROOT = process.env.CUE_REPO_ROOT;

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "cue-ruler-repo-"));
  work = await mkdtemp(join(tmpdir(), "cue-ruler-work-"));
  process.env.CUE_REPO_ROOT = repo;
  const rulesDir = join(repo, "resources", "rules", "common");
  await mkdir(rulesDir, { recursive: true });
  await writeFile(join(rulesDir, "a.md"), "# Rule A\nbody a\n");
  await writeFile(join(rulesDir, "b.md"), "# Rule B\nbody b\n");
});

afterEach(async () => {
  if (ORIG_CUE_REPO_ROOT === undefined) delete process.env.CUE_REPO_ROOT;
  else process.env.CUE_REPO_ROOT = ORIG_CUE_REPO_ROOT;
  await rm(repo, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

/** Minimal AgentAdapter whose rules file is <work>/<fileRel>. */
function fakeAdapter(id: string, fileRel: string): AgentAdapter {
  return {
    id,
    name: id,
    configDir: () => work,
    writeSkills: () => {},
    writeMcps: () => {},
    rulesFile: (targetDir) => join(targetDir, fileRel),
    detectBinary: () => null,
  };
}

describe("gatherRules", () => {
  test("reads refs in order, normalizes .md, skips missing", () => {
    const got = gatherRules(["common/a", "common/missing", "common/b.md"]);
    expect(got.map((r) => r.source)).toEqual(["common/a.md", "common/b.md"]);
    expect(got[0]!.content).toBe("# Rule A\nbody a"); // trimmed
  });

  test("empty when no refs resolve", () => {
    expect(gatherRules(["nope/x", "also/missing"])).toEqual([]);
  });

  test("skips refs that escape the rules root (.. / absolute)", () => {
    expect(gatherRules(["../../etc/passwd", "/etc/hosts", "common/../../../a"])).toEqual([]);
    // a legitimate sibling ref still resolves
    expect(gatherRules(["common/a"]).length).toBe(1);
  });
});

describe("concatRules", () => {
  test("stamps marker + per-rule source markers", () => {
    const out = concatRules(gatherRules(["common/a", "common/b"]));
    expect(out).toContain(RULER_MARKER);
    expect(out).toContain("<!-- Source: common/a.md -->");
    expect(out).toContain("<!-- Source: common/b.md -->");
    expect(out).toContain("body a");
    // a's source marker precedes b's
    expect(out.indexOf("common/a.md")).toBeLessThan(out.indexOf("common/b.md"));
  });
});

describe("applyRuler", () => {
  test("writes each agent's native file; shared path written once", () => {
    const content = "RULES_CONTENT";
    const adapters = [
      fakeAdapter("codex", "AGENTS.md"),
      fakeAdapter("cursor", ".cursorrules"),
      fakeAdapter("amp", "AGENTS.md"), // shares AGENTS.md with codex
    ];
    const actions = applyRuler({ adapters, content, targetDir: work });
    expect(actions.map((a) => a.kind)).toEqual(["write", "write", "skip-shared"]);
    expect(existsSync(join(work, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(work, ".cursorrules"))).toBe(true);
  });

  test("backs up a pre-existing file once, then is idempotent", async () => {
    await writeFile(join(work, "AGENTS.md"), "OLD HAND-WRITTEN");
    const adapters = [fakeAdapter("codex", "AGENTS.md")];

    const first = applyRuler({ adapters, content: "NEW", targetDir: work });
    expect(first[0]!.kind).toBe("backup+write");
    expect(await readFile(join(work, "AGENTS.md.bak"), "utf8")).toBe("OLD HAND-WRITTEN");
    expect(await readFile(join(work, "AGENTS.md"), "utf8")).toBe("NEW");

    // Second run must NOT overwrite the .bak (it holds the true pre-ruler state).
    const second = applyRuler({ adapters, content: "NEWER", targetDir: work });
    expect(second[0]!.kind).toBe("write");
    expect(await readFile(join(work, "AGENTS.md.bak"), "utf8")).toBe("OLD HAND-WRITTEN");
    expect(await readFile(join(work, "AGENTS.md"), "utf8")).toBe("NEWER");
  });

  test("dry-run writes nothing", () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    const actions = applyRuler({ adapters, content: "X", targetDir: work, dryRun: true });
    expect(actions[0]!.kind).toBe("dry-write");
    expect(existsSync(join(work, ".cursorrules"))).toBe(false);
  });

  test("null rulesFile is skipped", () => {
    const noFile: AgentAdapter = { ...fakeAdapter("x", "y"), rulesFile: () => null };
    const actions = applyRuler({ adapters: [noFile], content: "X", targetDir: work });
    expect(actions[0]!.kind).toBe("skip-no-file");
  });
});

describe("applyRuler — safe mode", () => {
  const marked = (body: string) => `${RULER_MARKER}\n${body}`;

  test("writes when the file is absent (no .bak)", () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    const actions = applyRuler({ adapters, content: marked("X"), targetDir: work, mode: "safe" });
    expect(actions[0]!.kind).toBe("write");
    expect(existsSync(join(work, ".cursorrules"))).toBe(true);
    expect(existsSync(join(work, ".cursorrules.bak"))).toBe(false);
  });

  test("never clobbers a hand-written (foreign) file", async () => {
    await writeFile(join(work, "AGENTS.md"), "HAND-WRITTEN, no marker");
    const adapters = [fakeAdapter("codex", "AGENTS.md")];
    const actions = applyRuler({ adapters, content: marked("X"), targetDir: work, mode: "safe" });
    expect(actions[0]!.kind).toBe("skip-foreign-safe");
    expect(await readFile(join(work, "AGENTS.md"), "utf8")).toBe("HAND-WRITTEN, no marker");
    expect(existsSync(join(work, "AGENTS.md.bak"))).toBe(false);
  });

  test("treats a hand-written file that merely quotes the marker as foreign", async () => {
    // M1: marker must be at the START to count as ours; a doc snippet that
    // mentions `<!-- cue:ruler -->` mid-file must NOT be overwritten.
    await writeFile(join(work, ".cursorrules"), `# My notes\nThe header is ${RULER_MARKER} fyi\n`);
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    const before = await readFile(join(work, ".cursorrules"), "utf8");
    const actions = applyRuler({ adapters, content: marked("X"), targetDir: work, mode: "safe" });
    expect(actions[0]!.kind).toBe("skip-foreign-safe");
    expect(await readFile(join(work, ".cursorrules"), "utf8")).toBe(before); // untouched
  });

  test("no-ops when our file is already current", async () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    const content = marked("SAME");
    await writeFile(join(work, ".cursorrules"), content);
    const actions = applyRuler({ adapters, content, targetDir: work, mode: "safe" });
    expect(actions[0]!.kind).toBe("skip-current");
  });

  test("refreshes our file when content drifted", async () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    await writeFile(join(work, ".cursorrules"), marked("OLD"));
    const actions = applyRuler({ adapters, content: marked("NEW"), targetDir: work, mode: "safe" });
    expect(actions[0]!.kind).toBe("write");
    expect(await readFile(join(work, ".cursorrules"), "utf8")).toBe(marked("NEW"));
  });

  test("dry-run writes nothing", () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    const actions = applyRuler({ adapters, content: marked("X"), targetDir: work, mode: "safe", dryRun: true });
    expect(actions[0]!.kind).toBe("dry-write");
    expect(existsSync(join(work, ".cursorrules"))).toBe(false);
  });
});

describe("runAutoRuler", () => {
  test("writes the profile's agents' files in safe mode", () => {
    const actions = runAutoRuler({
      profile: { rules: ["common/a"], agents: ["cursor", "codex"] },
      targetDir: work,
    });
    expect(actions.map((a) => a.kind)).toEqual(["write", "write"]);
    expect(existsSync(join(work, ".cursorrules"))).toBe(true);
    expect(existsSync(join(work, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(work, ".cursorrules.bak"))).toBe(false);
  });

  test("returns [] when the profile has no rules", () => {
    expect(runAutoRuler({ profile: { rules: [], agents: ["cursor"] }, targetDir: work })).toEqual([]);
  });

  test("returns [] when no agents resolve", () => {
    expect(runAutoRuler({ profile: { rules: ["common/a"], agents: ["nope"] }, targetDir: work })).toEqual([]);
  });

  test("dry-run previews without writing", () => {
    const actions = runAutoRuler({
      profile: { rules: ["common/a"], agents: ["cursor"] },
      targetDir: work,
      dryRun: true,
    });
    expect(actions[0]!.kind).toBe("dry-write");
    expect(existsSync(join(work, ".cursorrules"))).toBe(false);
  });
});

describe("isRulerAutoEnabled", () => {
  test("true for enabling values, false otherwise", () => {
    for (const v of ["1", "true", "on", "auto", "AUTO", " On "]) expect(isRulerAutoEnabled(v)).toBe(true);
    for (const v of [undefined, "", "0", "off", "no", "false"]) expect(isRulerAutoEnabled(v)).toBe(false);
  });
});

describe("revertRuler", () => {
  test("restores from .bak and drops it (keepBackups retains)", async () => {
    await writeFile(join(work, "AGENTS.md"), "OLD");
    const adapters = [fakeAdapter("codex", "AGENTS.md")];
    applyRuler({ adapters, content: "NEW", targetDir: work });

    const reverted = revertRuler({ adapters, targetDir: work });
    expect(reverted[0]!.kind).toBe("revert-restore");
    expect(await readFile(join(work, "AGENTS.md"), "utf8")).toBe("OLD");
    expect(existsSync(join(work, "AGENTS.md.bak"))).toBe(false);
  });

  test("keepBackups retains the .bak", async () => {
    await writeFile(join(work, "AGENTS.md"), "OLD");
    const adapters = [fakeAdapter("codex", "AGENTS.md")];
    applyRuler({ adapters, content: "NEW", targetDir: work });
    revertRuler({ adapters, targetDir: work, keepBackups: true });
    expect(existsSync(join(work, "AGENTS.md.bak"))).toBe(true);
  });

  test("deletes a cue-generated file when no .bak exists", () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    applyRuler({ adapters, content: concatRules(gatherRules(["common/a"])), targetDir: work });
    expect(existsSync(join(work, ".cursorrules"))).toBe(true);

    const reverted = revertRuler({ adapters, targetDir: work });
    expect(reverted[0]!.kind).toBe("revert-delete");
    expect(existsSync(join(work, ".cursorrules"))).toBe(false);
  });

  test("leaves a foreign (non-cue) file intact", async () => {
    await writeFile(join(work, ".cursorrules"), "hand-written, no marker");
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    const reverted = revertRuler({ adapters, targetDir: work });
    expect(reverted[0]!.kind).toBe("revert-foreign");
    expect(existsSync(join(work, ".cursorrules"))).toBe(true);
  });

  test("nothing to revert when no file and no .bak", () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    expect(revertRuler({ adapters, targetDir: work })[0]!.kind).toBe("revert-none");
  });

  test("dry-run revert reports restore but changes nothing", async () => {
    await writeFile(join(work, "AGENTS.md"), "OLD");
    const adapters = [fakeAdapter("codex", "AGENTS.md")];
    applyRuler({ adapters, content: "NEW", targetDir: work }); // .bak=OLD, file=NEW

    const dry = revertRuler({ adapters, targetDir: work, dryRun: true });
    expect(dry[0]!.kind).toBe("dry-revert-restore");
    expect(await readFile(join(work, "AGENTS.md"), "utf8")).toBe("NEW"); // untouched
    expect(existsSync(join(work, "AGENTS.md.bak"))).toBe(true); // untouched
  });

  test("dry-run revert of a generated file reports delete, keeps file", () => {
    const adapters = [fakeAdapter("cursor", ".cursorrules")];
    applyRuler({ adapters, content: concatRules(gatherRules(["common/a"])), targetDir: work });

    const dry = revertRuler({ adapters, targetDir: work, dryRun: true });
    expect(dry[0]!.kind).toBe("dry-revert-delete");
    expect(existsSync(join(work, ".cursorrules"))).toBe(true); // untouched
  });
});

describe("revertGitignore", () => {
  test("strips the managed block and is idempotent", async () => {
    updateGitignore(work, [".cursorrules"]);
    expect((await readFile(join(work, ".gitignore"), "utf8"))).toContain("# cue ruler");

    expect(revertGitignore(work)).toBe(true);
    const body = await readFile(join(work, ".gitignore"), "utf8");
    expect(body).not.toContain("# cue ruler");
    expect(body).not.toContain(".cursorrules");
    expect(revertGitignore(work)).toBe(false); // nothing left to strip
  });

  test("preserves unrelated .gitignore entries", async () => {
    await writeFile(join(work, ".gitignore"), "node_modules\ndist\n");
    updateGitignore(work, [".cursorrules"]);
    revertGitignore(work);
    const body = await readFile(join(work, ".gitignore"), "utf8");
    expect(body).toContain("node_modules");
    expect(body).toContain("dist");
    expect(body).not.toContain(".cursorrules");
  });

  test("dry-run reports without writing", async () => {
    updateGitignore(work, [".cursorrules"]);
    expect(revertGitignore(work, true)).toBe(true);
    expect((await readFile(join(work, ".gitignore"), "utf8"))).toContain("# cue ruler"); // untouched
  });
});

describe("updateGitignore", () => {
  test("adds rule files + .bak siblings, idempotent", async () => {
    const added = updateGitignore(work, [".cursorrules", "AGENTS.md"]);
    expect(added).toEqual([".cursorrules", ".cursorrules.bak", "AGENTS.md", "AGENTS.md.bak"]);
    const body = await readFile(join(work, ".gitignore"), "utf8");
    expect(body).toContain("# cue ruler");
    // second call adds nothing already-present
    expect(updateGitignore(work, [".cursorrules"])).toEqual([]);
  });

  test("dry-run reports without writing", () => {
    const added = updateGitignore(work, [".cursorrules"], true);
    expect(added).toEqual([".cursorrules", ".cursorrules.bak"]);
    expect(existsSync(join(work, ".gitignore"))).toBe(false);
  });
});
