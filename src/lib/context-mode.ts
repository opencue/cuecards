/** Explicit per-user context-mode installation; never changes portable profile defaults. */
import Ajv from "ajv";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { configDir } from "./config-paths";
import { reconcileCodexHooks } from "./codex-hooks";
import type { MaterializeInput } from "./runtime-materializer";

interface Installation {
  enabled: true;
  command: string;
  args: string[];
  codexHooks: string;
  claudeHooks: string;
}
const validate = new Ajv().compile<Installation>({
  type: "object", additionalProperties: false,
  required: ["enabled", "command", "args", "codexHooks", "claudeHooks"],
  properties: {
    enabled: { const: true },
    command: { type: "string", minLength: 1 },
    args: { type: "array", items: { type: "string" } },
    codexHooks: { type: "string", minLength: 1 },
    claudeHooks: { type: "string", minLength: 1 },
  },
});

const ROUTING = `<!-- cue:context-mode:start -->
## Context-mode: automatic use
When context-mode tools are available, use ctx_batch_execute for noisy tests/logs,
ctx_execute_file for large-file analysis, and ctx_index/ctx_search for reusable evidence.
Print only relevant results. Keep CodeGraph for repository symbols, the browser tool
for live UI checks, and native file edits/approval gates for changes. Never route
around permissions or safety hooks. For small reads and commands, use the simpler
native tool. Do not claim savings without a measured comparison.
<!-- cue:context-mode:end -->`;

export async function withContextMode(
  input: MaterializeInput,
  path = join(configDir(), "context-mode.json"),
): Promise<MaterializeInput> {
  if (input.agent !== "codex" && input.agent !== "claude-code") return input;
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return input;
    throw error;
  }
  const config: unknown = JSON.parse(text);
  if (config && typeof config === "object" && "enabled" in config && config.enabled === false) return input;
  if (!validate(config) || ![config.command, config.codexHooks, config.claudeHooks].every(isAbsolute)) {
    throw new TypeError(`Invalid context-mode installation: ${path}`);
  }
  const profile = { ...input.profile };
  profile.mcps = [...profile.mcps.filter((m) => m.id.toLowerCase() !== "context-mode"), { id: "context-mode", pin: true }];
  if (input.agent === "codex") {
    const current = { ...(profile.codexConfig ?? {}), ...(profile.codex ?? {}) };
    const desired = JSON.parse(await readFile(config.codexHooks, "utf8"));
    const { document } = reconcileCodexHooks(JSON.stringify({ hooks: current.hooks ?? {} }), undefined, desired.hooks);
    profile.codexConfig = {
      ...current,
      features: { ...(profile.codexConfig?.features as object ?? {}), ...(profile.codex?.features ?? {}), hooks: true },
      hooks: document.hooks,
    };
    // Resolved profiles may carry both legacy and current representations.
    profile.codex = { ...profile.codex, hooks: document.hooks, features: { ...(profile.codex?.features ?? {}), hooks: true } };
  } else {
    await readFile(config.claudeHooks, "utf8"); // Fail clearly if setup is incomplete.
    profile.hooks = [...new Set([...(profile.hooks ?? []), config.claudeHooks])];
  }
  return {
    ...input, profile,
    mcpRegistry: { ...input.mcpRegistry, "context-mode": {
      command: config.command, args: config.args,
      env: { CONTEXT_MODE_PLATFORM: input.agent },
    } },
    disabledMcpIds: input.disabledMcpIds?.filter((id) => id.toLowerCase() !== "context-mode"),
    userClaudeMd: input.userClaudeMd.includes("<!-- cue:context-mode:start -->")
      ? input.userClaudeMd : input.userClaudeMd + "\n\n" + ROUTING,
  };
}
