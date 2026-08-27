import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./auto-detect";

let tmp: string;
let origCwd: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cue-autodetect-cli-"));
  origCwd = process.cwd();
  process.chdir(tmp);
});
afterEach(() => {
  process.chdir(origCwd);
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

async function capture(args: string[]): Promise<{ stdout: string; code: number }> {
  const origOut = process.stdout.write.bind(process.stdout);
  let stdout = "";
  (process.stdout as any).write = (c: string | Uint8Array) => { stdout += String(c); return true; };
  try {
    const code = await run(args);
    return { stdout, code };
  } finally {
    (process.stdout as any).write = origOut;
  }
}

describe("cue auto-detect (CLI)", () => {
  test("package.json with stripe dep surfaces the stripe profile", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { stripe: "14.0.0" },
    }));
    const { stdout, code } = await capture([]);
    expect(code).toBe(0);
    expect(stdout).toContain("stripe");
  });

  test("--json emits v2 suggestions with reasons", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { next: "14.0.0", "@aws-sdk/client-s3": "3.0.0" },
    }));
    const { stdout, code } = await capture(["--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    const profiles = parsed.suggestions.map((s: { profile: string }) => s.profile);
    expect(profiles).toContain("nextjs");
    expect(profiles).toContain("aws");
    for (const s of parsed.suggestions) {
      expect(Array.isArray(s.reasons)).toBe(true);
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
    expect(parsed.stacks[0].profiles).toEqual(["nextjs", "aws"]);
    expect(parsed.autoSelection).toMatchObject({
      status: "confident",
      selector: "nextjs+aws",
    });
  });

  test("--apply pins the top v2 match to .cue.profile", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { next: "14.0.0", stripe: "14.0.0" },
    }));
    const { code } = await capture(["--apply"]);
    expect(code).toBe(0);
    expect(readFileSync(join(tmp, ".cue.profile"), "utf8").trim()).toBe("nextjs+stripe");
  });

  test("--apply refuses a weak match unless --force is explicit", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({
      dependencies: { express: "5.0.0" },
    }));

    const refused = await capture(["--apply"]);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("uncertain");
    expect(() => readFileSync(join(tmp, ".cue.profile"), "utf8")).toThrow();

    const forced = await capture(["--apply", "--force"]);
    expect(forced.code).toBe(0);
    expect(readFileSync(join(tmp, ".cue.profile"), "utf8").trim()).toBe("backend");
  });

  test("empty dir reports no matches", async () => {
    const { stdout, code } = await capture([]);
    expect(code).toBe(0);
    expect(stdout).toContain("No profile matches");
  });
});
