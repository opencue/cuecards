# Agent Context Budget

This repo ships profile definitions, skills, MCP configs, setup manuals, test
fixtures, and generated catalogs. Many files are intentionally large. Keep the
always-injected agent prompt small and open detailed docs only when needed.

## Permanent Defaults

- First-run onboarding should default to `core`.
- Broader composites such as `core+skill-writer` or `core+caveman-quick` should
  be opt-in.
- Setup docs may describe optional composites, but the low-context path is
  `core` until the user asks for more.

## Files To Avoid Loading By Default

- `resources/skills/catalog/*.json`
- `resources/skills/skills/**/test/fixtures/*`
- `resources/skills/skills/**/fixtures/*`
- `docs/assets/*.svg`
- `dist/*`
- `node_modules/*`
- package-manager caches
- `~/.config/cue/analytics.jsonl`
- `~/.config/cue/session-log.jsonl`

Use `wc -c` or `du -h` first, then a narrow `rg`, `head`, `tail`, or `sed -n`.

## Lean Install Guidance

Use `setup/lean-cue.md` for the smallest path. It should install cue and pin
`core` by default. Caveman, RTK, skill-writing, memory, gbrain, and Office MCPs
are optional add-ons.

## Model-Aware Startup Budget

A profile's *always-on* footprint — skill frontmatter (loaded into the skill
router every message) plus MCP tool schemas (one set per connected server) — is
paid before the user types anything. The rule cue enforces: that startup load
should stay under **50% of the model's context window**, leaving the other half
as working headroom. For a 256K model that's a **~128K startup ceiling**.

The math lives in `src/lib/token-budget.ts` (pure, unit-tested in
`token-budget.test.ts`):

- `resolveContextWindow` picks the window. Precedence: profile `contextWindow`
  → profile `model` (via `MODEL_CONTEXT_WINDOWS`) → env `CUE_CONTEXT_WINDOW`
  → env `CUE_MODEL` → `DEFAULT_CONTEXT_WINDOW` (256K). cue can't auto-detect the
  main-session model (per-launch `/model` choice), hence the declared/env source.
- `estimateMcpTokens` charges `MCP_TOKENS_PER_SERVER` (default 1500, override
  with `CUE_MCP_TOKENS_PER_SERVER`) per connected MCP.
- `computeContextBudget` returns the budget, the startup load, and whether it
  fits. `formatContextBudgetWarning` stays quiet under 80% of budget, prints a
  🟡 note as it approaches, and a 🔴 over-budget warning past the ceiling.

Surfaces:

- `cue launch` prints the warning in the startup banner (real resolved skill +
  MCP token data).
- `cue profile suggest` adds a **Context budget** section auditing every
  profile; flags `--model <id>`, `--context <tokens>`, `--load-factor <0..1>`,
  and `--no-budget` to skip it.

Profiles declare their target via the `model` / `contextWindow` fields (both
optional, leaf-wins through inheritance). `core` sets `contextWindow: 256000` as
the fan-out baseline; a long-context profile can bump it (e.g.
`model: claude-opus-4-8[1m]` for a 1M window).

## Onboarding Source

`src/commands/init.ts` controls first-run global onboarding. Keep the first
option and `initialValue` aligned with the low-context default:

```text
core
```

Tests around default-profile parsing live in `src/lib/cwd-resolver.test.ts`.
Those tests should continue allowing composites; the change is only the default
recommendation.
