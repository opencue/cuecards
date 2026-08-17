#!/usr/bin/env bash
set -euo pipefail

# Picoclaw-oriented sandbox regression for picoclaw-security-guardian.
#
# This is deliberately NOT a Hermes install test. It boots a disposable Docker
# sandbox, mounts a Picoclaw source tree, publishes this skill through a local
# ClawHub-compatible registry, installs it with Picoclaw's own install_skill tool,
# verifies Picoclaw's skill loader can see/load it, then runs the installed copy's
# Picoclaw security workflows against an isolated PICOCLAW_HOME.
#
# Usage from the ClawSec repo root:
#   skills/picoclaw-security-guardian/test/picoclaw_security_guardian_sandbox_regression.sh
#
# Optional env overrides:
#   IMAGE=golang:1.25-bookworm
#   PICOCLAW_SRC=/home/davida/picoclaw_research/picoclaw
#   SKILL_SRC=/home/davida/clawsec/skills/picoclaw-security-guardian
#   CLAWHUB_PORT=8767

IMAGE="${IMAGE:-golang:1.25-bookworm}"
PICOCLAW_SRC="${PICOCLAW_SRC:-$HOME/picoclaw_research/picoclaw}"
SKILL_SRC="${SKILL_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CLAWHUB_PORT="${CLAWHUB_PORT:-8767}"
SKILL_VERSION="${SKILL_VERSION:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$SKILL_SRC/skill.json")}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required." >&2
  exit 1
fi
if [[ ! -d "$PICOCLAW_SRC" ]]; then
  echo "ERROR: PICOCLAW_SRC not found: $PICOCLAW_SRC" >&2
  exit 1
fi
if [[ ! -f "$PICOCLAW_SRC/go.mod" ]]; then
  echo "ERROR: PICOCLAW_SRC does not look like a Picoclaw Go module: $PICOCLAW_SRC" >&2
  exit 1
fi
if [[ ! -d "$SKILL_SRC" ]]; then
  echo "ERROR: SKILL_SRC not found: $SKILL_SRC" >&2
  exit 1
fi

echo "[sandbox] image=$IMAGE"
echo "[sandbox] picoclaw-src=$PICOCLAW_SRC"
echo "[sandbox] skill-src=$SKILL_SRC"
echo "[sandbox] skill-version=$SKILL_VERSION"

docker run --rm \
  -e HOME=/tmp/picoclaw-user-home \
  -e PICOCLAW_HOME=/tmp/picoclaw-instance-home \
  -e PICOCLAW_WORKSPACE=/tmp/picoclaw-workspace \
  -e SKILL_VERSION="$SKILL_VERSION" \
  -e CLAWHUB_PORT="$CLAWHUB_PORT" \
  -v "$PICOCLAW_SRC":/opt/picoclaw-src:ro \
  -v "$SKILL_SRC":/opt/skill-src:ro \
  "$IMAGE" bash -lc '
set -euo pipefail
export PATH="/usr/local/go/bin:$PATH"
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends ca-certificates curl nodejs npm openssl zip >/dev/null

mkdir -p "$HOME" "$PICOCLAW_HOME/security/clawsec" "$PICOCLAW_WORKSPACE" /tmp/clawhub /tmp/registry-src

echo "INSIDE_HOME=$HOME"
echo "INSIDE_PICOCLAW_HOME=$PICOCLAW_HOME"
echo "INSIDE_PICOCLAW_WORKSPACE=$PICOCLAW_WORKSPACE"

# Build a ClawHub-style archive with SKILL.md at the archive root, because
# Picoclaw extracts registry ZIPs directly into workspace/skills/<slug>/.
cp /opt/skill-src/SKILL.md /opt/skill-src/README.md /opt/skill-src/CHANGELOG.md /opt/skill-src/skill.json /tmp/registry-src/
cp -a /opt/skill-src/lib /opt/skill-src/scripts /tmp/registry-src/
(
  cd /tmp/registry-src
  zip -qr /tmp/clawhub/picoclaw-security-guardian.zip .
)

ZIP_SHA=$(sha256sum /tmp/clawhub/picoclaw-security-guardian.zip | awk "{print \$1}")
cat > /tmp/checksums.json <<EOF
{"files":{"picoclaw-security-guardian.zip":{"sha256":"$ZIP_SHA"}}}
EOF
openssl genpkey -algorithm ed25519 -out /tmp/release-sign.key >/dev/null 2>&1
openssl pkey -in /tmp/release-sign.key -pubout -out /tmp/signing-public.pem >/dev/null 2>&1
node - <<"NODE"
const crypto = require("node:crypto");
const fs = require("node:fs");
const privateKey = crypto.createPrivateKey(fs.readFileSync("/tmp/release-sign.key"));
const manifestBytes = fs.readFileSync("/tmp/checksums.json");
fs.writeFileSync("/tmp/checksums.json.sig", crypto.sign(null, manifestBytes, privateKey).toString("base64") + "\n");
NODE

# Release artifact verification preflight: checksum + detached Ed25519 signature.
node /opt/skill-src/scripts/verify_supply_chain.mjs \
  --artifact /tmp/clawhub/picoclaw-security-guardian.zip \
  --checksums /tmp/checksums.json \
  --signature /tmp/checksums.json.sig \
  --public-key /tmp/signing-public.pem >/tmp/release-verify.log

cat > /tmp/clawhub_server.py <<"PY"
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SKILL = "picoclaw-security-guardian"
VERSION = os.environ["SKILL_VERSION"]
ZIP_PATH = "/tmp/clawhub/picoclaw-security-guardian.zip"
SUMMARY = "Picoclaw security posture checks: advisory awareness, config drift, and supply-chain verification."

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def send_json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/search":
            self.send_json({"results": [{"score": 1.0, "slug": SKILL, "displayName": "Picoclaw Security Guardian", "summary": SUMMARY, "version": VERSION}]})
            return
        if parsed.path == f"/api/v1/skills/{SKILL}":
            self.send_json({"slug": SKILL, "displayName": "Picoclaw Security Guardian", "summary": SUMMARY, "latestVersion": {"version": VERSION}, "moderation": {"isMalwareBlocked": False, "isSuspicious": False}})
            return
        if parsed.path == "/api/v1/download":
            qs = parse_qs(parsed.query)
            if qs.get("slug", [""])[0] != SKILL:
                self.send_error(404, "unknown skill")
                return
            data = open(ZIP_PATH, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_error(404, "not found")

ThreadingHTTPServer(("127.0.0.1", int(os.environ["CLAWHUB_PORT"])), Handler).serve_forever()
PY
python3 /tmp/clawhub_server.py >/tmp/clawhub.log 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID >/dev/null 2>&1 || true; wait $SERVER_PID 2>/dev/null || true" EXIT
REGISTRY_READY=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$CLAWHUB_PORT/api/v1/skills/picoclaw-security-guardian" >/dev/null; then
    REGISTRY_READY=1
    break
  fi
  sleep 0.2
done
if [ "$REGISTRY_READY" -ne 1 ]; then
  echo "ERROR: local ClawHub-compatible registry did not become ready" >&2
  cat /tmp/clawhub.log >&2 || true
  exit 1
fi

# Exercise Picoclaw itself: registry search -> install_skill -> skill loader.
cat > /tmp/picoclaw_skill_harness.go <<"GO"
package main

import (
    "context"
    "fmt"
    "os"
    "path/filepath"
    "strings"
    "time"

    "github.com/sipeed/picoclaw/pkg/skills"
    integrationtools "github.com/sipeed/picoclaw/pkg/tools/integration"
)

func must(ok bool, msg string, args ...any) {
    if !ok {
        fmt.Fprintf(os.Stderr, msg+"\n", args...)
        os.Exit(1)
    }
}

func main() {
    workspace := os.Getenv("PICOCLAW_WORKSPACE")
    baseURL := "http://127.0.0.1:" + os.Getenv("CLAWHUB_PORT")
    version := os.Getenv("SKILL_VERSION")

    registryMgr := skills.NewRegistryManager()
    registryMgr.AddRegistry(skills.NewClawHubRegistry(skills.ClawHubConfig{Enabled: true, BaseURL: baseURL, Timeout: 10}))

    findTool := integrationtools.NewFindSkillsTool(registryMgr, skills.NewSearchCache(50, 5*time.Minute))
    findResult := findTool.Execute(context.Background(), map[string]any{"query": "picoclaw security", "limit": float64(5)})
    fmt.Println(findResult.ForLLM)
    must(!findResult.IsError, "find_skills failed: %s", findResult.ForLLM)
    must(strings.Contains(findResult.ForLLM, "picoclaw-security-guardian"), "find_skills did not return picoclaw-security-guardian")

    installTool := integrationtools.NewInstallSkillTool(registryMgr, workspace)
    installResult := installTool.Execute(context.Background(), map[string]any{
        "slug": "picoclaw-security-guardian",
        "registry": "clawhub",
        "version": version,
    })
    fmt.Println(installResult.ForLLM)
    must(!installResult.IsError, "install_skill failed: %s", installResult.ForLLM)
    must(strings.Contains(installResult.ForLLM, "Successfully installed skill"), "install_skill did not report success")

    installed := filepath.Join(workspace, "skills", "picoclaw-security-guardian")
    for _, rel := range []string{"SKILL.md", "skill.json", "scripts/generate_profile.mjs", "scripts/check_drift.mjs", "scripts/check_advisories.mjs", "scripts/verify_supply_chain.mjs"} {
        if _, err := os.Stat(filepath.Join(installed, rel)); err != nil {
            fmt.Fprintf(os.Stderr, "missing installed file %s: %v\n", rel, err)
            os.Exit(1)
        }
    }

    loader := skills.NewSkillsLoader(workspace, filepath.Join(os.Getenv("PICOCLAW_HOME"), "skills"), "")
    found := false
    for _, skill := range loader.ListSkills() {
        if skill.Name == "picoclaw-security-guardian" && skill.Source == "workspace" {
            found = true
            break
        }
    }
    must(found, "Picoclaw SkillsLoader did not list installed picoclaw-security-guardian workspace skill")
    content, ok := loader.LoadSkill("picoclaw-security-guardian")
    must(ok, "Picoclaw SkillsLoader could not load installed skill content")
    must(strings.Contains(content, "Picoclaw Security Guardian"), "loaded skill content is not Picoclaw Security Guardian")

    fmt.Println("picoclaw_find_skill=PASS")
    fmt.Println("picoclaw_install_skill=PASS")
    fmt.Println("picoclaw_skill_loader=PASS")
}
GO
(
  cd /opt/picoclaw-src
  go run /tmp/picoclaw_skill_harness.go >/tmp/picoclaw-install.log
)
cat /tmp/picoclaw-install.log

SKILL_DIR="$PICOCLAW_WORKSPACE/skills/picoclaw-security-guardian"

# Use Picoclaw-native config paths and shapes: config.json + launcher-config.json.
cat > "$PICOCLAW_HOME/config.json" <<EOF
{
  "version": 3,
  "agents": {
    "defaults": {
      "workspace": "$PICOCLAW_WORKSPACE",
      "restrict_to_workspace": true,
      "model_name": "sandbox-model"
    }
  },
  "tools": {
    "exec": {"enabled": false},
    "cron": {"enabled": false},
    "find_skills": {"enabled": true},
    "install_skill": {"enabled": true}
  }
}
EOF
cat > "$PICOCLAW_HOME/launcher-config.json" <<EOF
{
  "port": 18800,
  "public": false,
  "allowed_cidrs": ["127.0.0.1/32"],
  "dashboard_password_hash": "argon2id-test-hash"
}
EOF

node "$SKILL_DIR/scripts/generate_profile.mjs" \
  --home "$PICOCLAW_HOME" \
  --output "$PICOCLAW_HOME/security/clawsec/baseline-profile.json" \
  --generated-at 2026-04-25T00:00:00.000Z >/tmp/profile-baseline.log

cp "$PICOCLAW_HOME/security/clawsec/baseline-profile.json" "$PICOCLAW_HOME/security/clawsec/current-profile.json"
node "$SKILL_DIR/scripts/check_drift.mjs" \
  --baseline "$PICOCLAW_HOME/security/clawsec/baseline-profile.json" \
  --current "$PICOCLAW_HOME/security/clawsec/current-profile.json" \
  --fail-on critical >/tmp/drift-clean.log

cat > "$PICOCLAW_HOME/config.json" <<EOF
{
  "version": 3,
  "agents": {
    "defaults": {
      "workspace": "/",
      "restrict_to_workspace": false,
      "allow_read_outside_workspace": true,
      "model_name": "sandbox-model"
    }
  },
  "tools": {
    "exec": {"enabled": true, "allow_remote": true},
    "cron": {"enabled": true, "allow_command": true},
    "mcp": {
      "enabled": true,
      "servers": {
        "dangerous-local": {"command": "node", "args": ["server.js"]}
      }
    },
    "web": {"brave": {"enabled": true, "api_keys": ["test-secret-value"]}}
  }
}
EOF
cat > "$PICOCLAW_HOME/launcher-config.json" <<EOF
{
  "port": 18800,
  "public": true,
  "allowed_cidrs": ["0.0.0.0/0"],
  "dashboard_password_hash": ""
}
EOF
node "$SKILL_DIR/scripts/generate_profile.mjs" \
  --home "$PICOCLAW_HOME" \
  --output "$PICOCLAW_HOME/security/clawsec/current-profile.json" \
  --generated-at 2026-04-25T00:10:00.000Z >/tmp/profile-current.log

set +e
DRIFT_OUT=$(node "$SKILL_DIR/scripts/check_drift.mjs" \
  --baseline "$PICOCLAW_HOME/security/clawsec/baseline-profile.json" \
  --current "$PICOCLAW_HOME/security/clawsec/current-profile.json" \
  --fail-on critical 2>&1)
DRIFT_CODE=$?
set -e
[ "$DRIFT_CODE" -ne 0 ]
echo "$DRIFT_OUT" | grep -Eq "PUBLIC_WEB_UI_ENABLED|WEB_UI_AUTH_DISABLED|WORKSPACE_RESTRICTION_DISABLED"

cat > /tmp/picoclaw-feed.json <<EOF
{"version":"1.0.0","updated":"2026-04-25T00:00:00Z","advisories":[{"id":"CLAW-PICO-TEST","severity":"high","type":"prompt_injection","platforms":["picoclaw"],"affected":["picoclaw-security-guardian@$SKILL_VERSION"],"title":"Picoclaw test advisory","description":"Picoclaw gateway review","published":"2026-04-25T00:00:00Z","action":"Review before release"}]}
EOF
cat > /tmp/feed-state-unknown.json <<EOF
{"status":"unknown"}
EOF
set +e
ADVISORY_UNKNOWN_OUT=$(node "$SKILL_DIR/scripts/check_advisories.mjs" --feed /tmp/picoclaw-feed.json --state /tmp/feed-state-unknown.json 2>&1)
ADVISORY_UNKNOWN_CODE=$?
set -e
if [ "$ADVISORY_UNKNOWN_CODE" -eq 0 ]; then
  echo "ERROR: advisory check unexpectedly allowed unknown feed state" >&2
  exit 1
fi
echo "$ADVISORY_UNKNOWN_OUT" | grep -q "advisory feed state is not verified"
cat > /tmp/feed-state-verified.json <<EOF
{"status":"verified"}
EOF
node "$SKILL_DIR/scripts/check_advisories.mjs" --feed /tmp/picoclaw-feed.json --state /tmp/feed-state-verified.json >/tmp/advisory-verified.log
grep -q "CLAW-PICO-TEST" /tmp/advisory-verified.log

node "$SKILL_DIR/scripts/verify_supply_chain.mjs" \
  --artifact /tmp/clawhub/picoclaw-security-guardian.zip \
  --checksums /tmp/checksums.json \
  --signature /tmp/checksums.json.sig \
  --public-key /tmp/signing-public.pem >/tmp/installed-supply-chain.log

echo "=== PICOCLAW SANDBOX FEATURE TEST SUMMARY ==="
echo "picoclaw_find_skill=PASS"
echo "picoclaw_install_skill=PASS"
echo "picoclaw_skill_loader=PASS"
echo "release_verify_triad=PASS"
echo "generate_profile=PASS"
echo "picoclaw_json_config_detection=PASS"
echo "clean_drift_pass=PASS"
echo "baseline_drift_fail_closed=PASS"
echo "advisory_unknown_state_fail_closed=PASS"
echo "advisory_verified_filter=PASS"
echo "installed_supply_chain_verify=PASS"
echo "[sandbox] completed successfully"
'
