/**
 * Tests for the dashboard server's profile-detail handler — the data source
 * that backs cue studio's explorer / search / mcps views. Runs against the
 * real on-disk `profiles/` + `resources/skills/` tree (no mocks) so the test
 * also guards the loader → resolver → parser wiring the studio depends on.
 */

import { describe, expect, test } from "bun:test";

import { handleProfileDetail, handleMcpCatalog, handleMcpAdd, handleMarket, handleMarketInstall, createHandler, semverGt, computeVersionInfo, buildTimeline, handleHooks, handleHookSource } from "./dashboard-server";
import { existsSync } from "node:fs";
import { join } from "node:path";

// `resources/skills` is a git submodule. The catalogue test below asserts real
// on-disk skill bodies (e.g. meta/analyze), so skip it when the submodule isn't
// checked out (`git submodule update --init`) — a setup gap, not a regression.
const SKILLS_PRESENT = existsSync(join(import.meta.dir, "../../resources/skills/skills"));

function detail(profile: string) {
  return handleProfileDetail(new URLSearchParams({ profile }));
}

describe("version banner logic", () => {
  test("semverGt compares major.minor.patch", () => {
    expect(semverGt("0.9.1", "0.9.0")).toBe(true);
    expect(semverGt("1.0.0", "0.9.9")).toBe(true);
    expect(semverGt("0.9.0", "0.9.0")).toBe(false);
    expect(semverGt("0.9.0", "0.9.1")).toBe(false);
    expect(semverGt("0.10.0", "0.9.0")).toBe(true); // numeric, not lexical
  });

  test("computeVersionInfo flags an update + carries the registry notice", () => {
    const info = computeVersionInfo("0.9.0", { version: "0.9.1", cue: { notice: { message: "hi", command: "npm i -g cue-ai@latest" } } });
    expect(info.updateAvailable).toBe(true);
    expect(info.latest).toBe("0.9.1");
    expect(info.notice).toEqual({ message: "hi", command: "npm i -g cue-ai@latest" });
  });

  test("computeVersionInfo is fail-soft when the registry doc is null (offline)", () => {
    const info = computeVersionInfo("0.9.0", null);
    expect(info).toEqual({ current: "0.9.0", latest: null, updateAvailable: false, notice: null });
  });

  test("computeVersionInfo shows a notice even when already up to date", () => {
    const info = computeVersionInfo("0.9.0", { version: "0.9.0", cue: { notice: { message: "heads up" } } });
    expect(info.updateAvailable).toBe(false);
    expect(info.notice).toEqual({ message: "heads up", command: undefined });
  });

  test("computeVersionInfo drops an empty notice object", () => {
    const info = computeVersionInfo("0.9.0", { version: "0.9.0", cue: { notice: {} } });
    expect(info.notice).toBeNull();
  });
});

describe("handleProfileDetail", () => {
  test.skipIf(!SKILLS_PRESENT)("returns a real, grouped skill catalogue for gstack", async () => {
    const res = await detail("gstack");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data as {
      profile: string;
      parts: string[];
      counts: { skills: number; mcps: number; plugins: number; commands: number };
      skills: { id: string; ns: string; name: string; body: string; missing: boolean }[];
      mcps: { id: string }[];
      commands: { name: string; ref: string; desc: string; argHint: string | null; body: string; sizeK: number; missing: boolean }[];
    };

    expect(d.profile).toBe("gstack");
    expect(d.parts).toEqual(["gstack"]);
    expect(d.skills.length).toBeGreaterThan(0);
    expect(d.counts.skills).toBe(d.skills.length);

    // Every skill carries a namespace (first path segment) and a non-empty body.
    for (const s of d.skills) {
      expect(s.ns.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }

    // The known meta/analyze skill resolves from disk (not a stub).
    const analyze = d.skills.find((s) => s.id === "meta/analyze");
    expect(analyze).toBeDefined();
    expect(analyze!.missing).toBe(false);
    expect(analyze!.body).toContain("name: analyze");

    // Commands are slash-prefixed, carry a bare ref, and a body for the preview.
    expect(d.commands.length).toBeGreaterThan(0);
    expect(d.counts.commands).toBe(d.commands.length);
    for (const c of d.commands) {
      expect(c.name).toBe("/" + c.ref);
      expect(c.body.length).toBeGreaterThan(0);
    }

    // A known command (/verify) resolves its real markdown from
    // resources/commands (not a stub), with its frontmatter description.
    const verify = d.commands.find((c) => c.ref === "verify");
    expect(verify).toBeDefined();
    expect(verify!.missing).toBe(false);
    expect(verify!.desc.length).toBeGreaterThan(0);
    expect(verify!.body).toContain("description:");
  });

  test("resolves composite selectors and dedupes the union", async () => {
    const res = await detail("gstack+core");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data as { parts: string[]; skills: { id: string }[] };
    expect(d.parts).toEqual(["gstack", "core"]);
    const ids = d.skills.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate skill ids
  });

  test("errors cleanly for an unknown profile", async () => {
    const res = await detail("definitely-not-a-real-profile-xyz");
    expect(res.ok).toBe(false);
  });

  test("surfaces per-profile CLI dependencies from skill frontmatter", async () => {
    const res = await detail("gstack+core");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data as {
      counts: { clis: number };
      clis: { name: string; install: string; known: boolean; usedBy: string[] }[];
    };
    expect(Array.isArray(d.clis)).toBe(true);
    expect(d.counts.clis).toBe(d.clis.length);
    // Every CLI is attributed to at least one skill and ranked by usage.
    for (const c of d.clis) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.usedBy.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < d.clis.length; i++) {
      expect(d.clis[i - 1]!.usedBy.length).toBeGreaterThanOrEqual(d.clis[i]!.usedBy.length);
    }
  });

  test("surfaces the agency profile's declared subagents, grouped by division", async () => {
    const res = await detail("agency");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data as {
      counts: { subagents: number };
      subagents: { id: string; division: string; name: string }[];
    };

    // The roster is large and varied — not just a couple inherited bits.
    expect(d.counts.subagents).toBe(d.subagents.length);
    expect(d.subagents.length).toBeGreaterThan(40);

    // A known ref splits into division + slug for grouped display.
    const ui = d.subagents.find((s) => s.id === "design/design-ui-designer");
    expect(ui).toBeDefined();
    expect(ui!.division).toBe("design");
    expect(ui!.name).toBe("design-ui-designer");

    // Multiple divisions are represented (design, finance, sales, …).
    expect(new Set(d.subagents.map((s) => s.division)).size).toBeGreaterThan(5);
  });

  test("parses the profile's declared playbooks into workflow cards", async () => {
    const res = await detail("gstack");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data as {
      playbooks: { id: string; name: string; title: string; emoji: string; trigger: string; est: string; desc: string; steps: { name: string; detail: string }[] }[];
    };

    expect(Array.isArray(d.playbooks)).toBe(true);
    expect(d.playbooks.length).toBeGreaterThan(0);

    // ship-feature is declared (inherited from core) and parses with real steps.
    const ship = d.playbooks.find((p) => p.id === "ship-feature");
    expect(ship).toBeDefined();
    expect(ship!.title).toBe("Ship a Feature");
    expect(ship!.trigger).toBe("playbook");
    expect(ship!.est.startsWith("~")).toBe(true);
    expect(ship!.desc.length).toBeGreaterThan(0);
    expect(ship!.steps.length).toBeGreaterThan(0);

    // Steps strip the leading "N." numbering and never carry markdown noise.
    for (const s of ship!.steps) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(/^\d+\.\s/.test(s.name)).toBe(false);
    }
  });
});

describe("GET /api/v1/plugin-icon", () => {
  const handler = createHandler();
  const get = (qs: string) =>
    handler(new Request(`http://127.0.0.1/api/v1/plugin-icon${qs}`));

  test("reuses a same-named profile's logo (resend)", async () => {
    const res = await get("?plugin=resend@claude-plugins-official");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("rejects a path-traversal plugin name", async () => {
    const res = await get("?plugin=" + encodeURIComponent("../secret"));
    expect(res.status).toBe(400);
  });

  test("400 when the plugin param is missing", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
  });

  test("404 for a plugin with neither a profile nor a generated logo", async () => {
    const res = await get("?plugin=definitely-not-a-real-plugin-xyz");
    expect(res.status).toBe(404);
  });
});

describe("handleMcpCatalog", () => {
  test("returns the catalog as an array of addable entries", async () => {
    const res = await handleMcpCatalog();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const entries = res.data as { id: string; transport: string }[];
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(10);
    expect(entries.some((e) => e.id === "coolify")).toBe(true);
  });
});

describe("handleMarket", () => {
  const VALID_TYPES = new Set(["profile", "workflow", "skill", "cli", "mcp", "plugin"]);

  test("returns a normalized, counted marketplace feed", async () => {
    const res = await handleMarket();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.data as {
      items: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };

    expect(Array.isArray(d.items)).toBe(true);
    expect(d.items.length).toBeGreaterThan(0);

    // Every item carries the full contract: correct field types + a valid type.
    for (const it of d.items) {
      expect(typeof it.id).toBe("string");
      expect((it.id as string).length).toBeGreaterThan(0);
      expect(VALID_TYPES.has(it.type as string)).toBe(true);
      expect(typeof it.name).toBe("string");
      expect(typeof it.author).toBe("string");
      expect(typeof it.handle).toBe("string");
      expect(typeof it.stars).toBe("number");
      expect(typeof it.installs).toBe("string");
      expect(typeof it.when).toBe("string");
      expect(typeof it.featured).toBe("boolean");
      expect(typeof it.desc).toBe("string");
      expect(Array.isArray(it.tags)).toBe(true);
      expect(["registry", "local"]).toContain(it.source as string);
      expect(typeof it.add).toBe("string");
      expect(VALID_TYPES.has(it.addKind as string)).toBe(true);
    }

    // counts.all === items.length, and per-type counts sum to it.
    expect(d.counts.all).toBe(d.items.length);
    const perType = d.counts.profile + d.counts.workflow + d.counts.skill + d.counts.cli + d.counts.mcp + d.counts.plugin;
    expect(perType).toBe(d.counts.all);

    // The local library is always present — profiles + workflows come from disk.
    expect(d.counts.profile).toBeGreaterThan(0);
    expect(d.counts.workflow).toBeGreaterThan(0);
  });
});

describe("handleMcpAdd validation", () => {
  test("rejects a missing id", async () => {
    const res = await handleMcpAdd({ profile: "core" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("missing-id");
  });

  test("rejects a missing profile", async () => {
    const res = await handleMcpAdd({ id: "coolify" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("missing-profile");
  });

  test("surfaces unknown-mcp from the lib as an error envelope", async () => {
    const res = await handleMcpAdd({ id: "not-a-real-mcp-xyz", profile: "core" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown-mcp/);
  });
});

describe("handleMarketInstall validation", () => {
  test("rejects a missing id", async () => {
    const res = await handleMarketInstall({ addKind: "skill", profile: "core" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("missing-id");
  });

  test("rejects an unknown add kind", async () => {
    const res = await handleMarketInstall({ id: "skill:x", addKind: "bogus", profile: "core" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid-add-kind");
  });

  test("rejects a missing profile", async () => {
    const res = await handleMarketInstall({ id: "skill:x", addKind: "skill" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("missing-profile");
  });

  test("returns a manual command for a CLI without touching a profile", async () => {
    const res = await handleMarketInstall({ id: "cli:ripgrep", addKind: "cli", profile: "core" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as { manual?: { command: string }; changed: boolean };
      expect(data.changed).toBe(false);
      expect(data.manual?.command).toBeTruthy();
    }
  });
});

describe("buildTimeline", () => {
  test("returns gap-filled daily buckets spanning the window", () => {
    const t = buildTimeline(7);
    expect(t.windowDays).toBe(7);
    expect(t.daily).toHaveLength(7);
    expect(t.daily.every((d) => typeof d.sessions === "number" && /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
    expect(Array.isArray(t.profiles)).toBe(true);
  });
});

describe("GET /api/v1/hook-source", () => {
  test("rejects a missing path", async () => {
    const r = await handleHookSource(new URLSearchParams());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing-path");
  });

  test("rejects an arbitrary path — only enumerated hook scripts are readable", async () => {
    const r = await handleHookSource(new URLSearchParams({ path: "/etc/passwd" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not-a-hook-script");
  });

  test("rejects a path traversal that escapes the hooks dir", async () => {
    const r = await handleHookSource(new URLSearchParams({ path: "/x/hooks/../../../../etc/passwd" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not-a-hook-script");
  });

  test("serves a real enumerated hook script's source", async () => {
    const hk = await handleHooks(new URLSearchParams());
    if (!hk.ok) return; // telemetry/profile unresolved in this env — security cases still cover it
    const events = (hk.data as { events: { hooks: { scriptPath: string | null }[] }[] }).events;
    const withScript = events.flatMap((e) => e.hooks).find((h) => h.scriptPath);
    if (!withScript?.scriptPath) return; // no resolvable hook scripts here
    const r = await handleHookSource(new URLSearchParams({ path: withScript.scriptPath }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const d = r.data as { filename: string; content: string; language: string };
      expect(d.filename.length).toBeGreaterThan(0);
      expect(typeof d.content).toBe("string");
      expect(d.language.length).toBeGreaterThan(0);
    }
  });
});

describe("GET /api/v1/telemetry/stream (SSE)", () => {
  test("responds as an event-stream and pushes an initial frame", async () => {
    const handler = createHandler();
    const res = await handler(new Request("http://localhost/api/v1/telemetry/stream?since=7"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.body).not.toBeNull();
    // Read just the first frame, then cancel so the stream's interval timers
    // stop and the test process can exit.
    const reader = res.body!.getReader();
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = new TextDecoder().decode(value);
    // A real timeline frame when telemetry is on, or the disabled error frame.
    expect(text).toMatch(/event: (timeline|error)/);
    await reader.cancel();
  });
});
