/**
 * Prompt redaction for telemetry.
 *
 * Before a user prompt is logged as part of a `skill_miss` event, run it
 * through `redactPrompt()` to:
 *   1. Mask known secret patterns (API keys, tokens, etc.) with `<redacted>`.
 *   2. Truncate to 80 chars (per locked v1 scope).
 *
 * Patterns are conservative: we'd rather mask too much than leak. False
 * positives only hurt report readability, not user privacy.
 */

const MAX_PROMPT_LENGTH = 80;

/**
 * Each pattern matches a credential-like substring. Order matters — more
 * specific patterns first so generic ones don't shadow them.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Anthropic / OpenAI / common LLM provider keys
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  // GitHub tokens (classic + fine-grained + app installation)
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // AWS access keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bASIA[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Slack tokens
  /\bxox[bpsoa]-[A-Za-z0-9-]{10,}/g,
  // Stripe
  /\b(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g,
  // npm
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  // PyPI
  /\bpypi-[A-Za-z0-9_-]{50,}/g,
  // Generic long bearer/JWT-shaped tokens (3 base64 segments separated by .)
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  // Generic 32+ char hex (catches many opaque tokens)
  /\b[a-f0-9]{32,}\b/g,
  // Bearer tokens in headers
  /\bBearer\s+[A-Za-z0-9._-]{16,}/gi,
];

/**
 * Redact secrets and truncate. Returns the safe form ready to write to the
 * telemetry log. Idempotent: running twice produces the same output.
 */
export function redactPrompt(raw: string): string {
  let s = redactSensitiveText(raw);
  // Collapse whitespace so logs stay scannable.
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > MAX_PROMPT_LENGTH) {
    s = s.slice(0, MAX_PROMPT_LENGTH - 1) + "…";
  }
  return s;
}

/** Redact credential-shaped substrings without truncating the surrounding text. */
export function redactSensitiveText(raw: string): string {
  let s = raw;
  for (const pattern of SECRET_PATTERNS) {
    s = s.replace(pattern, "<redacted>");
  }
  return s;
}

export const TELEMETRY_REDACTION_MAX_LENGTH = MAX_PROMPT_LENGTH;
