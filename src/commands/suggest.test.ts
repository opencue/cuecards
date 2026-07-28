/**
 * Tests for `cue suggest`.
 *
 * The command's only exported surface is `run()`.  We drive it through the
 * fast paths (--help) and through the "no sessions" path by pointing
 * CUE_SUGGEST_SESSIONS_DIR at an empty temp dir so we never touch
 * ~/.claude/projects.  The profile is always supplied explicitly so that
 * the cwd-based auto-detection (which reads ~/.config/cue) is skipped.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractUserPrompts,
  run,
  scoreSkills,
  tokenizeText,
  type CatalogEntry,
} from "./suggest";

// ---------------------------------------------------------------------------
// tokenizeText / scoreSkills — the scoring core, pure
// ---------------------------------------------------------------------------

describe("tokenizeText", () => {
  test("drops function words, which every skill description is full of", () => {
    // Every SKILL.md description opens with boilerplate like this; if it turns
    // into keywords, the whole catalogue matches every transcript.
    const out = tokenizeText("Use this when the user asks you to design a page");
    expect(out).toContain("design");
    expect(out).toContain("page");
    for (const noise of ["use", "this", "when", "the", "user", "you", "asks"]) {
      expect(out).not.toContain(noise);
    }
  });

  test("drops transcript structure words, which are not something anyone said", () => {
    const out = tokenizeText("assistant tool_result content json stripe");
    expect(out).toEqual(["stripe"]);
  });
});

describe("extractUserPrompts", () => {
  const line = (o: unknown) => JSON.stringify(o);

  test("keeps what the user typed and drops everything else in the transcript", () => {
    const chunk = [
      line({ message: { role: "user", content: "please set up kubernetes" } }),
      line({ message: { role: "assistant", content: [{ type: "text", text: "wedding invitations" }] } }),
      line({ message: { role: "user", content: [{ type: "text", text: "and helm charts" }] } }),
    ].join("\n");
    const out = extractUserPrompts(chunk);
    expect(out).toContain("kubernetes");
    expect(out).toContain("helm charts");
    expect(out).not.toContain("wedding");
  });

  test("tool output is not something the user said, despite its user role", () => {
    const chunk = line({
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "read read read date date" }],
      },
    });
    expect(extractUserPrompts(chunk)).toBe("");
  });

  test("a torn final line is skipped, not thrown on", () => {
    const chunk = `${line({ message: { role: "user", content: "figma" } })}\n{"message":{"rol`;
    expect(extractUserPrompts(chunk)).toBe("figma");
  });
});

describe("scoreSkills", () => {
  const entry = (id: string, keywords: string[]): CatalogEntry => ({ id, keywords });

  test("a keyword only ever seen inside longer words scores nothing", () => {
    // "ops" lives inside "operations"/"develops"; substring counting made that
    // look like 40 mentions of an ops skill.
    const out = scoreSkills(
      [entry("ops/deploy", ["ops", "kubernetes"])],
      ["operations develops operations develops operations develops"],
    );
    expect(out).toEqual([]);
  });

  test("one repeated word is not enough — a skill must match on more than one", () => {
    const out = scoreSkills(
      [entry("some/skill", ["design", "figma", "typography"])],
      [Array(80).fill("design").join(" ")],
    );
    expect(out).toEqual([]);
  });

  test("suggests a skill whose vocabulary genuinely shows up", () => {
    const out = scoreSkills(
      [entry("design/figma", ["figma", "typography", "palette"])],
      ["figma figma typography palette figma typography"],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.skillId).toBe("design/figma");
    expect(out[0]?.reason).toContain("figma");
  });

  test("the named keyword is one that actually scored", () => {
    // The reason used to be computed by a second, unfiltered pass, so it could
    // name a word ("to", "and") that never contributed to the score.
    const out = scoreSkills(
      [entry("a/b", ["kubernetes", "helm", "and", "the"])],
      ["kubernetes helm kubernetes and the and the and the and the and the"],
    );
    expect(out[0]?.reason).toContain("kubernetes");
    expect(out[0]?.reason).not.toContain('"and"');
    expect(out[0]?.reason).not.toContain('"the"');
  });

  test("confidence discriminates instead of pinning everything at 1.00", () => {
    const broad = entry("broad/skill", ["figma", "typography", "palette", "kerning"]);
    const narrow = entry("narrow/skill", ["figma", "typography", "palette", "kerning"]);
    const out = scoreSkills(
      [broad, narrow],
      ["figma typography palette kerning figma typography palette kerning", "figma typography"],
    );
    for (const s of out) expect(s.confidence).toBeLessThanOrEqual(1);
    // A single dominant word can never reach certainty on its own.
    const thin = scoreSkills(
      [entry("thin/skill", ["figma", "typography"])],
      [Array(500).fill("figma typography").join(" ")],
    );
    expect(thin[0]!.confidence).toBeLessThan(1);
  });

  test("ranks the better-covered skill first", () => {
    const out = scoreSkills(
      [
        entry("weak/skill", ["figma", "sketch", "invision", "zeplin"]),
        entry("strong/skill", ["kubernetes", "helm", "kubectl"]),
      ],
      ["figma figma sketch kubernetes helm kubectl kubernetes helm kubectl"],
    );
    expect(out[0]?.skillId).toBe("strong/skill");
  });
});

let tmpDir: string;
let savedSessionsDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-suggest-"));
  savedSessionsDir = process.env.CUE_SUGGEST_SESSIONS_DIR;
  // Redirect session scanning away from the real ~/.claude/projects.
  process.env.CUE_SUGGEST_SESSIONS_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedSessionsDir === undefined) {
    delete process.env.CUE_SUGGEST_SESSIONS_DIR;
  } else {
    process.env.CUE_SUGGEST_SESSIONS_DIR = savedSessionsDir;
  }
});

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as any).write = (chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout as any).write = orig;
  }
}

describe("cue suggest --help", () => {
  test("--help returns 0 and prints usage", async () => {
    const { code, out } = await captureStdout(() => run(["--help"]));
    expect(code).toBe(0);
    expect(out).toContain("cue suggest");
    expect(out).toContain("--days");
    expect(out).toContain("--profile");
  });

  test("-h is an alias for --help", async () => {
    const { code, out } = await captureStdout(() => run(["-h"]));
    expect(code).toBe(0);
    expect(out).toContain("cue suggest");
  });
});

describe("cue suggest with explicit profile and empty sessions", () => {
  test("reports no transcripts when sessions dir is empty (default days)", async () => {
    // tmpDir has no .jsonl files → scanSessions returns [] → early exit
    const { code, out } = await captureStdout(() => run(["--profile", "core"]));
    expect(code).toBe(0);
    expect(out).toContain("No session transcripts found");
    expect(out).toContain("7 days");
  });

  test("--days N is reflected in the no-transcripts message", async () => {
    const { code, out } = await captureStdout(() =>
      run(["--profile", "core", "--days", "3"]),
    );
    expect(code).toBe(0);
    expect(out).toContain("No session transcripts found");
    expect(out).toContain("3 days");
  });
});
