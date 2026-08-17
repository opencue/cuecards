import { describe, expect, test } from "bun:test";
import {
  buildCodexConfigToml,
  parseBaseCodexConfig,
} from "./codex-config";

const BASE = `# user config
approval_policy = "never"
model = "gpt-5.5"
model_context_window = 400000
model_reasoning_effort = "xhigh"
sandbox_mode = "danger-full-access"

[features]
goals = true
memories = true
js_repl = false

[mcp_servers.colony]
command = "colony"
args = [ "mcp" ]

[mcp_servers.colony.env]
COLONY_HOME = "/somewhere"

[projects."/home/u/x"]
trust_level = "trusted"
`;

describe("parseBaseCodexConfig", () => {
  test("keeps top-level scalars and [features], drops every other table", () => {
    const base = parseBaseCodexConfig(BASE);
    expect(base.top.model).toBe('"gpt-5.5"');
    expect(base.top.model_reasoning_effort).toBe('"xhigh"');
    expect(base.top.model_context_window).toBe("400000");
    expect(base.features).toEqual({ goals: "true", memories: "true", js_repl: "false" });
    // tables cue owns or that are machine-local never leak in
    expect(base.top.command).toBeUndefined();
    expect(base.top.trust_level).toBeUndefined();
    expect(base.top.COLONY_HOME).toBeUndefined();
  });

  test("pulls multi-line arrays and inline tables in whole", () => {
    const base = parseBaseCodexConfig(`
allowed = [
  "a",
  "b",
]
shell = { inherit = "all" }
model = "x"
[features]
`);
    expect(base.top.allowed).toBe('[\n  "a",\n  "b",\n]');
    expect(base.top.shell).toBe('{ inherit = "all" }');
    expect(base.top.model).toBe('"x"');
  });

  test("a bracket inside a string does not start a table", () => {
    const base = parseBaseCodexConfig(`notify = "say [done]"\nmodel = "x"\n`);
    expect(base.top.notify).toBe('"say [done]"');
    expect(base.top.model).toBe('"x"');
  });
});

describe("buildCodexConfigToml", () => {
  test("inherits the base autonomy knobs alongside cue's MCP servers", () => {
    const toml = buildCodexConfigToml({
      baseText: BASE,
      mcpServers: { codegraph: { command: "codegraph", args: ["serve"] } },
    });
    expect(toml).toContain('model_reasoning_effort = "xhigh"');
    expect(toml).toContain("model_context_window = 400000");
    expect(toml).toContain("[features]");
    expect(toml).toContain("goals = true");
    expect(toml).toContain("[mcp_servers.codegraph]");
    // cue owns MCP wiring — the base config's servers must not come along
    expect(toml).not.toContain("[mcp_servers.colony]");
  });

  test("top-level keys precede every table header", () => {
    const toml = buildCodexConfigToml({
      baseText: BASE,
      mcpServers: { codegraph: { command: "codegraph" } },
    });
    const firstTable = toml.indexOf("[");
    expect(toml.indexOf("model_reasoning_effort")).toBeLessThan(firstTable);
  });

  test("the profile block wins over the base, key by key", () => {
    const toml = buildCodexConfigToml({
      baseText: BASE,
      overrides: {
        sandbox_mode: "workspace-write",
        model_reasoning_effort: "high",
        features: { memories: false },
      },
      mcpServers: {},
    });
    expect(toml).toContain('sandbox_mode = "workspace-write"');
    expect(toml).not.toContain("danger-full-access");
    expect(toml).toContain('model_reasoning_effort = "high"');
    expect(toml).toContain("memories = false");
    // untouched base keys survive the override
    expect(toml).toContain('model = "gpt-5.5"');
    expect(toml).toContain("goals = true");
  });

  test("a profile key absent from the base is added", () => {
    const toml = buildCodexConfigToml({
      baseText: "model = \"x\"\n",
      overrides: { model_auto_compact_token_limit: 320000 },
      mcpServers: {},
    });
    expect(toml).toContain("model_auto_compact_token_limit = 320000");
  });

  test("without a base it renders exactly the pre-inheritance MCP-only shape", () => {
    const toml = buildCodexConfigToml({
      mcpServers: {
        "google-ads-mcp": {
          command: "pipx",
          args: ["run", "google-ads-mcp"],
          env: { GOOGLE_PROJECT_ID: "my-project" },
        },
      },
    });
    expect(toml).toBe(
      '[mcp_servers.google-ads-mcp]\n' +
      'command = "pipx"\n' +
      'args = ["run", "google-ads-mcp"]\n' +
      'env = { "GOOGLE_PROJECT_ID" = "my-project" }\n',
    );
  });
});
