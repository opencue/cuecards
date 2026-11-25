# cue Dashboard — DESIGN

> Status: **proposed** · Target: `cue` 0.11 · Author: ai-pair · Last updated: 2026-05-28
> Estimated effort: 3–4 days for the MVP shipping to Vercel.

---

## Problem

cue has accumulated a lot of *data* and a lot of *decisions*:

- 5 different `cue` commands (`status`, `gates status`, `skill-report`, `suggest-pairs`, `trigger-gaps`) each show a slice.
- Telemetry events live in JSONL on disk.
- Gate-status JSONs sit per-profile.
- Profile YAMLs declare the structure.

No single place answers: *"is everything healthy, where am I spending tokens, what should I clean up next?"* Power users want a glance dashboard. Casual users want a "first 5 minutes" wow moment.

## Goals

- One page that surfaces: active profile, telemetry usage, skill activation, gate status, pair-suggestions, trigger-gaps.
- Zero-config: `cue dashboard` opens it in the browser, reads from local disk.
- Hostable: same React app deploys to Vercel as a public marketing page, with telemetry data piped in via a JSON endpoint OR fully client-side from a local server.
- Fast first paint. <100KB JS gzipped. Static-first.

## Non-goals (MVP)

- Write actions (`prune --apply`, `share push`, etc.). MVP is read-only. Buttons that *deep-link* into the right CLI command are fine.
- Multi-user / cloud-synced dashboards. Local data only.
- Auth. Local-only access in v1; localhost binding only.
- Real-time streaming. Refresh on user action; no websockets.

## Architecture

`cue dash sessions` requests an on-demand Linux RAM snapshot. Each session's
`memory` reports proportional resident memory (PSS, in KiB) for the Cue
launcher, agent, recognizable local MCP subtrees, and other processes in the
session tree. PSS apportions shared RAM and excludes swap.
`unreadableProcesses` signals a partial result (for example, a process exited or
its memory could not be read). Detached services and other users' memory are not
measured. The dashboard's usual background session polling does not request this
snapshot.

Two deployment modes from one codebase:

### Mode A — Local (`cue dashboard`)

```
$ cue dashboard
  ▸ starts local Bun server on :7891
  ▸ serves the built React app from dist/
  ▸ exposes /api/* endpoints that read ~/.config/cue/*
  ▸ opens http://localhost:7891 in the default browser

  React app
      │ fetch
      ▼
  Bun /api/status        → reads $XDG/cue/* synchronously, returns JSON
  Bun /api/skill-report  → wraps existing computeSkillUsage()
  Bun /api/gates         → wraps readAllGateStatus()
  Bun /api/pairs         → wraps suggestionsByProfile()
  Bun /api/trigger-gaps  → wraps computeTriggerGaps()
```

### Mode B — Vercel (`https://cue.so/dashboard?demo=1`)

```
  Same React app, deployed static to Vercel.
  Hits a /demo-data.json blob instead of /api/*.
  Used for marketing + onboarding: "see what cue does, with realistic example data."
```

Both modes share the same components — only the data layer (a TanStack Query `fetcher` factory) swaps.

## Stack

- **React 19** (already in your stack preferences).
- **Vite 5** for dev + production bundling.
- **TanStack Router** for file-based routing (single route at `/` for MVP; add `/profile/:name` later).
- **TanStack Query** for data fetching + caching.
- **shadcn/ui** for primitives (button, card, table, badge). Lightweight, no runtime CSS framework lock-in.
- **Recharts** for the time-series + bar charts. ~30KB; adequate for our taste.
- **Bun** as the local dev server runtime (already in use).

No state management library. TanStack Query covers all caching. Page-local `useState` for filters.

## Page layout (MVP, one route `/`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  cue                          📊  ●  active: medusa-vite+backend     │
│                                                                      │
│  ┌─Active Profile──────────────────────────────────────────────────┐ │
│  │ 🎨🦊 medusa-vite + 🌐 backend          last launched 2h ago     │ │
│  │ 47 skills · 3 MCPs · ~6.8KB CLAUDE.md (down from 28KB)          │ │
│  │ ✓ Gates: 5/5 passed                                             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─Skill activation (30d)─────────────────────────────────────────┐ │
│  │  ● 12 active   ✗ 35 zombie (~38k tokens, "cue prune --dead")  │ │
│  │  ▁▂▃▆█▆▃▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  ← daily hits sparkline       │ │
│  │  Top hits:  meta/skill-reviewer (29)                            │ │
│  │             meta/description-optimizer (17)                     │ │
│  │             ...                                                 │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─Token cost per profile (this week)──────────────────────────────┐ │
│  │  ████████  medusa-vite+backend       6.8KB · ↓76% via lean      │ │
│  │  ██████    skill-writer+core+ecc    13.2KB                      │ │
│  │  ████      designer                  9.1KB                      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─Pair suggestions────────────────┐  ┌─Trigger gaps──────────────┐ │
│  │ medusa-vite + backend (87%, 7×) │  │ meta/help    2356 matches │ │
│  │ designer + medusa-dev (62%, 5×) │  │              0 hits       │ │
│  │ vite + frontend  (50%, 4×)      │  │ meta/just    1585 matches │ │
│  │                                 │  │              0 hits       │ │
│  └─────────────────────────────────┘  └───────────────────────────┘ │
│                                                                      │
│  ┌─Gate runs (last 7d)─────────────────────────────────────────────┐ │
│  │  Profile             Result        When           Failed gates  │ │
│  │  medusa-vite+backend ✓ pass        2h ago         —             │ │
│  │  skill-writer        ✗ fail        4h ago         lint-skill   │ │
│  │  designer            ✓ pass        yesterday      —             │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Six cards, all single-row collapsible, mobile-stacks-vertical. Top-bar shows the active-profile dot + name (green = healthy, yellow = warnings, red = gate failure).

## Components

| Component | Purpose | Data source |
|---|---|---|
| `<ActiveProfile />` | Header card, profile name + icon + 1-line health | `/api/status` |
| `<SkillActivation />` | Active vs zombie split + sparkline + top-N | `/api/skill-report?profile=<active>` |
| `<TokenCostChart />` | Per-profile CLAUDE.md size bar chart | `/api/profiles` + computed |
| `<PairSuggestions />` | Top empirical pairs | `/api/pairs` |
| `<TriggerGaps />` | Top under-firing skills | `/api/trigger-gaps?profile=<active>` |
| `<GateTimeline />` | Recent gate runs across all profiles | `/api/gates?all=true` |

Each card has a "→ cue cmd-name" footer link that opens a copy-to-clipboard tooltip with the equivalent CLI command. Closes the loop between UI exploration and CLI action.

## API surface

All endpoints under `/api/v1/`:

| Endpoint | Returns | Wraps |
|---|---|---|
| `GET /api/v1/status` | active profile + counts + gate-latest | reuses `cue status --json` body |
| `GET /api/v1/profiles` | every profile + materialized-size if cached | reuses `cue list --json` + statSync |
| `GET /api/v1/skill-report?profile=<n>&since=<d>` | active vs zombie rows | reuses `computeSkillUsage` |
| `GET /api/v1/pairs?profile=<n>` | partner suggestions | reuses `suggestionsByProfile` |
| `GET /api/v1/gates?profile=<n>` or `?all=1` | gate runs | reuses `readGateStatus` / `readAllGateStatus` |
| `GET /api/v1/trigger-gaps?profile=<n>&since=<d>` | gap rows | reuses `computeTriggerGaps` |
| `GET /api/v1/telemetry/timeline?since=<d>` | day-bucketed event counts | reads analytics.jsonl |

Every endpoint:
- Returns `{ ok: true, data: T }` or `{ ok: false, error: string }`.
- Caches on the server for 5s (analytics + status don't change that fast).
- Returns `{ ok: false, error: "telemetry-disabled" }` when needed so the UI can render an empty-state with an enable button.

## File layout

```
src/
├── commands/
│   └── dashboard.ts          ← new — spawns the Bun server
├── lib/
│   └── dashboard-server.ts   ← new — Bun.serve() + handlers
└── ...

web/                           ← new — Vite + React app
├── package.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── routes/
│   │   └── index.tsx          ← single page MVP
│   ├── components/
│   │   ├── ActiveProfile.tsx
│   │   ├── SkillActivation.tsx
│   │   ├── TokenCostChart.tsx
│   │   ├── PairSuggestions.tsx
│   │   ├── TriggerGaps.tsx
│   │   └── GateTimeline.tsx
│   ├── lib/
│   │   ├── fetcher.ts         ← local vs vercel adapter
│   │   ├── format.ts          ← number/bytes/relative-time
│   │   └── query-keys.ts
│   └── styles/globals.css
├── public/
│   └── demo-data.json         ← realistic sample for Vercel mode
└── dist/                       ← built, served by Bun in local mode
```

Build pipeline:
```
$ bun run build:web     # cd web && vite build → web/dist/
$ bun run build         # cue's existing build + ensures web/dist exists
$ bun src/index.ts dashboard
  → reads web/dist/ as static + serves /api/* dynamically
```

## Local vs Vercel — the data layer

```ts
// web/src/lib/fetcher.ts
type Mode = "local" | "demo";

function detectMode(): Mode {
  // Vercel deployment sets window.__CUE_MODE__ = "demo" via inline script.
  // Local Bun server serves the index.html unchanged → mode = "local".
  return (window as any).__CUE_MODE__ ?? "local";
}

export function fetcher(path: string): Promise<unknown> {
  const mode = detectMode();
  if (mode === "demo") {
    return fetch("/demo-data.json").then((r) => r.json()).then((all) => all[path]);
  }
  return fetch(`/api/v1${path}`).then((r) => r.json());
}
```

`demo-data.json` is a single static file shipped to Vercel containing canned responses for every endpoint. Generated by a script that runs `cue *` commands against a demo profile and dumps the outputs.

## Why ship to Vercel at all

Two reasons:

1. **Marketing.** "What does cue look like?" → link to `cue.so/dashboard?demo=1`. Static, fast, no install required. Way more compelling than a README screenshot.
2. **First-5-minutes loop.** A new user downloads cue, opens `cue dashboard` locally, and sees the same UI they saw on the marketing page — but with their own (empty-ish) data. Aha moment.

## Open questions

- **Auth on the local server.** Bind to 127.0.0.1 only by default? Random token in the URL? MVP: 127.0.0.1 binding, no token. Document the assumption.
- **Dev-time hot reload.** `cue dashboard --dev` proxies to Vite's dev server. Convenient for dashboard authors, not shipped to users.
- **Real-time updates.** SSE endpoint that emits when analytics.jsonl changes? Deferred — manual refresh in v1.
- **Mobile UX.** MVP is desktop-only. Cards stack on narrow viewports but no first-class mobile design.
- **Theme.** System theme honored, no toggle. Light + dark via CSS variables.

## MVP scope (v1, 3–4 days)

Day 1 — server scaffold:
- `cue dashboard` command starts Bun.serve()
- 7 API endpoints wired to existing lib functions
- Returns JSON; smoke-tested with curl

Day 2 — Vite + React app skeleton:
- `web/` scaffolded with TanStack Router (single route) + Query + shadcn/ui
- 6 component shells with mock data
- `fetcher.ts` adapter

Day 3 — Real data + polish:
- All 6 cards reading real `/api/*` data
- Demo data generator script
- Recharts for token-cost + sparkline
- Empty states (telemetry off, no profiles, no gates)

Day 4 — Vercel + ship:
- `vercel.json` + GitHub Actions deploy from `web/dist/`
- Demo data baked in
- Landing page link from cue.so
- Documentation + screenshots in README

## Test plan

- Unit: every API endpoint returns shape `{ ok: true, data }` on happy path, `{ ok: false, error }` on telemetry-off.
- Unit: `fetcher` correctly switches modes.
- Component: snapshot test for each card with empty + populated states.
- e2e: `cue dashboard` boots, browser loads, 6 cards render within 500ms.
- Manual: deploy demo to a Vercel preview, verify it's standalone.

## Rollout

1. Ship the server + APIs first (week 1). No UI yet — `curl` returns JSON. Used by anyone scripting against cue.
2. Ship the React app behind `cue dashboard --experimental` (week 2).
3. Deploy demo to Vercel under `cue.so/dashboard` (week 3).
4. Drop `--experimental` once core endpoints stabilize.
