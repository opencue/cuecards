---
description: Brand-aware post composer + scheduler — loads the brand kit, drafts the post, generates the brand-styled image, and confirms before publishing to Postiz
argument-hint: <brand> [topic | --resume <draft-id>]
---

# /post-as <brand> [topic]

End-to-end posting under a specific brand. Forces the brand kit and
account confirmation flow so the agent can't accidentally publish under
the wrong identity.

## Parse arguments

- `<brand>` (required) — must match a directory under `profiles/postizz/brands/`
- `<topic>` (optional) — free-text seed; if omitted, prompt the user
- `--resume <draft-id>` — reopen an existing Postiz draft and continue

If `<brand>` is missing or doesn't exist, list available brands and stop.

## Phase 1 — load brand kit (mandatory)

```bash
BRAND_DIR="${CUE_REPO_ROOT}/profiles/postizz/brands/$BRAND"
test -d "$BRAND_DIR" || { echo "Unknown brand: $BRAND"; exit 1; }
test -f "$BRAND_DIR/brand.md" -a -f "$BRAND_DIR/logo.png" || {
  echo "Brand $BRAND is a placeholder — fill in brand.md + logo.png first."; exit 1; }
```

Read both files in full:
- `brand.md` → palette, typography, voice, card template, voice mixes
- `accounts.yaml` → integration IDs, default platforms, cadence, compliance

## Phase 2 — confirm target accounts

From `accounts.yaml` `defaults.card-image` (or the content-type the user
asked for), build the list of `(platform, handle, integration_id)`.
Show it to the user:

```
About to publish under VOLARIA:
  x         @volaria          (x_abc)
  threads   @volaria          (th_def)
  instagram @volaria          (ig_xyz)

Topic: <topic>
Card format: 4:5 vertical meme news card

Proceed? [y/N]
```

Wait for explicit `y`. Anything else → abort, show how to override.

## Phase 3 — draft copy

Use the voice rules from `brand.md` (e.g. for VOLARIA: authoritative,
dry-witty, no finfluencer cringe, clean tickers). For longer drafts,
invoke the `article-writer` skill with the brand's recommended voice
mix per preset (`brand.md` § Composite voices).

Show 2-3 copy variants. Let user pick.

## Phase 4 — generate brand-styled image

Use the brand's card template from `brand.md` as the image-gen system
prompt. Pass `brands/<brand>/logo.png` as a reference image — instruct
the model to use it **EXACTLY** (no redraw/recolor/restyle).

Image-gen tools (pick the right one for the format):
- `mcp__higgsfield__generate_image` (4:5 card, hero image)
- Postiz built-in (`mcp__postiz__generate_media`) for quick variants

Save to `/tmp/post-<brand>-<timestamp>.png` for review.

## Phase 5 — apply compliance + cadence

Before scheduling, run through `accounts.yaml § compliance`:
- For VOLARIA: append "Not financial advice" disclaimer if copy is
  trade-actionable. Strip any AUM figures or named clients.
- Check `cadence.max_posts_per_day` and `min_minutes_between` — warn
  if scheduling would breach.
- Check `blackout_hours_utc` — if scheduling falls inside, suggest the
  next available slot.

## Phase 6 — schedule via Postiz

```
mcp__postiz__create_post(
  integrations=[<resolved IDs from Phase 2>],
  content=<approved copy>,
  media=[<image path>],
  scheduledAt=<resolved slot>
)
```

Confirm draft ID and scheduled time back to the user.
