import { describe, expect, test } from "bun:test";

import { detectCompanions, serviceCompanions, type CompanionDetectInput } from "./companion-detect";
import { COMBINE_AUTO_CHECK_CONFIDENCE } from "./picker";

const KNOWN = new Set(["higgsfield", "blog-writer", "postizz", "creative-media"]);

function run(
  entries: string[],
  extra: Partial<CompanionDetectInput> = {},
): ReturnType<typeof detectCompanions> {
  return detectCompanions({
    cwd: "/work/volaria",
    knownProfiles: KNOWN,
    listEntries: () => entries,
    ...extra,
  });
}

describe("detectCompanions — images → higgsfield", () => {
  test("≥3 image files suggest higgsfield, auto-checkable (≥0.7), with a count reason", () => {
    const r = run(["a.png", "b.jpg", "c.webp", "d.jpeg"]);
    const hf = r.find((s) => s.profile === "higgsfield");
    expect(hf).toBeDefined();
    expect(hf!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(hf!.reason).toBe("4 image assets");
  });

  test("fewer than 3 images produces no higgsfield signal", () => {
    const r = run(["a.png", "b.png", "notes.txt"]);
    expect(r.find((s) => s.profile === "higgsfield")).toBeUndefined();
  });

  test("confidence scales with count but caps at 0.9", () => {
    const many = Array.from({ length: 30 }, (_, i) => `img${i}.png`);
    const hf = run(many).find((s) => s.profile === "higgsfield");
    expect(hf!.confidence).toBe(0.9);
  });
});

describe("detectCompanions — video → higgsfield", () => {
  test("a single video file suggests higgsfield", () => {
    const hf = run(["clip.mp4"]).find((s) => s.profile === "higgsfield");
    expect(hf).toBeDefined();
    expect(hf!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("images + video collapse to one higgsfield row, reasons merged", () => {
    const r = run(["a.png", "b.png", "c.png", "reel.mov"]);
    const hf = r.filter((s) => s.profile === "higgsfield");
    expect(hf).toHaveLength(1);
    expect(hf[0]!.reason).toContain("image assets");
    expect(hf[0]!.reason).toContain("video file");
  });
});

describe("detectCompanions — markdown → blog-writer", () => {
  test("≥2 draft .md files suggest blog-writer but stay below auto-check", () => {
    const bw = run(["draft-1.md", "draft-2.md"]).find((s) => s.profile === "blog-writer");
    expect(bw).toBeDefined();
    expect(bw!.confidence).toBeLessThan(0.7);
  });

  test("README/AGENTS/CLAUDE are not counted as drafts", () => {
    const r = run(["README.md", "AGENTS.md", "CLAUDE.md"]);
    expect(r.find((s) => s.profile === "blog-writer")).toBeUndefined();
  });

  test("a content/ entry alone is enough", () => {
    const bw = run(["content", "x.txt"]).find((s) => s.profile === "blog-writer");
    expect(bw).toBeDefined();
  });
});

describe("detectCompanions — brand dir → postizz", () => {
  test("cwd basename matching a registered brand suggests postizz", () => {
    const pz = run(["whatever.txt"], { brands: new Set(["volaria", "slopix"]) }).find(
      (s) => s.profile === "postizz",
    );
    expect(pz).toBeDefined();
    expect(pz!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(pz!.reason).toBe("registered brand: volaria");
  });

  test("non-brand cwd basename yields no postizz signal", () => {
    const r = run(["x.txt"], { cwd: "/work/random-proj", brands: new Set(["volaria"]) });
    expect(r.find((s) => s.profile === "postizz")).toBeUndefined();
  });
});

describe("detectCompanions — gating & robustness", () => {
  test("companions not installed in this cue install are filtered out", () => {
    const r = run(["a.png", "b.png", "c.png"], { knownProfiles: new Set(["blog-writer"]) });
    expect(r.find((s) => s.profile === "higgsfield")).toBeUndefined();
  });

  test("results are sorted by confidence descending", () => {
    const r = run(["a.png", "b.png", "c.png", "d.md", "e.md"], {
      brands: new Set(["volaria"]),
    });
    const confs = r.map((s) => s.confidence);
    expect(confs).toEqual([...confs].sort((a, b) => b - a));
  });

  test("an empty / unreadable directory yields no signals", () => {
    expect(run([])).toEqual([]);
    expect(detectCompanions({ cwd: "/work/x", knownProfiles: KNOWN })).toBeInstanceOf(Array);
  });
});

describe("serviceCompanions", () => {
  const SERVICE_KNOWN = new Set(["stripe", "aws", "react-native", "nextjs"]);

  test("dep-detected stripe becomes a pre-checked combine companion", () => {
    const out = serviceCompanions(
      [{ profile: "stripe", confidence: 0.6, reasons: ["package.json has stripe"] }],
      SERVICE_KNOWN,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.profile).toBe("stripe");
    // At/above the combine multiselect's auto-check line (0.7) so the row
    // starts checked — a direct dependency is a strong companion signal.
    expect(out[0]!.confidence).toBeGreaterThanOrEqual(COMBINE_AUTO_CHECK_CONFIDENCE);
    expect(out[0]!.reason).toBe("package.json has stripe");
  });

  test("primary-stack rules (react-native) never become companions", () => {
    const out = serviceCompanions(
      [{ profile: "react-native", confidence: 0.85, reasons: ["package.json has react-native/expo"] }],
      SERVICE_KNOWN,
    );
    expect(out).toEqual([]);
  });

  test("non-rule detections (nextjs from framework chain) pass through nothing", () => {
    const out = serviceCompanions(
      [{ profile: "nextjs", confidence: 0.9, reasons: ["package.json has next"] }],
      SERVICE_KNOWN,
    );
    expect(out).toEqual([]);
  });

  test("profiles not installed in this cue install are filtered out", () => {
    const out = serviceCompanions(
      [{ profile: "aws", confidence: 0.6, reasons: ["package.json has @aws-sdk/*"] }],
      new Set(["stripe"]),
    );
    expect(out).toEqual([]);
  });
});
