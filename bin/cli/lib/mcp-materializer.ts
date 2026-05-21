/**
 * MCP materializer (Agent A9).
 *
 * Given a `ResolvedProfile`, emit the per-agent MCP config blocks that the
 * profile would drop into `~/.claude.json` and `~/.codex/config.toml`-style
 * files. A14 writes the result to disk; this module is read-only by contract.
 *
 * Inputs
 *   - The sanitized master registry at `mcps/configs/{claude,codex}.sanitized.json`.
 *     Each file has the shape `{ server_key: string, servers: Record<id, value>, ... }`.
 *     The `server_key` is the idiomatic top-level key for that agent
 *     (e.g. `mcpServers` for Claude, `mcp_servers` for Codex).
 *   - `profile.mcps`  — the list of server ids to include.
 *   - `profile.env`   — declared environment overrides for placeholder substitution.
 *
 * Output
 *   `{ claude: { <server_key>: {<id>: {...}} },
 *      codex:  { <server_key>: {<id>: {...}} } }`
 *
 * Substitution rules
 *   Any string value within a server config that contains `${VAR_NAME}` is
 *   substituted. Lookup order is:
 *     1. `profile.env[VAR_NAME]`
 *     2. `process.env[VAR_NAME]`
 *   If neither defines the var, throw `UnresolvedEnvPlaceholder`. We never
 *   silently leave a `${...}` literal in the emitted config.
 *
 * Error semantics
 *   - `McpNotFound`               — profile references an id missing from *both* registries.
 *   - `UnresolvedEnvPlaceholder`  — a `${VAR}` placeholder couldn't be resolved.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ProfileError, type ResolvedProfile } from "../../../profiles/_types";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class McpNotFound extends ProfileError {
  constructor(
    public id: string,
    public known: string[],
  ) {
    super(
      "MCP_NOT_FOUND",
      `MCP server "${id}" not found in sanitized registry. ` +
        `Known: ${known.length > 0 ? known.join(", ") : "<empty>"}`,
    );
  }
}

export class UnresolvedEnvPlaceholder extends ProfileError {
  constructor(
    public varName: string,
    public serverId: string,
    public source: "claude" | "codex",
  ) {
    super(
      "UNRESOLVED_ENV_PLACEHOLDER",
      `Unresolved env placeholder "\${${varName}}" in ${source} server ` +
        `"${serverId}". Declare it in profile.env or export it in the shell.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Constants & options
// ---------------------------------------------------------------------------

/** Resolve repo root by walking up from this file: bin/cli/lib -> repo root. */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const DEFAULT_CONFIGS_ROOT = join(REPO_ROOT, "mcps", "configs");

export interface MaterializeOptions {
  /**
   * Root directory holding `claude.sanitized.json` and `codex.sanitized.json`.
   * Defaults to env var `SOUL_MCPS_ROOT`, then to `<repo>/mcps/configs`.
   */
  configsRoot?: string;
  /**
   * Override the `process.env` lookup table (for tests). When omitted the real
   * `process.env` is consulted.
   */
  processEnv?: Record<string, string | undefined>;
}

export interface MaterializedMcp {
  claude: Record<string, unknown>;
  codex: Record<string, unknown>;
}

/** Shape of each sanitized config file on disk. */
interface SanitizedConfig {
  server_key: string;
  servers: Record<string, unknown>;
  source?: string;
  source_path?: string;
}

// ---------------------------------------------------------------------------
// Sanitized config loader
// ---------------------------------------------------------------------------

function resolveConfigsRoot(opts?: MaterializeOptions): string {
  if (opts?.configsRoot) return opts.configsRoot;
  const fromEnv = (opts?.processEnv ?? process.env).SOUL_MCPS_ROOT;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEFAULT_CONFIGS_ROOT;
}

async function readSanitized(
  root: string,
  agent: "claude" | "codex",
): Promise<SanitizedConfig> {
  const path = join(root, `${agent}.sanitized.json`);
  const text = await readFile(path, "utf8");
  const parsed = JSON.parse(text) as unknown;
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new ProfileError(
      "INVALID_SANITIZED_CONFIG",
      `${agent}.sanitized.json must be a JSON object`,
    );
  }
  const obj = parsed as Record<string, unknown>;
  const serverKey = obj.server_key;
  const servers = obj.servers;
  if (typeof serverKey !== "string" || serverKey.length === 0) {
    throw new ProfileError(
      "INVALID_SANITIZED_CONFIG",
      `${agent}.sanitized.json missing string "server_key"`,
    );
  }
  if (
    servers === null ||
    typeof servers !== "object" ||
    Array.isArray(servers)
  ) {
    throw new ProfileError(
      "INVALID_SANITIZED_CONFIG",
      `${agent}.sanitized.json "servers" must be an object`,
    );
  }
  return {
    server_key: serverKey,
    servers: servers as Record<string, unknown>,
    source: typeof obj.source === "string" ? obj.source : undefined,
    source_path:
      typeof obj.source_path === "string" ? obj.source_path : undefined,
  };
}

// ---------------------------------------------------------------------------
// Env-placeholder substitution
// ---------------------------------------------------------------------------

/**
 * Matches `${VAR_NAME}` where VAR_NAME is `[A-Za-z_][A-Za-z0-9_]*`. We are
 * intentionally strict: a placeholder that doesn't fit shell-style identifier
 * rules is treated as literal text (no substitution attempted, no error).
 */
const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function substituteString(
  value: string,
  serverId: string,
  source: "claude" | "codex",
  profileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): string {
  // Replace each placeholder; collect first unresolved name so we throw with
  // useful context rather than silently leaving `${X}` in output.
  let unresolved: string | null = null;
  const out = value.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(profileEnv, name)) {
      return profileEnv[name]!;
    }
    const fromProc = processEnv[name];
    if (fromProc !== undefined) {
      return fromProc;
    }
    if (unresolved === null) unresolved = name;
    return _match;
  });
  if (unresolved !== null) {
    throw new UnresolvedEnvPlaceholder(unresolved, serverId, source);
  }
  return out;
}

/**
 * Walk an arbitrary JSON-shaped value, returning a structurally identical copy
 * with every string passed through {@link substituteString}. Order of object
 * keys is preserved (matters for deterministic round-tripping).
 */
function substituteDeep(
  value: unknown,
  serverId: string,
  source: "claude" | "codex",
  profileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): unknown {
  if (typeof value === "string") {
    return substituteString(value, serverId, source, profileEnv, processEnv);
  }
  if (Array.isArray(value)) {
    return value.map((v) =>
      substituteDeep(v, serverId, source, profileEnv, processEnv),
    );
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteDeep(v, serverId, source, profileEnv, processEnv);
    }
    return out;
  }
  // numbers, booleans, null — pass through untouched.
  return value;
}

// ---------------------------------------------------------------------------
// Per-agent filter
// ---------------------------------------------------------------------------

function filterAgentConfig(
  sanitized: SanitizedConfig,
  source: "claude" | "codex",
  wanted: string[],
  profileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  // Preserve the order in which profile.mcps lists the ids; this makes the
  // output deterministic and easy to diff. Duplicate ids in the input list
  // are collapsed by virtue of object-key uniqueness.
  for (const id of wanted) {
    if (!Object.prototype.hasOwnProperty.call(sanitized.servers, id)) {
      // Caller (materializeMcp) already verified existence across BOTH
      // registries, so a miss here is an expected branch — that means this
      // id only exists in the other agent's registry. Skip silently.
      continue;
    }
    const raw = sanitized.servers[id];
    filtered[id] = substituteDeep(raw, id, source, profileEnv, processEnv);
  }
  return { [sanitized.server_key]: filtered };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the per-agent MCP config blocks for a resolved profile.
 *
 * @throws McpNotFound              if `profile.mcps` references an id missing from BOTH sanitized registries.
 * @throws UnresolvedEnvPlaceholder if a `${VAR}` placeholder can't be resolved from profile.env or process.env.
 * @throws ProfileError             on malformed sanitized config files.
 */
export async function materializeMcp(
  profile: ResolvedProfile,
  opts?: MaterializeOptions,
): Promise<MaterializedMcp> {
  const root = resolveConfigsRoot(opts);
  const [claudeCfg, codexCfg] = await Promise.all([
    readSanitized(root, "claude"),
    readSanitized(root, "codex"),
  ]);

  // An MCP id is "known" if it exists in at least one registry. A truly
  // unknown id is a configuration error and aborts the materialization.
  const knownUnion = new Set<string>([
    ...Object.keys(claudeCfg.servers),
    ...Object.keys(codexCfg.servers),
  ]);

  // Extract string ids from the resolved MCPs (which may be { id, agents? } objects).
  const mcpIds = profile.mcps.map((ref) =>
    typeof ref === "string" ? ref : (ref as { id: string }).id,
  );

  for (const id of mcpIds) {
    if (!knownUnion.has(id)) {
      throw new McpNotFound(id, [...knownUnion].sort());
    }
  }

  const procEnv = opts?.processEnv ?? process.env;

  return {
    claude: filterAgentConfig(
      claudeCfg,
      "claude",
      mcpIds,
      profile.env,
      procEnv,
    ),
    codex: filterAgentConfig(
      codexCfg,
      "codex",
      mcpIds,
      profile.env,
      procEnv,
    ),
  };
}
