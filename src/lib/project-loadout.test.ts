import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ResolvedProfile, ResolvedSkill } from "../../profiles/_types";
import {
  applyProjectLoadout,
  classifySkills,
  deleteLoadout,
  findLoadoutDir,
  LOADOUT_MIN_SKILLS,
  projectSignals,
  readLoadout,
  signalsHash,
  skillFingerprint,
  writeLoadout,
} from "./project-loadout";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cue-loadout-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const mkProject = (pkg?: object, files: string[] = []): string => {
  const dir = join(root, "proj");
  mkdirSync(dir, { recursive: true });
  if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  for (const f of files) writeFileSync(join(dir, f), "");
  return dir;
};

describe("projectSignals", () => {
  test("extracts dependency names and framework markers", () => {
    const dir = mkProject(
      { dependencies: { "@medusajs/medusa": "^2", stripe: "^14" }, devDependencies: { vite: "^5" } },
      ["vite.config.ts"],
    );
    const signals = projectSignals(dir);
    expect(signals.has("medusa")).toBe(true);
    expect(signals.has("medusajs")).toBe(true);
    expect(signals.has("stripe")).toBe(true);
    expect(signals.has("vite")).toBe(true);
    expect(signals.has("typescript")).toBe(true); // package.json ⇒ TS per scanner
  });

  test("monorepo: deps in nested apps/*/package.json contribute signals", () => {
    const dir = mkProject({ devDependencies: { turbo: "^2", prettier: "^3" } });
    const backend = join(dir, "apps", "backend");
    mkdirSync(backend, { recursive: true });
    writeFileSync(
      join(backend, "package.json"),
      JSON.stringify({ dependencies: { "@medusajs/medusa": "^2", stripe: "^14" } }),
    );
    mkdirSync(join(dir, "node_modules", "trap"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "trap", "package.json"),
      JSON.stringify({ dependencies: { "left-pad": "1" } }),
    );
    const signals = projectSignals(dir);
    expect(signals.has("medusa")).toBe(true);
    expect(signals.has("stripe")).toBe(true);
    expect(signals.has("turbo")).toBe(true);
    expect(signals.has("left")).toBe(false); // node_modules never swept
  });

  test("strips generic tokens and survives an empty dir", () => {
    const dir = mkProject({ dependencies: { "some-config": "1", "api-client": "1" } });
    const signals = projectSignals(dir);
    expect(signals.has("config")).toBe(false);
    expect(signals.has("api")).toBe(false);
    expect(signals.has("client")).toBe(false);
    expect(projectSignals(join(root, "does-not-exist")).size).toBe(0);
  });
});

describe("classifySkills", () => {
  const skill = (id: string, when?: ResolvedSkill["when"]): ResolvedSkill => ({ id, when });
  const noDesc = () => "";

  test("id-token match beats deferral; unmatched skills defer", () => {
    const { full, deferred } = classifySkills({
      skills: [skill("medusa/db-migrate"), skill("gstack/browse")],
      signals: new Set(["medusa", "vite"]),
      cwd: root,
      describe: noDesc,
    });
    expect(full).toEqual(["medusa/db-migrate"]);
    expect(deferred).toEqual(["gstack/browse"]);
  });

  test("description word-boundary match keeps a skill", () => {
    const { full } = classifySkills({
      skills: [skill("ops/db-generate")],
      signals: new Set(["medusa"]),
      cwd: root,
      describe: () => "Generate migrations for the Medusa backend",
    });
    expect(full).toEqual(["ops/db-generate"]);
  });

  test("short signals never match description prose", () => {
    const { deferred } = classifySkills({
      skills: [skill("misc/notes")],
      signals: new Set(["ci"]), // < 4 chars — id tokens only
      cwd: root,
      describe: () => "helps you circle back on ci things", // 'ci' appears
    });
    expect(deferred).toEqual(["misc/notes"]);
  });

  test("ALWAYS_KEEP operational skills stay full with zero signals", () => {
    const { full } = classifySkills({
      skills: [skill("meta/analyze"), skill("random/other")],
      signals: new Set(),
      cwd: root,
      describe: noDesc,
    });
    expect(full).toEqual(["meta/analyze"]);
  });

  test("when: condition is evaluated against cwd and beats keyword mismatch", () => {
    const dir = mkProject(undefined, ["medusa-config.ts"]);
    const { full, deferred } = classifySkills({
      skills: [
        skill("a/gated-present", { has_file: "medusa-config.ts" }),
        skill("b/gated-absent", { has_file: "nope.xyz" }),
      ],
      signals: new Set(),
      cwd: dir,
      describe: noDesc,
    });
    expect(full).toEqual(["a/gated-present"]);
    expect(deferred).toEqual(["b/gated-absent"]);
  });

  test("userKeep and userDefer override everything else", () => {
    const { full, deferred } = classifySkills({
      skills: [skill("meta/analyze"), skill("gstack/browse")],
      signals: new Set(),
      cwd: root,
      describe: noDesc,
      userKeep: ["gstack/browse"],
      userDefer: ["meta/analyze"],
    });
    expect(full).toEqual(["gstack/browse"]);
    expect(deferred).toEqual(["meta/analyze"]);
  });
});

describe("loadout persistence", () => {
  const entry = (over: Partial<Parameters<typeof writeLoadout>[1]> = {}) => ({
    profile: "combo",
    fingerprint: "f1",
    signalsHash: "s1",
    full: ["a/b"],
    deferred: ["c/d"],
    userKeep: [],
    userDefer: [],
    enabled: true,
    capturedAt: "2026-07-02T00:00:00.000Z",
    ...over,
  });

  test("round-trips, deletes, and walks parents via findLoadoutDir", () => {
    const file = join(root, "loadouts.json");
    const dir = join(root, "a", "b");
    writeLoadout(dir, entry(), file);
    expect(readLoadout(dir, file)?.full).toEqual(["a/b"]);
    expect(findLoadoutDir(join(dir, "deep", "sub"), file)).toBe(dir);
    expect(findLoadoutDir(join(root, "elsewhere"), file)).toBeUndefined();
    expect(deleteLoadout(dir, file)).toBe(true);
    expect(readLoadout(dir, file)).toBeUndefined();
  });

  test("fingerprints are order-independent and case-insensitive", () => {
    expect(skillFingerprint(["A/b", "c/d"])).toBe(skillFingerprint(["c/d", "a/b"]));
    expect(signalsHash(new Set(["x", "y"]))).toBe(signalsHash(new Set(["y", "x"])));
  });
});

describe("applyProjectLoadout", () => {
  const mkProfile = (ids: string[]): ResolvedProfile =>
    ({
      name: "combo",
      agents: ["claude-code"],
      skills: { local: ids.map((id) => ({ id })), npx: [] },
      mcps: [], plugins: [], env: {}, rules: [], commands: [], hooks: [],
      subagents: [], persona: "", personaIncludes: [], playbooks: [],
      qualityGates: [], evals: [], recommends: [], autoSelect: [],
      conflicts: [], inheritanceChain: [], personaRouting: [],
    }) as unknown as ResolvedProfile;

  const manyIds = (n: number, prefix = "misc/skill"): string[] =>
    Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

  const readSkill = async (id: string) => ({
    description: id.startsWith("medusa/") ? "medusa things" : "",
    path: `/skills/${id}/SKILL.md`,
  });

  test("below the threshold → null (lean profiles untouched)", async () => {
    const res = await applyProjectLoadout({
      profile: mkProfile(manyIds(LOADOUT_MIN_SKILLS - 1)),
      cwd: mkProject(), pinDir: join(root, "pin"),
      readSkill, loadoutsFile: join(root, "loadouts.json"),
    });
    expect(res).toBeNull();
  });

  test("classifies, persists, filters the profile, and attaches the index", async () => {
    const dir = mkProject({ dependencies: { "@medusajs/medusa": "2" } });
    const file = join(root, "loadouts.json");
    const ids = [...manyIds(LOADOUT_MIN_SKILLS), "medusa/db-migrate"];
    const res = await applyProjectLoadout({
      profile: mkProfile(ids), cwd: dir, pinDir: dir, readSkill, loadoutsFile: file,
    });
    expect(res).not.toBeNull();
    expect(res!.computed).toBe(true);
    expect(res!.full).toContain("medusa/db-migrate");
    expect(res!.profile.skills.local.map((s) => s.id)).toEqual(res!.full);
    expect(res!.profile.deferredSkills!.length).toBe(LOADOUT_MIN_SKILLS);
    expect(res!.profile.deferredSkills![0]!.path).toContain("/SKILL.md");
    // Persisted and reused on the next launch (computed=false).
    const again = await applyProjectLoadout({
      profile: mkProfile(ids), cwd: dir, pinDir: dir, readSkill, loadoutsFile: file,
    });
    expect(again!.computed).toBe(false);
    expect(again!.full).toEqual(res!.full);
  });

  test("skill-set change invalidates the remembered loadout", async () => {
    const dir = mkProject({ dependencies: { vite: "5" } });
    const file = join(root, "loadouts.json");
    const first = await applyProjectLoadout({
      profile: mkProfile(manyIds(LOADOUT_MIN_SKILLS + 1)),
      cwd: dir, pinDir: dir, readSkill, loadoutsFile: file,
    });
    expect(first!.computed).toBe(true);
    const second = await applyProjectLoadout({
      profile: mkProfile([...manyIds(LOADOUT_MIN_SKILLS + 1), "new/skill"]),
      cwd: dir, pinDir: dir, readSkill, loadoutsFile: file,
    });
    expect(second!.computed).toBe(true);
  });

  test("`cue loadout off` (enabled:false) short-circuits to null", async () => {
    const dir = mkProject();
    const file = join(root, "loadouts.json");
    writeLoadout(dir, {
      profile: "combo", fingerprint: "x", signalsHash: "y", full: [], deferred: [],
      userKeep: [], userDefer: [], enabled: false, capturedAt: "now",
    }, file);
    const res = await applyProjectLoadout({
      profile: mkProfile(manyIds(LOADOUT_MIN_SKILLS + 5)),
      cwd: dir, pinDir: dir, readSkill, loadoutsFile: file,
    });
    expect(res).toBeNull();
  });

  test("nothing deferred → null (no pointless index skill)", async () => {
    const dir = mkProject({ dependencies: { misc: "1" } });
    const ids = manyIds(LOADOUT_MIN_SKILLS + 1, "misc/skill"); // all match "misc"
    const res = await applyProjectLoadout({
      profile: mkProfile(ids), cwd: dir, pinDir: dir, readSkill,
      loadoutsFile: join(root, "loadouts.json"),
    });
    expect(res).toBeNull();
  });
});
