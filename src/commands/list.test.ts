/**
 * Tests for `cue list --json`.
 *
 * Plugin commands (`plugins/cue/commands/cue.md`, `cue-switch.md`,
 * `cue-setup.md`) parse `cue list --json` to enumerate and validate profile
 * names. Before this test existed, `list.ts` always rendered ANSI-coloured
 * text regardless of `--json`, so those commands' first real use would have
 * misparsed the human-readable render — this guards the machine-readable
 * contract directly, against the real `profiles/` tree (no isolation needed:
 * `run()` only reads profiles, it never writes anything).
 */

import { describe, expect, test } from "bun:test";

import { run, type ListedProfile } from "./list";

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as unknown as { write: (c: string | Uint8Array) => boolean }).write = (c) => {
    out += String(c);
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
}

const ESCAPE = String.fromCharCode(27);

describe("cue list --json", () => {
  test("emits a plain JSON array, no ANSI, containing a known profile", async () => {
    const { code, out } = await captureStdout(() => run(["--json"]));
    expect(code).toBe(0);

    // No ANSI escape codes and no "Featured" section header — the whole
    // point of --json is that a plugin command can JSON.parse() the output
    // directly, which the human-readable render's coloured text defeats.
    expect(out.includes(ESCAPE)).toBe(false);
    expect(out).not.toContain("Featured");

    const parsed: ListedProfile[] = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);

    const core = parsed.find((p) => p.name === "core");
    expect(core).toBeDefined();
    expect(typeof core!.description).toBe("string");
    expect(typeof core!.icon).toBe("string");
    expect(typeof core!.skillCount).toBe("number");
    expect(typeof core!.mcpCount).toBe("number");
    expect(typeof core!.featured).toBe("boolean");
  });

  test("without --json still renders the human-readable list (unchanged behavior)", async () => {
    const { code, out } = await captureStdout(() => run([]));
    expect(code).toBe(0);
    expect(out).toContain("core");
  });
});
