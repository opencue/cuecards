# postizz brands

One subdir per brand the user posts as. Each brand owns its own logo,
design system, and Postiz account map. The agent must load the relevant
`brand.md` before generating images or copy for that brand, and must
reference the brand's `logo.png` as-is (never redraw).

## Structure

```
brands/<brand>/
├── logo.png         # use EXACTLY — never redraw/recolor/restyle
├── brand.md         # palette, typography, voice, card template, voice mixes
└── accounts.yaml    # Postiz integration IDs + default platforms + cadence + compliance
```

## Registered brands

| Brand | Status | Notes |
|---|---|---|
| [volaria](./volaria/brand.md) | active | Financial / markets — cinematic editorial card format |
| [slopix](./slopix/brand.md) | placeholder | Assets + accounts not yet filled in |

## Account confirmation

Before posting via Postiz, the agent ALWAYS:

1. Reads `brands/<brand>/accounts.yaml` to find the integration IDs for
   the target brand.
2. Cross-checks with live Postiz state (`postiz_list_integrations` MCP
   call or `postiz integrations:list` CLI) — IDs in accounts.yaml that
   no longer exist are flagged.
3. Confirms the resolved `(brand, account, platforms)` triple with the
   user and waits for explicit "yes" before scheduling/publishing.

Posting under the wrong brand is hard-to-reverse — never skip step 3.
