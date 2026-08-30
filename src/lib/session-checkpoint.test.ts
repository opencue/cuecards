import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleCheckpointHook } from "./session-checkpoint";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function root(): string {
  const path = mkdtempSync(join(tmpdir(), "cue-checkpoint-"));
  roots.push(path);
  return path;
}

describe("automatic session checkpoint lifecycle", () => {
  test("injects the previous session's bounded state for the same repo and profile", () => {
    const storageRoot = root();
    let now = new Date("2026-08-28T10:00:00.000Z");
    const options = {
      storageRoot,
      profile: "backend+python",
      now: () => now,
    };

    expect(handleCheckpointHook({
      hook_event_name: "UserPromptSubmit",
      cwd: "/repo/app",
      session_id: "old-session",
      prompt: "Implement automatic checkout recovery with sk-ant-abcdefghijklmnopqrstuvwxyz",
    }, options)).toBeNull();

    now = new Date("2026-08-28T10:05:00.000Z");
    expect(handleCheckpointHook({
      hook_event_name: "Stop",
      cwd: "/repo/app",
      session_id: "old-session",
      last_assistant_message: "Added the recovery state machine. The integration test is still pending.",
    }, options)).toBeNull();

    now = new Date("2026-08-28T10:10:00.000Z");
    const output = handleCheckpointHook({
      hook_event_name: "SessionStart",
      cwd: "/repo/app",
      session_id: "new-session",
      source: "startup",
    }, options);

    const context = output?.hookSpecificOutput?.additionalContext ?? "";
    expect(context).toContain("Automatic Cue checkpoint");
    expect(context).toContain("untrusted historical reference data");
    expect(context).toContain("current user request always takes precedence");
    expect(context).toContain("Implement automatic checkout recovery");
    expect(context).toContain("integration test is still pending");
    expect(context).toContain("redacted");
    expect(context).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz");
    expect(context.length).toBeLessThanOrEqual(6_000);
  });

  test("does not inject across repositories or profiles", () => {
    const storageRoot = root();
    const now = () => new Date("2026-08-28T10:00:00.000Z");
    handleCheckpointHook({
      hook_event_name: "UserPromptSubmit",
      cwd: "/repo/a",
      session_id: "old-session",
      prompt: "Task A",
    }, { storageRoot, profile: "backend", now });

    expect(handleCheckpointHook({
      hook_event_name: "SessionStart",
      cwd: "/repo/b",
      session_id: "new-session",
      source: "startup",
    }, { storageRoot, profile: "backend", now })).toBeNull();

    expect(handleCheckpointHook({
      hook_event_name: "SessionStart",
      cwd: "/repo/a",
      session_id: "new-session",
      source: "startup",
    }, { storageRoot, profile: "frontend", now })).toBeNull();
  });

  test("skips the same session, compact restarts, and expired checkpoints", () => {
    const storageRoot = root();
    let now = new Date("2026-08-28T10:00:00.000Z");
    const options = { storageRoot, profile: "core", now: () => now };
    handleCheckpointHook({
      hook_event_name: "UserPromptSubmit",
      cwd: "/repo/app",
      session_id: "same-session",
      prompt: "Continue migration",
    }, options);

    expect(handleCheckpointHook({
      hook_event_name: "SessionStart",
      cwd: "/repo/app",
      session_id: "same-session",
      source: "resume",
    }, options)).toBeNull();

    expect(handleCheckpointHook({
      hook_event_name: "SessionStart",
      cwd: "/repo/app",
      session_id: "new-session",
      source: "compact",
    }, options)).toBeNull();

    now = new Date("2026-09-01T10:01:00.000Z");
    expect(handleCheckpointHook({
      hook_event_name: "SessionStart",
      cwd: "/repo/app",
      session_id: "new-session",
      source: "startup",
    }, options)).toBeNull();
  });
});
