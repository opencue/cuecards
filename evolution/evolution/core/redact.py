"""Secret detection — dspy-free so the offline / analytics path imports it
without pulling DSPy.

This mirrors the pattern set in external_importers.SECRET_PATTERNS (which keeps
its own copy to avoid a heavy import there). Anchored to known key formats to
minimize false positives on normal prose. Used to drop any mined user prompt
that contains a credential before it ever enters an eval dataset.
"""

import re

SECRET_PATTERNS = re.compile(
    r"("
    r"sk-ant-api\S+"           # Anthropic API keys
    r"|sk-or-v1-\S+"          # OpenRouter API keys
    r"|sk-\S{20,}"            # Generic OpenAI-style keys
    r"|ghp_\S+|ghu_\S+|gho_\S+"  # GitHub tokens
    r"|xoxb-\S+|xapp-\S+"     # Slack tokens
    r"|ntn_\S+"               # Notion
    r"|AKIA[0-9A-Z]{16}"      # AWS access key IDs
    r"|AIza[0-9A-Za-z_\-]{20,}"  # Google API keys
    r"|Bearer\s+\S{20,}"      # Bearer tokens
    r"|-----BEGIN\s+(?:RSA\s+)?PRIVATE\sKEY-----"
    r"|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY"
    r"|SLACK_BOT_TOKEN|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|DATABASE_URL"
    r"|\bpassword\s*[=:]\s*\S+"
    r"|\bsecret\s*[=:]\s*\S+"
    r"|\btoken\s*[=:]\s*\S{10,}"
    r")",
    re.IGNORECASE,
)


def contains_secret(text: str) -> bool:
    return bool(SECRET_PATTERNS.search(text or ""))
