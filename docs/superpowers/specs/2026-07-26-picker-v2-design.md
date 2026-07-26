# cue picker v2 — suggestion-first profile chooser

Status: approved 2026-07-26. Supersedes the two-screen picker flow in
`src/lib/picker.ts` (kept behind `CUE_PICKER=classic`).

## Problem

`cue launch` opens a 93-row profile list, then a second "combine with…" multiselect.
Three complaints, in the user's words: the first list is too long, the combine screen
is confusing, and the whole thing is visually hard to read. Detection accuracy was
*not* a complaint — the signals exist, they just never assemble into an answer.

## Design

### 1. Suggestion-first card

The picker opens on a card, not a list:

```
╭─ cue · ~/Documents/cue ──────────────────╮
│  suggested stack                    1/3  │
│    🦀 rust  +  🔒 secops                 │
│    Cargo.toml · src/main.rs · CI         │
│    31 skills · 2 mcps · ~6k always-on 🟢 │
│  ⏎ launch  ↹ next  e edit  / search      │
╰──────────────────────────────────────────╯
```

Keys: `⏎` launch · `↹`/`↑↓` cycle suggestions · `e` edit in palette · `/` palette in
search mode · `a` palette scrolled to all profiles · `p` toggle pin · `?` help ·
`esc` cancel (exit 130).

Pinning folds into the card (`p`), removing the separate "Pin to this directory?"
confirm — one less step.

### 2. Unified stack palette

`e` / `/` / `a` open **one** screen that replaces both classic screens: primary and
companions live in the same list, `space` toggles, typing fuzzy-filters, and a sticky
footer always shows the stack being built plus its cost. `esc` returns to the card.

Sections, in order: suggested · detected in this cwd · frequently used · featured ·
all profiles (by category). Conflicting rows render `[—] (conflicts with X)` as today.

### 3. Suggestion engine

`suggestStacks()` in `src/lib/stack-suggest.ts` — a pure function, no I/O, no TTY.
It fuses signals `launch.ts` already collects:

| Source | Weight base |
|---|---|
| cwd detection (`detectProfileV2`) | `confidence × 100` |
| path rules (new, `pathSignals()`) | merged into detection by `max` |
| combo history (`combo-history`) | 45 + count bonus |
| cwd-scoped recents | 40 + session bonus |
| global recents | 25 + session bonus |
| featured | 15 |
| Default selector | 5 (last resort) |

A candidate stack = primary + companions, where companions come from the primary's
`autoSelect`, high-confidence detected companions, and frequent partners; capped at
3 parts and run through the existing symmetric conflict resolution. Ranked, deduped
by part-set, capped at 3 suggestions. **The card is never empty**: with no signal at
all it shows the Default selector and says so.

New path rules (only for profiles that exist): `medusa-shops/<shop>` → `medusa-stack`
(+ `medusa-next`/`medusa-vite` by storefront config), `websites/<site>` → `frontend`,
`wp-config.php` → `wordpress`, ROS `package.xml` → `ros2`, `.n8n/` or n8n compose →
`n8n`, markdown-only directory → `docs-writer`, `*.tf` → `ops`.

### 4. Module layout

`picker.ts` (1542 lines) does not grow. Shared pieces move out and are re-exported
from `picker.ts` so every existing import keeps resolving:

- `src/lib/picker/types.ts` — `PickerOption`, `PickerInput`, `PickerOutput`
- `src/lib/picker/selector.ts` — `DIVIDER_PREFIX`, sentinels, `dedupeSelectorParts`
- `src/lib/picker/render-util.ts` — `displayWidth`, `windowOptions`, ASCII icon mode
- `src/lib/picker/tally.ts` — `ProfileTally`, tally math, overhead badge
- `src/lib/profile-conflicts.ts` — `buildConflictMap`, `resolveConflicts`
- `src/lib/stack-suggest.ts` — the engine above
- `src/lib/picker/card.ts` — `renderCardFrame` + `CardPrompt`
- `src/lib/picker/palette.ts` — fuzzy match, row builder, `renderPaletteFrame`, `StackPalettePrompt`
- `src/lib/picker/flow.ts` — `runPickerV2` orchestration

### 5. Behavior guarantees

- `runPicker` returns the same `{ profile, pinned }`; nothing downstream changes.
- Every signal read stays best-effort `try/catch`; a failure degrades the card, never
  crashes the launch.
- Non-TTY semantics unchanged (`launch.ts` already exits 1 before the picker).
- `CUE_ASCII_ICONS` honored throughout; narrow/short terminals use compact rendering
  and windowed lists.
- `CUE_PICKER=classic` restores the old flow byte-for-byte.

### 6. Testing

New: `stack-suggest.test.ts` (ranking, fallback chain, conflict filtering, path rules,
determinism), `card.test.ts` (frames: no-signal, paging, heavy-stack warning, ASCII,
narrow terminal), `palette.test.ts` (fuzzy scoring, sections, conflict rendering,
footer, windowing). The existing 1203-line `picker.test.ts` stays green as the
classic-path regression net.

Out of scope (YAGNI): AI repo scan, mouse support, theming, kitty icon rework,
`cue init`'s own prompt.
