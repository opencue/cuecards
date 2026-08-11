import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adviseProfiles, advisorCacheKey, parseProfileAdvice } from "./ai-profile-advisor";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "cue-advisor-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("AI profile advisor", () => {
  test("accepts JSON only when every suggestion names an installed profile", () => {
    const known = new Set(["google-ads", "coolify"]);
    expect(parseProfileAdvice('{"summary":"ads repo","suggestions":[{"profile":"google-ads","confidence":0.92,"reasons":["GAQL scripts"]}]}', known)?.suggestions[0]?.profile).toBe("google-ads");
    expect(parseProfileAdvice('{"summary":"bad","suggestions":[{"profile":"invented","confidence":0.9,"reasons":["guess"]}]}', known)).toBeNull();
  });

  test("caches by resolved repository path and git HEAD", async () => {
    const cwd = temp();
    const cacheRoot = temp();
    writeFileSync(join(cwd, "README.md"), "Google Ads campaign manager");
    let calls = 0;
    const runner = () => {
      calls += 1;
      return '{"summary":"ads","suggestions":[{"profile":"google-ads","confidence":0.9,"reasons":["README"]}]}';
    };
    const options = { cwd, cacheRoot, head: "abc", knownProfiles: ["google-ads", "coolify"], runner };
    expect((await adviseProfiles(options))?.suggestions[0]?.profile).toBe("google-ads");
    expect((await adviseProfiles(options))?.suggestions[0]?.profile).toBe("google-ads");
    expect(calls).toBe(1);
    expect(advisorCacheKey(cwd, "abc")).not.toBe(advisorCacheKey(cwd, "def"));
  });

  test("tries the other agent, then returns null for deterministic fallback", async () => {
    const cwd = temp();
    const attempted: string[] = [];
    const result = await adviseProfiles({
      cwd,
      cacheRoot: temp(),
      head: "abc",
      knownProfiles: ["core"],
      preferredAgent: "codex",
      runner: (agent) => { attempted.push(agent); return agent === "codex" ? "not json" : null; },
    });
    expect(result).toBeNull();
    expect(attempted).toEqual(["codex", "claude"]);
  });
});
