import { describe, expect, test, beforeAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Behavior tests for the two liedetector Stop hooks.
 *
 * Both are gated shell scripts that parse a Claude Code transcript, so the only
 * honest way to test them is to feed a real-shaped transcript through stdin and
 * read what they emit. Nothing under resources/hooks/ had coverage before this.
 *
 * Transcript records MUST be compact JSON — tag-audit.sh matches the literal
 * `"type":"user"` to find the turn boundary, and Claude Code writes compact
 * JSONL. A pretty-printed fixture silently produces zero output.
 */

const REPO = join(import.meta.dir, "../..");
const TAG_AUDIT = join(REPO, "resources/hooks/tag-audit.sh");
const DENSITY = join(REPO, "resources/hooks/liedetector-tag-density.sh");

type Tool = { name: string; command?: string };

let dir: string;
let seq = 0;

/**
 * Both hooks are gated on a state file under $HOME, so the tests must run with
 * HOME pointed at a temp dir — otherwise they'd read the developer's real
 * config and pass or fail for the wrong reason.
 *
 * That breaks `python3` on setups where it resolves to a wrapper script that
 * execs `$HOME/.nix-profile/bin/python3` (nix, pyenv, mise, asdf all do shapes
 * of this). The hook then fails open and emits nothing — which silently turns
 * every "expects no output" assertion into a vacuous pass. So: resolve the real
 * interpreter under the ambient HOME once, and front-load a PATH shim pointing
 * straight at it. setup asserts the shim survives a foreign HOME, so a broken
 * environment fails loudly instead of quietly greening the suite.
 */
let shimBin: string;
beforeAll(async () => {
  shimBin = await mkdtemp(join(tmpdir(), "cue-hook-shim-"));
  const resolved = Bun.spawnSync(["python3", "-c", "import sys; print(sys.executable)"]);
  const real = resolved.stdout.toString().trim();
  if (!resolved.success || !real) {
    throw new Error("cannot resolve a real python3 interpreter for hook tests");
  }
  await symlink(real, join(shimBin, "python3"));

  const probe = Bun.spawnSync(["python3", "-c", "print('ok')"], {
    env: { ...process.env, HOME: shimBin, PATH: `${shimBin}:${process.env.PATH}` },
  });
  if (probe.stdout.toString().trim() !== "ok") {
    throw new Error("python3 shim does not survive a foreign HOME");
  }
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cue-liedetector-hooks-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** One user turn plus one assistant turn carrying `text` and `tools`. */
async function transcript(text: string, tools: Tool[] = []): Promise<string> {
  const content: unknown[] = [{ type: "text", text }];
  for (const t of tools) {
    content.push({
      type: "tool_use",
      name: t.name,
      input: t.command ? { command: t.command } : {},
    });
  }
  const lines = [
    JSON.stringify({ type: "user", message: { content: "go" } }),
    JSON.stringify({ type: "assistant", message: { content } }),
  ];
  const path = join(dir, `t${seq++}.jsonl`);
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

/** Run a hook with the Stop payload on stdin; return everything it emitted. */
async function runHook(
  hook: string,
  transcriptPath: string,
  env: Record<string, string> = {},
): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn(["bash", hook], {
    stdin: new TextEncoder().encode(
      JSON.stringify({
        transcript_path: transcriptPath,
        session_id: `test-${seq}`,
      }),
    ),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: dir,
      XDG_RUNTIME_DIR: dir,
      PATH: `${shimBin}:${process.env.PATH}`,
      ...env,
    },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: (stdout + stderr).trim(), code };
}

async function enableDensityGate() {
  await mkdir(join(dir, ".config/cue"), { recursive: true });
  await writeFile(join(dir, ".config/cue/liedetector-tag-check"), "");
}

const PAD = " filler words to clear the length gate.".repeat(40);
const tag = (s: string) => s; // readability at call sites

describe("tag-audit.sh", () => {
  test("reports the tag mix on a turn with 3+ tags", async () => {
    const t = await transcript(
      tag(
        "🟢 [VERIFIED] a. 🟢 [KNOWN] b. " +
          "🟡 [INFERRED ~80%] c. 🟡 [INFERRED ~70%] d. 🟡 [ASSUMED ~60%] e. " +
          "🟡 [ASSUMED ~50%] f. 🟡 [INFERRED ~60%] g. " +
          "🟠 [GUESSED ~30%] h. 🟠 [GUESSED ~20%] i. 🟠 [STALE ~40%] j. " +
          "🔴 [UNKNOWN] k.",
      ),
      [{ name: "Read" }, { name: "Grep" }],
    );
    const { out, code } = await runHook(TAG_AUDIT, t);
    expect(code).toBe(0);
    expect(out).toContain("Tag mix (11 claims)");
    expect(out).toContain("🟢2 🟡5 🟠3 🔴1");
    expect(out).toContain("18% grounded");
    expect(out).toContain("36% guess-or-worse");
    // Evidence was present, so no violation warning.
    expect(out).not.toContain("Tag audit:");
  });

  test("counts [CORRECTION] separately in the mix line", async () => {
    const t = await transcript(
      "🟢 [VERIFIED] a. 🟡 [INFERRED ~80%] b. 🟠 [GUESSED ~30%] c. " +
        "🟠 [CORRECTION] earlier I said d.",
      [{ name: "Read" }],
    );
    const { out } = await runHook(TAG_AUDIT, t);
    expect(out).toContain("Tag mix (3 claims)");
    expect(out).toContain("1x [CORRECTION]");
  });

  test("warns when [VERIFIED] appears with no verification action", async () => {
    const t = await transcript(
      "🟢 [VERIFIED] a. 🟢 [VERIFIED] b. 🟢 [VERIFIED] c. 🟡 [INFERRED ~80%] d.",
      [{ name: "Write" }],
    );
    const { out } = await runHook(TAG_AUDIT, t);
    expect(out).toContain("zero observable verification action");
    expect(out).toContain("Tag mix (4 claims)");
  });

  test("stays silent below the 3-tag threshold", async () => {
    const t = await transcript("🟢 [VERIFIED] a. 🟡 [INFERRED ~80%] b.", [
      { name: "Read" },
    ]);
    const { out } = await runHook(TAG_AUDIT, t);
    expect(out).toBe("");
  });

  test("CUE_TAG_MIX_OFF=1 suppresses the mix line", async () => {
    const t = await transcript(
      "🟢 [VERIFIED] a. 🟡 [INFERRED ~80%] b. 🟠 [GUESSED ~30%] c.",
      [{ name: "Read" }],
    );
    const { out } = await runHook(TAG_AUDIT, t, { CUE_TAG_MIX_OFF: "1" });
    expect(out).toBe("");
  });

  test("[skip-tag-audit] suppresses the whole hook", async () => {
    const t = await transcript(
      "🟢 [VERIFIED] a. 🟢 [VERIFIED] b. 🟢 [VERIFIED] c. [skip-tag-audit]",
      [{ name: "Write" }],
    );
    const { out } = await runHook(TAG_AUDIT, t);
    expect(out).toBe("");
  });

  test("fails open on an unreadable transcript", async () => {
    const { out, code } = await runHook(TAG_AUDIT, join(dir, "missing.jsonl"));
    expect(code).toBe(0);
    expect(out).toBe("");
  });
});

describe("liedetector-tag-density.sh", () => {
  test("flags a yellow tag with no ~N%", async () => {
    await enableDensityGate();
    const t = await transcript(
      "🟡 [INFERRED] the fix works. 🟠 [GUESSED ~30%] more bugs." + PAD,
    );
    const { out, code } = await runHook(DENSITY, t);
    expect(code).toBe(0);
    expect(out).toContain("no ~N%");
    expect(out).toContain("INFERRED");
  });

  test("flags off-ladder values on both tiers", async () => {
    await enableDensityGate();
    const t = await transcript(
      "🟡 [INFERRED ~90%] a. 🟠 [GUESSED ~50%] b." + PAD,
    );
    const { out } = await runHook(DENSITY, t);
    expect(out).toContain("off-ladder");
    expect(out).toContain("INFERRED ~90%");
    expect(out).toContain("GUESSED ~50%");
  });

  test("flags false precision", async () => {
    await enableDensityGate();
    const t = await transcript("🟡 [INFERRED ~67%] a." + PAD);
    const { out } = await runHook(DENSITY, t);
    expect(out).toContain("off-ladder");
  });

  // One tag per transcript: packing all 28 into one response trips the
  // tag-spam check instead, which is correct hook behavior but a different
  // assertion. No PAD either — the zero-tag check can't fire when a tag is
  // present, and 1 tag is well under the spam floor.
  const YELLOW = ["50", "55", "60", "65", "70", "75", "80", "85"];
  const ORANGE = ["20", "25", "30", "35", "40", "45"];

  test("accepts every step of the 5-point raster", async () => {
    await enableDensityGate();
    const cases: Array<[string, string[]]> = [
      ["INFERRED", YELLOW],
      ["ASSUMED", YELLOW],
      ["GUESSED", ORANGE],
      ["STALE", ORANGE],
    ];
    for (const [name, ladder] of cases) {
      for (const v of ladder) {
        const t = await transcript(`[${name} ~${v}%] a claim.`);
        const { out } = await runHook(DENSITY, t);
        expect(`${name} ~${v}% -> ${out}`).toBe(`${name} ~${v}% -> `);
      }
    }
  });

  test("green and red carry no ~N% and stay legal", async () => {
    await enableDensityGate();
    for (const name of ["VERIFIED", "KNOWN", "UNKNOWN"]) {
      const t = await transcript(`[${name}] a claim.`);
      const { out } = await runHook(DENSITY, t);
      expect(out).toBe("");
    }
  });

  test("rejects values that fall between the 5-point steps", async () => {
    await enableDensityGate();
    for (const bad of ["52", "63", "77", "22", "38"]) {
      const t = await transcript(`🟡 [INFERRED ~${bad}%] a.` + PAD);
      const { out } = await runHook(DENSITY, t);
      expect(out).toContain("off-ladder");
    }
  });

  test("nudges a long response carrying zero tags", async () => {
    await enableDensityGate();
    const t = await transcript("A long untagged answer." + PAD);
    const { out } = await runHook(DENSITY, t);
    expect(out).toContain("zero confidence tags");
  });

  test("nudges tag-spam", async () => {
    await enableDensityGate();
    const t = await transcript(
      Array.from({ length: 12 }, (_, i) => `🟢 [KNOWN] w${i}.`).join(" "),
    );
    const { out } = await runHook(DENSITY, t);
    expect(out).toContain("Tag-spam");
  });

  test("[skip-tag-density] suppresses the nudge", async () => {
    await enableDensityGate();
    const t = await transcript(
      "🟡 [INFERRED] no percent here. [skip-tag-density]" + PAD,
    );
    const { out } = await runHook(DENSITY, t);
    expect(out).toBe("");
  });

  test("no-ops entirely when the opt-in gate is absent", async () => {
    // gate deliberately not created
    const t = await transcript("🟡 [INFERRED] no percent here." + PAD);
    const { out, code } = await runHook(DENSITY, t);
    expect(code).toBe(0);
    expect(out).toBe("");
  });
});
