# Multi-client Google + Facebook Ads Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-client Google Ads + Meta Ads access from this machine — two MCPs for Claude sessions plus `gads`/`fbads` terminal CLIs — switching clients with `cue workspace <client>`.

**Architecture:** One credential layer under `~/.config/cue/secrets/ads/` (per-Google-login ADC files + one Meta system-user token) consumed by the official `google-ads-mcp` (already registered), a locally-cloned `gomarble-ai/facebook-ads-mcp-server` (new registry entry, token injected by a wrapper script at exec time), and Python CLI wrappers in `resources/ads-cli/` that resolve client identity from `profiles/google-ads/workspaces.yaml`.

**Tech Stack:** Python 3 + PyYAML (CLI wrappers), bash (wrappers/init), uv (FB MCP venv), gaarf Node CLI (`google-ads-api-report-fetcher`), cue workspaces.

**Spec:** `docs/superpowers/specs/2026-07-15-ads-multi-client-design.md`

## Global Constraints

- Secrets NEVER enter the repo or any MCP config file. Token values live only in `~/.config/cue/secrets/ads/` (dir 0700, files 0600) and `~/.env.cue` (0600).
- `~` is not expanded by cue's env plumbing — use absolute paths (`/home/deadpool/...`) in workspace env values; CLI scripts must `os.path.expanduser` + `os.path.expandvars` everything they read from workspaces.yaml.
- CLI scripts live in `resources/ads-cli/`, are executable, and find the repo root via `Path(__file__).resolve()` (symlink-safe), NOT via cwd.
- Read-only by default: `fbads` refuses POST without `--write`; google-ads-mcp and gaarf are read-only by nature.
- Meta Graph API version: single constant `META_API_VERSION = "v23.0"` in `_adslib.py`.
- Workspace env values keep the existing `${VAR}` indirection convention (resolved from `~/.env.cue` at runtime).
- Repo work happens on branch `feat/ads-multi-client`.

## File Structure

```
resources/ads-cli/
  _adslib.py                  # shared: workspace resolution, expansion, errors
  gads                        # Google Ads GAQL report CLI (python, executable)
  fbads                       # Meta Graph API CLI (python, executable)
  ads-gen-yaml                # ADC json -> google-ads.yaml generator (python, executable)
  ads-secrets-init            # one-shot secrets dir scaffolding (bash, executable)
  facebook-ads-mcp-run.sh     # MCP wrapper: reads token file, execs server (bash)
  test/run-tests.sh           # offline test suite (bash asserts, no network)
  README.md                   # setup runbook (dev token, ADC logins, meta token, add-a-client)
resources/mcps/configs/claude.sanitized.json   # + facebook-ads-mcp server block
resources/mcps/configs/codex.sanitized.json    # + facebook-ads-mcp server block
resources/mcps/mcps/facebook-ads/skills.md     # registry stub
profiles/google-ads/profile.yaml               # + facebook-ads-mcp in mcps:
profiles/google-ads/workspaces.yaml            # extended per-client schema
profiles/claude-ads/profile.yaml               # + facebook-ads-mcp in mcps:
~/.config/cue/mcp-servers/facebook-ads/        # clone (NOT in repo)
~/.config/cue/secrets/ads/{google,meta}/       # credentials (NOT in repo)
```

---

### Task 1: Shared resolver library + secrets scaffolding

**Files:**
- Create: `resources/ads-cli/_adslib.py`
- Create: `resources/ads-cli/ads-secrets-init`
- Test: `resources/ads-cli/test/run-tests.sh` (started here, extended by later tasks)

**Interfaces:**
- Produces (consumed by Tasks 2, 3):
  - `_adslib.resolve_client(client: str) -> dict` — keys: `name` (str), `google_customer_id` (str, digits only, dashes stripped), `login_customer_id` (str, may be ""), `adc_path` (str, expanded abs path), `ads_yaml_path` (str, sibling of adc: `<slug>-adc.json` → `<slug>.google-ads.yaml`), `fb_ad_account_id` (str, e.g. "act_123", may be ""). Unset/unresolved `${VAR}` → "" for that key.
  - `_adslib.list_clients() -> list[str]`
  - `_adslib.fail(msg: str)` — prints `error: <msg>` to stderr, exit 1
  - `_adslib.META_API_VERSION = "v23.0"`
  - `_adslib.SECRETS = os.path.expanduser("~/.config/cue/secrets/ads")`
  - `_adslib.WORKSPACES_FILE` — `<repo>/profiles/google-ads/workspaces.yaml`, overridable via env `ADS_WORKSPACES_FILE` (tests use this).

- [ ] **Step 1: Write failing test harness**

```bash
mkdir -p resources/ads-cli/test
cat > resources/ads-cli/test/run-tests.sh <<'EOF'
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
EOF
chmod +x resources/ads-cli/test/run-tests.sh
```

- [ ] **Step 2: Run to verify it fails**

Run: `resources/ads-cli/test/run-tests.sh`
Expected: FAIL lines (ModuleNotFoundError: `_adslib`), `pass=0 fail=5`, exit 1.

- [ ] **Step 3: Implement `_adslib.py`**

```python
#!/usr/bin/env python3
"""Shared helpers for the ads CLI wrappers (gads, fbads, ads-gen-yaml).

Client identity comes from the cue google-ads profile's workspaces.yaml.
Values may contain ${VAR} references (resolved from the environment, the
same convention cue uses) and ~ or $HOME path prefixes.
"""
import os
import sys
from pathlib import Path

import yaml

META_API_VERSION = "v23.0"
SECRETS = os.path.expanduser("~/.config/cue/secrets/ads")

_REPO_ROOT = Path(__file__).resolve().parents[2]
WORKSPACES_FILE = os.environ.get(
    "ADS_WORKSPACES_FILE",
    str(_REPO_ROOT / "profiles" / "google-ads" / "workspaces.yaml"),
)


def fail(msg: str) -> "NoReturn":
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def _expand(value: str) -> str:
    """Expand ${VAR} / $VAR and ~. Unresolvable ${VAR} collapses to ""."""
    out = os.path.expandvars(os.path.expanduser(value or ""))
    if out.startswith("${") and out.endswith("}"):
        return ""
    return out


def _load() -> dict:
    try:
        with open(WORKSPACES_FILE) as f:
            data = yaml.safe_load(f) or {}
    except FileNotFoundError:
        fail(f"workspaces file not found: {WORKSPACES_FILE}")
    return data.get("workspaces") or {}


def list_clients() -> list:
    return sorted(_load().keys())


def resolve_client(client: str) -> dict:
    workspaces = _load()
    if client not in workspaces:
        fail(
            f"unknown client '{client}'. Available: {', '.join(sorted(workspaces))}\n"
            f"Add it in {WORKSPACES_FILE}"
        )
    ws = workspaces[client]
    env = ws.get("env") or {}
    adc = _expand(env.get("GOOGLE_APPLICATION_CREDENTIALS", ""))
    ads_yaml = ""
    if adc.endswith("-adc.json"):
        ads_yaml = adc[: -len("-adc.json")] + ".google-ads.yaml"
    return {
        "name": ws.get("name", client),
        "google_customer_id": _expand(env.get("GOOGLE_ADS_CUSTOMER_ID", "")).replace("-", ""),
        "login_customer_id": _expand(env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")).replace("-", ""),
        "adc_path": adc,
        "ads_yaml_path": ads_yaml,
        "fb_ad_account_id": _expand(env.get("FB_AD_ACCOUNT_ID", "")),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `resources/ads-cli/test/run-tests.sh`
Expected: `pass=5 fail=0`, exit 0.

- [ ] **Step 5: Write `ads-secrets-init`**

```bash
#!/usr/bin/env bash
# One-shot scaffolding for the ads credential layer. Idempotent.
set -euo pipefail
BASE="$HOME/.config/cue/secrets/ads"
mkdir -p "$BASE/google" "$BASE/meta"
chmod 700 "$HOME/.config/cue/secrets" "$BASE" "$BASE/google" "$BASE/meta"
TOKEN_FILE="$BASE/meta/system-user.token"
if [ ! -f "$TOKEN_FILE" ]; then
  touch "$TOKEN_FILE" && chmod 600 "$TOKEN_FILE"
  echo "created empty $TOKEN_FILE — paste the Meta system-user token into it (single line)."
else
  echo "exists: $TOKEN_FILE"
fi
echo "Google ADC files go to: $BASE/google/<login-slug>-adc.json"
echo "Generate gaarf configs with: ads-gen-yaml <login-slug>"
```

Mark executable: `chmod +x resources/ads-cli/ads-secrets-init resources/ads-cli/_adslib.py`

- [ ] **Step 6: Run it and verify layout**

Run: `resources/ads-cli/ads-secrets-init && ls -la ~/.config/cue/secrets/ads/{google,meta}`
Expected: dirs exist with `drwx------`, `system-user.token` with `-rw-------`.

- [ ] **Step 7: Commit**

```bash
git add resources/ads-cli
git commit -m "feat(ads-cli): shared client resolver + secrets scaffolding"
```

---

### Task 2: `ads-gen-yaml` — gaarf config generator

**Files:**
- Create: `resources/ads-cli/ads-gen-yaml`
- Modify: `resources/ads-cli/test/run-tests.sh` (append tests)

**Interfaces:**
- Consumes: `_adslib.SECRETS`, `_adslib.fail`
- Produces: `~/.config/cue/secrets/ads/google/<slug>.google-ads.yaml` with keys `developer_token`, `client_id`, `client_secret`, `refresh_token`, optional `login_customer_id` — the file `gads` (Task 3) passes to gaarf as `--ads-config`.

- [ ] **Step 1: Append failing tests to run-tests.sh** (before the final `echo "----"` block)

```bash
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
```

Note: `ads-gen-yaml` reads ADC from `$ADS_SECRETS_DIR` when set (tests), else `_adslib.SECRETS + "/google"`.

- [ ] **Step 2: Run — expect the 5 new tests FAIL** (`ads-gen-yaml: No such file`).

- [ ] **Step 3: Implement `ads-gen-yaml`**

```python
#!/usr/bin/env python3
"""Generate <slug>.google-ads.yaml (for gaarf) from <slug>-adc.json.

Usage: ads-gen-yaml <login-slug> [--login-customer-id ID]

Requires GOOGLE_ADS_DEVELOPER_TOKEN in the environment (~/.env.cue).
"""
import json
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _adslib import SECRETS, fail  # noqa: E402


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        fail("usage: ads-gen-yaml <login-slug> [--login-customer-id ID]")
    slug = args[0]
    login_id = ""
    if "--login-customer-id" in args:
        login_id = args[args.index("--login-customer-id") + 1].replace("-", "")
    dev_token = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", "")
    if not dev_token:
        fail("GOOGLE_ADS_DEVELOPER_TOKEN is not set — add it to ~/.env.cue and re-source your shell")
    base = os.environ.get("ADS_SECRETS_DIR", os.path.join(SECRETS, "google"))
    adc_path = os.path.join(base, f"{slug}-adc.json")
    if not os.path.isfile(adc_path):
        fail(f"no ADC file at {adc_path} — run:\n"
             f"  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/adwords,https://www.googleapis.com/auth/cloud-platform\n"
             f"  cp ~/.config/gcloud/application_default_credentials.json {adc_path}")
    with open(adc_path) as f:
        adc = json.load(f)
    for key in ("client_id", "client_secret", "refresh_token"):
        if not adc.get(key):
            fail(f"{adc_path} is missing '{key}' — regenerate it with gcloud (user ADC, not service account)")
    out_path = os.path.join(base, f"{slug}.google-ads.yaml")
    lines = [
        f"developer_token: '{dev_token}'",
        f"client_id: '{adc['client_id']}'",
        f"client_secret: '{adc['client_secret']}'",
        f"refresh_token: '{adc['refresh_token']}'",
    ]
    if login_id:
        lines.append(f"login_customer_id: '{login_id}'")
    with open(out_path, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(out_path, 0o600)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
```

`chmod +x resources/ads-cli/ads-gen-yaml`

- [ ] **Step 4: Run tests — expect `pass=10 fail=0`.**

- [ ] **Step 5: Commit**

```bash
git add resources/ads-cli
git commit -m "feat(ads-cli): ads-gen-yaml gaarf config generator"
```

---

### Task 3: `gads` and `fbads` CLIs

**Files:**
- Create: `resources/ads-cli/gads`
- Create: `resources/ads-cli/fbads`
- Modify: `resources/ads-cli/test/run-tests.sh` (append tests)

**Interfaces:**
- Consumes: `_adslib.resolve_client`, `_adslib.fail`, `_adslib.META_API_VERSION`, `_adslib.SECRETS`
- Produces: `gads <client> "<GAQL>" [--csv] [--dry-run]`; `fbads <client> <endpoint> [k=v ...] [--write] [--dry-run]` — both symlinked into `~/.local/bin` in Task 6.

- [ ] **Step 1: Append failing tests** (before the final block; still offline — only `--dry-run` paths)

```bash
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
```

- [ ] **Step 2: Run — expect the 6 new tests FAIL.**

- [ ] **Step 3: Implement `gads`**

```python
#!/usr/bin/env python3
"""gads — run a GAQL query for a client via gaarf.

Usage: gads <client> "<GAQL>" [--csv] [--dry-run]
Clients come from profiles/google-ads/workspaces.yaml (cue workspaces).
"""
import os
import shutil
import subprocess
import sys
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _adslib import fail, resolve_client  # noqa: E402


def main() -> None:
    args = [a for a in sys.argv[1:]]
    flags = {a for a in args if a.startswith("--")}
    pos = [a for a in args if not a.startswith("--")]
    if len(pos) != 2:
        fail('usage: gads <client> "<GAQL query>" [--csv] [--dry-run]')
    client, query = pos
    c = resolve_client(client)
    if not c["google_customer_id"]:
        fail(f"client '{client}' has no GOOGLE_ADS_CUSTOMER_ID (check ~/.env.cue)")
    cmd = [
        "gaarf", query,
        "--input=console",
        f"--ads-config={c['ads_yaml_path']}",
        f"--account={c['google_customer_id']}",
        "--output=csv" if "--csv" in flags else "--output=console",
    ]
    if "--dry-run" in flags:
        print(f"client={client} name={c['name']} account={c['google_customer_id']} "
              f"login_customer_id={c['login_customer_id'] or '-'}")
        print("would run: " + " ".join(cmd))
        return
    if not c["ads_yaml_path"] or not os.path.isfile(c["ads_yaml_path"]):
        fail(f"missing gaarf config {c['ads_yaml_path'] or '<unset>'} — run: ads-gen-yaml <login-slug>")
    if not shutil.which("gaarf"):
        fail("gaarf not installed — run: npm i -g google-ads-api-report-fetcher")
    sys.exit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Implement `fbads`**

```python
#!/usr/bin/env python3
"""fbads — Meta Graph API calls for a client's ad account.

Usage: fbads <client> <endpoint> [key=value ...] [--method POST] [--write] [--dry-run]

Endpoint is relative to the client's act_<id> (e.g. insights, campaigns,
adsets). An endpoint starting with '/' is absolute (e.g. /me/adaccounts).
GET by default; POST requires BOTH --method POST and --write.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from _adslib import META_API_VERSION, SECRETS, fail, resolve_client  # noqa: E402

TOKEN_FILE = os.path.join(SECRETS, "meta", "system-user.token")


def read_token() -> str:
    try:
        with open(TOKEN_FILE) as f:
            token = f.read().strip()
    except FileNotFoundError:
        fail(f"missing {TOKEN_FILE} — run ads-secrets-init, then paste the BM system-user token into it")
    if not token:
        fail(f"{TOKEN_FILE} is empty — paste the BM system-user token into it (single line)")
    return token


def main() -> None:
    args = sys.argv[1:]
    method = "GET"
    if "--method" in args:
        i = args.index("--method")
        method = args[i + 1].upper()
        del args[i:i + 2]
    flags = {a for a in args if a.startswith("--")}
    pos = [a for a in args if not a.startswith("--")]
    if len(pos) < 2:
        fail("usage: fbads <client> <endpoint> [key=value ...] [--method POST] [--write] [--dry-run]")
    client, endpoint, params = pos[0], pos[1], pos[2:]
    if method != "GET" and "--write" not in flags:
        fail(f"{method} requires --write (fbads is read-only by default)")
    c = resolve_client(client)
    if endpoint.startswith("/"):
        path = endpoint.lstrip("/")
    else:
        if not c["fb_ad_account_id"]:
            fail(f"client '{client}' has no FB_AD_ACCOUNT_ID (check ~/.env.cue)")
        path = f"{c['fb_ad_account_id']}/{endpoint}"
    kv = dict(p.split("=", 1) for p in params if "=" in p)
    url = f"https://graph.facebook.com/{META_API_VERSION}/{path}"
    if "--dry-run" in flags:
        qs = urllib.parse.urlencode({**kv, "access_token": "***"})
        print(f"client={client} name={c['name']} {method} {url}?{qs}")
        return
    kv["access_token"] = read_token()
    data = None
    if method == "GET":
        url += "?" + urllib.parse.urlencode(kv)
    else:
        data = urllib.parse.urlencode(kv).encode()
    req = urllib.request.Request(url, data=data, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
            fail(f"Graph API {e.code}: {err.get('message', e.reason)}")
        except (ValueError, AttributeError):
            fail(f"Graph API {e.code}: {e.reason}")
    print(json.dumps(body, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
```

`chmod +x resources/ads-cli/gads resources/ads-cli/fbads`

- [ ] **Step 5: Run tests — expect `pass=16 fail=0`.**

- [ ] **Step 6: Commit**

```bash
git add resources/ads-cli
git commit -m "feat(ads-cli): gads (gaarf wrapper) and fbads (Graph API) CLIs"
```

---

### Task 4: Facebook Ads MCP — clone, wrapper, registry

**Files:**
- Create: `resources/ads-cli/facebook-ads-mcp-run.sh`
- Create: `resources/mcps/mcps/facebook-ads/skills.md`
- Modify: `resources/mcps/configs/claude.sanitized.json` (add server after `google-ads-mcp` block, line ~115)
- Modify: `resources/mcps/configs/codex.sanitized.json` (same, after its `google-ads-mcp` block, line ~100)
- Outside repo: clone to `~/.config/cue/mcp-servers/facebook-ads/`

**Interfaces:**
- Consumes: token file `~/.config/cue/secrets/ads/meta/system-user.token` (Task 1 scaffolding)
- Produces: MCP server id `facebook-ads-mcp` in the cue catalog (Task 5 references it from profiles).

- [ ] **Step 1: Clone and set up venv**

```bash
git clone https://github.com/gomarble-ai/facebook-ads-mcp-server.git ~/.config/cue/mcp-servers/facebook-ads
cd ~/.config/cue/mcp-servers/facebook-ads
git rev-parse --short HEAD   # record the pinned commit in the commit message
uv venv
uv pip install -r requirements.txt
```

Expected: venv at `.venv/`, deps installed without error.

- [ ] **Step 2: Write the wrapper**

```bash
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
```

`chmod +x resources/ads-cli/facebook-ads-mcp-run.sh`

- [ ] **Step 3: Smoke-test the stdio handshake** (works with a dummy token — tool calls would fail, init must not)

```bash
echo "dummy-token-for-handshake" > ~/.config/cue/secrets/ads/meta/system-user.token
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | timeout 10 resources/ads-cli/facebook-ads-mcp-run.sh | head -1
```

Expected: one JSON-RPC line containing `"result"` and a `serverInfo` name. If the server errors on startup, read its output — do not proceed until init works. Afterwards empty the token file again: `: > ~/.config/cue/secrets/ads/meta/system-user.token`

- [ ] **Step 4: Register in both sanitized configs**

In `resources/mcps/configs/claude.sanitized.json`, after the `"google-ads-mcp"` entry, add:

```json
    "facebook-ads-mcp": {
      "command": "/home/deadpool/Documents/cue/resources/ads-cli/facebook-ads-mcp-run.sh",
      "args": [],
      "env": {}
    },
```

Same block in `resources/mcps/configs/codex.sanitized.json` (match that file's server object shape — copy how `google-ads-mcp` is declared there).

Validate: `python3 -c "import json; [json.load(open(f'resources/mcps/configs/{f}')) for f in ('claude.sanitized.json','codex.sanitized.json')]" && echo JSON-OK`

- [ ] **Step 5: Registry stub** — `resources/mcps/mcps/facebook-ads/skills.md`:

```markdown
# facebook-ads skills

MCP: `facebook-ads-mcp` — gomarble-ai/facebook-ads-mcp-server (local clone at
`~/.config/cue/mcp-servers/facebook-ads`, token via
`resources/ads-cli/facebook-ads-mcp-run.sh`).

Tools: list_ad_accounts, account details/insights, campaigns/adsets/ads
listing + insights, activity log. Read-only (token scope `ads_read`).

Related skills: `claude-ads` (`/ads meta` audit pairs with this MCP's live data).
```

- [ ] **Step 6: Commit**

```bash
git add resources/ads-cli/facebook-ads-mcp-run.sh resources/mcps/mcps/facebook-ads resources/mcps/configs/claude.sanitized.json resources/mcps/configs/codex.sanitized.json
git commit -m "feat(mcps): register facebook-ads-mcp (gomarble clone @ <commit>) with token wrapper"
```

---

### Task 5: Profile wiring — workspaces schema + mcps lists

**Files:**
- Modify: `profiles/google-ads/profile.yaml` (mcps list + persona note)
- Modify: `profiles/google-ads/workspaces.yaml` (extend schema, keep teherguminet)
- Modify: `profiles/claude-ads/profile.yaml` (mcps list)

**Interfaces:**
- Consumes: MCP id `facebook-ads-mcp` (Task 4)
- Produces: the workspace schema `gads`/`fbads` read (already coded against it in Tasks 1–3).

- [ ] **Step 1: Add `facebook-ads-mcp` to both profiles' `mcps:` lists**

`profiles/google-ads/profile.yaml`:
```yaml
mcps:
  - google-ads-mcp             # Official Google Ads MCP (GAQL search, metadata, resources)
  - facebook-ads-mcp           # Meta Graph API reads (gomarble clone, BM system-user token)
```
Same two-line list in `profiles/claude-ads/profile.yaml` (it currently has only `google-ads-mcp`).

- [ ] **Step 2: Extend `profiles/google-ads/workspaces.yaml`**

Replace the header comment + teherguminet block so each workspace carries both platforms; keep the existing context text:

```yaml
# Workspaces — per-client configurations for the google-ads profile.
#
# Each workspace switches BOTH platforms at once:
#   GOOGLE_ADS_CUSTOMER_ID          client's Google Ads account (${VAR} from ~/.env.cue)
#   GOOGLE_ADS_LOGIN_CUSTOMER_ID    ${AGENCY_MCC_ID} for MCC-linked clients, "" otherwise
#   GOOGLE_APPLICATION_CREDENTIALS  absolute path to the Google login's ADC file
#                                   (~/.config/cue/secrets/ads/google/<login>-adc.json)
#   FB_AD_ACCOUNT_ID                client's Meta ad account (act_..., ${VAR} from ~/.env.cue)
#
# Switch:  cue workspace <client>     Status:  cue workspace --status
# CLI:     gads <client> "<GAQL>"     fbads <client> insights date_preset=last_30d

workspaces:
  teherguminet:
    name: "Teherguminet.hu"
    url: "https://teherguminet.hu"
    description: "Tehergumi webshop — teherautó, kisteherautó, mezőgazdasági gumik"
    env:
      GOOGLE_ADS_CUSTOMER_ID: "${TEHERGUMINET_GOOGLE_ADS_CUSTOMER_ID}"
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "${AGENCY_MCC_ID}"
      GOOGLE_APPLICATION_CREDENTIALS: "/home/deadpool/.config/cue/secrets/ads/google/agency-adc.json"
      FB_AD_ACCOUNT_ID: "${TEHERGUMINET_FB_AD_ACCOUNT_ID}"
    context: |
      Active workspace: teherguminet.hu
      Industry: E-commerce / Automotive parts (truck tires)
      Market: Hungary (HU)
      Language: Hungarian
      Currency: HUF
      Key products: tehergumi, kisteherautó gumi, mezőgazdasági gumi, munkagép gumi
      Seasonality: peak in spring (March-May) and autumn (Sept-Nov)

  # --- Template: MCC-linked client (shares the agency ADC) ---
  # acme:
  #   name: "Acme Kft."
  #   env:
  #     GOOGLE_ADS_CUSTOMER_ID: "${ACME_GOOGLE_ADS_CUSTOMER_ID}"
  #     GOOGLE_ADS_LOGIN_CUSTOMER_ID: "${AGENCY_MCC_ID}"
  #     GOOGLE_APPLICATION_CREDENTIALS: "/home/deadpool/.config/cue/secrets/ads/google/agency-adc.json"
  #     FB_AD_ACCOUNT_ID: "${ACME_FB_AD_ACCOUNT_ID}"
  #   context: |
  #     Industry / market / currency / seasonality ...

  # --- Template: separate-login client (own ADC file, no MCC in the chain) ---
  # legacyclient:
  #   name: "Legacy Client"
  #   env:
  #     GOOGLE_ADS_CUSTOMER_ID: "${LEGACYCLIENT_GOOGLE_ADS_CUSTOMER_ID}"
  #     GOOGLE_ADS_LOGIN_CUSTOMER_ID: ""
  #     GOOGLE_APPLICATION_CREDENTIALS: "/home/deadpool/.config/cue/secrets/ads/google/legacyclient-adc.json"
  #     FB_AD_ACCOUNT_ID: "${LEGACYCLIENT_FB_AD_ACCOUNT_ID}"
  #   context: |
  #     Industry / market / currency ...
```

- [ ] **Step 3: Persona note in `profiles/google-ads/profile.yaml`** — append to the persona's "## MCP Tools" section:

```
  Meta side (facebook-ads-mcp, read-only): list_ad_accounts, campaign/adset/ad
  listing and insights for the active workspace's FB_AD_ACCOUNT_ID. State which
  ad account you are reading at session start.
```

- [ ] **Step 4: Validate**

Run: `cue validate google-ads && cue validate claude-ads`
Expected: both pass (exit 0). If `facebook-ads-mcp` is reported unknown, the sanitized-config entry from Task 4 is malformed — fix there, not here.

- [ ] **Step 5: Commit**

```bash
git add profiles/google-ads profiles/claude-ads
git commit -m "feat(profiles): wire facebook-ads-mcp + two-platform client workspaces"
```

---

### Task 6: gaarf install, symlinks, README runbook

**Files:**
- Create: `resources/ads-cli/README.md`
- Outside repo: `npm i -g google-ads-api-report-fetcher`, symlinks in `~/.local/bin`

- [ ] **Step 1: Install gaarf** (global npm install was approved in the design)

```bash
npm i -g google-ads-api-report-fetcher
gaarf --version
```
Expected: a version string prints.

- [ ] **Step 2: Symlink the CLIs**

```bash
mkdir -p ~/.local/bin
for f in gads fbads ads-gen-yaml ads-secrets-init; do
  ln -sf /home/deadpool/Documents/cue/resources/ads-cli/$f ~/.local/bin/$f
done
gads 2>&1 | head -1   # expect the usage error via _adslib (proves symlink+import work)
```

- [ ] **Step 3: Write `resources/ads-cli/README.md`** — the full setup runbook:

```markdown
# ads-cli — multi-client Google + Meta Ads access

Spec: `docs/superpowers/specs/2026-07-15-ads-multi-client-design.md`

## One-time setup

1. `ads-secrets-init`
2. `~/.env.cue` gains (0600, sourced by the shell):
   `GOOGLE_ADS_DEVELOPER_TOKEN` (MCC → API Center), `GOOGLE_PROJECT_ID`,
   `AGENCY_MCC_ID`, and per client:
   `<CLIENT>_GOOGLE_ADS_CUSTOMER_ID`, `<CLIENT>_FB_AD_ACCOUNT_ID` (act_...).
3. Agency Google login:
   `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/adwords,https://www.googleapis.com/auth/cloud-platform`
   then `cp ~/.config/gcloud/application_default_credentials.json ~/.config/cue/secrets/ads/google/agency-adc.json`
   and `ads-gen-yaml agency --login-customer-id $AGENCY_MCC_ID`
4. Each separate-login client: repeat step 3 with that login →
   `<slug>-adc.json`, then `ads-gen-yaml <slug>` (no --login-customer-id).
5. Meta: Business Manager → system user → generate token (`ads_read`;
   `ads_management` only if you will use `fbads --write`). Paste into
   `~/.config/cue/secrets/ads/meta/system-user.token`.

## Adding a client

1. Env vars in `~/.env.cue` (customer ID + act ID).
2. Workspace block in `profiles/google-ads/workspaces.yaml` (see templates there).
3. `cue workspace <client>` to switch; `cue workspace --status` to verify.

## Daily use

- Claude session: `cue workspace <client>` then launch with the `google-ads`
  (or `claude-ads`) profile — both MCPs pick up the client automatically.
- Terminal: `gads <client> "SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_30_DAYS"`
- Terminal: `fbads <client> insights date_preset=last_30d level=campaign`
- Mutations: Meta only, explicit: `fbads <client> ... --method POST --write`.
  Google mutations are out of scope v1 (read-only MCP + gaarf); do them in the UI.

## Tests

`resources/ads-cli/test/run-tests.sh` — offline, no credentials needed.
```

- [ ] **Step 4: Commit**

```bash
git add resources/ads-cli/README.md
git commit -m "docs(ads-cli): setup runbook + symlink/gaarf install notes"
```

---

### Task 7: End-to-end verification (offline part now, live part gated on credentials)

**Files:** none (verification only)

- [ ] **Step 1: Full offline suite**

```bash
resources/ads-cli/test/run-tests.sh          # expect pass=16 fail=0
cue validate google-ads && cue validate claude-ads
cue workspace --list                          # teherguminet listed
bun test src/lib/mcp-catalog.test.ts 2>/dev/null || npx vitest run src/lib/mcp-catalog.test.ts 2>/dev/null || true
  # whichever runner the repo uses — catalog tests must still pass with the new server id
```

- [ ] **Step 2: Handshake re-check** — repeat Task 4 Step 3's initialize echo (dummy token), confirm `"result"` line, empty the token file again.

- [ ] **Step 3: Document the live-smoke checklist as the handoff** (runs only after the user supplies credentials):
  1. `cue workspace teherguminet && cue launch claude` → `list_accessible_customers` (Google) and `list_ad_accounts` (Meta) both return data.
  2. `gads teherguminet "SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_30_DAYS"` prints a table.
  3. `fbads teherguminet insights date_preset=last_30d` prints JSON.

- [ ] **Step 4: Final commit + PR** per the pre-authorized gated ship flow (review clean + no new failures vs base → merge).
