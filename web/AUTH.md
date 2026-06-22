# Auth & API tokens

cuecards.cc has free public accounts and per-user API tokens, built on
[BetterAuth](https://better-auth.com) with email + password. Storage is
Postgres (Neon in production). The auth server runs as Vercel serverless
functions, same-origin with the SPA.

```
cuecards.cc
├─ /                     Vite SPA (cue studio) — the "API tokens" rail view
├─ /api/auth/*           BetterAuth: sign-up, sign-in, sign-out, session, api-key/*
├─ /api/v1/me            returns the caller (session cookie OR Bearer token)
└─ /api/v1/community     community marketplace: GET (public list) + POST (publish)
```

## Environment

Set these in the Vercel project (and in `web/.env` for local work — copy
`web/.env.example`):

| Var | Required | What |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Use Neon's **pooled** endpoint (`-pooler`) in production. |
| `BETTER_AUTH_SECRET` | yes | Session/token signing secret. Generate: `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | prod | Public site origin, e.g. `https://cuecards.cc`. |
| `PG_POOL_MAX` | no | Max Postgres connections per instance. Defaults to `1` (serverless-safe). |
| `BETTER_AUTH_TRUSTED_ORIGINS` | dev | Extra CSRF-trusted origins (comma-separated), e.g. the Vite dev origin. |

The server fails to boot if `DATABASE_URL` or `BETTER_AUTH_SECRET` is missing.

## Database setup

BetterAuth manages its own schema (`user`, `session`, `account`,
`verification`, `apikey`). After pointing `DATABASE_URL` at a fresh database,
run the migration once:

```bash
cd web
npx @better-auth/cli@latest migrate --config lib/auth.ts -y
```

## Local development

```bash
cd web
cp .env.example .env          # fill DATABASE_URL + BETTER_AUTH_SECRET

# 1. auth server (BetterAuth) on :3000
bun scripts/dev-server.ts

# 2. the SPA, proxying /api/auth + /api/v1/me to the auth server
AUTH_TARGET=http://127.0.0.1:3000 npm run dev
```

The Vite proxy sends `/api/auth` and `/api/v1/me` to `AUTH_TARGET`; everything
else under `/api` still goes to the local cue dashboard server. The "API
tokens" rail view works even when the dashboard server is offline.

### The check

`scripts/check-auth-flow.ts` is the end-to-end gate — it walks
register → login → create token → `GET /api/v1/me` with the Bearer token,
then bursts 15 calls to confirm tokens aren't throttled to the plugin default:

```bash
BASE=http://localhost:3000 bun scripts/check-auth-flow.ts
```

`scripts/smoke-ui.mjs` is the browser smoke (Playwright) for the UI.

## Using a token

Create a token in the **API tokens** view (shown once). Then authenticate
programmatically with a Bearer header:

```bash
curl https://cuecards.cc/api/v1/me \
  -H "Authorization: Bearer <your-token>"
# -> { "ok": true, "data": { "id": "...", "email": "...", "name": "..." } }
```

Tokens also accept the `x-api-key` header. Each token is rate limited to 120
requests/minute by default (configurable in `lib/auth.ts`).

## Publishing to the marketplace

`/api/v1/community` is the "push from your PC" surface. Users mint a token in the
API view, then publish profiles / skills / MCPs — from the studio's **Publish**
modal (session cookie) or `cue marketplace publish` (Bearer token).

```bash
# list the public community catalog (no auth)
curl https://cuecards.cc/api/v1/community

# your own items, any status (auth)
curl https://cuecards.cc/api/v1/community?mine=1 -H "Authorization: Bearer <token>"

# publish / re-publish one item (auth)
curl -X POST https://cuecards.cc/api/v1/community \
  -H "Authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"type":"profile","name":"ship-fast","description":"…","tags":["build","review"]}'
```

Server behavior (`web/lib/market.ts`):

- **Auth** via `auth.api.getSession` — same path as `/api/v1/me`, so a session
  cookie or a Bearer api-key both work.
- **The install command is derived server-side** (`cue add <handle>/<name>`,
  `cue marketplace install-mcp <name>`, …) and never read from the request, so a
  submission can't smuggle a `curl … | bash` into someone's dashboard.
- Every field is length-clamped; `name`/tags are slugged; `sourceUrl` must be
  `https://`. The `id` embeds a per-user suffix and `(user_id, type, name)` is
  unique, so re-publishing updates your own item and no one can overwrite
  another user's.
- Items default to `status = 'approved'` (frictionless, matching free signup).
  The `status` column is the hook to add moderation later without a schema
  change.

The table (`market_item`) is created lazily on first use, so no extra migration
step is required beyond BetterAuth's. The CLI defaults to `https://cuecards.cc`;
point it elsewhere with `CUE_API_URL` (env) or `--api <url>`.

## Deploy (Vercel + Neon)

1. Create a Neon project; copy the **pooled** connection string.
2. In Vercel → Project → Settings → Environment Variables, set `DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
3. Run the migration once against the Neon database (above).
4. Deploy. Functions in `web/api/**` are picked up automatically; the SPA and
   API are same-origin, so no CORS/`trustedOrigins` config is needed.

## Security notes

- **Free signup, no email verification** (`requireEmailVerification: false`) —
  a deliberate "free, no card" product choice. Pair with abuse monitoring.
- **`/api/v1/me` is unauthenticated-reachable and not itself throttled.** Put a
  rate limit at the edge (Vercel middleware / WAF) if token-guessing or DoS is a
  concern; BetterAuth's own `/api/auth/*` routes are already rate limited.
- Tokens are shown once and stored hashed. Regenerate creates the replacement
  before deleting the old token, so a failed rotation never leaves zero tokens.
