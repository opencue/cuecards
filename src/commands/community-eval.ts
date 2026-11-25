import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, unlinkSync, writeFileSync } from "node:fs";
import { DEFAULT_API_URL, loadCredentials } from "../lib/cue-credentials";
import {
  COMMUNITY_BENCHMARK, COMMUNITY_MODELS, COMMUNITY_PAIR_COUNT, COMMUNITY_REPORT_BYTES, COMMUNITY_SCORE_MAX,
  isCommunityModel, parseCommunityReport, type CommunityModel, type CommunityReport, type CommunityReportV2,
} from "../lib/community-eval/result";

const endpoint = DEFAULT_API_URL + "/api/v1/benchmarks";
const usage = [
  "cue community-eval run --model <" + COMMUNITY_MODELS.join("|") + "> [--out report.json] [--yes]",
  "cue community-eval submit <report.json> [--yes]",
  "Without --yes, each command previews its action; no models are called and no data is sent.",
].join("\n") + "\n";

type Dependencies = {
  measure: (model: CommunityModel) => Promise<CommunityReport>;
  credentials: typeof loadCredentials;
  request: (url: string, init: RequestInit) => Promise<Response>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const defaults: Dependencies = {
  measure: async (model) => (await import("../lib/community-eval/runner")).runCommunityEval(model),
  credentials: loadCredentials,
  request: (url, init) => fetch(url, init),
  stdout: (text) => { process.stdout.write(text); },
  stderr: (text) => { process.stderr.write(text); },
};

function readReport(path: string): CommunityReport {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.size > COMMUNITY_REPORT_BYTES) throw new Error("Invalid report file");
    const data = Buffer.alloc(COMMUNITY_REPORT_BYTES + 1);
    const size = readSync(fd, data, 0, data.length, 0);
    if (size > COMMUNITY_REPORT_BYTES) throw new Error("Report file is too large");
    return parseCommunityReport(JSON.parse(data.toString("utf8", 0, size)));
  } finally {
    closeSync(fd);
  }
}

async function measure(args: string[], io: Dependencies): Promise<number> {
  let model: string | undefined;
  let out: string | undefined;
  let yes = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes" && !yes) yes = true;
    else if (arg === "--model" && model === undefined && args[i + 1] && !args[i + 1]?.startsWith("-")) model = args[++i];
    else if (arg === "--out" && out === undefined && args[i + 1] && !args[i + 1]?.startsWith("-")) out = args[++i];
    else { io.stderr(usage); return 2; }
  }
  if (!isCommunityModel(model)) { io.stderr(usage); return 2; }
  out ??= `cue-${COMMUNITY_BENCHMARK}.json`;
  io.stdout(`Plan: ${COMMUNITY_PAIR_COUNT * 2} Codex runs with ${model} (${COMMUNITY_BENCHMARK}) using your Codex login. Runs make model requests and may consume subscription quota. Synthetic code only; no Cuecards upload.\n`);
  if (!yes) { io.stdout("Re-run with --yes to start.\n"); return 0; }
  let fd: number;
  try {
    fd = openSync(out, "wx", 0o600);
  } catch {
    io.stderr("BENCHMARK_OUTPUT_UNAVAILABLE: choose a writable, unused --out path.\n");
    return 1;
  }

  let report: CommunityReportV2;
  let saved = false;
  try {
    try {
      const measured = parseCommunityReport(await io.measure(model));
      if (measured.version !== 2 || measured.model !== model) throw new Error("Benchmark or model mismatch");
      report = measured;
    } catch (error) {
      const code = error instanceof Error && /^BENCHMARK_[A-Z_]{1,40}$/.test(error.message)
        ? error.message : "BENCHMARK_RUN_FAILED";
      io.stderr(`${code}: no report saved. Check your Codex login, supported Codex and CodeGraph versions, and sandbox availability.\n`);
      return 1;
    }
    try {
      writeFileSync(fd, JSON.stringify(report, null, 2) + "\n");
      saved = true;
    } catch {
      io.stderr("BENCHMARK_SAVE_FAILED: check the output filesystem.\n");
      return 1;
    }
  } finally {
    try {
      if (!saved) {
        const reserved = fstatSync(fd);
        const current = lstatSync(out, { throwIfNoEntry: false });
        if (current?.ino === reserved.ino && current.dev === reserved.dev) unlinkSync(out);
      }
    } catch {
      // Best effort: never clear a different file or mask the run failure.
    } finally {
      closeSync(fd);
    }
  }
  io.stdout(`Saved local report: ${out}\nPreview optional contribution with cue community-eval submit <report.json>.\n`);
  const attempts = report.pairs.length;
  const failuresOff = report.pairs.filter((pair) => pair.off.status !== "completed").length;
  const failuresOn = report.pairs.filter((pair) => pair.on.status !== "completed").length;
  io.stdout(`Incomplete runs: without CodeGraph ${failuresOff}/${attempts}, with CodeGraph ${failuresOn}/${attempts}\n`);
  const complete = report.pairs.filter((pair) => pair.off.status === "completed" && pair.on.status === "completed");
  if (complete.length > 0) {
    const maxScore = COMMUNITY_SCORE_MAX * complete.length;
    const offScore = complete.reduce((total, pair) => total + pair.off.score, 0);
    const onScore = complete.reduce((total, pair) => total + pair.on.score, 0);
    io.stdout(`Correct answers in complete pairs: without CodeGraph ${offScore}/${maxScore}, with CodeGraph ${onScore}/${maxScore}\n`);
  } else {
    io.stdout("No complete A/B pairs; correctness was not compared.\n");
  }
  return 0;
}

async function submit(args: string[], io: Dependencies): Promise<number> {
  const [path, confirm] = args;
  if (!path || path.startsWith("-") || args.length > 2 || (confirm !== undefined && confirm !== "--yes")) {
    io.stderr(usage);
    return 2;
  }
  let report: CommunityReport;
  try { report = readReport(path); } catch {
    io.stderr("BENCHMARK_INVALID_REPORT: expected one bounded, complete benchmark report.\n");
    return 1;
  }
  io.stdout(`Destination: ${endpoint}\nThe server uses your Cuecards account to prevent duplicate submissions. No individual reports are public.\n${JSON.stringify(report, null, 2)}\n`);
  if (confirm !== "--yes") { io.stdout("Nothing sent. Re-run with --yes to submit.\n"); return 0; }
  let accepted: boolean;
  try {
    const credentials = io.credentials();
    // Never forward credentials saved for a self-hosted origin.
    if (!credentials || new URL(credentials.apiUrl).origin !== DEFAULT_API_URL) {
      io.stderr("BENCHMARK_LOGIN_REQUIRED: sign in to the official Cuecards service before sharing.\n");
      return 1;
    }
    const response = await io.request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials.token}` },
      body: JSON.stringify(report),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Collector rejected report");
    const result = await response.json() as { ok?: unknown; data?: { accepted?: unknown } } | null;
    if (result?.ok !== true || typeof result.data?.accepted !== "boolean") throw new Error("Invalid collector response");
    accepted = result.data.accepted;
  } catch {
    io.stderr("BENCHMARK_SUBMIT_FAILED: contribution was not confirmed; the local report remains.\n");
    return 1;
  }
  io.stdout(accepted ? "Contribution accepted.\n" : "Already contributed; only the first report counts.\n");
  return 0;
}

export async function run(args: string[], io: Dependencies = defaults): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "run") return measure(rest, io);
  if (sub === "submit") return submit(rest, io);
  if (!sub || sub === "--help" || sub === "-h") { io.stdout(usage); return 0; }
  io.stderr(usage);
  return 2;
}
