import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SCHEMA_VERSION = "picoclaw-profile/v1";
export const PROFILE_VERSION = "0.0.1";

export function stableStringify(value, space = 2) {
  return JSON.stringify(sortDeep(value), null, space);
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
  return out;
}

export function sha256Hex(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function sha256FileHex(filePath) {
  return sha256Hex(fs.readFileSync(filePath));
}

export function defaultPicoclawHome() {
  return path.resolve(process.env.PICOCLAW_HOME || path.join(os.homedir(), ".picoclaw"));
}

export function defaultOutputPath(picoclawHome = defaultPicoclawHome()) {
  return path.join(picoclawHome, "security", "clawsec", "current-profile.json");
}

export function expandUserPath(raw, base = defaultPicoclawHome()) {
  if (!raw) return "";
  const value = String(raw).trim();
  if (!value) return "";
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (value.startsWith("$PICOCLAW_HOME/")) return path.join(base, value.slice("$PICOCLAW_HOME/".length));
  return path.resolve(value);
}

export function isPathInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function nearestExistingAncestor(candidatePath) {
  let candidate = path.resolve(candidatePath);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
  return candidate;
}

function realpathWithMissingTail(candidatePath) {
  const resolved = path.resolve(candidatePath);
  const ancestor = nearestExistingAncestor(resolved);
  const realAncestor = fs.realpathSync.native ? fs.realpathSync.native(ancestor) : fs.realpathSync(ancestor);
  const rel = path.relative(ancestor, resolved);
  return rel ? path.join(realAncestor, rel) : realAncestor;
}

export function confineOutputToPicoclawHome(candidatePath, picoclawHome = defaultPicoclawHome()) {
  const root = path.resolve(picoclawHome);
  const resolved = path.resolve(candidatePath);
  if (!isPathInside(resolved, root)) throw new Error(`output path must stay under ${root}`);
  const rootReal = realpathWithMissingTail(root);
  const resolvedReal = realpathWithMissingTail(resolved);
  if (!isPathInside(resolvedReal, rootReal)) throw new Error(`output path must stay under ${rootReal}`);
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error(`output path must not be a symlink: ${resolved}`);
  }
  return resolved;
}

export function parseJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function detectConfigPaths(picoclawHome = defaultPicoclawHome(), extraConfig = null) {
  const candidates = [
    process.env.PICOCLAW_CONFIG,
    extraConfig,
    path.join(picoclawHome, "config.yaml"),
    path.join(picoclawHome, "config.yml"),
    path.join(picoclawHome, "config.json"),
    path.join(picoclawHome, "launcher-config.json"),
    path.join(picoclawHome, ".security.yml"),
    path.join(picoclawHome, "security.yml"),
  ].filter(Boolean).map((p) => expandUserPath(p, picoclawHome));
  return [...new Set(candidates)];
}

function safeReadText(filePath, maxBytes = 1024 * 1024) {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size > maxBytes) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function fingerprintPath(filePath) {
  const exists = fs.existsSync(filePath);
  if (!exists) return { path: filePath, exists: false };
  const st = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    type: st.isDirectory() ? "directory" : st.isFile() ? "file" : "other",
    size: st.isFile() ? st.size : null,
    mode: (st.mode & 0o777).toString(8).padStart(3, "0"),
    sha256: st.isFile() ? sha256FileHex(filePath) : null,
  };
}

function truthyFromText(text, patterns) {
  const low = text.toLowerCase();
  return patterns.some((p) => low.includes(p));
}

function truthyRegex(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function jsonBoolPattern(key, expected) {
  return new RegExp(`"${key}"\\s*:\\s*${expected ? "true" : "false"}`, "i");
}

function jsonEmptyStringPattern(key) {
  return new RegExp(`"${key}"\\s*:\\s*"\\s*"`, "i");
}

function jsonStringPattern(key, value) {
  return new RegExp(`"${key}"\\s*:\\s*"${value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"`, "i");
}

function analyzeConfigText(text) {
  return {
    public_web_ui: truthyFromText(text, [
      "public: true",
      "bind: 0.0.0.0",
      "host: 0.0.0.0",
      "-public",
      '"public": true',
      '"bind": "0.0.0.0"',
      '"host": "0.0.0.0"',
      '"listen": "0.0.0.0"',
    ]) || truthyRegex(text, [
      jsonBoolPattern("public", true),
      jsonStringPattern("bind", "0.0.0.0"),
      jsonStringPattern("host", "0.0.0.0"),
      jsonStringPattern("listen", "0.0.0.0"),
    ]),
    auth_disabled: truthyFromText(text, [
      "auth: false",
      "disable_auth: true",
      "no_auth: true",
      "password: ''",
      'password: ""',
      '"auth": false',
      '"disable_auth": true',
      '"no_auth": true',
      '"require_auth": false',
      '"dashboard_auth": false',
      '"password": ""',
      '"dashboard_password_hash": ""',
      '"launcher_token": ""',
    ]) || truthyRegex(text, [
      jsonBoolPattern("auth", false),
      jsonBoolPattern("disable_auth", true),
      jsonBoolPattern("no_auth", true),
      jsonBoolPattern("require_auth", false),
      jsonBoolPattern("dashboard_auth", false),
      jsonEmptyStringPattern("password"),
      jsonEmptyStringPattern("dashboard_password_hash"),
      jsonEmptyStringPattern("launcher_token"),
    ]),
    allow_unsigned: truthyFromText(text, [
      "allow_unsigned",
      "skip_signature",
      "disable_signature",
      "insecure_skip_verify",
    ]),
    unrestricted_workspace: truthyFromText(text, [
      "restrict_to_workspace: false",
      "workspace_restriction: false",
      "sandbox: false",
      '"restrict_to_workspace": false',
      '"workspace_restriction": false',
      '"sandbox": false',
    ]) || truthyRegex(text, [
      jsonBoolPattern("restrict_to_workspace", false),
      jsonBoolPattern("workspace_restriction", false),
      jsonBoolPattern("sandbox", false),
    ]),
    mcp_enabled: truthyFromText(text, ["mcp:", "mcp_servers", "modelcontextprotocol", '"mcp"', '"mcp_servers"']),
    tools_enabled: truthyFromText(text, ["tools:", "code_execution", "shell", "filesystem", '"tools"', '"exec"', '"shell"']),
    scheduler_enabled: truthyFromText(text, ["cron", "schedule", "scheduler"]),
    secret_markers: (text.match(/(api[_-]?key|token|secret|password)\s*[":=]+\s*['"]?[^\s'"]{8,}/gi) || []).length,
  };
}

function mergeConfigSignals(paths) {
  const signals = {
    public_web_ui: false,
    auth_disabled: false,
    allow_unsigned: false,
    unrestricted_workspace: false,
    mcp_enabled: false,
    tools_enabled: false,
    scheduler_enabled: false,
    secret_markers: 0,
  };
  for (const p of paths) {
    const text = safeReadText(p);
    const found = analyzeConfigText(text);
    for (const [k, v] of Object.entries(found)) {
      if (typeof v === "boolean") signals[k] = signals[k] || v;
      else signals[k] += v;
    }
  }
  return signals;
}

export function buildPicoclawProfile(options = {}) {
  const picoclawHome = path.resolve(options.picoclawHome || defaultPicoclawHome());
  const generatedAt = options.generatedAt || new Date().toISOString();
  const configPaths = detectConfigPaths(picoclawHome, options.configPath);
  const watchedFiles = [...new Set([...(options.watchFiles || []), ...configPaths].filter(Boolean).map((p) => expandUserPath(p, picoclawHome)))];
  const releaseArtifacts = [...new Set((options.releaseArtifacts || []).filter(Boolean).map((p) => expandUserPath(p, picoclawHome)))];
  const signals = options.signals || mergeConfigSignals(watchedFiles);
  const profile = {
    schema_version: SCHEMA_VERSION,
    platform: "picoclaw",
    generated_at: generatedAt,
    generator: { name: "picoclaw-security-guardian", version: PROFILE_VERSION },
    posture: {
      runtime: {
        home: picoclawHome,
        config_paths: configPaths,
        gateways: options.gateways || {},
        ui: { public_web_ui: !!signals.public_web_ui, auth_disabled: !!signals.auth_disabled },
        tools: { enabled: !!signals.tools_enabled, unrestricted_workspace: !!signals.unrestricted_workspace },
        mcp: { enabled: !!signals.mcp_enabled },
        scheduler: { enabled: !!signals.scheduler_enabled },
        risky_toggles: { allow_unsigned_mode: !!signals.allow_unsigned },
        secrets: { config_secret_markers: signals.secret_markers || 0 },
      },
      integrity: {
        watched_files: watchedFiles.map(fingerprintPath),
        release_artifacts: releaseArtifacts.map(fingerprintPath),
      },
      feed_verification: options.feedVerification || { status: "unknown" },
    },
  };
  profile.digests = { canonical_sha256: sha256Hex(stableStringify({ ...profile, digests: undefined }, 0)) };
  return profile;
}
