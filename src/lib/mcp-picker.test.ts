import { describe, expect, test } from "bun:test";

import { buildMcpRows, renderMcpFrame, type McpRow } from "./mcp-picker";

describe("buildMcpRows", () => {
  const needed = new Map([
    ["hostinger-api", { skills: ["hostinger/dns"], source: "implicit" as const }],
  ]);

  test("separates pinned (always-on) from prunable rows", () => {
    const { prunable, pinnedIds } = buildMcpRows({
      profileMcpIds: ["codegraph", "gbrain", "hostinger-api"],
      pinned: new Set(["codegraph"]),
      needed,
    });
    expect(pinnedIds).toEqual(["codegraph"]);
    expect(prunable.map((r) => r.id)).toEqual(["gbrain", "hostinger-api"]);
  });

  test("default-on: every prunable row pre-selected, grouped by skill reference", () => {
    const { prunable } = buildMcpRows({
      profileMcpIds: ["gbrain", "hostinger-api"],
      pinned: new Set(),
      needed,
    });
    const ha = prunable.find((r) => r.id === "hostinger-api")!;
    expect(ha.preselect).toBe(true);
    expect(ha.group).toBe("used");
    expect(ha.hint).toContain("hostinger/dns");

    // Unreferenced MCPs are now also checked by default (opt-out), grouped
    // under "unused" with a reason.
    const gb = prunable.find((r) => r.id === "gbrain")!;
    expect(gb.preselect).toBe(true);
    expect(gb.group).toBe("unused");
    expect(gb.hint).toContain("no active skill references it");
  });

  test("compacts a multi-skill reason to lead + '+N'", () => {
    const { prunable } = buildMcpRows({
      profileMcpIds: ["some-mcp"],
      pinned: new Set(),
      needed: new Map([
        ["some-mcp", { skills: ["marketing/cue-rec", "design/headless-gif-demo"], source: "explicit" as const }],
      ]),
    });
    expect(prunable[0].hint).toBe("marketing/cue-rec +1");
  });

  test("curated default-off MCPs start unchecked even when a skill references them", () => {
    const { prunable } = buildMcpRows({
      profileMcpIds: ["cue-tty-watch", "postiz", "lightpanda"],
      pinned: new Set(),
      needed: new Map([
        ["cue-tty-watch", { skills: ["marketing/cue-rec"], source: "explicit" as const }],
        ["lightpanda", { skills: ["browser/lightpanda"], source: "explicit" as const }],
      ]),
    });
    // Referenced but curated-off → unchecked, still truthfully in the used group.
    const tty = prunable.find((r) => r.id === "cue-tty-watch")!;
    expect(tty.preselect).toBe(false);
    expect(tty.group).toBe("used");
    expect(tty.hint).toBe("off by default");

    // Unreferenced + curated-off → unchecked under unused.
    const pz = prunable.find((r) => r.id === "postiz")!;
    expect(pz.preselect).toBe(false);
    expect(pz.group).toBe("unused");
    expect(pz.hint).toBe("off by default");

    // A normal referenced MCP is unaffected — still on.
    expect(prunable.find((r) => r.id === "lightpanda")!.preselect).toBe(true);
  });

  test("matches needed/pinned case-insensitively but keeps original casing", () => {
    const { prunable, pinnedIds } = buildMcpRows({
      profileMcpIds: ["Higgsfield", "CodeGraph"],
      pinned: new Set(["codegraph"]),
      needed: new Map([["higgsfield", { skills: ["x"], source: "explicit" as const }]]),
    });
    expect(pinnedIds).toEqual(["CodeGraph"]); // original casing preserved
    const hf = prunable.find((r) => r.id === "Higgsfield")!;
    expect(hf.preselect).toBe(true);
    expect(hf.group).toBe("used");
  });
});

describe("renderMcpFrame", () => {
  // styleText emits ANSI under bun test, so strip it before asserting on text.
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const rows: McpRow[] = [
    { id: "lightpanda", preselect: true, group: "used", hint: "browser/lightpanda" },
    { id: "coolify", preselect: true, group: "used", hint: "deployment/coolify" },
    { id: "gbrain", preselect: true, group: "unused", hint: "no active skill references it" },
  ];

  test("renders ASCII checkboxes reflecting selection", () => {
    const frame = strip(renderMcpFrame({ rows, cursor: 0, selected: new Set(["lightpanda", "coolify"]) }));
    expect(frame).toContain("[x] lightpanda");
    expect(frame).toContain("[x] coolify");
    expect(frame).toContain("[ ] gbrain"); // not selected → empty box
  });

  test("renders both group headers with totals", () => {
    const frame = strip(renderMcpFrame({ rows, cursor: 0, selected: new Set() }));
    expect(frame).toContain("Used by active skills");
    expect(frame).toContain("Not referenced (optional)");
    // counts: 2 used, 1 unused (rendered after the rule)
    expect(frame).toMatch(/Used by active skills .*2/);
    expect(frame).toMatch(/Not referenced \(optional\) .*1/);
  });

  test("footer reports the live on/total count", () => {
    const frame = strip(renderMcpFrame({ rows, cursor: 0, selected: new Set(["lightpanda"]) }));
    expect(frame).toContain("1 of 3 on");
  });

  test("cursor row carries the › marker", () => {
    const frame = strip(renderMcpFrame({ rows, cursor: 1, selected: new Set() }));
    expect(frame).toContain("› [ ] coolify");
  });
});
