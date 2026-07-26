/**
 * Tests for src/commands/handoff.ts
 *
 * The command is a thin router over src/lib/handoff.ts. We mock the lib so
 * tests never touch the real HANDOFFS_DIR (which is a module-level constant
 * baked from XDG_CONFIG_HOME at import time and therefore cannot be redirected
 * via beforeEach).
 *
 * Coverage:
 *  - create: missing --task → usage error
 *  - create: valid args → calls createHandoff with parsed skills
 *  - latest: no handoff → "No handoffs yet"
 *  - latest: with handoff → calls formatHandoffForAgent
 *  - list: empty → "No handoffs"
 *  - list: with entries → prints each entry
 *  - show: not found → stderr error, returns 1
 *  - inject: no handoff → stderr error, returns 1
 *
 * Not tested: the actual filesystem I/O in lib/handoff.ts (covered separately
 * by lib tests once written, or can be added with a dynamic-import pattern).
 */

import { mock } from "bun:test";

// ---- Mock lib/handoff before the command module imports it ----
// Bun hoists mock.module calls, so this registers before the static import below.

const mockHandoffStore: any[] = [];

mock.module("../lib/handoff", () => ({
  createHandoff: (ctx: any) => {
    const h = { id: "handoff-testid", ts: "2024-01-15T12:00:00.000Z", ...ctx };
    mockHandoffStore.push(h);
    return h;
  },
  getLatestHandoff: () => mockHandoffStore.at(-1) ?? null,
  getHandoff: (id: string) => mockHandoffStore.find((h) => h.id === id) ?? null,
  listHandoffs: (limit = 10) => mockHandoffStore.slice(-limit).reverse(),
  formatHandoffForAgent: (h: any) =>
    `## Handoff from "${h.from_profile}" (${h.from_agent})\n> ${h.task_summary}\n`,
}));

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "./handoff";

// ---- Output capture ----

let stdoutBuf: string[];
let stderrBuf: string[];
let origStdout: typeof process.stdout.write;
let origStderr: typeof process.stderr.write;

beforeEach(() => {
  stdoutBuf = [];
  stderrBuf = [];
  mockHandoffStore.length = 0; // reset the mock store
  origStdout = process.stdout.write.bind(process.stdout);
  origStderr = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (c: string | Uint8Array) => {
    stdoutBuf.push(typeof c === "string" ? c : Buffer.from(c).toString());
    return true;
  };
  (process.stderr as any).write = (c: string | Uint8Array) => {
    stderrBuf.push(typeof c === "string" ? c : Buffer.from(c).toString());
    return true;
  };
});

afterEach(() => {
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
});

// ---- create subcommand ----

describe("cue handoff create", () => {
  test("missing --task → usage error on stderr, returns 1", async () => {
    const code = await run(["create", "--from", "core"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("Usage");
  });

  test("missing --task with no other flags → usage error, returns 1", async () => {
    const code = await run(["create"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("cue handoff create");
  });

  test("valid create → calls createHandoff, confirms id in stdout", async () => {
    const code = await run(["create", "--from", "core", "--task", "Build feature X"]);
    expect(code).toBe(0);
    const out = stdoutBuf.join("");
    expect(out).toContain("handoff-testid");
  });

  test("--skills parsed into high/medium/low objects", async () => {
    await run([
      "create",
      "--from", "core",
      "--task", "Testing skills parsing",
      "--skills", "meta/analyze:high,meta/caveman:low,meta/help",
    ]);
    // The mock createHandoff captures the ctx.skills_used
    const h = mockHandoffStore[0];
    expect(h).toBeDefined();
    expect(h.skills_used).toEqual([
      { id: "meta/analyze", usefulness: "high" },
      { id: "meta/caveman", usefulness: "low" },
      // No level → defaults to "medium"
      { id: "meta/help", usefulness: "medium" },
    ]);
  });

  test("--from defaults to 'unknown' when omitted", async () => {
    await run(["create", "--task", "Task without from"]);
    const h = mockHandoffStore[0];
    expect(h.from_profile).toBe("unknown");
  });

  test("--notes passed through to createHandoff", async () => {
    await run([
      "create",
      "--from", "core",
      "--task", "Task with notes",
      "--notes", "Remember to run tests",
    ]);
    const h = mockHandoffStore[0];
    expect(h.notes).toBe("Remember to run tests");
  });
});

// ---- latest subcommand ----

describe("cue handoff latest", () => {
  test("no handoffs → prints 'No handoffs yet'", async () => {
    const code = await run(["latest"]);
    expect(code).toBe(0);
    expect(stdoutBuf.join("")).toContain("No handoffs yet");
  });

  test("with a handoff → calls formatHandoffForAgent output", async () => {
    // Create a handoff first
    mockHandoffStore.push({
      id: "handoff-abc",
      ts: "2024-01-15T10:00:00.000Z",
      from_profile: "backend",
      from_agent: "claude-code",
      task_summary: "Implement pagination",
      skills_used: [],
      mcps_used: [],
      notes: "",
    });

    const code = await run(["latest"]);
    expect(code).toBe(0);
    const out = stdoutBuf.join("");
    expect(out).toContain("backend");
    expect(out).toContain("Implement pagination");
  });

  test("--json with a handoff → valid JSON output", async () => {
    mockHandoffStore.push({
      id: "handoff-json",
      ts: "2024-01-15T10:00:00.000Z",
      from_profile: "core",
      from_agent: "claude-code",
      task_summary: "JSON test",
      skills_used: [],
      mcps_used: [],
      notes: "",
    });

    const code = await run(["latest", "--json"]);
    expect(code).toBe(0);
    const data = JSON.parse(stdoutBuf.join(""));
    expect(data.id).toBe("handoff-json");
    expect(data.from_profile).toBe("core");
  });

  test("default subcommand (no args) behaves like latest", async () => {
    const code = await run([]);
    expect(code).toBe(0);
    // No handoffs → "No handoffs yet"
    expect(stdoutBuf.join("")).toContain("No handoffs yet");
  });
});

// ---- list subcommand ----

describe("cue handoff list", () => {
  test("empty list → prints 'No handoffs'", async () => {
    const code = await run(["list"]);
    expect(code).toBe(0);
    expect(stdoutBuf.join("")).toContain("No handoffs");
  });

  test("with entries → prints count and summary", async () => {
    mockHandoffStore.push(
      {
        id: "handoff-1",
        ts: "2024-01-15T10:00:00.000Z",
        from_profile: "core",
        to_profile: "backend",
        from_agent: "claude-code",
        task_summary: "First task",
        skills_used: [],
        mcps_used: [],
        notes: "",
      },
      {
        id: "handoff-2",
        ts: "2024-01-16T11:00:00.000Z",
        from_profile: "backend",
        from_agent: "codex",
        task_summary: "Second task",
        skills_used: [],
        mcps_used: [],
        notes: "",
      },
    );

    const code = await run(["list"]);
    expect(code).toBe(0);
    const out = stdoutBuf.join("");
    expect(out).toContain("handoff-2"); // listed (reversed)
    expect(out).toContain("handoff-1");
  });
});

// ---- show subcommand ----

describe("cue handoff show", () => {
  test("unknown id → stderr error, returns 1", async () => {
    const code = await run(["show", "nonexistent-id"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("not found");
  });

  test("known id → formats the handoff", async () => {
    mockHandoffStore.push({
      id: "handoff-known",
      ts: "2024-01-15T09:00:00.000Z",
      from_profile: "gstack",
      from_agent: "claude-code",
      task_summary: "Show this one",
      skills_used: [],
      mcps_used: [],
      notes: "",
    });

    const code = await run(["show", "handoff-known"]);
    expect(code).toBe(0);
    expect(stdoutBuf.join("")).toContain("gstack");
  });
});

// ---- inject subcommand ----

describe("cue handoff inject", () => {
  test("no handoffs → stderr error, returns 1", async () => {
    const code = await run(["inject"]);
    expect(code).toBe(1);
    expect(stderrBuf.join("")).toContain("No handoffs to inject");
  });

  test("with a handoff → outputs formatted text", async () => {
    mockHandoffStore.push({
      id: "handoff-inject",
      ts: "2024-01-15T08:00:00.000Z",
      from_profile: "frontend",
      from_agent: "claude-code",
      task_summary: "Inject this context",
      skills_used: [],
      mcps_used: [],
      notes: "",
    });

    const code = await run(["inject"]);
    expect(code).toBe(0);
    const out = stdoutBuf.join("");
    expect(out).toContain("frontend");
    expect(out).toContain("Inject this context");
  });
});
