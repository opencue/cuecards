import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultFeedStatePath, getFeedVerificationStatus } from "./feed.mjs";

export const SCHEMA_VERSION = "0.0.1";
export const SKILL_NAME = "hermes-attestation-guardian";
export const SKILL_VERSION = "0.0.1";
export const DIGEST_ALGORITHM = "sha256";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = stableSortObject(value[key]);
  }
  return out;
}

export function stableStringify(value, spacing = 2) {
  return JSON.stringify(stableSortObject(value), null, spacing);
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function sha256FileHex(filePath) {
  const data = fs.readFileSync(filePath);
  return sha256Hex(data);
}

export function detectHermesHome() {
  const candidate = (process.env.HERMES_HOME || "").trim();
  return candidate || path.join(os.homedir(), ".hermes");
}

export function defaultOutputPath() {
  return path.join(detectHermesHome(), "security", "attestations", "current.json");
}

export function attestationOutputRoot(hermesHome = detectHermesHome()) {
  return path.join(path.resolve(hermesHome), "security", "attestations");
}

function nearestExistingAncestor(inputPath) {
  let candidate = path.resolve(inputPath);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return candidate;
    }
    candidate = parent;
  }
  return candidate;
}

function safeRealpath(inputPath) {
  return fs.realpathSync.native ? fs.realpathSync.native(inputPath) : fs.realpathSync(inputPath);
}

function realpathWithMissingTail(inputPath) {
  const resolved = path.resolve(inputPath);
  const ancestor = nearestExistingAncestor(resolved);
  const ancestorReal = safeRealpath(ancestor);
  const rel = path.relative(ancestor, resolved);
  return rel ? path.join(ancestorReal, rel) : ancestorReal;
}

function nearestExistingAncestorWithinRoot(targetPath, rootPath) {
  const stopAt = path.resolve(path.dirname(rootPath));
  let candidate = path.resolve(targetPath);

  while (true) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    if (candidate === stopAt) {
      return null;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = parent;
  }
}

export function resolveHermesScopedOutputPath(outputPath, hermesHome = detectHermesHome()) {
  const root = attestationOutputRoot(hermesHome);
  const resolvedOutput = path.resolve(String(outputPath || defaultOutputPath()));
  if (!isPathInside(resolvedOutput, root)) {
    throw new Error(`output path must stay under ${root}`);
  }

  const hermesHomeReal = realpathWithMissingTail(hermesHome);
  const rootReal = path.join(hermesHomeReal, "security", "attestations");
  const nearestOutputAncestor = nearestExistingAncestorWithinRoot(resolvedOutput, root);
  if (nearestOutputAncestor) {
    const nearestOutputAncestorReal = safeRealpath(nearestOutputAncestor);
    if (!isPathInside(nearestOutputAncestorReal, rootReal)) {
      throw new Error(`output path must stay under ${rootReal}`);
    }
  }

  if (fs.existsSync(resolvedOutput) && fs.lstatSync(resolvedOutput).isSymbolicLink()) {
    throw new Error(`output path must not be a symlink: ${resolvedOutput}`);
  }

  return resolvedOutput;
}

export function isPathInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function parseAttestationPolicy(policyContent) {
  if (!policyContent) {
    return { watch_files: [], trust_anchor_files: [] };
  }
  const parsed = JSON.parse(policyContent);
  const watchFiles = Array.isArray(parsed.watch_files) ? parsed.watch_files : [];
  const trustAnchors = Array.isArray(parsed.trust_anchor_files) ? parsed.trust_anchor_files : [];
  return {
    watch_files: [...new Set(watchFiles.map((v) => String(v).trim()).filter(Boolean))].sort(),
    trust_anchor_files: [...new Set(trustAnchors.map((v) => String(v).trim()).filter(Boolean))].sort(),
  };
}

function readJsonFileMaybe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

export function detectHermesConfig(hermesHome) {
  const configCandidates = [
    path.join(hermesHome, "config.json"),
    path.join(hermesHome, "gateway", "config.json"),
  ];

  for (const candidate of configCandidates) {
    try {
      const parsed = readJsonFileMaybe(candidate);
      if (parsed && typeof parsed === "object") {
        return { path: candidate, config: parsed };
      }
    } catch {
      // Continue trying fallbacks; verifier reports malformed artifacts, not local config issues.
    }
  }

  return { path: null, config: {} };
}

function bool(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return defaultValue;
  }
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(norm)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(norm)) return false;
    return defaultValue;
  }
  return defaultValue;
}

function readEnvBool(name, fallback = false) {
  const envObj = process?.["env"] || {};
  const raw = envObj[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  return bool(raw, fallback);
}

function configBool(value, envFallback = false) {
  if (value === undefined || value === null) {
    return envFallback;
  }
  return bool(value, false);
}

function normalizePath(input, hermesHome) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  if (raw.startsWith("$HERMES_HOME/")) return path.join(hermesHome, raw.slice("$HERMES_HOME/".length));
  return path.resolve(raw);
}

function resolveConfiguredFeedStatePath(config, hermesHome) {
  const configuredStatePath =
    process.env.HERMES_ADVISORY_FEED_STATE_PATH
    || config?.advisory_feed?.state_path
    || config?.security?.advisory_feed?.state_path;

  const fallbackPath = defaultFeedStatePath(hermesHome);

  if (typeof configuredStatePath !== "string" || !configuredStatePath.trim()) {
    return { statePath: fallbackPath, configWarning: null };
  }

  const candidate = normalizePath(configuredStatePath, hermesHome);
  if (!candidate) {
    return {
      statePath: fallbackPath,
      configWarning: "configured advisory state path was empty after normalization; using default path",
    };
  }

  if (isPathInside(candidate, hermesHome)) {
    return { statePath: candidate, configWarning: null };
  }

  return {
    statePath: fallbackPath,
    configWarning: `configured advisory state path rejected (outside HERMES_HOME): ${candidate}`,
  };
}

function readFeedVerificationStateSafe(config, hermesHome) {
  const { statePath: safeStatePath, configWarning } = resolveConfiguredFeedStatePath(config, hermesHome);

  try {
    return {
      ...getFeedVerificationStatus({ statePath: safeStatePath }),
      config_warning: configWarning,
    };
  } catch {
    return {
      status: "unknown",
      available: false,
      checked_at: null,
      state_path: safeStatePath,
      source: null,
      config_warning: configWarning,
    };
  }
}

function fileFingerprint(filePath) {
  if (!filePath) {
    return { path: filePath, exists: false, sha256: null };
  }
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false, sha256: null };
  }
  const data = fs.readFileSync(filePath);
  return { path: filePath, exists: true, sha256: sha256Hex(data) };
}

export function buildAttestation({
  generatedAt,
  policy,
  extraWatchFiles = [],
  extraTrustAnchorFiles = [],
} = {}) {
  const hermesHome = detectHermesHome();
  const configState = detectHermesConfig(hermesHome);
  const config = configState.config || {};

  const gateways = {
    telegram: configBool(config?.gateways?.telegram?.enabled, readEnvBool("HERMES_GATEWAY_TELEGRAM_ENABLED", false)),
    matrix: configBool(config?.gateways?.matrix?.enabled, readEnvBool("HERMES_GATEWAY_MATRIX_ENABLED", false)),
    discord: configBool(config?.gateways?.discord?.enabled, readEnvBool("HERMES_GATEWAY_DISCORD_ENABLED", false)),
  };

  const riskyToggles = {
    allow_unsigned_mode: configBool(config?.security?.allow_unsigned_mode, readEnvBool("HERMES_ALLOW_UNSIGNED_MODE", false)),
    bypass_verification: configBool(config?.security?.bypass_verification, readEnvBool("HERMES_BYPASS_VERIFICATION", false)),
  };

  const feedVerificationState = readFeedVerificationStateSafe(config, hermesHome);
  const normalizedFeedStatus = feedVerificationState.status;

  const selectedPolicy = policy || { watch_files: [], trust_anchor_files: [] };

  const watchFiles = [...new Set([...(selectedPolicy.watch_files || []), ...extraWatchFiles])]
    .map((p) => normalizePath(p, hermesHome))
    .filter(Boolean)
    .sort();

  const trustAnchorFiles = [...new Set([...(selectedPolicy.trust_anchor_files || []), ...extraTrustAnchorFiles])]
    .map((p) => normalizePath(p, hermesHome))
    .filter(Boolean)
    .sort();

  const watchedFingerprints = watchFiles.map(fileFingerprint);
  const trustAnchorFingerprints = trustAnchorFiles.map(fileFingerprint);

  const payload = {
    schema_version: SCHEMA_VERSION,
    platform: "hermes",
    generated_at: generatedAt || new Date().toISOString(),
    generator: {
      skill: SKILL_NAME,
      version: SKILL_VERSION,
      node: process.version,
    },
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
    },
    posture: {
      hermes_home: hermesHome,
      config_source: configState.path,
      runtime: {
        gateways,
        risky_toggles: riskyToggles,
      },
      feed_verification: {
        configured: feedVerificationState.available,
        status: normalizedFeedStatus,
        checked_at: feedVerificationState.checked_at,
        source: feedVerificationState.source,
        state_path: feedVerificationState.state_path,
        config_warning: feedVerificationState.config_warning || null,
      },
      integrity: {
        watched_files: watchedFingerprints,
        trust_anchors: trustAnchorFingerprints,
      },
    },
  };

  const canonicalWithoutDigest = stableStringify(payload, 0);
  const canonicalSha256 = sha256Hex(canonicalWithoutDigest);

  return {
    ...payload,
    digests: {
      canonical_sha256: canonicalSha256,
      algorithm: DIGEST_ALGORITHM,
    },
  };
}

export function normalizeDigestAlgorithm(algorithm) {
  return String(algorithm || "").trim().toLowerCase();
}

export function isSupportedDigestAlgorithm(algorithm) {
  return normalizeDigestAlgorithm(algorithm) === DIGEST_ALGORITHM;
}

export function computeCanonicalDigest(attestation) {
  const clone = JSON.parse(JSON.stringify(attestation || {}));
  delete clone.digests;
  return sha256Hex(stableStringify(clone, 0));
}

export function validateDigestBinding(attestation) {
  if (!attestation || typeof attestation !== "object") {
    return "attestation must be a JSON object";
  }
  if (!isSupportedDigestAlgorithm(attestation?.digests?.algorithm)) {
    return `unsupported digest algorithm: ${attestation?.digests?.algorithm ?? "(missing)"}`;
  }
  const expectedCanonical = String(attestation?.digests?.canonical_sha256 || "").toLowerCase();
  const actualCanonical = computeCanonicalDigest(attestation);
  if (expectedCanonical !== actualCanonical) {
    return `canonical digest mismatch expected=${expectedCanonical} actual=${actualCanonical}`;
  }
  return null;
}

export function validateAttestationSchema(attestation) {
  const errors = [];

  if (!isPlainObject(attestation)) {
    return ["attestation must be a JSON object"];
  }

  if (attestation.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (attestation.platform !== "hermes") {
    errors.push("platform must be hermes");
  }

  const generatedAt = String(attestation.generated_at || "").trim();
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    errors.push("generated_at must be an ISO timestamp");
  }

  if (!isPlainObject(attestation.generator)) {
    errors.push("generator object is required");
  } else {
    if (typeof attestation.generator.version !== "string" || !attestation.generator.version.trim()) {
      errors.push("generator.version must be a non-empty string");
    }
  }
  if (!isPlainObject(attestation.host)) {
    errors.push("host object is required");
  }

  if (!isPlainObject(attestation.posture)) {
    errors.push("posture object is required");
  } else {
    const runtime = attestation.posture.runtime;
    if (!isPlainObject(runtime)) {
      errors.push("posture.runtime object is required");
    } else {
      if (!isPlainObject(runtime.gateways)) {
        errors.push("posture.runtime.gateways object is required");
      } else {
        for (const gateway of ["telegram", "matrix", "discord"]) {
          if (typeof runtime.gateways[gateway] !== "boolean") {
            errors.push(`posture.runtime.gateways.${gateway} must be a boolean`);
          }
        }
      }

      if (!isPlainObject(runtime.risky_toggles)) {
        errors.push("posture.runtime.risky_toggles object is required");
      } else {
        for (const toggle of ["allow_unsigned_mode", "bypass_verification"]) {
          if (typeof runtime.risky_toggles[toggle] !== "boolean") {
            errors.push(`posture.runtime.risky_toggles.${toggle} must be a boolean`);
          }
        }
      }
    }
    if (!isPlainObject(attestation.posture.feed_verification)) {
      errors.push("posture.feed_verification object is required");
    } else {
      const status = attestation.posture.feed_verification.status;
      if (!["verified", "unverified", "unknown"].includes(status)) {
        errors.push("posture.feed_verification.status must be verified|unverified|unknown");
      }
    }

    const integrity = attestation.posture.integrity;
    if (!isPlainObject(integrity)) {
      errors.push("posture.integrity object is required");
    } else {
      const validateIntegrityEntries = (entries, fieldPath) => {
        if (!Array.isArray(entries)) {
          errors.push(`${fieldPath} must be an array`);
          return;
        }

        entries.forEach((entry, index) => {
          const itemPath = `${fieldPath}[${index}]`;
          if (!isPlainObject(entry)) {
            errors.push(`${itemPath} must be an object`);
            return;
          }

          if (typeof entry.path !== "string" || !entry.path.trim()) {
            errors.push(`${itemPath}.path must be a non-empty string`);
          }

          if (typeof entry.exists !== "boolean") {
            errors.push(`${itemPath}.exists must be a boolean`);
          }

          if (entry.sha256 !== null && !/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ""))) {
            errors.push(`${itemPath}.sha256 must be null or a 64-char sha256 hex string`);
          }
        });
      };

      validateIntegrityEntries(integrity.watched_files, "posture.integrity.watched_files");
      validateIntegrityEntries(integrity.trust_anchors, "posture.integrity.trust_anchors");
    }
  }

  if (!isPlainObject(attestation.digests)) {
    errors.push("digests object is required");
  } else {
    if (!/^[a-f0-9]{64}$/i.test(String(attestation.digests.canonical_sha256 || ""))) {
      errors.push("digests.canonical_sha256 must be a 64-char sha256 hex string");
    }
    if (!isSupportedDigestAlgorithm(attestation.digests.algorithm)) {
      errors.push(`digests.algorithm must be ${DIGEST_ALGORITHM}`);
    }
  }

  return errors;
}
