function add(findings, severity, code, title, evidence, recommendation) { findings.push({ severity, code, title, evidence, recommendation }); }
export function runPicoclawSelfPenTest(profile, _options = {}) {
  const findings=[]; const rt=profile?.posture?.runtime || {};
  if (rt.ui?.public_web_ui) add(findings,"critical","PUBLIC_WEB_UI_EXPOSED","Web UI appears bound publicly","public_web_ui=true or equivalent detected","Bind to localhost or enforce password auth + CIDR allowlist before exposure.");
  if (rt.ui?.auth_disabled) add(findings,"critical","WEB_UI_AUTH_DISABLED","Web UI auth appears disabled","auth_disabled=true or empty password marker detected","Require password/session auth for any gateway controller UI.");
  if (rt.tools?.unrestricted_workspace) add(findings,"critical","WORKSPACE_UNRESTRICTED","Tool workspace restriction appears disabled","restrict_to_workspace=false or sandbox=false marker detected","Enable workspace confinement and deny symlink/absolute-path escapes.");
  if (rt.risky_toggles?.allow_unsigned_mode) add(findings,"critical","UNSIGNED_MODE_ALLOWED","Unsigned or insecure verification mode appears enabled","allow_unsigned/skip_signature marker detected","Disable unsigned mode except short audited break-glass windows.");
  if (rt.mcp?.enabled) add(findings,"high","MCP_REVIEW_REQUIRED","MCP servers enabled","mcp marker detected","Review each MCP server as a separate trust boundary with least privilege and secrets isolation.");
  if (rt.tools?.enabled) add(findings,"medium","TOOLING_REVIEW_REQUIRED","Agent tools appear enabled","tools/code_execution/shell/filesystem marker detected","Require per-tool allowlists and operator approval for dangerous tools.");
  if (rt.scheduler?.enabled) add(findings,"medium","SCHEDULER_REVIEW_REQUIRED","Scheduler/persistence features appear enabled","cron/schedule marker detected","Inventory jobs and alert on new persistent actions.");
  if ((rt.secrets?.config_secret_markers || 0) > 0) add(findings,"high","PLAINTEXT_SECRET_MARKERS","Config contains secret-like markers",`${rt.secrets.config_secret_markers} marker(s) found`,`Move secrets to supported encrypted/secure storage and redact logs/exports.`);
  const enabledGateways = Object.entries(rt.gateways || {}).filter(([,v])=>!!v).map(([k])=>k);
  if (enabledGateways.length > 1) add(findings,"medium","MULTI_CHANNEL_AUTH_REVIEW","Multiple chat gateways appear enabled",enabledGateways.join(", "),"Pin immutable user IDs per channel and reject group/forwarded-message ambiguity.");
  return { summary: summarize(findings), findings };
}
function summarize(findings) { const out={critical:0, high:0, medium:0, low:0, info:0}; for (const f of findings) out[f.severity]=(out[f.severity]||0)+1; return out; }
