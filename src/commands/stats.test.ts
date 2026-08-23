/**
 * Tests for `cue stats`.
 *
 * `parseSince` and `formatDuration` are unexported internal helpers; tested
 * indirectly through `run`.  We control the analytics log by pointing
 * XDG_CONFIG_HOME at a hermetic temp dir.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./stats";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let stdoutBuf = "";
let _stderrBuf = "";
let stdoutSpy: ReturnType<typeof spyOn>;
let stderrSpy: ReturnType<typeof spyOn>;
let tmpDir = "";
let prevXdg: string | undefined;

function setup(dir: string) {
  prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = dir;
  stdoutBuf = "";
  _stderrBuf = "";
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((s: unknown) => {
    stdoutBuf += String(s);
    return true;
  });
  stderrSpy = spyOn(process.stderr, "write").mockImplementation((s: unknown) => {
    _stderrBuf += String(s);
    return true;
  });
}

afterEach(() => {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
  if (prevXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = prevXdg;
  }
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = "";
  }
});

/** Create an analytics.jsonl file inside <dir>/cue/ with the given rows. */
function writeAnalytics(dir: string, events: object[]): void {
  const cueDir = join(dir, "cue");
  mkdirSync(cueDir, { recursive: true });
  writeFileSync(
    join(cueDir, "analytics.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

function writeProfileChoices(dir: string, events: object[]): void {
  const cueDir = join(dir, "cue");
  mkdirSync(cueDir, { recursive: true });
  writeFileSync(
    join(cueDir, "profile-choice-history.jsonl"),
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cue stats run — no data", () => {
  test("help documents the suggestion-quality report", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-help-"));
    setup(tmpDir);

    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("--suggestions");
    expect(stdoutBuf).toContain("--all");
  });

  test("empty analytics dir prints 'No usage data' and returns 0", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-nodata-"));
    setup(tmpDir);

    const code = await run([]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("No usage data");
  });

  test("--json with no analytics returns empty JSON array", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-nojson-"));
    setup(tmpDir);

    const code = await run(["--json"]);
    expect(code).toBe(0);
    const data = JSON.parse(stdoutBuf);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });
});

describe("cue stats --suggestions", () => {
  test("reports local top-suggestion acceptance as JSON", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-suggestions-"));
    writeProfileChoices(tmpDir, [
      { ts: "2026-08-20T10:00:00Z", cwd: "/repo", choice: "python", suggested: ["python", "core"] },
      { ts: "2026-08-20T11:00:00Z", cwd: "/repo", choice: "python", suggested: ["vite", "python"] },
      { ts: "2026-08-20T12:00:00Z", cwd: "/other", choice: "rust", suggested: ["rust"] },
    ]);
    setup(tmpDir);

    const code = await run(["--suggestions", "--all", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(stdoutBuf)).toMatchObject({
      choices: 3,
      compared: 3,
      topAccepted: 2,
      topOverridden: 1,
      topAcceptanceRate: 2 / 3,
    });
  });

  test("prints an actionable empty state without analytics data", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-suggestions-empty-"));
    setup(tmpDir);

    const code = await run(["--suggestions"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("No profile suggestion feedback yet");
  });
});

describe("cue stats run — with session data", () => {
  test("--json shows correct session counts per profile", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-json-"));
    writeAnalytics(tmpDir, [
      { ts: "2026-07-01T10:00:00Z", event: "start", profile: "core", cwd: "/tmp/proj" },
      { ts: "2026-07-01T11:00:00Z", event: "end", profile: "core", cwd: "/tmp/proj", duration_s: 3600 },
      { ts: "2026-07-02T10:00:00Z", event: "start", profile: "core", cwd: "/tmp/proj" },
      { ts: "2026-07-02T10:00:00Z", event: "start", profile: "backend", cwd: "/tmp/proj" },
    ]);
    setup(tmpDir);

    const code = await run(["--json"]);
    expect(code).toBe(0);

    const data = JSON.parse(stdoutBuf) as Array<{
      profile: string;
      sessions: number;
      avg_duration_s: number;
    }>;

    const coreEntry = data.find((s) => s.profile === "core");
    const backendEntry = data.find((s) => s.profile === "backend");

    expect(coreEntry?.sessions).toBe(2);
    expect(backendEntry?.sessions).toBe(1);
    // avg_duration_s: one end event with 3600s over 2 sessions = 1800
    expect(coreEntry?.avg_duration_s).toBe(1800);
  });

  test("--json result is sorted by session count descending", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-sort-"));
    writeAnalytics(tmpDir, [
      { ts: "2026-07-01T10:00:00Z", event: "start", profile: "solo", cwd: "/tmp/x" },
      { ts: "2026-07-01T11:00:00Z", event: "start", profile: "popular", cwd: "/tmp/x" },
      { ts: "2026-07-01T12:00:00Z", event: "start", profile: "popular", cwd: "/tmp/x" },
      { ts: "2026-07-01T13:00:00Z", event: "start", profile: "popular", cwd: "/tmp/x" },
    ]);
    setup(tmpDir);

    const code = await run(["--json"]);
    expect(code).toBe(0);

    const data = JSON.parse(stdoutBuf) as Array<{ profile: string; sessions: number }>;
    expect(data[0]!.profile).toBe("popular");
    expect(data[0]!.sessions).toBe(3);
    expect(data[1]!.profile).toBe("solo");
  });

  test("--profile filter restricts output to the requested profile", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-filter-"));
    writeAnalytics(tmpDir, [
      { ts: "2026-07-01T10:00:00Z", event: "start", profile: "core", cwd: "/tmp/x" },
      { ts: "2026-07-01T11:00:00Z", event: "start", profile: "backend", cwd: "/tmp/x" },
    ]);
    setup(tmpDir);

    const code = await run(["--json", "--profile", "core"]);
    expect(code).toBe(0);

    const data = JSON.parse(stdoutBuf) as Array<{ profile: string }>;
    expect(data).toHaveLength(1);
    expect(data[0]!.profile).toBe("core");
  });

  test("--since 1d excludes events older than one day", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cue-stats-since-"));
    const recentTs = new Date().toISOString(); // now — inside any 1-day window
    writeAnalytics(tmpDir, [
      // ancient event: should be excluded by --since 1d
      { ts: "2020-01-01T10:00:00Z", event: "start", profile: "old-profile", cwd: "/tmp/x" },
      // recent event: must be included
      { ts: recentTs, event: "start", profile: "fresh-profile", cwd: "/tmp/x" },
    ]);
    setup(tmpDir);

    const code = await run(["--json", "--since", "1d"]);
    expect(code).toBe(0);

    const data = JSON.parse(stdoutBuf) as Array<{ profile: string }>;
    expect(data.some((s) => s.profile === "fresh-profile")).toBe(true);
    expect(data.some((s) => s.profile === "old-profile")).toBe(false);
  });
});
