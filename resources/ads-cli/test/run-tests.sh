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
t "yaml path derived" "agency.google-ads.yaml" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; print(_adslib.resolve_client('acme')['ads_yaml_path'])"
t "unknown client lists available" "acme" \
  python3 -c "import sys; sys.path.insert(0,'$CLI'); import _adslib; _adslib.resolve_client('nope')"

echo "----"; echo "pass=$PASS fail=$FAIL"; [ "$FAIL" -eq 0 ]
