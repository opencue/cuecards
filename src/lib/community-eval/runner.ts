import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { findRealAgentBin } from "../claude-binary";
import { canonicalCodexHome } from "../codex-config";
import {
  COMMUNITY_BENCHMARK,
  type CommunityArm,
  type CommunityModel,
  type CommunityReport,
  isCommunityModel,
  parseCommunityReport,
} from "./result";

const CODEX_VERSION = "0.172.0"; // Named profile behavior is qualified for this CLI release.
const PROFILE = "cue-benchmark";
const TIMEOUT_MS = 120_000;
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
const TOOL = "codegraph_explore";
const SYSTEM_CONFIGS = ["config.toml", "requirements.toml", "managed_config.toml"];
const FIXTURE = {
  "src/http/quotes.ts": `import { normalizeQuoteInput } from "./quote-input";
import { createQuote } from "../pricing/quote";
export function handleQuote(body: unknown) {
  return createQuote(normalizeQuoteInput(body));
}`,
  "src/http/quote-input.ts": `export function normalizeQuoteInput(body: unknown) {
  if (!body || typeof body !== "object" || !("subtotal" in body) || !("month" in body))
    throw new Error("Invalid quote");
  const { subtotal, month } = body;
  if (typeof subtotal !== "number" || typeof month !== "number") throw new Error("Invalid quote");
  return { subtotal, month };
}`,
  "src/pricing/quote.ts": `import { seasonalCredit } from "./campaign";
import { standardFee } from "./fees";
export function createQuote({ subtotal, month }: { subtotal: number; month: number }) {
  return { total: subtotal + standardFee(subtotal) - seasonalCredit(subtotal, month) };
}`,
  "src/pricing/campaign.ts": `export function seasonalCredit(subtotal: number, month: number) {
  return month === 7 ? subtotal * 0.1 : 0;
}`,
  "src/pricing/fees.ts": `export function standardFee(subtotal: number) {
  return subtotal < 30 ? 4 : 0;
}`,
};

const QUESTIONS = [
  "entry: Which repository-relative file defines createQuote, the pricing function used by handleQuote?",
  "rule: What is the exact function name that calculates the seasonal credit used by createQuote?",
  "boundary: Which repository-relative file defines the function that validates the unknown request body before pricing?",
];
const ANSWERS = {
  entry: "src/pricing/quote.ts",
  rule: "seasonalCredit",
  boundary: "src/http/quote-input.ts",
};
const ANSWER_KEYS = Object.keys(ANSWERS) as (keyof typeof ANSWERS)[];
const PROMPT = [
  "Answer these questions about this small TypeScript repository. Inspect the repository with the available tools.",
  ...QUESTIONS,
  "Return just the JSON object with the three requested strings. Use bare repository-relative paths.",
].join("\n");

type Tools = { codex: string; codegraph: string; codegraphRoot: string };
type CommandOptions = { cwd: string; env: NodeJS.ProcessEnv; stdin?: string };
export type CommunityCommand = (
  bin: string,
  args: readonly string[],
  options: CommandOptions,
) => { ok: boolean; stdout: string; stderr: string };

const runCommand: CommunityCommand = (bin, args, { cwd, env, stdin }) => {
  const result = spawnSync(bin, args, {
    cwd, env, input: stdin, encoding: "utf8", timeout: TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024, killSignal: "SIGKILL",
    stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function fail(code: string): never {
  throw new Error(`BENCHMARK_${code}`);
}

function locateTools(): Tools {
  const codexPath = findRealAgentBin("codex");
  if (!codexPath) return fail("CODEX_NOT_INSTALLED");
  const codegraphPath = findRealAgentBin("codegraph");
  if (!codegraphPath) return fail("CODEGRAPH_NOT_INSTALLED");
  const architecture = process.arch;
  if (architecture !== "x64" && architecture !== "arm64") return fail("UNSUPPORTED_PLATFORM");

  // The npm wrappers resolve to native bundles. Grant the sandbox only the
  // binary/runtime bundle, not Node, its global packages, or the user's home.
  let codex = realpathSync(codexPath);
  try {
    const pkg = createRequire(codex).resolve(`@openai/codex-linux-${architecture}/package.json`);
    const triple = architecture === "x64" ? "x86_64" : "aarch64";
    codex = realpathSync(join(dirname(pkg), "vendor", `${triple}-unknown-linux-musl`, "bin", "codex"));
  } catch {
    // Standalone Codex installation; sandbox preflight verifies this executable.
  }

  let codegraph = realpathSync(codegraphPath);
  try {
    codegraph = realpathSync(createRequire(codegraph).resolve(`@colbymchenry/codegraph-linux-${architecture}/bin/codegraph`));
  } catch {
    // The standalone installer symlinks bin/codegraph from the same bundle layout.
  }
  const codegraphRoot = dirname(dirname(codegraph));
  if (!existsSync(join(codegraphRoot, "node")) || !existsSync(join(codegraphRoot, "lib", "dist", "bin", "codegraph.js"))) {
    return fail("CODEGRAPH_BUNDLE_REQUIRED");
  }
  return { codex, codegraph, codegraphRoot };
}

function writeFixture(where: string) {
  for (const [file, content] of Object.entries(FIXTURE)) {
    const path = join(where, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${content}\n`);
  }
}

function permissions(roots: Record<string, "read" | "write">): string[] {
  const rootEntries = Object.entries({ ":minimal": "read", ...roots }).map(
    ([path, mode]) => `${JSON.stringify(path)}=${JSON.stringify(mode)}`,
  );
  return [
    "-c", `permissions.${PROFILE}.filesystem={${rootEntries.join(",")}}`,
    "-c", `permissions.${PROFILE}.network.enabled=false`,
  ];
}

function sandboxArgs(cwd: string, rules: string[], command: string[]): string[] {
  return ["sandbox", "-C", cwd, "-P", PROFILE, ...rules, "--", ...command];
}

function readTokens(usage: Record<string, unknown> | undefined) {
  const tokens = (key: string) => {
    const value = usage?.[key];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : null;
  };
  const inputTokens = tokens("input_tokens");
  const cachedInputTokens = tokens("cached_input_tokens");
  const outputTokens = tokens("output_tokens");
  return inputTokens !== null && cachedInputTokens !== null && outputTokens !== null && cachedInputTokens <= inputTokens
    ? { inputTokens, cachedInputTokens, outputTokens }
    : { inputTokens: null, cachedInputTokens: null, outputTokens: null };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readArm(stdout: string, durationMs: number, on: boolean): CommunityArm {
  let lastMessage: string | undefined;
  let completed = false;
  let codegraphUsed = false;
  let usage: Record<string, unknown> | undefined;
  try {
    for (const line of stdout.trim().split("\n")) {
      const event = record(JSON.parse(line));
      if (!event || event.type === "turn.failed") return fail("CODEX_FAILED");
      if (event.type === "turn.completed") {
        if (completed) return fail("CODEX_FAILED");
        completed = true;
        usage = record(event.usage);
      }
      if (event.type !== "item.completed") continue;
      const item = record(event.item);
      if (item?.type === "agent_message" && typeof item.text === "string") lastMessage = item.text;
      if (item?.type === "mcp_tool_call") {
        if (!on || item.server !== "codegraph" || item.tool !== TOOL) return fail("CODEX_FAILED");
        if (item.status === "completed" && !item.error) codegraphUsed = true;
      }
    }
    if (!completed || !lastMessage) return fail("CODEX_FAILED");
    const response = record(JSON.parse(lastMessage));
    if (!response || ANSWER_KEYS.some((key) => typeof response[key] !== "string")) return fail("CODEX_FAILED");
    const score = ANSWER_KEYS.filter((key) => String(response[key]).trim() === ANSWERS[key]).length;
    return { score, durationMs, ...readTokens(usage), codegraphUsed };
  } catch {
    // Raw provider JSONL and filesystem paths never leave this function.
    return fail("CODEX_FAILED");
  }
}

type RunnerOptions = {
  command?: CommunityCommand;
  tools?: Tools;
  platform?: NodeJS.Platform;
  authHome?: string;
  now?: () => number;
  hasSystemConfig?: () => boolean;
};

export async function runCommunityEval(model: CommunityModel, options: RunnerOptions = {}): Promise<CommunityReport> {
  if (!isCommunityModel(model)) return fail("UNSUPPORTED_MODEL");
  if ((options.platform ?? process.platform) !== "linux") return fail("UNSUPPORTED_PLATFORM");
  // Codex merges system TOML even with --ignore-user-config. In particular
  // mcp_servers={} does not disable servers from a lower-precedence layer.
  const hasSystemConfig = options.hasSystemConfig ?? (() => SYSTEM_CONFIGS.some((file) => existsSync(join("/etc/codex", file))));
  if (hasSystemConfig()) return fail("SYSTEM_CONFIG_UNSUPPORTED");
  const tools = options.tools ?? locateTools();
  const { command = runCommand, now = () => performance.now() } = options;
  const { codex, codegraph, codegraphRoot } = tools;
  // Avoid inheriting a local project from a TMPDIR nested inside its checkout.
  const scratch = realpathSync(mkdtempSync("/tmp/cue-benchmark-"));
  try {
    const fixture = join(scratch, "fixture");
    const index = join(scratch, "index");
    const sandboxHome = join(scratch, "home");
    const clientHome = join(scratch, "client");
    const schema = join(scratch, "answer-schema.json");
    const authHome = resolve(options.authHome ?? canonicalCodexHome());
    mkdirSync(sandboxHome);
    mkdirSync(clientHome);
    writeFixture(fixture);
    // An identical indexed copy avoids exposing .codegraph to the off arm.
    writeFixture(index);
    writeFileSync(schema, JSON.stringify({
      type: "object", properties: Object.fromEntries(ANSWER_KEYS.map((key) => [key, { type: "string" }])),
      required: ANSWER_KEYS, additionalProperties: false,
    }));

    const sandboxEnv = {
      PATH: SYSTEM_PATH, HOME: sandboxHome, CODEX_HOME: sandboxHome, LANG: "C.UTF-8",
      CODEGRAPH_TELEMETRY: "0", CODEGRAPH_NO_DOWNLOAD: "1",
    };
    const isolated = { cwd: fixture, env: sandboxEnv };
    const client = { cwd: fixture, env: { PATH: SYSTEM_PATH, HOME: sandboxHome, CODEX_HOME: clientHome, LANG: "C.UTF-8" } };
    const codexVersion = command(codex, ["--version"], isolated);
    if (!codexVersion.ok || codexVersion.stdout.trim() !== `codex-cli ${CODEX_VERSION}`) return fail("UNSUPPORTED_CODEX");
    const graphVersion = command(codegraph, ["--version"], isolated);
    const codegraphVersion = /^(?:codegraph )?(\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(graphVersion.stdout.trim())?.[1];
    if (!graphVersion.ok || !codegraphVersion) return fail("UNSUPPORTED_CODEGRAPH");

    const shellRules = permissions({ [codex]: "read", [fixture]: "read" });
    const probe = [
      "/bin/sh", "-c", 'test -r src/http/quotes.ts && ! test -r "$1" && ! test -r "$2" && ! test -r "$3"',
      "cue-probe", join(index, "src/http/quotes.ts"), authHome, process.cwd(),
    ];
    if (!command(codex, sandboxArgs(fixture, shellRules, probe), isolated).ok) return fail("SANDBOX_UNAVAILABLE");

    const initRules = permissions({ [codex]: "read", [codegraphRoot]: "read", [index]: "write" });
    const init = [codegraph, "init", "--yes", index];
    if (!command(codex, sandboxArgs(index, initRules, init), isolated).ok) return fail("INDEX_FAILED");

    // Use native file-backed auth without inheriting user config, skills or
    // caches. Codex 0.172.0 resolves this symlink itself, including on refresh.
    symlinkSync(join(authHome, "auth.json"), join(clientHome, "auth.json"));
    const auth = ["-c", 'cli_auth_credentials_store="file"'];
    const status = command(codex, ["login", "status", ...auth], client);
    if (!status.ok || !/^Logged in using ChatGPT\s*$/m.test(status.stderr)) return fail("CHATGPT_LOGIN_REQUIRED");

    // CodeGraph takes a writer lock even for exploration. Allow its disposable
    // index state to change, not the source fixture or the rest of the host.
    const serveRules = permissions({
      [codex]: "read", [codegraphRoot]: "read", [index]: "read", [join(index, ".codegraph")]: "write",
    });
    const serve = sandboxArgs(index, serveRules, [codegraph, "serve", "--mcp", "--path", index, "--no-watch"]);
    const mcp = [
      `command=${JSON.stringify(codex)}`, `args=${JSON.stringify(serve)}`, `cwd=${JSON.stringify(index)}`,
      `env={${Object.entries(sandboxEnv).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(",")}}`,
      `enabled_tools=["${TOOL}"]`, "required=true",
    ].join(",");
    const commonArgs = [
      "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
      "--json", "--model", model, "--output-schema", schema, "-C", fixture, ...auth,
      "-c", 'model_provider="openai"', "-c", 'model_reasoning_effort="low"',
      "-c", `default_permissions="${PROFILE}"`, ...shellRules,
      "-c", 'approval_policy="never"', "-c", "allow_login_shell=false", "-c", 'shell_environment_policy.inherit="none"',
      "-c", "project_doc_max_bytes=0", "-c", "features.hooks=false", "-c", "features.plugins=false",
      "-c", "features.apps=false", "-c", "features.multi_agent_v2=false", "-c", 'web_search="disabled"',
      "-c", "features.memories=false", "-c", "features.shell_snapshot=false", "-c", "features.shell_snapshot_v2=false",
      "-c", "analytics.enabled=false", "-c", `log_dir=${JSON.stringify(sandboxHome)}`,
    ];
    const runArm = (on: boolean) => {
      const start = now();
      const output = command(codex, [
        ...commonArgs, "-c", on ? `mcp_servers={codegraph={${mcp}}}` : "mcp_servers={}", "--", PROMPT,
      ], client);
      if (!output.ok) return fail("CODEX_FAILED");
      return readArm(output.stdout, Math.max(1, Math.round(now() - start)), on);
    };

    const offFirst = runArm(false);
    const onSecond = runArm(true);
    const onFirst = runArm(true);
    const offSecond = runArm(false);
    return parseCommunityReport({
      version: 1, benchmark: COMMUNITY_BENCHMARK, model, codexVersion: CODEX_VERSION, codegraphVersion,
      pairs: [{ off: offFirst, on: onSecond }, { off: offSecond, on: onFirst }],
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
