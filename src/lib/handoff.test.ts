import { describe, test, expect } from "bun:test";
import { formatHandoffForAgent, type HandoffContext } from "./handoff";

function makeHandoff(overrides: Partial<HandoffContext> = {}): HandoffContext {
  return {
    id: "handoff-abc",
    ts: "2026-07-01T12:00:00.000Z",
    from_profile: "core",
    from_agent: "claude",
    task_summary: "Implement the auth feature",
    skills_used: [],
    mcps_used: [],
    notes: "",
    ...overrides,
  };
}

describe("formatHandoffForAgent", () => {
  test("includes the from_profile and from_agent in the header", () => {
    const out = formatHandoffForAgent(makeHandoff());
    expect(out).toContain('"core"');
    expect(out).toContain("claude");
  });

  test("includes the task_summary as a block quote", () => {
    const out = formatHandoffForAgent(makeHandoff({ task_summary: "Fix the payment flow" }));
    expect(out).toContain("> Fix the payment flow");
  });

  test("high-usefulness skills appear under 'Most useful skills'", () => {
    const out = formatHandoffForAgent(
      makeHandoff({
        skills_used: [
          { id: "meta/careful", usefulness: "high" },
          { id: "review/code-review", usefulness: "high" },
        ],
      }),
    );
    expect(out).toContain("**Most useful skills:**");
    expect(out).toContain("meta/careful");
    expect(out).toContain("review/code-review");
  });

  test("medium-usefulness skills appear under 'Also helpful'", () => {
    const out = formatHandoffForAgent(
      makeHandoff({
        skills_used: [{ id: "tools/context7", usefulness: "medium" }],
      }),
    );
    expect(out).toContain("**Also helpful:**");
    expect(out).toContain("tools/context7");
  });

  test("low-usefulness skills do not appear in output", () => {
    const out = formatHandoffForAgent(
      makeHandoff({
        skills_used: [{ id: "rarely-used", usefulness: "low" }],
      }),
    );
    expect(out).not.toContain("rarely-used");
    expect(out).not.toContain("Most useful");
    expect(out).not.toContain("Also helpful");
  });

  test("MCPs used line is included when non-empty", () => {
    const out = formatHandoffForAgent(
      makeHandoff({ mcps_used: ["codegraph", "context7"] }),
    );
    expect(out).toContain("**MCPs used:**");
    expect(out).toContain("codegraph");
    expect(out).toContain("context7");
  });

  test("MCPs used line is omitted when empty", () => {
    const out = formatHandoffForAgent(makeHandoff({ mcps_used: [] }));
    expect(out).not.toContain("MCPs used");
  });

  test("notes section is included when non-empty", () => {
    const out = formatHandoffForAgent(makeHandoff({ notes: "Remember to check env vars" }));
    expect(out).toContain("**Notes:**");
    expect(out).toContain("Remember to check env vars");
  });

  test("notes section is omitted when empty string", () => {
    const out = formatHandoffForAgent(makeHandoff({ notes: "" }));
    expect(out).not.toContain("Notes");
  });

  test("minimal handoff has only header and task summary", () => {
    const out = formatHandoffForAgent(makeHandoff());
    expect(out).toContain("## Handoff from");
    expect(out).toContain("> Implement the auth feature");
    expect(out).not.toContain("Most useful");
    expect(out).not.toContain("Also helpful");
    expect(out).not.toContain("MCPs used");
    expect(out).not.toContain("Notes");
  });
});
