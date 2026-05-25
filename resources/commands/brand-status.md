---
description: List registered postizz brands with active accounts, last-post times, and any drift between accounts.yaml and live Postiz integrations
argument-hint: [brand-name | blank for all]
---

# /brand-status

Show the state of every registered brand under `profiles/postizz/brands/`,
or just the one named in `$ARGUMENTS`. Use this before posting to confirm
which brand assets and accounts are wired up.

## Phase 1 — discover

```bash
ls "${CUE_REPO_ROOT}/profiles/postizz/brands/"
```

For each brand dir (or just `$ARGUMENTS` if given):
1. Read `brands/<brand>/brand.md` — extract: status line, palette one-liner, voice mixes for each preset.
2. Read `brands/<brand>/accounts.yaml` — extract: accounts map, defaults, cadence, compliance.
3. Note any `TODO` markers or empty `integration_id: ""` fields.

## Phase 2 — cross-check with live Postiz

Call `mcp__postiz__list_integrations` (or `postiz integrations:list -o json`).
For each integration_id in accounts.yaml:
- Mark **OK** if present in live list
- Mark **DRIFTED** if missing or disabled
- Mark **UNKNOWN** if the accounts.yaml value is empty

If Postiz is unreachable (`curl -fsS http://localhost:4007 >/dev/null`
fails), say so and skip Phase 2.

## Phase 3 — report

Output one block per brand:

```
📮 volaria — active
  brand.md     ✓ loaded (palette: jet-black / amber / teal)
  voices       ✓ qa-interview, op-ed, sector-analysis, listicle, breaking-news
  accounts.yaml
    x          @volaria          (id: x_abc)   OK
    threads    @volaria          (id: <empty>) UNKNOWN — fill in accounts.yaml
    instagram  @volaria          (id: ig_xyz)  DRIFTED — not in live Postiz
    linkedin   volaria-financial (id: li_456)  OK
  cadence      6/day, ≥45min between, blackout 00-04 UTC
  compliance   2 rules (not-financial-advice, no-AUM-names)

📮 slopix — placeholder
  brand.md     ⚠ placeholder, missing logo + voice
  accounts.yaml  empty
```

End with a one-line summary: `X brands registered, Y active, Z need attention`.
