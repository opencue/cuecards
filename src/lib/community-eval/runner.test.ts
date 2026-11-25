import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { type CommunityCommand, runCommunityEval } from "./runner";

function jsonl(codegraphUsed: boolean, usage = true, correct = true): string {
  return [
    { type: "thread.started", thread_id: "not-in-report" },
    ...(codegraphUsed
      ? [{type: "item.completed", item: {type: "mcp_tool_call", server: "codegraph", tool: "codegraph_explore", status: "completed", error: null}}]
      : []),
    { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({
      entry: "src/pricing/quote.ts",
      rule: correct ? "seasonalCredit" : "not-in-report",
      boundary: "src/http/quote-input.ts",
    }) }},
    { type: "turn.completed", usage: usage ? { input_tokens: 500, cached_input_tokens: 100, output_tokens: 75 } : {} },
  ].map((event) => JSON.stringify(event)).join("\n");
}

const tools = { codex: "/test/bin/codex", codegraph: "/test/codegraph/bin/codegraph", codegraphRoot: "/test/codegraph" };

function fakeCommand(override?: (args: readonly string[]) => string | undefined) {
  const calls: {args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv}[] = [];
  const command: CommunityCommand = (bin, args, options) => {
    calls.push({ args, cwd: options.cwd, env: options.env });
    const stdout = override?.(args);
    if (stdout !== undefined) return { stdout, stderr: "", ok: true };
    if (args[0] === "--version") {
      return { stdout: bin === tools.codex ? "codex-cli 0.172.0\n" : "codegraph 1.6.2\n", stderr: "", ok: true };
    }
    if (args[0] === "login") return { stdout: "", stderr: "Logged in using ChatGPT", ok: true };
    if (args[0] === "sandbox") return { stdout: "", stderr: "", ok: true };
    expect(args[0]).toBe("exec");
    expect(readdirSync(options.cwd)).toEqual(["src"]);
    expect(existsSync(join(options.cwd, ".codegraph"))).toBe(false);
    expect(readFileSync(join(options.cwd, "src/pricing/quote.ts"), "utf8")).toContain("seasonalCredit");
    const on = args.some((arg) => arg.startsWith("mcp_servers={codegraph="));
    return { stdout: jsonl(on), stderr: "", ok: true };
  };
  return { command, calls };
}

describe("community CodeGraph runner", () => {
  test("holds model, questions, working tree and shell settings constant; alternates arm order; returns metrics only", async () => {
    const { command, calls } = fakeCommand();
    const report = await runCommunityEval("gpt-5.4", {
      platform: "linux", tools, authHome: "/private/codex", now: () => 20,
      command: (bin, args, options) => {
        if (args[0] === "login" || args[0] === "exec") {
          expect(readdirSync(options.env.CODEX_HOME!)).toEqual(["auth.json"]);
          expect(readlinkSync(join(options.env.CODEX_HOME!, "auth.json"))).toBe("/private/codex/auth.json");
        }
        return command(bin, args, options);
      },
    });
    expect(report).toEqual({
      version: 1, benchmark: "codegraph-v1", model: "gpt-5.4", codexVersion: "0.172.0", codegraphVersion: "1.6.2",
      pairs: Array.from({length: 2}, () => ({
        off: { score: 3, durationMs: 1, inputTokens: 500, cachedInputTokens: 100, outputTokens: 75, codegraphUsed: false },
        on: { score: 3, durationMs: 1, inputTokens: 500, cachedInputTokens: 100, outputTokens: 75, codegraphUsed: true },
      })),
    });
    const execs = calls.filter(({args}) => args[0] === "exec");
    expect(execs.map(({args}) => args.some((arg) => arg.startsWith("mcp_servers={codegraph=")))).toEqual([false, true, true, false]);
    expect(new Set(execs.map(({cwd}) => cwd)).size).toBe(1);
    expect(execs[0].args.filter((arg) => !arg.startsWith("mcp_servers="))).toEqual(
      execs[1].args.filter((arg) => !arg.startsWith("mcp_servers=")),
    );
    expect(execs[0].args).toContain("gpt-5.4");
    expect(execs[0].args).toContain("--ignore-user-config");
    expect(execs[0].args).toContain("--ignore-rules");
    expect(execs[0].args).toContain("--ephemeral");
    expect(execs[0].args).toContain("features.hooks=false");
    expect(execs[0].args).toContain("permissions.cue-benchmark.network.enabled=false");
    expect(execs[1].args.join(" ")).toContain('enabled_tools=["codegraph_explore"]');
    expect(execs[1].args.join(" ")).toContain("required=true");
    expect(execs[1].args.join(" ")).toContain("CODEGRAPH_TELEMETRY");
    const mcpRules = execs[1].args.join(" ").replaceAll('\\"', '"');
    expect(mcpRules).toContain('/.codegraph"="write"');
    expect(mcpRules).toContain('/index"="read"');
    expect(execs[1].args.join(" ")).not.toContain("/private/codex");
    expect(execs[0].env.CODEX_HOME).not.toBe("/private/codex");
    expect(execs[0].env.OPENAI_API_KEY).toBeUndefined();
    expect(execs[0].env.GITHUB_TOKEN).toBeUndefined();
    expect(existsSync(execs[0].cwd)).toBe(false);
  });

  test("distinguishes a wrong answer from missing token accounting", async () => {
    const { command } = fakeCommand((args) => args[0] === "exec" ? jsonl(false, false, false) : undefined);
    const { pairs } = await runCommunityEval("gpt-5.4", { platform: "linux", tools, command });
    expect(pairs[0].on).toMatchObject({score: 2, inputTokens: null, cachedInputTokens: null, outputTokens: null, codegraphUsed: false});
  });

  test("stops after first protocol error and does not leak its text", async () => {
    const { command, calls } = fakeCommand((args) => args[0] === "exec" ? '{"type":"turn.failed","error":{"message":"private-path"}}' : undefined);
    await expect(runCommunityEval("gpt-5.4", { platform: "linux", tools, command }))
      .rejects.toThrow("BENCHMARK_CODEX_FAILED");
    expect(calls.filter(({args}) => args[0] === "exec")).toHaveLength(1);
    expect(existsSync(calls.at(-1)!.cwd)).toBe(false);
  });

  test("does not make model requests with an unsupported sandbox or release", async () => {
    const { command, calls } = fakeCommand((args) => args[0] === "--version" ? "codex-cli 0.171.0" : undefined);
    await expect(runCommunityEval("gpt-5.4", { platform: "darwin", tools, command }))
      .rejects.toThrow("BENCHMARK_UNSUPPORTED_PLATFORM");
    await expect(runCommunityEval("gpt-5.4", { platform: "linux", tools, command }))
      .rejects.toThrow("BENCHMARK_UNSUPPORTED_CODEX");
    expect(calls.some(({args}) => args[0] === "exec")).toBe(false);
  });

  test("does not start Codex with a system configuration that can change the benchmark", async () => {
    const { command, calls } = fakeCommand();
    await expect(runCommunityEval("gpt-5.4", { platform: "linux", tools, command, hasSystemConfig: () => true }))
      .rejects.toThrow("BENCHMARK_SYSTEM_CONFIG_UNSUPPORTED");
    expect(calls).toEqual([]);
  });
});
