/**
 * @param {string} version
 * @returns {[number, number, number] | null}
 */
export function parseSemver(version) {
  const cleaned = String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split("+")[0]
    .split("-")[0];

  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;

  const normalized = [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2] || "0", 10),
    Number.parseInt(match[3] || "0", 10),
  ];

  if (normalized.some((part) => Number.isNaN(part))) return null;
  return /** @type {[number, number, number]} */ (normalized);
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number | null}
 */
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;

  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} rawSpecifier
 * @returns {{name: string, versionSpec: string} | null}
 */
export function parseAffectedSpecifier(rawSpecifier) {
  const specifier = String(rawSpecifier || "").trim();
  if (!specifier) return null;

  const atIndex = specifier.lastIndexOf("@");
  if (atIndex <= 0) {
    return null;
  }
  if (atIndex === specifier.length - 1) {
    return null;
  }

  const name = specifier.slice(0, atIndex).trim();
  const versionSpec = specifier.slice(atIndex + 1).trim();
  if (!name || !versionSpec) return null;
  return { name, versionSpec };
}

/**
 * @param {string} reason
 * @param {string} normalized
 * @returns {{supported: false, normalized: string, reason: string}}
 */
function unsupportedSpec(reason, normalized) {
  return { supported: false, normalized, reason };
}

/**
 * @param {string} normalized
 * @returns {{supported: true, normalized: string, reason: null}}
 */
function supportedSpec(normalized) {
  return { supported: true, normalized, reason: null };
}

/**
 * @param {string} rawSpec
 * @returns {{supported: boolean, normalized: string, reason: string | null}}
 */
export function parseVersionSpec(rawSpec) {
  const spec = String(rawSpec || "").trim();
  if (!spec || spec === "*" || spec.toLowerCase() === "any") {
    return supportedSpec("*");
  }

  if (spec.includes("||") || spec.includes("&&") || /\s-\s/.test(spec) || spec.includes(",")) {
    return unsupportedSpec("unsupported logical/composite semver range syntax", spec);
  }

  if (/^(>=|<=|>|<|=).*\s+(>=|<=|>|<|=)/.test(spec)) {
    return unsupportedSpec("unsupported comparator-set semver range syntax", spec);
  }

  if (spec.includes("*")) {
    if (!/^[vV]?[0-9*]+(?:\.[0-9*]+){0,2}$/.test(spec)) {
      return unsupportedSpec("unsupported wildcard semver range syntax", spec);
    }
    return supportedSpec(spec);
  }

  if (/^(>=|<=|>|<|=)\s*([vV]?\d+(?:\.\d+){0,2})$/.test(spec)) {
    return supportedSpec(spec);
  }

  if (spec.startsWith("^")) {
    if (!parseSemver(spec.slice(1))) {
      return unsupportedSpec("invalid caret semver range syntax", spec);
    }
    return supportedSpec(spec);
  }

  if (spec.startsWith("~")) {
    if (!parseSemver(spec.slice(1))) {
      return unsupportedSpec("invalid tilde semver range syntax", spec);
    }
    return supportedSpec(spec);
  }

  if (parseSemver(spec.replace(/^v/i, ""))) {
    return supportedSpec(spec);
  }

  return unsupportedSpec("unsupported semver range syntax", spec);
}

/**
 * @param {string | null} version
 * @param {string} rawSpec
 * @returns {boolean}
 */
export function versionMatches(version, rawSpec) {
  const parsedSpec = parseVersionSpec(rawSpec);
  if (!parsedSpec.supported) return false;

  const spec = parsedSpec.normalized;
  if (spec === "*") return true;
  if (!version || String(version).trim().toLowerCase() === "unknown") return false;

  const normalizedVersion = String(version).trim().replace(/^v/i, "");

  if (spec.includes("*")) {
    const wildcardRegex = new RegExp(`^${escapeRegex(spec).replace(/\\\*/g, ".*")}$`);
    return wildcardRegex.test(normalizedVersion);
  }

  const comparatorMatch = spec.match(/^(>=|<=|>|<|=)\s*([vV]?\d+(?:\.\d+){0,2})$/);
  if (comparatorMatch) {
    const operator = comparatorMatch[1];
    const targetVersion = comparatorMatch[2].trim();
    const compared = compareSemver(normalizedVersion, targetVersion);
    if (compared === null) return false;
    if (operator === ">=") return compared >= 0;
    if (operator === "<=") return compared <= 0;
    if (operator === ">") return compared > 0;
    if (operator === "<") return compared < 0;
    return compared === 0;
  }

  if (spec.startsWith("^")) {
    const target = parseSemver(spec.slice(1));
    const current = parseSemver(normalizedVersion);
    if (!target || !current) return false;

    const lowerBound = `${target[0]}.${target[1]}.${target[2]}`;
    let upperBound;
    if (target[0] > 0) {
      upperBound = `${target[0] + 1}.0.0`;
    } else if (target[1] > 0) {
      upperBound = `0.${target[1] + 1}.0`;
    } else {
      upperBound = `0.0.${target[2] + 1}`;
    }

    const lowerCompared = compareSemver(normalizedVersion, lowerBound);
    const upperCompared = compareSemver(normalizedVersion, upperBound);
    return lowerCompared !== null && upperCompared !== null && lowerCompared >= 0 && upperCompared === -1;
  }

  if (spec.startsWith("~")) {
    const target = parseSemver(spec.slice(1));
    const current = parseSemver(normalizedVersion);
    if (!target || !current) return false;
    return (
      current[0] === target[0] &&
      current[1] === target[1] &&
      compareSemver(normalizedVersion, spec.slice(1)) !== -1
    );
  }

  return normalizedVersion === spec || normalizedVersion === spec.replace(/^v/i, "");
}
