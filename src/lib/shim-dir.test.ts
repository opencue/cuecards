import { describe, expect, test } from "bun:test";

import {
  FISH_DROPIN_MARKER,
  fishDropIn,
  fishDropInPath,
  isCueShimContent,
  rcSnippet,
  shimContent,
  shimDir,
  shimDirPosition,
} from "./shim-dir";

describe("shimDir", () => {
  test("is under the given home, never ~/.local/bin", () => {
    const dir = shimDir("/fake/home");
    expect(dir).toBe("/fake/home/.config/cue/shims");
    expect(dir).not.toContain(".local/bin");
  });

  test("fish drop-in lands in conf.d", () => {
    expect(fishDropInPath("/fake/home")).toBe("/fake/home/.config/fish/conf.d/cue-shims.fish");
  });
});

describe("isCueShimContent", () => {
  test("matches the bare-cue form", () => {
    expect(isCueShimContent('#!/usr/bin/env bash\nexec cue launch claude "$@"\n', "claude")).toBe(true);
  });

  // The old inline check was /cue\s+launch/i, which does NOT match this form —
  // the quote between `cue` and `launch` isn't whitespace. That made
  // findRealAgentBin() treat a source-clone user's shim as the real binary.
  test("matches the quoted-absolute-path form", () => {
    const content = '#!/usr/bin/env bash\nexec "/home/u/Documents/cue/bin/cue" launch claude "$@"\n';
    expect(isCueShimContent(content, "claude")).toBe(true);
  });

  test("does not match a real binary wrapper", () => {
    expect(isCueShimContent('#!/usr/bin/env bash\nexec /opt/anthropic/claude "$@"\n')).toBe(false);
  });

  test("is agent-specific when an agent is given", () => {
    const codex = '#!/usr/bin/env bash\nexec cue launch codex "$@"\n';
    expect(isCueShimContent(codex, "codex")).toBe(true);
    expect(isCueShimContent(codex, "claude")).toBe(false);
  });

  test("round-trips whatever shimContent produces", () => {
    for (const invoke of ["cue", '"/abs/path/cue"', '"/abs/path/cue.mjs"']) {
      expect(isCueShimContent(shimContent(invoke, "claude"), "claude")).toBe(true);
    }
  });
});

describe("rcSnippet", () => {
  test("fish prepends via fish_add_path", () => {
    // -g not -U: a conf.d snippet re-runs every session, and a universal
    // variable would accumulate duplicate entries instead of being reset.
    expect(rcSnippet("fish", "/x/shims")).toBe("fish_add_path -g -p /x/shims");
  });

  test("bash and zsh prepend to PATH", () => {
    expect(rcSnippet("bash", "/x/shims")).toBe('export PATH="/x/shims:$PATH"');
    expect(rcSnippet("zsh", "/x/shims")).toBe('export PATH="/x/shims:$PATH"');
  });

  test("the fish drop-in carries the ownership marker and the line", () => {
    const body = fishDropIn("/x/shims");
    expect(body).toContain(FISH_DROPIN_MARKER);
    expect(body).toContain(rcSnippet("fish", "/x/shims"));
  });
});

describe("shimDirPosition", () => {
  const dir = "/home/u/.config/cue/shims";

  test("absent when the shim dir isn't on PATH", () => {
    expect(shimDirPosition(["/usr/bin"], "/usr/bin/claude", dir)).toBe("absent");
  });

  test("before when the shim dir leads", () => {
    expect(shimDirPosition([dir, "/usr/bin"], "/usr/bin/claude", dir)).toBe("before");
  });

  test("after when the real binary's dir leads", () => {
    expect(shimDirPosition(["/usr/bin", dir], "/usr/bin/claude", dir)).toBe("after");
  });

  test("before when the real binary's dir isn't on PATH — nothing can shadow it", () => {
    expect(shimDirPosition([dir], "/opt/claude/bin/claude", dir)).toBe("before");
  });

  test("before when the real binary is unknown", () => {
    expect(shimDirPosition([dir], null, dir)).toBe("before");
  });

  test("normalizes PATH entries before comparing", () => {
    expect(shimDirPosition([`${dir}/`, "/usr/bin"], "/usr/bin/claude", dir)).toBe("before");
  });
});
