#!/usr/bin/env bash
set -euo pipefail

# Sandbox regression test for hermes-attestation-guardian using an isolated Docker Hermes instance.
#
# Usage:
#   skills/hermes-attestation-guardian/test/hermes_attestation_sandbox_regression.sh
#
# Optional env overrides:
#   IMAGE=python:3.11-slim
#   HERMES_AGENT_SRC=/home/davida/.hermes/hermes-agent
#   SKILL_SRC=/home/davida/clawsec/skills/hermes-attestation-guardian
#   WELL_KNOWN_PORT=8765

IMAGE="${IMAGE:-python:3.11-slim}"
HERMES_AGENT_SRC="${HERMES_AGENT_SRC:-$HOME/.hermes/hermes-agent}"
SKILL_SRC="${SKILL_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
WELL_KNOWN_PORT="${WELL_KNOWN_PORT:-8765}"
SKILL_VERSION="${SKILL_VERSION:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("version", "0.0.2"))' "$SKILL_SRC/skill.json")}"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required." >&2
  exit 1
fi
if [[ ! -d "$HERMES_AGENT_SRC" ]]; then
  echo "ERROR: HERMES_AGENT_SRC not found: $HERMES_AGENT_SRC" >&2
  exit 1
fi
if [[ ! -d "$SKILL_SRC" ]]; then
  echo "ERROR: SKILL_SRC not found: $SKILL_SRC" >&2
  exit 1
fi

echo "[sandbox] image=$IMAGE"
echo "[sandbox] hermes-agent-src=$HERMES_AGENT_SRC"
echo "[sandbox] skill-src=$SKILL_SRC"
echo "[sandbox] skill-version=$SKILL_VERSION"

# shellcheck disable=SC2140,SC1078
# Rationale: Docker inner script is intentionally embedded as a single quoted payload
# for `bash -lc` so variables expand inside the container runtime (not on host).
docker run --rm \
  -e HOME=/tmp/hermes-sandbox-home \
  -e HERMES_HOME=/tmp/hermes-sandbox-home \
  -e SKILL_VERSION="$SKILL_VERSION" \
  -v "$HERMES_AGENT_SRC":/opt/hermes-agent:ro \
  -v "$SKILL_SRC":/opt/skill-src:ro \
  "$IMAGE" bash -lc "
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update >/dev/null
apt-get install -y --no-install-recommends openssl ca-certificates curl nodejs npm zip >/dev/null

cp -a /opt/hermes-agent /tmp/hermes-agent-src
python -m pip install --no-cache-dir /tmp/hermes-agent-src >/tmp/pip-install.log 2>&1
mkdir -p \"\$HOME\"

echo \"INSIDE_HOME=\$HOME\"
echo \"INSIDE_HERMES_HOME=\$HERMES_HOME\"

mkdir -p /tmp/well/.well-known/skills/hermes-attestation-guardian
cp /opt/skill-src/SKILL.md /opt/skill-src/README.md /opt/skill-src/CHANGELOG.md /opt/skill-src/skill.json /tmp/well/.well-known/skills/hermes-attestation-guardian/
cp -a /opt/skill-src/lib /opt/skill-src/scripts /tmp/well/.well-known/skills/hermes-attestation-guardian/
python3 - <<'PY'
import os,json
root='/tmp/well/.well-known/skills'
sk='hermes-attestation-guardian'
base=os.path.join(root,sk)
files=[]
for dp,_,fns in os.walk(base):
  for fn in fns:
    files.append(os.path.relpath(os.path.join(dp,fn),base).replace('\\\\','/'))
idx={'generated_at':'2026-04-16T00:00:00Z','skills':[{'name':sk,'version':os.environ.get('SKILL_VERSION','0.0.2'),'description':'sandbox feature test','path':f'.well-known/skills/{sk}','files':sorted(files)}]}
with open(os.path.join(root,'index.json'),'w') as f: json.dump(idx,f)
PY
python3 -m http.server $WELL_KNOWN_PORT --directory /tmp/well >/tmp/http.log 2>&1 &
HPID=\$!
sleep 1

SKILL_ZIP=/tmp/hermes-attestation-guardian.zip
(
  cd /tmp/well/.well-known/skills
  zip -qr "\$SKILL_ZIP" hermes-attestation-guardian
)
ZIP_SHA=\$(sha256sum "\$SKILL_ZIP" | awk '{print \$1}')
cat > /tmp/checksums.json <<EOF
{"archive":{"name":"hermes-attestation-guardian.zip","sha256":"\$ZIP_SHA"}}
EOF
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/release-sign.key >/dev/null 2>&1
openssl pkey -in /tmp/release-sign.key -pubout -out /tmp/signing-public.pem >/dev/null 2>&1
openssl pkeyutl -sign -rawin -inkey /tmp/release-sign.key -in /tmp/checksums.json -out /tmp/checksums.sig.bin
openssl base64 -A -in /tmp/checksums.sig.bin -out /tmp/checksums.sig

PINNED_RELEASE_PUBKEY_SHA256=\$(openssl pkey -pubin -in /tmp/signing-public.pem -outform DER | sha256sum | awk '{print \$1}')
[ -s /tmp/checksums.json ]
[ -s /tmp/checksums.sig ]
ACTUAL_RELEASE_PUBKEY_SHA256=\$(openssl pkey -pubin -in /tmp/signing-public.pem -outform DER | sha256sum | awk '{print \$1}')
[ "\$ACTUAL_RELEASE_PUBKEY_SHA256" = "\$PINNED_RELEASE_PUBKEY_SHA256" ]
openssl base64 -d -A -in /tmp/checksums.sig -out /tmp/checksums.sig.verify.bin
openssl pkeyutl -verify -rawin -pubin -inkey /tmp/signing-public.pem -sigfile /tmp/checksums.sig.verify.bin -in /tmp/checksums.json >/dev/null
EXPECTED_ZIP_SHA="\$ZIP_SHA"
ACTUAL_ZIP_SHA=\$(sha256sum "\$SKILL_ZIP" | awk '{print \$1}')
[ "\$EXPECTED_ZIP_SHA" = "\$ACTUAL_ZIP_SHA" ]

set +e
INSTALL_OUT=\$(hermes skills install \"well-known:http://127.0.0.1:$WELL_KNOWN_PORT/.well-known/skills/hermes-attestation-guardian\" --yes 2>&1)
INSTALL_CODE=\$?
set -e
echo \"\$INSTALL_OUT\"

INSTALL_SAFE_ALLOWED=0
INSTALL_FORCE_OVERRIDE=0
if [ \"\$INSTALL_CODE\" -eq 0 ] && echo \"\$INSTALL_OUT\" | grep -q \"Decision: ALLOWED\"; then
  INSTALL_SAFE_ALLOWED=1
else
  echo \"[sandbox] install without --force was not ALLOWED; retrying with --force for feature regression coverage\" >&2
  set +e
  INSTALL_FORCE_OUT=\$(hermes skills install \"well-known:http://127.0.0.1:$WELL_KNOWN_PORT/.well-known/skills/hermes-attestation-guardian\" --yes --force 2>&1)
  INSTALL_FORCE_CODE=\$?
  set -e
  echo \"\$INSTALL_FORCE_OUT\"
  [ \"\$INSTALL_FORCE_CODE\" -eq 0 ]
  INSTALL_FORCE_OVERRIDE=1
fi

SKILL_DIR=\"\$HERMES_HOME/skills/hermes-attestation-guardian\"
mkdir -p \"\$HERMES_HOME/security/attestations\"
echo \"alpha\" > /tmp/watch.txt
echo \"anchor-v1\" > /tmp/anchor.pem
cat > /tmp/policy.json <<EOF
{\"watch_files\": [\"/tmp/watch.txt\"], \"trust_anchor_files\": [\"/tmp/anchor.pem\"]}
EOF

node \"\$SKILL_DIR/scripts/generate_attestation.mjs\" --output \"\$HERMES_HOME/security/attestations/current.json\" --policy /tmp/policy.json --generated-at 2026-04-16T00:00:00.000Z --write-sha256 >/tmp/generate.log
DIGEST=\$(cut -d\" \" -f1 \"\$HERMES_HOME/security/attestations/current.json.sha256\")
node \"\$SKILL_DIR/scripts/verify_attestation.mjs\" --input \"\$HERMES_HOME/security/attestations/current.json\" --expected-sha256 \"\$DIGEST\" >/tmp/verify-ok.log

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /tmp/sign.key >/dev/null 2>&1
openssl pkey -in /tmp/sign.key -pubout -out /tmp/sign.pub.pem >/dev/null 2>&1
openssl dgst -sha256 -sign /tmp/sign.key -out /tmp/current.sig \"\$HERMES_HOME/security/attestations/current.json\"
node \"\$SKILL_DIR/scripts/verify_attestation.mjs\" --input \"\$HERMES_HOME/security/attestations/current.json\" --signature /tmp/current.sig --public-key /tmp/sign.pub.pem >/tmp/verify-sig.log

cp \"\$HERMES_HOME/security/attestations/current.json\" \"\$HERMES_HOME/security/attestations/baseline.json\"
BASE_SHA=\$(sha256sum \"\$HERMES_HOME/security/attestations/baseline.json\" | cut -d\" \" -f1)
echo \"beta\" > /tmp/watch.txt
echo \"anchor-v2\" > /tmp/anchor.pem
node \"\$SKILL_DIR/scripts/generate_attestation.mjs\" --output \"\$HERMES_HOME/security/attestations/current.json\" --policy /tmp/policy.json --generated-at 2026-04-16T00:10:00.000Z >/tmp/generate-drift.log
set +e
DRIFT_OUT=\$(node \"\$SKILL_DIR/scripts/verify_attestation.mjs\" --input \"\$HERMES_HOME/security/attestations/current.json\" --baseline \"\$HERMES_HOME/security/attestations/baseline.json\" --baseline-expected-sha256 \"\$BASE_SHA\" --fail-on-severity critical 2>&1)
DRIFT_CODE=\$?
set -e
[ \"\$DRIFT_CODE\" -ne 0 ]
echo \"\$DRIFT_OUT\" | grep -Eq \"WATCHED_FILE_DRIFT|TRUST_ANCHOR_MISMATCH\"

node \"\$SKILL_DIR/scripts/setup_attestation_cron.mjs\" --every 6h --print-only > /tmp/cron-preview.log
grep -q \"Preflight review:\" /tmp/cron-preview.log
grep -q \"# >>> hermes-attestation-guardian >>>\" /tmp/cron-preview.log

# Phase 1/2/3 feature coverage: signed advisory feed verify + guarded gating + advisory scheduler helper
cat > /tmp/feed.json <<EOF
{\"version\":\"1.0.0\",\"updated\":\"2026-04-20T00:00:00Z\",\"advisories\":[{\"id\":\"CLAW-TEST-0001\",\"severity\":\"high\",\"title\":\"Test advisory\",\"affected\":[\"hermes-attestation-guardian@${SKILL_VERSION}\"],\"action\":\"Do not install without explicit acknowledgement\"}]}
EOF

node - <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const feedRaw = fs.readFileSync('/tmp/feed.json', 'utf8');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const sig = crypto.sign(null, Buffer.from(feedRaw, 'utf8'), privateKey).toString('base64');
fs.writeFileSync('/tmp/feed.json.sig', sig + '\n');
fs.writeFileSync('/tmp/feed-signing-public.pem', publicKey.export({type:'spki', format:'pem'}));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const checksums = {
  files: {
    'feed.json': sha(feedRaw),
    'feed.json.sig': sha(fs.readFileSync('/tmp/feed.json.sig', 'utf8'))
  }
};
const checksumsRaw = JSON.stringify(checksums);
fs.writeFileSync('/tmp/checksums-feed.json', checksumsRaw + '\n');
const csumSig = crypto.sign(null, Buffer.from(checksumsRaw + '\n', 'utf8'), privateKey).toString('base64');
fs.writeFileSync('/tmp/checksums-feed.json.sig', csumSig + '\n');
NODE

export HERMES_ADVISORY_FEED_SOURCE=local
export HERMES_LOCAL_ADVISORY_FEED=/tmp/feed.json
export HERMES_LOCAL_ADVISORY_FEED_SIG=/tmp/feed.json.sig
export HERMES_LOCAL_ADVISORY_FEED_CHECKSUMS=/tmp/checksums-feed.json
export HERMES_LOCAL_ADVISORY_FEED_CHECKSUMS_SIG=/tmp/checksums-feed.json.sig
export HERMES_ADVISORY_FEED_PUBLIC_KEY=/tmp/feed-signing-public.pem

node \"\$SKILL_DIR/scripts/refresh_advisory_feed.mjs\" > /tmp/refresh-advisory.log
grep -q \"\\\"status\\\":\\\"verified\\\"\" /tmp/refresh-advisory.log
node \"\$SKILL_DIR/scripts/check_advisories.mjs\" > /tmp/check-advisories.log
grep -q \"Feed verification state: verified\" /tmp/check-advisories.log

if node \"\$SKILL_DIR/scripts/guarded_skill_verify.mjs\" --skill hermes-attestation-guardian --version "\$SKILL_VERSION" > /tmp/guarded-no-confirm.log 2>&1; then
  GUARD_CODE=0
else
  GUARD_CODE=\$?
fi
[ \"\$GUARD_CODE\" -eq 42 ]
grep -q \"Advisory matches detected\" /tmp/guarded-no-confirm.log

node \"\$SKILL_DIR/scripts/guarded_skill_verify.mjs\" --skill hermes-attestation-guardian --version "\$SKILL_VERSION" --confirm-advisory > /tmp/guarded-confirm.log 2>&1
grep -q \"Advisory feed status: verified\" /tmp/guarded-confirm.log

node \"\$SKILL_DIR/scripts/setup_advisory_check_cron.mjs\" --every 6h --skill hermes-attestation-guardian --version "\$SKILL_VERSION" --print-only > /tmp/advisory-cron-preview.log
grep -q \"Preflight review:\" /tmp/advisory-cron-preview.log
grep -q \"# >>> hermes-attestation-guardian-advisory-check >>>\" /tmp/advisory-cron-preview.log
grep -q \"guarded_skill_verify.mjs\" /tmp/advisory-cron-preview.log

echo \"=== SANDBOX FEATURE TEST SUMMARY ===\"
if [ \"\$INSTALL_SAFE_ALLOWED\" -eq 1 ]; then
  echo \"install_safe_allowed=PASS\"
else
  echo \"install_safe_allowed=BLOCKED\"
fi
if [ \"\$INSTALL_FORCE_OVERRIDE\" -eq 1 ]; then
  echo \"install_force_override=PASS\"
fi
echo \"release_verify_triad=PASS\"
echo \"generate_with_policy=PASS\"
echo \"verify_expected_sha=PASS\"
echo \"verify_signature=PASS\"
echo \"baseline_drift_fail_closed=PASS\"
echo \"scheduler_preview=PASS\"
echo \"advisory_feed_refresh_verified=PASS\"
echo \"advisory_feed_status_report=PASS\"
echo \"guarded_verify_requires_confirm=PASS\"
echo \"guarded_verify_confirm_override=PASS\"
echo \"advisory_scheduler_preview=PASS\"

kill \$HPID >/dev/null 2>&1 || true
wait \$HPID 2>/dev/null || true
"

echo "[sandbox] completed successfully"