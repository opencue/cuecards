#!/usr/bin/env bash
# facebook-ads-mcp-run.sh — exec the gomarble facebook-ads MCP server with the
# Meta system-user token read at exec time. The token never lands in an MCP
# config file.
set -euo pipefail
SERVER_DIR="$HOME/.config/cue/mcp-servers/facebook-ads"
TOKEN_FILE="$HOME/.config/cue/secrets/ads/meta/system-user.token"
if [ ! -s "$TOKEN_FILE" ]; then
  echo "facebook-ads-mcp: missing or empty $TOKEN_FILE — run ads-secrets-init and paste the BM system-user token" >&2
  exit 1
fi
if [ ! -x "$SERVER_DIR/.venv/bin/python" ]; then
  echo "facebook-ads-mcp: no venv at $SERVER_DIR — clone gomarble-ai/facebook-ads-mcp-server there and run 'uv venv && uv pip install -r requirements.txt'" >&2
  exit 1
fi
exec "$SERVER_DIR/.venv/bin/python" "$SERVER_DIR/server.py" --fb-token "$(cat "$TOKEN_FILE")"
