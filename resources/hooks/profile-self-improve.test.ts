import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end test of the profile-self-improve Stop hook. The critic is stubbed
// via CUE_SELF_IMPROVE_CMD, so no real `claude` is spawned — we exercise the
// gate / substance / L1-capture / critic-once / recursion-guard paths.

const SCRIPT = join(import.meta.dir, "profile-self-improve.sh");

let home: string;
let work: string;

// A transcript with >= 3 tool_use entries (passes substance gate), a user
// prompt, a failed tool, and a retry phrase (two L1 friction signals).
function transcript(): string {
  return [
    JSON.stringify({ type: "user", message: { content: "build the deploy pipeline" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true }] } }),
    JSON.stringify({ type: "assistant", message: { content: "let me try again with a different approach" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
  ].join("\n");
}

async function writeTranscript(): Promise<string> {
  const p = join(work, "transcript.jsonl");
  await writeFile(p, transcript());
  return p;
}

function runHook(opts: {
  transcriptPath?: string;
  sessionId?: string;
  env?: Record<string, string>;
} = {}) {
  const payload = JSON.stringify({
    transcript_path: opts.transcriptPath ?? "",
    session_id: opts.sessionId ?? "sess-1",
    cwd: work,
  });
  const r = spawnSync("bash", [SCRIPT], {
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      ...(opts.env ?? {}),
    },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

async function enable(opts: { consent?: boolean; feature?: boolean } = {}) {
  const cfg = join(home, ".config", "cue");
  await mkdir(cfg, { recursive: true });
  if (opts.feature ?? true) await writeFile(join(cfg, ".auto-improve-enabled"), "");
  if (opts.consent ?? true) await writeFile(join(cfg, ".telemetry-consent"), "");
}

async function readEvents(): Promise<any[]> {
  const p = join(home, ".config", "cue", "analytics.jsonl");
  if (!existsSync(p)) return [];
  const raw = await readFile(p, "utf8");
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cue-si-home-"));
  work = await mkdtemp(join(tmpdir(), "cue-si-work-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

describe("profile-self-improve Stop hook", () => {
  test("no-op when the feature flag is absent", async () => {
    await enable({ feature: false, consent: true });
    const tp = await writeTranscript();
    const r = runHook({ transcriptPath: tp, env: { CUE_SELF_IMPROVE_NO_CRITIC: "1" } });
    expect(r.code).toBe(0);
    expect(await readEvents()).toHaveLength(0);
  });

  test("no-op when telemetry consent is absent", async () => {
    await enable({ feature: true, consent: false });
    const tp = await writeTranscript();
    const r = runHook({ transcriptPath: tp, env: { CUE_SELF_IMPROVE_NO_CRITIC: "1" } });
    expect(r.code).toBe(0);
    expect(await readEvents()).toHaveLength(0);
  });

  test("recursion guard: inner critic session is a no-op", async () => {
    await enable();
    const tp = await writeTranscript();
    const r = runHook({ transcriptPath: tp, env: { CUE_AUTO_IMPROVE_INNER: "1" } });
    expect(r.code).toBe(0);
    expect(await readEvents()).toHaveLength(0);
  });

  test("substance gate: skips trivial turns (< 3 tool_use)", async () => {
    await enable();
    const p = join(work, "thin.jsonl");
    await writeFile(p, JSON.stringify({ type: "user", message: { content: "hi" } }));
    const r = runHook({ transcriptPath: p, env: { CUE_SELF_IMPROVE_NO_CRITIC: "1" } });
    expect(r.code).toBe(0);
    expect(await readEvents()).toHaveLength(0);
  });

  test("L1: captures a skill_gap(hook) event with friction signals", async () => {
    await enable();
    const tp = await writeTranscript();
    const r = runHook({ transcriptPath: tp, env: { CUE_SELF_IMPROVE_NO_CRITIC: "1" } });
    expect(r.code).toBe(0);
    const events = await readEvents();
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.event).toBe("skill_gap");
    expect(e.source).toBe("hook");
    expect(e.signals).toContain("tool-error");
    expect(e.signals).toContain("retry-loop");
    // never blocks: no decision JSON on stdout
    expect(r.stdout).not.toContain("block");
  });

  test("L0: critic verdict appends a skill_gap(critic) event, once per session", async () => {
    await enable();
    const tp = await writeTranscript();
    const stub =
      'cat >/dev/null; printf \'%s\' \'{"skill":"meta/setup-deploy","gap_type":"missing-skill","suggestion":"add a deploy-pipeline skill","confidence":8}\'';
    const r1 = runHook({ transcriptPath: tp, sessionId: "sess-X", env: { CUE_SELF_IMPROVE_CMD: stub } });
    expect(r1.code).toBe(0);
    let events = await readEvents();
    const critic = events.filter((e) => e.source === "critic");
    expect(critic).toHaveLength(1);
    expect(critic[0].skill).toBe("meta/setup-deploy");
    expect(critic[0].gap_type).toBe("missing-skill");
    expect(critic[0].confidence).toBe(8);

    // Second Stop in the same session must NOT run the critic again.
    const before = (await readEvents()).filter((e) => e.source === "critic").length;
    runHook({ transcriptPath: tp, sessionId: "sess-X", env: { CUE_SELF_IMPROVE_CMD: stub } });
    const after = (await readEvents()).filter((e) => e.source === "critic").length;
    expect(after).toBe(before);
  });

  test("first_prompt: a tool_result-array first turn does not leak the raw line", async () => {
    await enable();
    // First "user" turn is a tool_result ARRAY (common on resumed sessions),
    // carrying a secretive payload. first_prompt must NOT capture it.
    const leak = "SECRET_TOOL_OUTPUT_should_not_be_logged";
    const lines = [
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: leak }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true }] } }),
      JSON.stringify({ type: "assistant", message: { content: "let me try again" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
    ];
    const p = join(work, "array-first.jsonl");
    await writeFile(p, lines.join("\n"));
    runHook({ transcriptPath: p, env: { CUE_SELF_IMPROVE_NO_CRITIC: "1" } });
    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0].first_prompt ?? "").not.toContain(leak);
    expect((events[0].first_prompt ?? "").length).toBeLessThanOrEqual(160);
  });

  test("L0: a 'no gap' critic verdict records nothing", async () => {
    await enable();
    const tp = await writeTranscript();
    const stub =
      'cat >/dev/null; printf \'%s\' \'{"skill":"NONE","gap_type":"none","suggestion":"","confidence":1}\'';
    runHook({ transcriptPath: tp, sessionId: "sess-clean", env: { CUE_SELF_IMPROVE_CMD: stub } });
    const critic = (await readEvents()).filter((e) => e.source === "critic");
    expect(critic).toHaveLength(0);
  });
});
