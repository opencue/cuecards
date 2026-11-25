# cue studio

A VS Code-style IDE for the `cue` profile manager — the UI for the local
dashboard server. The activity rail switches between eight views: **explorer**
(browse a profile's skills by namespace, read/edit each `SKILL.md` in a
line-numbered editor with a minimap + details panel), **dashboard** (scale /
usage / health bands, activity chart, active sessions), **search** (⌘K command
palette), **merge studio** (drag profiles into a composite with live deduped
stats from the merge engine), **workflows**, **mcps**, **plugins**, and
**settings**. Entry point: `src/main.tsx` → `src/studio/StudioApp.tsx`; styles
in `src/studio/styles.css`; data hooks in `src/studio/api.ts`.

Every view reads live data from the proxy (`/api/v1/*`). The explorer/search/
mcps views are backed by `/api/v1/profile-detail` (skills grouped by namespace
with real `SKILL.md` bodies, mcps, plugins, commands). A few presentation-only
fields the proxy has no source for yet (MCP tool inventories/latency, the
workflow gallery) are filled from `src/studio/curated.ts`, clearly labelled.

> The earlier 6-card dashboard (`src/App.tsx`, `src/components/*`,
> `src/routes/MergeStudio.tsx`) has been superseded by the studio and is no
> longer wired into `main.tsx`. Those files can be removed in a cleanup pass.

Two deployment modes from one codebase:

- **Local** — `cue dashboard` (in the parent repo) spawns a Bun server on `127.0.0.1:7891`. The React app fetches `/api/v1/*` against that server. Real data from `~/.config/cue/`.
- **Vercel demo** — `vercel.json` builds + serves the React app statically and rewrites every `/api/v1/*` request to `demo-data.json` so visitors see realistic numbers without any local install.

## Develop

**One command (recommended)** — boots both the API server and Vite together with color-prefixed logs, single Ctrl-C tears them both down:

```bash
cd web
npm install         # or: bun install
npm run dev:full    # → [dash] http://127.0.0.1:7891  +  [vite] http://127.0.0.1:5173
```

Open <http://localhost:5173>.

**Two terminals** if you want them split:

```bash
# T1
bun ../src/index.ts dashboard --no-open

# T2
cd web && npm run dev
```

**Proxy fault tolerance.** When the Bun API server isn't running, the Vite proxy (configured in `vite.config.ts`) intercepts the upstream error and returns a clean JSON envelope (`{ok:false, error:"dashboard-server-unreachable: ..."}` with HTTP 503) instead of Vite's stock HTML 500 page. The React app detects that envelope at startup and renders a single "server offline" banner with the command to start it, instead of every card repeating the same error.

## Build

```bash
npm run build      # → dist/
```

Once `web/dist/` exists, `cue dashboard` serves the static build alongside its `/api/v1/*` endpoints (no Vite needed).

## Demo data

`scripts/dashboard-demo-data.ts` produces `public/demo-data.json`. Studio previews use a hand-curated snapshot, while the public Marketplace roster reads display metadata from the checkout's `profiles/*/profile.yaml`. Regenerate after changing profiles or demo data:

```bash
npm run gen-demo-data
```

`vercel.json` runs this as part of the build. Build from the full checkout so the profile definitions are available. Community listings are fetched separately from the hosted API; the built-in roster works without that API.

## Deploy to Vercel

```bash
vercel deploy --prod
```

Make sure the Vercel project's "root directory" points at `web/`. The `vercel.json` here handles the rest (build command, output dir, rewrites, security headers).

## Architecture

```
src/
├── main.tsx           ← entry, QueryClientProvider
├── App.tsx            ← root layout, 6 cards
├── lib/
│   ├── fetcher.ts     ← local-vs-demo adapter
│   └── format.ts      ← bytes / relative-time
├── components/
│   ├── ActiveProfile.tsx
│   ├── SkillActivation.tsx
│   ├── TokenCostChart.tsx
│   ├── PairSuggestions.tsx
│   ├── TriggerGaps.tsx
│   └── GateTimeline.tsx
└── styles/globals.css ← CSS variables, dark-first, light fallback
```

Each component fetches one endpoint via TanStack Query, renders a card with a `cue ...` CLI hint in the corner so users can drop into the equivalent CLI command at any time.
