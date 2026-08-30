# Marketplace API

Publishing profiles, skills, and MCPs to cuecards.cc from your own machine.
Not needed to use cue — see the [README](../README.md) to get started.

cuecards.cc gives every account a free, per-user **API token** and a small HTTP
API. Mint a token in the studio (`cue dashboard` → **API** view, or
[cuecards.cc](https://cuecards.cc)), then use it from your own machine to push
profiles, skills, and MCPs to the community marketplace.

```bash
# 1. Save the token (verifies it against the server before writing ~/.config/cue/credentials.json)
cue marketplace login --token cue_sk_…       # or: export CUE_API_TOKEN=cue_sk_…
cue marketplace whoami                        # confirm which account you're authenticated as

# 2. Push something to the marketplace
cue marketplace publish profile ship-fast --tags build,review
cue marketplace publish skill seo-audit --source-url https://github.com/me/skills
cue marketplace publish mcp my-server --desc "internal tooling MCP"
```

Authenticate HTTP calls with a Bearer header (the token also works as
`x-api-key`):

```bash
curl https://cuecards.cc/api/v1/me            -H "Authorization: Bearer $CUE_API_TOKEN"
curl https://cuecards.cc/api/v1/community     # public community catalog (no auth)
curl https://cuecards.cc/api/v1/community     -H "Authorization: Bearer $CUE_API_TOKEN" \
  -X POST -H 'content-type: application/json' \
  -d '{"type":"profile","name":"ship-fast","tags":["build"]}'
```

Install commands are **derived server-side** — a submission can never inject an
arbitrary `add` string. See [web/AUTH.md](https://github.com/opencue/cuecards/blob/main/web/AUTH.md) for the auth model,
self-hosting, and `CUE_API_URL` (point the CLI at a different deployment).
