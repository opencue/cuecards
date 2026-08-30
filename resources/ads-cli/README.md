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
5. Meta: Business Manager → per-client system user → generate token
   (`ads_read`; `ads_management` only if you will use `fbads --write`). Store it
   through `ads setup meta-token <client>` in the client-specific path declared
   as `META_TOKEN_FILE`.

## Adding a client

1. Env vars in `~/.env.cue` (customer ID + act ID).
2. Workspace block in `profiles/google-ads/workspaces.yaml` (see templates there).
3. `cue workspace <client>` to switch; `cue workspace --status` to verify.

## Daily use

- Claude session: `cue workspace <client>` then launch with the `google-ads`
  profile — both MCPs pick up the client automatically. (Workspaces are
  per-profile: `claude-ads` also has both MCPs but no workspaces.yaml, so it
  reads the global values from `~/.env.cue` instead of switching per client.)
- Terminal: `gads <client> "SELECT campaign.name, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_30_DAYS"`
- Terminal: `fbads <client> insights date_preset=last_30d level=campaign`
- Mutations: Meta only, explicit: `fbads <client> ... --method POST --write`.
  Google mutations are out of scope v1 (read-only MCP + gaarf); do them in the UI.

## Tests

`resources/ads-cli/test/run-tests.sh` — offline, no credentials needed.
