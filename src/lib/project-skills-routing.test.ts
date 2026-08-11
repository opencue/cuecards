import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import { scoreQuery, type IndexEntry, type SkillIndex } from "./catalog-index";
import { parseSkillFromContent } from "./skill-router";

const SKILLS = [
  ".agents/skills/ai-slop-detector/SKILL.md",
  ".agents/skills/hydra/SKILL.md",
  ".agents/skills/reddit-skills/SKILL.md",
  ".agents/skills/reddit-skills/skills/reddit-auth/SKILL.md",
  ".agents/skills/reddit-skills/skills/reddit-content-ops/SKILL.md",
  ".agents/skills/reddit-skills/skills/reddit-explore/SKILL.md",
  ".agents/skills/reddit-skills/skills/reddit-interact/SKILL.md",
  ".agents/skills/reddit-skills/skills/reddit-publish/SKILL.md",
] as const;

function entryFrom(path: string): IndexEntry {
  const source = resolve(path);
  const content = readFileSync(source, "utf8");
  const frontmatter = parseYaml(content.split("---", 3)[1] ?? "") as {
    name: string;
    description: string;
    tags?: string[];
  };
  const parsed = parseSkillFromContent(frontmatter.name, content);

  return {
    id: frontmatter.name,
    name: frontmatter.name,
    category: frontmatter.tags?.[0] ?? "project",
    description: frontmatter.description,
    source,
    tags: frontmatter.tags ?? [],
    triggers: parsed.triggers,
    capability: parsed.capability,
    notFor: parsed.notFor,
    links: [],
    requires: { mcps: [] },
    quality: parsed.quality,
  };
}

const entries = SKILLS.map(entryFrom);
const index: SkillIndex = {
  schema_version: "test",
  catalog_mtime: 0,
  counts: {
    skills: entries.length,
    withTriggers: entries.filter((entry) => entry.triggers.length > 0).length,
    withCapability: entries.filter((entry) => entry.capability.length > 0).length,
    withRequires: 0,
  },
  skills: entries,
  mcpProviders: {},
};

const cases: Array<[prompt: string, expected: string]> = [
  ["Humanize this draft and flag anything that sounds AI-written", "ai-slop-detector"],
  ["Run Hydra for a deep security and architecture review", "hydra"],
  ["Am I logged in to Reddit?", "reddit-auth"],
  ["Search Reddit for discussions about local-first software", "reddit-explore"],
  ["Publish this image as a new Reddit post", "reddit-publish"],
  ["Upvote that Reddit post and save it", "reddit-interact"],
  ["Analyze subreddit trends and build an engagement campaign", "reddit-content-ops"],
  ["Use Reddit to search, publish, comment, and save in one workflow", "reddit-skills"],
];

const redditCollisions: Array<[prompt: string, expected: string]> = [
  ["Post a comment on Reddit", "reddit-interact"],
  ["Create a new text post on Reddit", "reddit-publish"],
  ["Check my Reddit login before publishing", "reddit-auth"],
  ["Research Reddit posts without commenting or voting", "reddit-explore"],
  ["Plan a Reddit content strategy, then publish and engage", "reddit-content-ops"],
];

describe("project skill routing", () => {
  for (const [prompt, expected] of cases) {
    test(`${prompt} -> ${expected}`, () => {
      expect(scoreQuery(index, prompt, { limit: 1, threshold: 0 })[0]?.entry.id).toBe(expected);
    });
  }

  for (const [prompt, expected] of redditCollisions) {
    test(`collision: ${prompt} -> ${expected}`, () => {
      expect(scoreQuery(index, prompt, { limit: 1, threshold: 0 })[0]?.entry.id).toBe(expected);
    });
  }
});
