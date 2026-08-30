# Project loadout — project-aware skill/MCP loading

**Date:** 2026-07-02 · **Status:** approved (user: "yes implement it")

## Problem

A combined profile (e.g. `hostinger+medusa-vite+gstack+core+coolify+commerce+stripe+resend+skill-writer`)
materializes 169 skills and 14 MCPs into every session in a project that
plausibly needs a quarter of them. Cost: ~18k always-on tokens (skill
frontmatter), slower launches (more to materialize), manual MCP picking, and
no memory of what a given *project* actually needs.

cue already has the raw machinery, but it is opt-in or unwired:
`smart-subset` (needs `--subset "<prompt>"`), `lazy-skills.ts` (never called),
`conditional-skills.ts` (never called, though the profile schema has `when:`
on SkillRef/MCPRef), `mcpPrune` (per-profile opt-in), `project-scanner`
(profile suggestions only).

## Design (approved: A+B layered)

Deterministic **per-project loadout** decides *full vs deferred* for each
skill — never *keep vs drop* — so a wrong guess degrades to one extra lookup,
not a missing capability.

### Classification (`src/lib/project-loadout.ts`, pure + testable)

1. **Signals**: lowercased keyword set from the project — `scanProject()`
   languages/frameworks/tools + `package.json` dependency names (scoped deps
   contribute both parts: `@medusajs/medusa` → `medusajs`, `medusa`).
2. A skill is **full** when any of:
   - its `when:` condition (existing schema, now finally evaluated via
     `conditional-skills.ts`) matches the cwd;
   - it is in `ALWAYS_KEEP` (shared with smart-subset);
   - its id/category tokens or description words match a project signal;
   - the user promoted it (`userKeep` in the saved loadout).
3. Everything else is **deferred**: excluded from the materialized skills dir
   (that's what removes its always-on frontmatter cost) but listed in a single
   generated index skill.
4. **Fail open**: any error → no loadout, full profile, launch unaffected.
5. **Threshold**: loadout only engages when the profile has ≥ 25 local skills;
   lean profiles load as today.

### Deferred index skill

The materializer writes one generated (not symlinked) skill,
`cue-deferred-skills/SKILL.md`: frontmatter description says "index of
deferred skills — invoke when a needed capability seems missing"; the body is
a table of `id — description — absolute SKILL.md path` with the instruction to
Read the listed file and follow it. One always-on frontmatter line buys back
the entire deferred tail.

### Persistence

`~/.config/cue/loadouts.json` — `Record<absDir, entry>` mirroring
`mcp-overrides.json`. Entry: `{ profile, fingerprint (skill-set hash),
signalsHash, full[], deferred[], userKeep[], userDefer[], enabled,
capturedAt }`. Reused while profile fingerprint AND signals hash match;
recomputed otherwise. Deleted/edited via `cue loadout`.

### Launch wiring (claude-code only, v1)

After profile load + workspace overrides, before the MCP block:
filter `profile.skills.local` to the full set (copy-on-write) and attach
`profile.deferredSkills` (id + description). The runtime hash covers the
profile object, so a loadout change rebuilds the runtime automatically; two
projects sharing a profile with different loadouts just rebuild on switch.

Summary line:
`[cue] loadout: 42 skills full · 127 deferred (signals: medusa, vite, stripe) · --cue-full to load all`

Escapes: `--cue-full` flag (this launch), `CUE_LOADOUT=off` (globally),
`cue loadout off` (this project), `cue loadout keep <id…>` (promote skills).

### MCP integration

No new MCP machinery. Because the MCP block runs after loadout,
`getNeededMcps()` sees only full skills, so the existing picker grouping,
override reconciliation, and `mcpPrune` all become project-aware for free.
One addition: when the interactive MCP toggle opens with *no* remembered
override and a loadout is active, seed its initial state with the
auto-prunable suggestion (unpinned + unneeded unchecked) — the user reviews
and Enter persists it as the normal override.

### `cue loadout` command

`cue loadout` (show current project's loadout), `reset`, `keep <ids…>`,
`defer <ids…>`, `on|off`.

## Testing

- `project-loadout.test.ts`: signal extraction, classification rules
  (`when:` > ALWAYS_KEEP > keyword > deferred), persistence round-trip,
  fingerprint/signals invalidation, fail-open on unreadable cwd.
- Materializer test: deferred index skill is written, contains entries, and
  is absent when `deferredSkills` is empty.
- Existing suites must stay green (fingerprint change → hash change covered
  by existing hash tests).

## Out of scope (v1)

Codex runtimes, LLM refinement (approach C), per-skill body stubs
(superseded by the index — frontmatter, not bodies, is the always-on cost),
npx skill filtering, automatic MCP disabling on non-interactive launches.
