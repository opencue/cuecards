/**
 * NVIDIA SkillSpector integration.
 *
 * The parsing/argv layer is tested pure. The spawn layer is tested against a
 * fake scanner binary pointed at by $SKILLSPECTOR_BIN, which both fakes a
 * verdict and records the argv it was called with — that argv is the upstream
 * contract we depend on (`scan <path> --no-llm --format json`).
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isEnabled,
  buildRunner,
  parseSkillSpectorJson,
  formatVerdict,
  unavailableNote,
  runSkillSpector,
  resetRunnerCache,
  SKILLSPECTOR_PKG,
} from "./skillspector";

function report(assessment: Record<string, unknown>, issues: unknown[] = []) {
  return JSON.stringify({ risk_assessment: assessment, issues });
}

describe("isEnabled", () => {
  test("on by default outside tests", () => {
    expect(isEnabled({})).toBe(true);
  });

  test("off when explicitly disabled", () => {
    for (const v of ["0", "false", "off", "no", "OFF"]) {
      expect(isEnabled({ CUE_SKILLSPECTOR: v })).toBe(false);
    }
  });

  test("off under NODE_ENV=test so suites never shell out", () => {
    expect(isEnabled({ NODE_ENV: "test" })).toBe(false);
  });

  test("explicit opt-in beats the NODE_ENV=test guard", () => {
    expect(isEnabled({ NODE_ENV: "test", CUE_SKILLSPECTOR: "1" })).toBe(true);
  });

  test("explicit off beats explicit on-ish NODE_ENV", () => {
    expect(isEnabled({ NODE_ENV: "production", CUE_SKILLSPECTOR: "0" })).toBe(false);
  });
});

describe("buildRunner", () => {
  test("uvx runs the package straight from git, scanning the host path", () => {
    const r = buildRunner("uvx", "/skills/evil");
    expect(r.cmd).toBe("uvx");
    expect(r.args).toEqual(["--from", SKILLSPECTOR_PKG, "skillspector"]);
    expect(r.target).toBe("/skills/evil");
  });

  test("docker mounts read-only and rewrites the target to the container path", () => {
    const r = buildRunner("docker", "/skills/evil");
    expect(r.args).toContain("-v");
    expect(r.args).toContain("/skills/evil:/scan:ro");
    // The host path must NOT be handed to `scan` — it does not exist in the container.
    expect(r.target).toBe("/scan");
  });

  test("explicit binary wins verbatim", () => {
    const r = buildRunner("bin", "/skills/evil", "/opt/skillspector");
    expect(r.cmd).toBe("/opt/skillspector");
    expect(r.args).toEqual([]);
  });
});

describe("parseSkillSpectorJson", () => {
  test("reads the recommendation, score and severity", () => {
    const r = parseSkillSpectorJson(report({ score: 78, severity: "HIGH", recommendation: "DO_NOT_INSTALL" }));
    expect(r.status).toBe("ok");
    expect(r.recommendation).toBe("DO_NOT_INSTALL");
    expect(r.score).toBe(78);
    expect(r.severity).toBe("HIGH");
  });

  test("maps findings including file/line", () => {
    const r = parseSkillSpectorJson(
      report({ score: 40, severity: "MEDIUM", recommendation: "CAUTION" }, [
        { id: "PI1", category: "prompt-injection", severity: "high", location: { file: "SKILL.md", start_line: 12 } },
      ]),
    );
    expect(r.findings).toEqual([
      { id: "PI1", category: "prompt-injection", severity: "HIGH", file: "SKILL.md", line: 12 },
    ]);
  });

  test("falls back to the documented severity mapping when recommendation is absent", () => {
    expect(parseSkillSpectorJson(report({ severity: "LOW" })).recommendation).toBe("SAFE");
    expect(parseSkillSpectorJson(report({ severity: "MEDIUM" })).recommendation).toBe("CAUTION");
    expect(parseSkillSpectorJson(report({ severity: "CRITICAL" })).recommendation).toBe("DO_NOT_INSTALL");
  });

  test("tolerates progress noise printed before the JSON", () => {
    const r = parseSkillSpectorJson(`Scanning...\n${report({ severity: "LOW", recommendation: "SAFE" })}\n`);
    expect(r.status).toBe("ok");
    expect(r.recommendation).toBe("SAFE");
  });

  test("no verdict is an error, never a silent pass", () => {
    expect(parseSkillSpectorJson("").status).toBe("error");
    expect(parseSkillSpectorJson("not json at all").status).toBe("error");
    expect(parseSkillSpectorJson("{oops").status).toBe("error");
    // Valid JSON, but no risk_assessment — must not read as SAFE.
    const r = parseSkillSpectorJson('{"skill":{"name":"x"}}');
    expect(r.status).toBe("error");
    expect(r.recommendation).toBeUndefined();
  });
});

describe("formatVerdict / unavailableNote", () => {
  test("verdict line carries score and finding categories", () => {
    const r = parseSkillSpectorJson(
      report({ score: 78, severity: "HIGH", recommendation: "DO_NOT_INSTALL" }, [
        { id: "PI1", category: "prompt-injection", severity: "HIGH" },
        { id: "DE2", category: "data-exfiltration", severity: "HIGH" },
      ]),
    );
    const line = formatVerdict(r);
    expect(line).toContain("DO_NOT_INSTALL");
    expect(line).toContain("78/100");
    expect(line).toContain("prompt-injection");
    expect(line).toContain("data-exfiltration");
  });

  test("a scan that ran produces no warning note; a skipped one does", () => {
    expect(unavailableNote({ status: "ok", findings: [], recommendation: "SAFE" })).toBeNull();
    expect(unavailableNote({ status: "disabled", findings: [] })).toBeNull();
    expect(unavailableNote({ status: "unavailable", findings: [], error: "not found" })).toContain("not found");
    expect(unavailableNote({ status: "error", findings: [], error: "boom" })).toContain("boom");
  });
});

describe("runSkillSpector", () => {
  let dir: string;
  let bin: string;
  let argvLog: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cue-ss-"));
    bin = join(dir, "fake-skillspector");
    argvLog = join(dir, "argv.txt");
    resetRunnerCache();
  });
  afterEach(() => {
    resetRunnerCache();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeFakeScanner(stdout: string, exitCode = 0) {
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s\\n' "$*" > ${JSON.stringify(argvLog)}\ncat <<'JSON'\n${stdout}\nJSON\nexit ${exitCode}\n`,
    );
    chmodSync(bin, 0o755);
  }

  test("is a no-op when disabled", () => {
    writeFakeScanner(report({ severity: "LOW", recommendation: "SAFE" }));
    const r = runSkillSpector(dir, { env: { CUE_SKILLSPECTOR: "0", SKILLSPECTOR_BIN: bin } });
    expect(r.status).toBe("disabled");
  });

  test("invokes the upstream contract: scan <path> --no-llm --format json", () => {
    writeFakeScanner(report({ score: 0, severity: "LOW", recommendation: "SAFE" }));
    const r = runSkillSpector(dir, { env: { CUE_SKILLSPECTOR: "1", SKILLSPECTOR_BIN: bin } });
    expect(r.status).toBe("ok");
    expect(r.recommendation).toBe("SAFE");
    const argv = readFileSync(argvLog, "utf8").trim();
    expect(argv).toBe(`scan ${dir} --no-llm --format json`);
  });

  test("exit code 1 (DO_NOT_INSTALL) still yields a parsed verdict, not an error", () => {
    writeFakeScanner(report({ score: 90, severity: "CRITICAL", recommendation: "DO_NOT_INSTALL" }), 1);
    const r = runSkillSpector(dir, { env: { CUE_SKILLSPECTOR: "1", SKILLSPECTOR_BIN: bin } });
    expect(r.status).toBe("ok");
    expect(r.recommendation).toBe("DO_NOT_INSTALL");
  });

  test("a missing scanner is 'unavailable', never a pass", () => {
    const r = runSkillSpector(dir, {
      env: { CUE_SKILLSPECTOR: "1", SKILLSPECTOR_BIN: join(dir, "does-not-exist") },
    });
    expect(r.status).toBe("unavailable");
    expect(r.recommendation).toBeUndefined();
  });

  test("a scanner that emits garbage is an error, never a pass", () => {
    writeFakeScanner("totally not json", 0);
    const r = runSkillSpector(dir, { env: { CUE_SKILLSPECTOR: "1", SKILLSPECTOR_BIN: bin } });
    expect(r.status).toBe("error");
    expect(r.recommendation).toBeUndefined();
  });
});
