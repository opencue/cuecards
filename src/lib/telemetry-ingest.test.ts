import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ingest, parseTranscript } from "./telemetry-ingest";
import { resolveJournalPath } from "./skill-resolve-journal";
import { analyticsPath, enable } from "./telemetry-consent";

let tempHome: string;
let projectsDir: string;
let priorXDG: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cue-ingest-test-"));
  projectsDir = join(tempHome, "claude-projects");
  mkdirSync(projectsDir, { recursive: true });
  priorXDG = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tempHome;
});

afterEach(() => {
  if (priorXDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = priorXDG;
  rmSync(tempHome, { recursive: true, force: true });
});

function writeTranscript(name: string, lines: object[]): string {
  const projDir = join(projectsDir, "proj-1");
  mkdirSync(projDir, { recursive: true });
  const file = join(projDir, `${name}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

function userTurn(text: string, opts: { sessionId?: string; messageId?: string; ts?: string; cwd?: string } = {}) {
  return {
    cwd: opts.cwd ?? "/repo/test",
    sessionId: opts.sessionId ?? "sess-1",
    timestamp: opts.ts ?? "2026-05-26T10:00:00Z",
    message: {
      id: opts.messageId ?? "msg-user-1",
      role: "user",
      content: text,
    },
  };
}

function assistantTextTurn(text: string, opts: { sessionId?: string; messageId?: string; cwd?: string } = {}) {
  return {
    cwd: opts.cwd ?? "/repo/test",
    sessionId: opts.sessionId ?? "sess-1",
    timestamp: "2026-05-26T10:00:05Z",
    message: {
      id: opts.messageId ?? "msg-asst-1",
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function assistantSkillTurn(skillName: string, opts: { toolUseId?: string; sessionId?: string; cwd?: string } = {}) {
  return {
    cwd: opts.cwd ?? "/repo/test",
    sessionId: opts.sessionId ?? "sess-1",
    timestamp: "2026-05-26T10:00:05Z",
    message: {
      id: "msg-asst-2",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: opts.toolUseId ?? "toolu-1",
        name: "Skill",
        input: { skill: skillName },
      }],
    },
  };
}

function skillResultTurn(toolUseId: string, opts: { sessionId?: string; cwd?: string } = {}) {
  return {
    cwd: opts.cwd ?? "/repo/test",
    sessionId: opts.sessionId ?? "sess-1",
    timestamp: "2026-05-26T10:00:06Z",
    message: {
      id: "msg-tool-result",
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: "loaded" }],
    },
  };
}

describe("parseTranscript (pure)", () => {
  test("extracts user text and assistant tool_use", () => {
    const content = [userTurn("save progress"), assistantSkillTurn("context-save")]
      .map((l) => JSON.stringify(l)).join("\n");
    const turns = parseTranscript(content);
    expect(turns.length).toBe(2);
    expect(turns[0]!.kind).toBe("user");
    expect(turns[0]!.text).toBe("save progress");
    expect(turns[1]!.kind).toBe("assistant");
    expect(turns[1]!.toolUses[0]!.name).toBe("Skill");
    expect(turns[1]!.toolUses[0]!.input.skill).toBe("context-save");
    expect(turns[1]!.cwd).toBe("/repo/test");
  });

  test("extracts tool-result ids for completed skill invocations", () => {
    const turns = parseTranscript(
      [assistantSkillTurn("context-save", { toolUseId: "tool-a" }), skillResultTurn("tool-a")]
        .map((line) => JSON.stringify(line))
        .join("\n"),
    );
    expect(turns[1]!.toolResultIds).toEqual(["tool-a"]);
  });

  test("skips malformed JSON lines", () => {
    const content = "not json\n" + JSON.stringify(userTurn("hi")) + "\n";
    const turns = parseTranscript(content);
    expect(turns.length).toBe(1);
  });

  test("ignores non-user/assistant roles", () => {
    const sys = { sessionId: "s", message: { role: "system", content: "x" } };
    const content = JSON.stringify(sys) + "\n";
    expect(parseTranscript(content)).toEqual([]);
  });
});

describe("ingest", () => {
  test("returns zero counts when telemetry is disabled", async () => {
    writeTranscript("t1", [userTurn("foo"), assistantSkillTurn("bar")]);
    const stats = await ingest({ projectsDir, sinceDays: 7 });
    expect(stats.newInvocations).toBe(0);
    expect(existsSync(analyticsPath())).toBe(false);
  });

  test("emits skill_invoked events for every Skill tool_use", async () => {
    enable();
    writeTranscript("t1", [
      userTurn("save progress"),
      assistantSkillTurn("context-save", { toolUseId: "tool-a" }),
      userTurn("write a commit", { messageId: "msg-u2" }),
      assistantSkillTurn("caveman-commit", { toolUseId: "tool-b" }),
    ]);

    const stats = await ingest({ projectsDir, sinceDays: 7 });
    expect(stats.newInvocations).toBe(2);

    const events = readFileSync(analyticsPath(), "utf8")
      .split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.filter((e) => e.event === "skill_invoked").length).toBe(2);
    expect(events.find((e) => e.skill === "context-save")).toBeDefined();
    expect(events.find((e) => e.skill === "caveman-commit")).toBeDefined();

    const journal = readFileSync(resolveJournalPath(), "utf8")
      .split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(journal.filter((row) => row.stage === "invoked")).toHaveLength(2);
    expect(journal.every((row) => row.cwd === "/repo/test")).toBe(true);
  });

  test("records completed after the matching Skill tool result", async () => {
    enable();
    writeTranscript("t1", [
      userTurn("save progress"),
      assistantSkillTurn("context-save", { toolUseId: "tool-a" }),
      skillResultTurn("tool-a"),
    ]);

    await ingest({ projectsDir, sinceDays: 7 });
    const stages = readFileSync(resolveJournalPath(), "utf8")
      .split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as { stage: string })
      .map((row) => row.stage);
    expect(stages).toEqual(["invoked", "completed"]);
  });

  test("idempotent: second ingest skips duplicates", async () => {
    enable();
    writeTranscript("t1", [userTurn("x"), assistantSkillTurn("foo", { toolUseId: "tool-x" })]);
    const first = await ingest({ projectsDir, sinceDays: 7 });
    expect(first.newInvocations).toBe(1);

    const second = await ingest({ projectsDir, sinceDays: 7 });
    expect(second.newInvocations).toBe(0);
    expect(second.skippedDuplicates).toBe(1);

    const events = readFileSync(analyticsPath(), "utf8").split("\n").filter(Boolean);
    expect(events.length).toBe(1);
  });

  test("emits skill_miss when trigger matched but no Skill was invoked", async () => {
    enable();
    writeTranscript("t1", [
      userTurn("please save my progress for later"),
      assistantTextTurn("Sure, here's what I'll do..."),
    ]);
    const triggers = new Map([["context-save", ["save my progress", "save progress"]]]);
    const stats = await ingest({ projectsDir, sinceDays: 7, triggers });
    expect(stats.newMisses).toBe(1);

    const events = readFileSync(analyticsPath(), "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const miss = events.find((e) => e.event === "skill_miss");
    expect(miss).toBeDefined();
    expect(miss?.matched_skills).toEqual(["context-save"]);
    expect(miss?.prompt_redacted).toContain("save my progress");
  });

  test("does NOT emit skill_miss when the matched skill was invoked", async () => {
    enable();
    writeTranscript("t1", [
      userTurn("please save my progress for later"),
      assistantSkillTurn("context-save"),
    ]);
    const triggers = new Map([["context-save", ["save my progress"]]]);
    const stats = await ingest({ projectsDir, sinceDays: 7, triggers });
    expect(stats.newMisses).toBe(0);
    expect(stats.newInvocations).toBe(1);
  });

  test("filters short single-word triggers (kills 'save', 'do', etc.)", async () => {
    enable();
    writeTranscript("t1", [userTurn("save"), assistantTextTurn("done")]);
    const triggers = new Map([["context-save", ["save"]]]); // <8 chars, no whitespace
    const stats = await ingest({ projectsDir, sinceDays: 7, triggers });
    expect(stats.newMisses).toBe(0);
  });

  test("allows short multi-word triggers", async () => {
    enable();
    writeTranscript("t1", [userTurn("do x now"), assistantTextTurn("ok")]);
    const triggers = new Map([["foo", ["do x"]]]); // 4 chars but has whitespace
    const stats = await ingest({ projectsDir, sinceDays: 7, triggers });
    expect(stats.newMisses).toBe(1);
  });

  test("skips sub-agent / orchestrator prompts (system-reminder, MODE SWITCH, etc.)", async () => {
    enable();
    writeTranscript("t1", [
      userTurn("<observed_from_primary_session> save my progress in the agent"),
      assistantTextTurn("noted"),
      userTurn("You are the memory-manager daemon. save my progress to disk now."),
      assistantTextTurn("running"),
      userTurn("MODE SWITCH: PROGRESS SUMMARY — please save my progress eventually"),
      assistantTextTurn("ok"),
    ]);
    const triggers = new Map([["context-save", ["save my progress"]]]);
    const stats = await ingest({ projectsDir, sinceDays: 7, triggers });
    expect(stats.newMisses).toBe(0);
  });
});
