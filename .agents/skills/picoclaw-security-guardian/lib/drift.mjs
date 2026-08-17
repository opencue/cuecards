const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function bump(summary, sev) { summary[sev] = (summary[sev] || 0) + 1; }
function bool(value) { return !!value; }
function add(findings, summary, severity, code, path, message, details = undefined) {
  const finding = { severity, code, path, message };
  if (details) finding.details = details;
  findings.push(finding); bump(summary, severity);
}
function byPath(entries) { const m = new Map(); for (const e of Array.isArray(entries) ? entries : []) if (e?.path) m.set(e.path, e); return m; }
function compareBool({ before, after, path, codeOnEnable, codeOnDisable, enableSeverity, findings, summary }) {
  if (bool(before) === bool(after)) return;
  if (!before && after) add(findings, summary, enableSeverity, codeOnEnable, path, `${path} changed false -> true`);
  else add(findings, summary, "info", codeOnDisable, path, `${path} changed true -> false`);
}
function compareHashSet(beforeEntries, afterEntries, changedCode, removedCode, findings, summary) {
  const b = byPath(beforeEntries); const a = byPath(afterEntries);
  for (const [p, before] of b.entries()) {
    const after = a.get(p);
    if (!after) { add(findings, summary, "high", removedCode, p, `${p} missing from current profile`); continue; }
    if ((before.sha256 || null) !== (after.sha256 || null)) add(findings, summary, "critical", changedCode, p, `${p} fingerprint changed`);
  }
  for (const [p] of a.entries()) if (!b.has(p)) add(findings, summary, "low", "NEW_INTEGRITY_SCOPE", p, `${p} added to integrity tracking scope`);
}
export function diffPicoclawProfiles(baseline, current) {
  const findings=[]; const summary={critical:0, high:0, medium:0, low:0, info:0};
  const b=baseline||{}; const c=current||{};
  if (b.platform !== c.platform) add(findings, summary, "critical", "PLATFORM_MISMATCH", "platform", `platform changed ${b.platform} -> ${c.platform}`);
  if (b.schema_version !== c.schema_version) add(findings, summary, "high", "SCHEMA_VERSION_CHANGED", "schema_version", `schema_version changed ${b.schema_version} -> ${c.schema_version}`);
  const br=b.posture?.runtime||{}; const cr=c.posture?.runtime||{};
  compareBool({before: br.ui?.public_web_ui, after: cr.ui?.public_web_ui, path:"posture.runtime.ui.public_web_ui", codeOnEnable:"PUBLIC_WEB_UI_ENABLED", codeOnDisable:"PUBLIC_WEB_UI_DISABLED", enableSeverity:"critical", findings, summary});
  compareBool({before: br.ui?.auth_disabled, after: cr.ui?.auth_disabled, path:"posture.runtime.ui.auth_disabled", codeOnEnable:"WEB_UI_AUTH_DISABLED", codeOnDisable:"WEB_UI_AUTH_REENABLED", enableSeverity:"critical", findings, summary});
  compareBool({before: br.tools?.unrestricted_workspace, after: cr.tools?.unrestricted_workspace, path:"posture.runtime.tools.unrestricted_workspace", codeOnEnable:"WORKSPACE_RESTRICTION_DISABLED", codeOnDisable:"WORKSPACE_RESTRICTION_RESTORED", enableSeverity:"critical", findings, summary});
  compareBool({before: br.risky_toggles?.allow_unsigned_mode, after: cr.risky_toggles?.allow_unsigned_mode, path:"posture.runtime.risky_toggles.allow_unsigned_mode", codeOnEnable:"UNSIGNED_MODE_ENABLED", codeOnDisable:"UNSIGNED_MODE_DISABLED", enableSeverity:"critical", findings, summary});
  compareBool({before: br.mcp?.enabled, after: cr.mcp?.enabled, path:"posture.runtime.mcp.enabled", codeOnEnable:"MCP_ENABLED", codeOnDisable:"MCP_DISABLED", enableSeverity:"high", findings, summary});
  compareBool({before: br.scheduler?.enabled, after: cr.scheduler?.enabled, path:"posture.runtime.scheduler.enabled", codeOnEnable:"SCHEDULER_ENABLED", codeOnDisable:"SCHEDULER_DISABLED", enableSeverity:"medium", findings, summary});
  if ((br.secrets?.config_secret_markers||0) < (cr.secrets?.config_secret_markers||0)) add(findings, summary, "high", "SECRET_MARKERS_INCREASED", "posture.runtime.secrets.config_secret_markers", "config secret markers increased", { before: br.secrets?.config_secret_markers||0, after: cr.secrets?.config_secret_markers||0 });
  if (b.posture?.feed_verification?.status === "verified" && c.posture?.feed_verification?.status !== "verified") add(findings, summary, "critical", "FEED_VERIFICATION_REGRESSION", "posture.feed_verification.status", `Feed verification regressed verified -> ${c.posture?.feed_verification?.status || "unknown"}`);
  compareHashSet(b.posture?.integrity?.watched_files, c.posture?.integrity?.watched_files, "WATCHED_FILE_DRIFT", "WATCHED_FILE_REMOVED", findings, summary);
  compareHashSet(b.posture?.integrity?.release_artifacts, c.posture?.integrity?.release_artifacts, "RELEASE_ARTIFACT_DRIFT", "RELEASE_ARTIFACT_REMOVED", findings, summary);
  findings.sort((x,y)=>SEVERITY_ORDER.indexOf(x.severity)-SEVERITY_ORDER.indexOf(y.severity)||String(x.code).localeCompare(String(y.code))||String(x.path).localeCompare(String(y.path)));
  return { summary, findings };
}
export function highestSeverity(findings=[]) { return SEVERITY_ORDER.find(s => findings.some(f => f?.severity===s)) || null; }
export function severityAtOrAbove(severity, threshold) { if (!threshold || threshold === "none") return false; const a=SEVERITY_ORDER.indexOf(severity), b=SEVERITY_ORDER.indexOf(threshold); return a >= 0 && b >= 0 && a <= b; }
