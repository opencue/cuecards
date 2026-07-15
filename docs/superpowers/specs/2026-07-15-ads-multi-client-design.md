# Multi-client Google Ads + Facebook Ads layer for cue

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation
**Owner:** cue repo

## Goal

Manage multiple advertising clients' Google Ads and Meta (Facebook) ad accounts
from this machine, through Claude sessions (MCP) and directly from the terminal
(CLI), switching between clients with one command: `cue workspace <client>`.

The user's account topology:

- **Google:** mixed — some client accounts linked under the user's own MCC
  (manager account), others reachable only via a separate per-client Google
  login.
- **Meta:** single Business Manager; client ad accounts are shared into it, so
  one system-user token reaches everything; switching is by ad account ID.

## Non-goals

- Google Ads campaign **mutations** are out of scope for v1. The official
  `googleads/google-ads-mcp` is read-only by design; changes are applied in the
  Google Ads UI based on the analysis. A `google-ads` Python-library mutate
  script can be a follow-up.
- No per-client cue profiles. Switching is via the existing workspaces
  mechanism, not profile duplication.

## Architecture

One shared credential layer, three consumers (two MCPs + CLI tools):

```
~/.env.cue (mode 0600)                   ~/.config/cue/secrets/ads/
  GOOGLE_ADS_DEVELOPER_TOKEN               google/<login>-adc.json          (ADC per Google login)
  GOOGLE_PROJECT_ID                        google/<login>.google-ads.yaml   (generated, for gaarf)
  META_SYSTEM_USER_TOKEN (name only;       meta/system-user.token           (0600)
    canonical value lives in token file)
        │                                        │
        ▼                                        ▼
profiles/google-ads/workspaces.yaml   ← one workspace block per client
        │  (env overrides + persona context injection)
        ├─► google-ads-mcp    (official, pipx run — GAQL reads)
        ├─► facebook-ads-mcp  (gomarble-ai clone at ~/.config/cue/mcp-servers/facebook-ads)
        ├─► gads  CLI         (gaarf wrapper — GAQL reports from the terminal)
        └─► fbads CLI         (Graph API curl wrapper)
```

## Components

### 1. Credential layout

- `~/.config/cue/secrets/ads/` — new directory, mode 0700, **never** inside the
  repo.
  - `google/<login-slug>-adc.json` — Application Default Credentials copied
    from `gcloud auth application-default login` runs, one per Google login
    (the main agency login + one per separate-login client).
  - `google/<login-slug>.google-ads.yaml` — generated from the ADC JSON +
    developer token by a helper script; consumed by gaarf.
  - `meta/system-user.token` — the BM system-user token, single line, 0600.
- `~/.env.cue` — existing cue secret-env convention (sourced by the shell,
  0600). Gains: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_PROJECT_ID`,
  `AGENCY_MCC_ID`, and per-client `<CLIENT>_GOOGLE_ADS_CUSTOMER_ID` /
  `<CLIENT>_FB_AD_ACCOUNT_ID` vars referenced by workspaces.

### 2. Workspace schema (extend `profiles/google-ads/workspaces.yaml`)

One block per client switches **both platforms** at once:

```yaml
workspaces:
  acme:                             # MCC-linked client
    name: "Acme Kft."
    env:
      GOOGLE_ADS_CUSTOMER_ID: "${ACME_GOOGLE_ADS_CUSTOMER_ID}"
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: "${AGENCY_MCC_ID}"
      GOOGLE_APPLICATION_CREDENTIALS: "~/.config/cue/secrets/ads/google/agency-adc.json"
      FB_AD_ACCOUNT_ID: "${ACME_FB_AD_ACCOUNT_ID}"
    context: |
      Active client: Acme Kft. — industry, market, currency, seasonality...

  legacyclient:                     # separate-login client
    env:
      GOOGLE_ADS_CUSTOMER_ID: "${LEGACYCLIENT_GOOGLE_ADS_CUSTOMER_ID}"
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: ""          # no MCC in the chain
      GOOGLE_APPLICATION_CREDENTIALS: "~/.config/cue/secrets/ads/google/legacyclient-adc.json"
      FB_AD_ACCOUNT_ID: "${LEGACYCLIENT_FB_AD_ACCOUNT_ID}"
```

One developer token serves all logins: a Google Ads developer token is issued
to an MCC but usable with any OAuth principal once it has Basic/Standard
access.

### 3. Facebook Ads MCP registration

- Clone `gomarble-ai/facebook-ads-mcp-server` to
  `~/.config/cue/mcp-servers/facebook-ads/` (follows the existing
  `financial-datasets` pattern), with a `uv` venv.
- `run.sh` wrapper: reads `~/.config/cue/secrets/ads/meta/system-user.token`
  at exec time and passes it as `--fb-token`. The token never appears in any
  MCP config file.
- Registry entries in the cue repo:
  - server block in `resources/mcps/configs/claude.sanitized.json` (and codex
    template if applicable) pointing at the wrapper;
  - `resources/mcps/mcps/facebook-ads/skills.md` stub.
- Added to the `mcps:` list of both the `google-ads` and `claude-ads`
  profiles. The `FB_AD_ACCOUNT_ID` from the active workspace is injected into
  the persona context so the agent targets the right account (the MCP itself
  can list all accounts the token reaches via `list_ad_accounts`).

### 4. CLI layer (`resources/ads-cli/` in the repo, symlinked to `~/.local/bin`)

- **`gads <client> "<GAQL>" [--csv]`** — wrapper around gaarf (Google Ads API
  Report Fetcher, official Google tool). Resolves the client's customer ID and
  `google-ads.yaml` path from `workspaces.yaml`, runs the query, prints
  console table or CSV.
- **`fbads <client> <endpoint> [param=value ...] [--write]`** — thin curl
  wrapper over the Meta Graph API (`/act_<id>/<endpoint>`). Read-only unless
  `--write` is passed explicitly (then POST is allowed — this is the v1 path
  for applying Meta setting changes).
- **`ads-gen-yaml <login-slug>`** — helper that generates
  `google-ads.yaml` for gaarf from an ADC JSON + `GOOGLE_ADS_DEVELOPER_TOKEN`.

### 5. Prerequisites only the user can provide

1. Google Ads **developer token** (MCC → API Center; test level is immediate,
   Basic access needed for live accounts).
2. `gcloud auth application-default login` once for the agency login and once
   per separate-login client (interactive browser flows; exact commands with
   adwords scope are provided during setup).
3. Meta **system-user token** from Business Manager with `ads_read`
   (+ `ads_management` if `fbads --write` will be used).
4. The client roster: name + Google customer ID + `act_` ID per client, used
   to generate the workspace blocks.

## Error handling

- Wrapper scripts fail fast with a clear message when a secret file is
  missing/empty, naming the exact file and the setup step that creates it.
- `gads`/`fbads` validate that the client key exists in `workspaces.yaml`
  before making any network call, and list available clients on miss.
- MCP env values are `${VAR}` references; `cue workspace --status` (existing)
  shows which vars are unset.

## Testing / verification

- `cue validate google-ads` and `cue validate claude-ads` after profile edits.
- Live smoke tests (once credentials exist): Google `list_accessible_customers`
  via MCP, Meta `list_ad_accounts` via MCP, one `gads` query
  (`campaign.name, metrics.cost_micros` last 30 days), one `fbads` insights
  call.
- CLI wrappers get `--help` and a `--dry-run` that prints the resolved
  identity (login, customer ID / act ID) without network calls.
