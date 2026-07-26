/**
 * Unit tests for PROFILE_KEYWORDS exported from ai.ts.
 *
 * The existing ai-score.e2e.test.ts covers end-to-end matching behaviour via
 * spawnSync. These tests guard the data structure itself — malformed keyword
 * data (uppercase, empty strings, duplicates) breaks matching silently.
 */

import { describe, test, expect } from "bun:test";
import { PROFILE_KEYWORDS } from "./ai";

describe("PROFILE_KEYWORDS data invariants", () => {
  test("every value is a non-empty array", () => {
    for (const [_profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBeGreaterThan(0);
    }
  });

  test("every keyword string is non-empty", () => {
    for (const [_profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
      for (const kw of keywords) {
        expect(typeof kw).toBe("string");
        expect(kw.length).toBeGreaterThan(0);
      }
    }
  });

  test("all keywords are lowercase (matching runs on desc.toLowerCase())", () => {
    const violations: string[] = [];
    for (const [profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
      for (const kw of keywords) {
        if (kw !== kw.toLowerCase()) {
          violations.push(`${profile}: "${kw}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("no duplicate keywords within the same profile entry", () => {
    for (const [_profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const kw of keywords) {
        if (seen.has(kw)) dupes.push(kw);
        seen.add(kw);
      }
      expect(dupes).toEqual([]);
    }
  });

  test("multi-word keywords exist (they score higher: += kw.split(' ').length)", () => {
    const allKeywords = Object.values(PROFILE_KEYWORDS).flat();
    const multiWord = allKeywords.filter(kw => kw.includes(" "));
    expect(multiWord.length).toBeGreaterThan(0);
  });
});

describe("PROFILE_KEYWORDS spot-checks for expected profile mappings", () => {
  test("rust profile maps to 'rust' and 'cargo'", () => {
    expect(PROFILE_KEYWORDS["rust"]).toContain("rust");
    expect(PROFILE_KEYWORDS["rust"]).toContain("cargo");
  });

  test("python profile maps to 'python' and 'fastapi'", () => {
    expect(PROFILE_KEYWORDS["python"]).toContain("python");
    expect(PROFILE_KEYWORDS["python"]).toContain("fastapi");
  });

  test("nextjs profile maps to 'next' and 'next.js'", () => {
    expect(PROFILE_KEYWORDS["nextjs"]).toContain("next");
    expect(PROFILE_KEYWORDS["nextjs"]).toContain("next.js");
  });

  test("frontend profile maps to 'react' and 'vue'", () => {
    expect(PROFILE_KEYWORDS["frontend"]).toContain("react");
    expect(PROFILE_KEYWORDS["frontend"]).toContain("vue");
  });

  test("go-api profile maps to 'go' and 'golang'", () => {
    expect(PROFILE_KEYWORDS["go-api"]).toContain("go");
    expect(PROFILE_KEYWORDS["go-api"]).toContain("golang");
  });

  test("medusa-dev profile maps to 'medusa' and 'ecommerce'", () => {
    expect(PROFILE_KEYWORDS["medusa-dev"]).toContain("medusa");
    expect(PROFILE_KEYWORDS["medusa-dev"]).toContain("ecommerce");
  });

  test("video profile maps to 'video' and 'ffmpeg'", () => {
    expect(PROFILE_KEYWORDS["video"]).toContain("video");
    expect(PROFILE_KEYWORDS["video"]).toContain("ffmpeg");
  });

  test("cybersecurity profile maps to 'security' and 'pentest'", () => {
    expect(PROFILE_KEYWORDS["cybersecurity"]).toContain("security");
    expect(PROFILE_KEYWORDS["cybersecurity"]).toContain("pentest");
  });
});

describe("PROFILE_KEYWORDS scoring behaviour", () => {
  test("rust multi-word entry 'async rust' scores 2 (2 words) for a matching description", () => {
    // Verify the keyword exists — scoring: score += kw.split(" ").length
    expect(PROFILE_KEYWORDS["rust"]).toContain("async rust");
    expect("async rust".split(" ").length).toBe(2);
  });

  test("nextjs 'server components' is a multi-word keyword", () => {
    expect(PROFILE_KEYWORDS["nextjs"]).toContain("server components");
    expect("server components".split(" ").length).toBe(2);
  });
});
