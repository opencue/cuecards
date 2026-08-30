import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getNeededMcps } from "./skill-dependencies";

// Hermetic fixtures: a temp skills root with controlled SKILL.md content,
// passed via getNeededMcps' skillsRoot param. Keeps the test independent of the
// resources/skills submodule pin (whose backfill state varies across commits),
// while still exercising every dependency-detection path:
//   - explicit inline-array requires_mcps  (hostinger/dns)
//   - implicit mcp__<id>__ body reference   (hostinger/dns, hostinger/domains)
//   - explicit-only, no body ref            (deployment/coolify)
//   - explicit block-sequence requires_mcps (xbot/operate) — inline-regex bug guard
//   - no MCP dependency                      (meta/help)
let root: string;

async function writeSkill(id: string, body: string): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), body);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cue-getneeded-"));
  await writeSkill(
    "hostinger/dns",
    `---\nname: dns\nrequires_mcps: [hostinger-api]\n---\nManage DNS via mcp__hostinger-api__list_zones.\n`,
  );
  await writeSkill(
    "hostinger/domains",
    `---\nname: domains\n---\nRegister domains via mcp__hostinger-api__buy_domain.\n`,
  );
  await writeSkill(
    "deployment/coolify",
    `---\nname: coolify\nrequires_mcps: [coolify]\n---\nDeploy. (no body MCP ref — explicit-only)\n`,
  );
  await writeSkill(
    "xbot/operate",
    `---\nname: operate\nrequires_mcps:\n  - xbot\n---\nDrive the bot. (block-sequence requires_mcps, no body ref)\n`,
  );
  await writeSkill("meta/help", `---\nname: help\n---\nJust prints help. No MCP.\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("getNeededMcps", () => {
  test("aggregates explicit + implicit deps across skills (lowercased keys)", () => {
    const needed = getNeededMcps(["hostinger/dns", "deployment/coolify"], root);
    expect(needed.has("hostinger-api")).toBe(true);
    expect(needed.has("coolify")).toBe(true); // explicit-only (no mcp__ ref) — the backfill gap closer
  });

  test("records which skills need an MCP and dedupes them", () => {
    const needed = getNeededMcps(["hostinger/dns", "hostinger/domains"], root);
    const entry = needed.get("hostinger-api")!;
    expect(entry.skills.sort()).toEqual(["hostinger/dns", "hostinger/domains"]);
  });

  test("returns an empty map for skills with no MCP dependency", () => {
    const needed = getNeededMcps(["meta/help"], root);
    expect(needed.size).toBe(0);
  });

  test("does not throw on unknown skill ids", () => {
    expect(() => getNeededMcps(["does/not-exist"], root)).not.toThrow();
    expect(getNeededMcps(["does/not-exist"], root).size).toBe(0);
  });

  test("parses block-sequence requires_mcps (not just inline arrays)", () => {
    // xbot/operate declares its dep as a YAML block list (`requires_mcps:\n  - xbot`)
    // with no `mcp__xbot__` body ref — so it's caught ONLY by explicit block-form
    // parsing. Regression guard for the inline-only-regex starvation bug.
    const needed = getNeededMcps(["xbot/operate"], root);
    expect(needed.has("xbot")).toBe(true);
    expect(needed.get("xbot")!.source).toBe("explicit");
  });
});
