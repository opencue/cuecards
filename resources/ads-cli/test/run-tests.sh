#!/usr/bin/env bash
# Offline tests for resources/ads-cli. No network. Run from anywhere.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$DIR/.."
PASS=0; FAIL=0
t() { # t <name> <expected-substring> <cmd...>
  local name="$1" want="$2"; shift 2
  local out; out="$("$@" 2>&1)"
  if [[ "$out" == *"$want"* ]]; then PASS=$((PASS+1)); echo "ok  - $name";
  else FAIL=$((FAIL+1)); echo "FAIL - $name"; echo "  want: $want"; echo "  got : $out"; fi
}
t_not() { # t_not <name> <forbidden-substring> <cmd...>
  local name="$1" forbidden="$2"; shift 2
  local out; out="$("$@" 2>&1)"
  if [[ "$out" != *"$forbidden"* ]]; then PASS=$((PASS+1)); echo "ok  - $name";
  else FAIL=$((FAIL+1)); echo "FAIL - $name"; echo "  leaked: $forbidden"; fi
}

# Fixture workspaces.yaml
FIX="$(mktemp -d)"
trap 'rm -rf "$FIX"' EXIT
cat > "$FIX/workspaces.yaml" <<'YAML'
workspaces:
  acme:
    name: "Acme Kft."
    env:
      GOOGLE_ADS_CUSTOMER_ID: "${ACME_GOOGLE_ADS_CUSTOMER_ID}"
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "${AGENCY_MCC_ID}"
      GOOGLE_APPLICATION_CREDENTIALS: "$FIXDIR/agency-adc.json"
      FB_AD_ACCOUNT_ID: "${ACME_FB_AD_ACCOUNT_ID}"
      META_TOKEN_FILE: "$FIXDIR/acme.system-user.token"
YAML
touch "$FIX/agency-adc.json"
export ADS_WORKSPACES_FILE="$FIX/workspaces.yaml" FIXDIR="$FIX"
export ACME_GOOGLE_ADS_CUSTOMER_ID="123-456-7890" AGENCY_MCC_ID="999-888-7777"
export ACME_FB_AD_ACCOUNT_ID="act_42"

t "resolve strips dashes" "1234567890" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['google_customer_id'])"
t "resolve login id" "9998887777" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['login_customer_id'])"
t "resolve fb act" "act_42" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['fb_ad_account_id'])"
t "resolve prefixes bare fb id" "act_42" \
  env ACME_FB_AD_ACCOUNT_ID=42 python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['fb_ad_account_id'])"
t "resolve client Meta token" "acme.system-user.token" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['meta_token_file'])"
t "yaml path derived" "agency.google-ads.yaml" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['ads_yaml_path'])"
t "unknown client lists available" "acme" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; _adslib.resolve_client('nope')"

# --- ads-gen-yaml ---
export GOOGLE_ADS_DEVELOPER_TOKEN="devtok-TEST"
cat > "$FIX/testlogin-adc.json" <<'JSON'
{"client_id":"cid.apps.googleusercontent.com","client_secret":"csec","refresh_token":"rtok","type":"authorized_user"}
JSON
t "gen-yaml writes config" "wrote" \
  env ADS_SECRETS_DIR="$FIX" "$CLI/ads-gen-yaml" testlogin
t "gen-yaml has dev token" "devtok-TEST" cat "$FIX/testlogin.google-ads.yaml"
t "gen-yaml has refresh"   "rtok"        cat "$FIX/testlogin.google-ads.yaml"
t "gen-yaml login id"      "login_customer_id: '111'" \
  bash -c "ADS_SECRETS_DIR='$FIX' '$CLI/ads-gen-yaml' testlogin --login-customer-id 111 >/dev/null && cat '$FIX/testlogin.google-ads.yaml'"
t "gen-yaml missing adc"   "no ADC file" \
  env ADS_SECRETS_DIR="$FIX" "$CLI/ads-gen-yaml" ghost
t "gen-yaml login flag needs value" "requires a value" \
  env ADS_SECRETS_DIR="$FIX" "$CLI/ads-gen-yaml" testlogin --login-customer-id

# --- gads / fbads dry-run ---
t "gads dry-run shows account" "account=1234567890" \
  "$CLI/gads" acme "SELECT campaign.name FROM campaign" --dry-run
t "gads dry-run shows config" "agency.google-ads.yaml" \
  "$CLI/gads" acme "SELECT campaign.name FROM campaign" --dry-run
t "gads unknown client" "unknown client" "$CLI/gads" nope "SELECT 1" --dry-run
t "fbads dry-run url" "graph.facebook.com/v23.0/act_42/insights" \
  "$CLI/fbads" acme insights date_preset=last_30d --dry-run
t "fbads refuses write" "requires --write" \
  "$CLI/fbads" acme campaigns name=X --method POST --dry-run
t "fbads no act id" "FB_AD_ACCOUNT_ID" \
  bash -c "unset ACME_FB_AD_ACCOUNT_ID; '$CLI/fbads' acme insights --dry-run"
t "fbads method needs value" "requires a value" \
  "$CLI/fbads" acme insights --method
t "fbads rejects bare param" "expected key=value" \
  "$CLI/fbads" acme insights level --dry-run
t "fbads redacts response token fields" '"access_token": "***"' \
  python3 -c "import json,runpy; f=runpy.run_path('$CLI/fbads')['redact_response']; print(json.dumps(f({'access_token':'secret-value'})))"
t "fbads redacts paging next tokens" "access_token=%2A%2A%2A" \
  python3 -c "import json,runpy; f=runpy.run_path('$CLI/fbads')['redact_response']; print(json.dumps(f({'paging':{'next':'https://graph.facebook.com/next?after=x&access_token=secret-value'}})))"
t_not "fbads response contains no raw token" "secret-value" \
  python3 -c "import json,runpy; f=runpy.run_path('$CLI/fbads')['redact_response']; print(json.dumps(f({'access_token':'secret-value','paging':{'next':'https://graph.facebook.com/next?after=x&access_token=secret-value'}})))"

echo "----"; echo "pass=$PASS fail=$FAIL"; [ "$FAIL" -eq 0 ]
