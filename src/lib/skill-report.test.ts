import { describe, expect, test } from "bun:test";

import {
  computeSkillUsage,
  estimateTokenSavings,
  zombieSkills,
} from "./skill-report";
import type { ResolvedProfile } from "../../profiles/_types";

function profile(name: string, localSkills: string[]): ResolvedProfile {
  return {
    name,
    description: "",
    inherits: undefined,
    agents: ["claude-code"],
    skills: { local: localSkills.map((id) => ({ id })), npx: [] },
    mcps: [],
    plugins: [],
    env: {},
    rules: [],
    commands: [],
    hooks: [],
    persona: "",
    playbooks: [],
    qualityGates: [],
    evals: [],
    recommends: [],
    conflicts: [],
    inheritanceChain: [name],
    personaRouting: [],
  } as ResolvedProfile;
}

type StubEvent = {
  event: string;
  profile?: string;
  skill?: string;
  ts: string;
  session_id?: string;
};
const src = (...events: StubEvent[]) => () => events;

describe("computeSkillUsage", () => {
  test("counts skill_hit + skill_invoked tied to this profile, ignores others", () => {
    const p = profile("test", ["a", "b", "c"]);
    const rows = computeSkillUsage(p, {
      source: src(
        { event: "skill_hit", profile: "test", skill: "a", ts: "2026-05-28T10:00:00Z" },
        { event: "skill_invoked", profile: "test", skill: "a", ts: "2026-05-28T11:00:00Z" },
        { event: "skill_hit", profile: "test", skill: "b", ts: "2026-05-27T10:00:00Z" },
        // Wrong profile — ignored.
        { event: "skill_hit", profile: "other", skill: "a", ts: "2026-05-28T10:00:00Z" },
        // Three observed launches are enough to classify an unused skill.
        { event: "start", profile: "test", ts: "2026-05-28T10:00:00Z", session_id: "s1" },
        { event: "start", profile: "test", ts: "2026-05-28T11:00:00Z", session_id: "s2" },
        { event: "start", profile: "test", ts: "2026-05-28T12:00:00Z", session_id: "s3" },
      ),
    });
    const a = rows.find((r) => r.id === "a")!;
    const b = rows.find((r) => r.id === "b")!;
    const c = rows.find((r) => r.id === "c")!;
    expect(a.hits).toBe(2);
    expect(b.hits).toBe(1);
    expect(c.hits).toBe(0);
    expect(c.status).toBe("unused");
    expect(c.exposures).toBe(3);
    expect(c.zombie).toBe(true);
    expect(a.status).toBe("used");
    expect(a.zombie).toBe(false);
  });

  test("keeps zero-hit skills unknown until enough profile launches were observed", () => {
    const p = profile("test", ["a"]);
    const noTelemetry = computeSkillUsage(p, { source: src() });
    expect(noTelemetry[0]).toMatchObject({
      id: "a",
      status: "unknown",
      exposures: 0,
      zombie: false,
    });

    const twoLaunches = computeSkillUsage(p, {
      source: src(
        { event: "start", profile: "test", ts: "2026-05-28T10:00:00Z", session_id: "s1" },
        { event: "start", profile: "test", ts: "2026-05-28T11:00:00Z", session_id: "s2" },
      ),
    });
    expect(twoLaunches[0]).toMatchObject({
      status: "unknown",
      exposures: 2,
      zombie: false,
    });
  });

  test("deduplicates exposure events by session id", () => {
    const p = profile("test", ["a"]);
    const rows = computeSkillUsage(p, {
      minExposureSessions: 2,
      source: src(
        { event: "start", profile: "test", ts: "2026-05-28T10:00:00Z", session_id: "same" },
        { event: "start", profile: "test", ts: "2026-05-28T10:01:00Z", session_id: "same" },
      ),
    });
    expect(rows[0]).toMatchObject({ status: "unknown", exposures: 1, zombie: false });
  });

  test("rows sorted by hits DESC then alpha", () => {
    const p = profile("t", ["alpha", "beta", "gamma"]);
    const rows = computeSkillUsage(p, {
      source: src(
        { event: "skill_hit", profile: "t", skill: "gamma", ts: "2026-05-28T10:00:00Z" },
        { event: "skill_hit", profile: "t", skill: "gamma", ts: "2026-05-28T10:00:00Z" },
        { event: "skill_hit", profile: "t", skill: "alpha", ts: "2026-05-28T10:00:00Z" },
      ),
    });
    expect(rows.map((r) => r.id)).toEqual(["gamma", "alpha", "beta"]);
  });

  test("wildcard refs are skipped (they expand at materialize time)", () => {
    const p = profile("t", ["*/*", "real/skill"]);
    const rows = computeSkillUsage(p, { source: src() });
    expect(rows.map((r) => r.id)).toEqual(["real/skill"]);
  });

  test("duplicate skill ids are de-duped", () => {
    const p = profile("t", ["x", "x", "x"]);
    const rows = computeSkillUsage(p, { source: src() });
    expect(rows.length).toBe(1);
  });

  test("untagged events (no profile field) still count", () => {
    // Some emitters omit the profile tag. They should fold in — better to
    // overcount than to misclassify a real-use skill as zombie.
    const p = profile("t", ["a"]);
    const rows = computeSkillUsage(p, {
      source: src({ event: "skill_invoked", skill: "a", ts: "2026-05-28T10:00:00Z" }),
    });
    expect(rows[0]?.hits).toBe(1);
  });

  test("composite profile (a+b+c) accepts events tagged with any of its parts", () => {
    // The materialized profile name is the composite, but historical events
    // may have been tagged with the solo profile name (user pinned `a`
    // before composing). Both must count, otherwise the composite looks
    // like every skill is zombie on day one of composing.
    const p = profile("a+b+c", ["x"]);
    const rows = computeSkillUsage(p, {
      source: src(
        { event: "skill_invoked", profile: "a", skill: "x", ts: "2026-05-26T10:00:00Z" },
        { event: "skill_invoked", profile: "b", skill: "x", ts: "2026-05-27T10:00:00Z" },
        { event: "skill_invoked", profile: "a+b+c", skill: "x", ts: "2026-05-28T10:00:00Z" },
        { event: "skill_invoked", profile: "unrelated", skill: "x", ts: "2026-05-28T10:00:00Z" },
      ),
    });
    expect(rows[0]?.hits).toBe(3);
    expect(rows[0]?.zombie).toBe(false);
  });
});

describe("zombieSkills", () => {
  test("returns alphabetically sorted zombie ids", () => {
    const rows = [
      { id: "z", hits: 0, lastUsed: null, status: "unused" as const, exposures: 3, zombie: true },
      { id: "a", hits: 5, lastUsed: "x", status: "used" as const, exposures: 3, zombie: false },
      { id: "m", hits: 0, lastUsed: null, status: "unused" as const, exposures: 3, zombie: true },
    ];
    expect(zombieSkills(rows)).toEqual(["m", "z"]);
  });
});

describe("estimateTokenSavings", () => {
  test("uses default 2400B per skill at 4 chars/token", () => {
    expect(estimateTokenSavings(0)).toBe(0);
    expect(estimateTokenSavings(5)).toBe(3000);
  });

  test("honors override avgSkillBytes", () => {
    expect(estimateTokenSavings(2, 8000)).toBe(4000);
  });
});
