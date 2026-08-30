import { describe, expect, test } from "bun:test";

import { __test, agentLaunchAccent, agentLaunchMessage, startLoader } from "./launch-loader";

const { createLoaderCore, FRAMES, ESC } = __test;

describe("agentLaunchMessage", () => {
  test("names the agent being launched", () => {
    expect(agentLaunchMessage("claude-code")).toBe("Launching Claude…");
    expect(agentLaunchMessage("codex")).toBe("Launching Codex…");
  });

  test("uses a distinct accent for each agent", () => {
    expect(agentLaunchAccent("codex")).not.toBe(agentLaunchAccent("claude-code"));
  });
});

/** A CoreDeps stub that records every write into a single string. */
function makeRecorder(opts: { logo?: string | null; clear?: string; logoCols?: number } = {}) {
  let out = "";
  const deps = {
    write: (s: string) => {
      out += s;
    },
    renderLogo: () => (opts.logo === undefined ? null : opts.logo),
    clearLogo: () => opts.clear ?? "",
    logoCols: opts.logoCols ?? 2,
  };
  return { deps, get: () => out };
}

describe("launch-loader core — ANSI path (no logo)", () => {
  test("start hides cursor and draws the first frame at column 1", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "Launching Claude…");
    core.start();
    const out = r.get();
    expect(out).toContain(ESC.HIDE_CURSOR);
    expect(out).toContain("\x1b[1G\x1b[K"); // text column 1, erase to EOL
    expect(out).toContain(FRAMES[0]!);
    expect(out).toContain("Launching Claude…");
  });

  test("tick advances to the next frame", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "msg");
    core.start();
    core.tick();
    expect(r.get()).toContain(FRAMES[1]!);
  });

  test("uses the requested accent color", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "msg", "<ACCENT>");
    core.start();
    expect(r.get()).toContain(`<ACCENT>${FRAMES[0]}`);
  });

  test("stop erases the line and shows the cursor, with no Kitty clear", () => {
    const r = makeRecorder(); // clear defaults to ""
    const core = createLoaderCore(r.deps, "msg");
    core.start();
    core.stop();
    const out = r.get();
    expect(out).toContain(ESC.ERASE_LINE);
    expect(out.endsWith(ESC.SHOW_CURSOR)).toBe(true);
    // delete-by-id APC must not appear when there is no logo
    expect(out).not.toContain("\x1b_Ga=d");
  });

  test("setMessage redraws with the new text", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "old");
    core.start();
    core.setMessage("new message");
    expect(r.get()).toContain("new message");
  });

  test("strips embedded CR/LF/ESC from the message (classifier REASON safety)", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "5/12 kept — line1\r\nline2\x1b[31mx");
    core.start();
    const out = r.get();
    // The message's own CR/LF/ESC must be neutralized (the loader still emits its
    // own \r in start() and its own SGR sequences — we only assert the message's
    // injected control chars are gone).
    expect(out).toContain("line1  line2"); // CR + LF each collapsed to a space
    expect(out).not.toContain("line1\r"); // the message's CR is gone
    expect(out).not.toContain("\x1b[31m"); // the injected SGR's ESC was stripped
  });
});

describe("launch-loader core — Kitty path (logo present)", () => {
  test("start renders the logo once and offsets the text after it", () => {
    const r = makeRecorder({ logo: "<IMG>", clear: "<CLR>", logoCols: 2 });
    const core = createLoaderCore(r.deps, "m");
    core.start();
    const out = r.get();
    expect(out).toContain("<IMG>");
    // logoCols(2) + 2 = column 4
    expect(out).toContain("\x1b[4G\x1b[K");
  });

  test("stop deletes the logo before showing the cursor", () => {
    const r = makeRecorder({ logo: "<IMG>", clear: "<CLR>" });
    const core = createLoaderCore(r.deps, "m");
    core.start();
    core.stop();
    const out = r.get();
    const clearIdx = out.indexOf("<CLR>");
    const showIdx = out.lastIndexOf(ESC.SHOW_CURSOR);
    expect(clearIdx).toBeGreaterThan(-1);
    expect(showIdx).toBeGreaterThan(clearIdx);
  });
});

describe("launch-loader core — lifecycle guards", () => {
  test("stop without start writes nothing (warm-launch no-op)", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "m");
    core.stop();
    expect(r.get()).toBe("");
    expect(core.started).toBe(false);
  });

  test("stop is idempotent", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "m");
    core.start();
    core.stop();
    const afterFirst = r.get();
    core.stop();
    expect(r.get()).toBe(afterFirst);
  });

  test("start after stop is a no-op", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "m");
    core.stop();
    core.start();
    expect(core.started).toBe(false);
    expect(r.get()).toBe("");
  });

  test("tick before start does nothing", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "m");
    core.tick();
    expect(r.get()).toBe("");
  });

  test("start then immediate stop draws one frame and cleans up (single-frame flash)", () => {
    const r = makeRecorder();
    const core = createLoaderCore(r.deps, "m");
    core.start();
    core.stop();
    const out = r.get();
    expect(out).toContain(ESC.HIDE_CURSOR);
    expect(out).toContain(FRAMES[0]!); // exactly one frame was drawn
    expect(out.trimEnd().endsWith(ESC.SHOW_CURSOR)).toBe(true); // ends clean
  });
});

describe("startLoader — non-interactive returns null", () => {
  test("returns null and writes nothing when the stream is not a TTY", () => {
    let wrote = "";
    const fakeStream = {
      isTTY: false,
      write: (s: string) => {
        wrote += s;
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    const handle = startLoader({ stream: fakeStream, startDelayMs: 0 });
    expect(handle).toBeNull();
    expect(wrote).toBe("");
  });
});
