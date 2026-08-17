const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function bumpSummary(summary, severity) {
  if (summary[severity] === undefined) {
    summary[severity] = 0;
  }
  summary[severity] += 1;
}

function compareBooleanFindings({ findings, summary, codeOnEnable, codeOnDisable, path, before, after, enableSeverity = "high" }) {
  if (!!before === !!after) return;

  if (!before && after) {
    findings.push({
      severity: enableSeverity,
      code: codeOnEnable,
      path,
      message: `${path} changed false -> true`,
    });
    bumpSummary(summary, enableSeverity);
    return;
  }

  findings.push({
    severity: "info",
    code: codeOnDisable,
    path,
    message: `${path} changed true -> false`,
  });
  bumpSummary(summary, "info");
}

function mapByPath(entries) {
  const out = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry.path !== "string") continue;
    out.set(entry.path, entry);
  }
  return out;
}

function compareHashedEntries({ findings, summary, beforeEntries, afterEntries, changedCode, missingCode }) {
  const beforeMap = mapByPath(beforeEntries);
  const afterMap = mapByPath(afterEntries);

  for (const [itemPath, before] of beforeMap.entries()) {
    const after = afterMap.get(itemPath);
    if (!after) {
      findings.push({
        severity: "high",
        code: missingCode,
        path: itemPath,
        message: `${itemPath} missing in current attestation`,
      });
      bumpSummary(summary, "high");
      continue;
    }

    const beforeHash = before.sha256 || null;
    const afterHash = after.sha256 || null;
    if (beforeHash !== afterHash) {
      findings.push({
        severity: "critical",
        code: changedCode,
        path: itemPath,
        message: `${itemPath} fingerprint changed`,
      });
      bumpSummary(summary, "critical");
    }
  }

  for (const [itemPath, after] of afterMap.entries()) {
    if (beforeMap.has(itemPath)) continue;
    findings.push({
      severity: "low",
      code: "NEW_INTEGRITY_SCOPE",
      path: itemPath,
      message: `${itemPath} added to integrity tracking scope`,
      details: { exists: !!after.exists },
    });
    bumpSummary(summary, "low");
  }
}

function compareFeedVerification({ findings, summary, baselineFeed, currentFeed }) {
  const beforeStatus = baselineFeed?.status || "unknown";
  const afterStatus = currentFeed?.status || "unknown";

  if (beforeStatus === afterStatus) return;

  if (beforeStatus === "verified" && afterStatus !== "verified") {
    findings.push({
      severity: "critical",
      code: "FEED_VERIFICATION_REGRESSION",
      path: "posture.feed_verification.status",
      message: `Feed verification regressed verified -> ${afterStatus}`,
    });
    bumpSummary(summary, "critical");
    return;
  }

  findings.push({
    severity: "medium",
    code: "FEED_VERIFICATION_CHANGED",
    path: "posture.feed_verification.status",
    message: `Feed verification status changed ${beforeStatus} -> ${afterStatus}`,
  });
  bumpSummary(summary, "medium");
}

function comparePlatform({ findings, summary, baseline, current }) {
  if (baseline.platform === current.platform) return;
  findings.push({
    severity: "critical",
    code: "PLATFORM_MISMATCH",
    path: "platform",
    message: `platform changed ${baseline.platform} -> ${current.platform}`,
  });
  bumpSummary(summary, "critical");
}

function compareSchema({ findings, summary, baseline, current }) {
  if (baseline.schema_version === current.schema_version) return;
  findings.push({
    severity: "high",
    code: "SCHEMA_VERSION_CHANGED",
    path: "schema_version",
    message: `schema_version changed ${baseline.schema_version} -> ${current.schema_version}`,
  });
  bumpSummary(summary, "high");
}

function compareGenerator({ findings, summary, baseline, current }) {
  const before = baseline?.generator?.version || "unknown";
  const after = current?.generator?.version || "unknown";
  if (before === after) return;
  findings.push({
    severity: "info",
    code: "GENERATOR_VERSION_CHANGED",
    path: "generator.version",
    message: `generator.version changed ${before} -> ${after}`,
  });
  bumpSummary(summary, "info");
}

export function diffAttestations(baseline, current) {
  const findings = [];
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

  const baselineSafe = baseline && typeof baseline === "object" ? baseline : {};
  const currentSafe = current && typeof current === "object" ? current : {};

  comparePlatform({ findings, summary, baseline: baselineSafe, current: currentSafe });
  compareSchema({ findings, summary, baseline: baselineSafe, current: currentSafe });
  compareGenerator({ findings, summary, baseline: baselineSafe, current: currentSafe });

  const baselineRuntime = baselineSafe?.posture?.runtime || {};
  const currentRuntime = currentSafe?.posture?.runtime || {};

  compareBooleanFindings({
    findings,
    summary,
    codeOnEnable: "UNSIGNED_MODE_ENABLED",
    codeOnDisable: "UNSIGNED_MODE_DISABLED",
    path: "posture.runtime.risky_toggles.allow_unsigned_mode",
    before: baselineRuntime?.risky_toggles?.allow_unsigned_mode,
    after: currentRuntime?.risky_toggles?.allow_unsigned_mode,
    enableSeverity: "critical",
  });

  compareBooleanFindings({
    findings,
    summary,
    codeOnEnable: "BYPASS_VERIFICATION_ENABLED",
    codeOnDisable: "BYPASS_VERIFICATION_DISABLED",
    path: "posture.runtime.risky_toggles.bypass_verification",
    before: baselineRuntime?.risky_toggles?.bypass_verification,
    after: currentRuntime?.risky_toggles?.bypass_verification,
    enableSeverity: "critical",
  });

  for (const gateway of ["telegram", "matrix", "discord"]) {
    compareBooleanFindings({
      findings,
      summary,
      codeOnEnable: "GATEWAY_ENABLED",
      codeOnDisable: "GATEWAY_DISABLED",
      path: `posture.runtime.gateways.${gateway}`,
      before: baselineRuntime?.gateways?.[gateway],
      after: currentRuntime?.gateways?.[gateway],
      enableSeverity: "low",
    });
  }

  compareFeedVerification({
    findings,
    summary,
    baselineFeed: baselineSafe?.posture?.feed_verification,
    currentFeed: currentSafe?.posture?.feed_verification,
  });

  compareHashedEntries({
    findings,
    summary,
    beforeEntries: baselineSafe?.posture?.integrity?.trust_anchors,
    afterEntries: currentSafe?.posture?.integrity?.trust_anchors,
    changedCode: "TRUST_ANCHOR_MISMATCH",
    missingCode: "TRUST_ANCHOR_REMOVED",
  });

  compareHashedEntries({
    findings,
    summary,
    beforeEntries: baselineSafe?.posture?.integrity?.watched_files,
    afterEntries: currentSafe?.posture?.integrity?.watched_files,
    changedCode: "WATCHED_FILE_DRIFT",
    missingCode: "WATCHED_FILE_REMOVED",
  });

  findings.sort((a, b) => {
    const sev = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (sev !== 0) return sev;
    const codeCmp = String(a.code || "").localeCompare(String(b.code || ""));
    if (codeCmp !== 0) return codeCmp;
    return String(a.path || "").localeCompare(String(b.path || ""));
  });

  return {
    summary,
    findings,
  };
}

export function highestSeverity(findings = []) {
  for (const severity of SEVERITY_ORDER) {
    if (findings.some((finding) => finding?.severity === severity)) {
      return severity;
    }
  }
  return null;
}

export function severityAtOrAbove(severity, threshold) {
  if (!threshold || threshold === "none") return false;
  const idx = SEVERITY_ORDER.indexOf(severity);
  const thresholdIdx = SEVERITY_ORDER.indexOf(threshold);
  if (idx < 0 || thresholdIdx < 0) return false;
  return idx <= thresholdIdx;
}
