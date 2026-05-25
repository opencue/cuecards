# VOLARIA — brand kit

Financial / markets brand. Cinematic, editorial, weighty. Bloomberg
Businessweek meets late-night talk-show meme aesthetic.

## Logo

`brands/volaria/logo.png` — 388×240 PNG, RGBA. **Use it EXACTLY as supplied.**
Never redraw, recolor, restyle, crop the chrome, or generate a "similar"
mark. Pass it as a reference image to every image-gen call.

## Palette

- **Jet black** `#000000` — primary background, header/footer bands
- **Warm spotlight amber** — single editorial highlight tone for hero subject
- **Teal-and-amber** color grade — cinematic mid-tones
- **Subtle red glow** — accent for emotional weight, sparingly
- **Pure white** `#FFFFFF` — headline type only

## Typography

- **Headline**: Druk / Bebas Neue — massive bold uppercase condensed sans,
  perfectly kerned, tight leading. White on black.
- **Label/eyebrow**: thin white uppercase sans, small caps feel
- **Body**: not used on card-format posts — keep image-first

## Voice

Authoritative, dry-witty, market-aware. Drop opinions confidently.
Never hedge. Avoid finfluencer cringe ("to the moon", emoji-spam,
"this is huge"). Tickers stay clean (`$NVDA`, not `$NVDA 🚀`).

## Composite voices (article-writer)

When invoking `/article` (article-writer skill) under VOLARIA, use these
voice mixes by default. Voice definitions live in the article-writer
skill's [voices library](../../../../../resources/skills/skills/content/article-writer/voices.md).
Do not invent new voices — add them to the shared library so other
brands can reuse them.

| Preset | Default voice mix | Notes |
|---|---|---|
| `qa-interview` | `macro-strategist, eu-prime-broker, us-vc-partner` | Pick 2-3. Add `hk-allocator` for Asia-tilted topics, `defense-procurement` for dual-use / supply-chain stories. |
| `op-ed` | `none` | VOLARIA op-eds are single-author voice. Use the brand voice above. |
| `sector-analysis` | `macro-strategist, quant-hedge, ai-infra-founder` | Swap `ai-infra-founder` for `defense-procurement` / `eu-policy-analyst` depending on the sector. |
| `listicle` | `none` | Crisp brand voice; no composite quotes. |
| `breaking-news` | `none` | Lede + context only. If a quote is essential, use one voice — never a multi-voice panel for breaking. |

Composite-voice articles MUST include the standard composite-voices
disclaimer in frontmatter (see article-writer SKILL.md, Phase 2).

## Card template — 4:5 vertical meme news card

Use this as the system prompt for image-gen calls when posting a
VOLARIA take. Adapt the headline and middle-image subject to the topic;
the layout/palette/logo placement is fixed.

```
LAYOUT — three stacked horizontal bands:

1) TOP HEADER BAR (10%): solid jet-black, logo centered, unchanged.

2) MIDDLE IMAGE (55%): Cinematic editorial close-up of <SUBJECT>,
   single dramatic warm spotlight, deep black space, subtle red glow
   from below if emotional, deep cinematic shadows, teal-and-amber
   color grade, 50mm macro lens. No people, no other text. Bloomberg
   Businessweek meets late-night talk-show meme aesthetic — weighty,
   dramatic, inviting.

3) BOTTOM TEXT BLOCK (35%): solid jet-black. Massive bold white
   uppercase condensed sans-serif headline (Druk / Bebas Neue style),
   perfectly kerned, tight leading, three lines exactly, left-aligned:

   <LINE 1>
   <LINE 2>
   <LINE 3>

Under headline, small thin white uppercase label: <CTA, e.g. ENGAGE>

All three lines FULLY VISIBLE, breathing margin.

Style: Apple Keynote precision, viral X meme energy. Hyper-sharp text.
Logo unchanged. No emoji.
```

## Subject / headline examples

| Subject | Headline (3 lines) | CTA |
|---|---|---|
| Vintage chrome studio microphone with "HOTTEST TAKE" tag | DROP YOUR / HOTTEST / MARKET TAKE. | ENGAGE |
| Bull and bear figurines mid-collision | THE TAPE / DOESN'T / CARE. | READ |
| Cracked CD labeled S&P 500 | THE INDEX / IS NOT / THE MARKET. | DIG IN |

Always three lines. Always uppercase. Always tight.

## Don't

- Don't generate the logo from scratch — always reference the PNG
- Don't add gradients to the bands (solid jet-black only)
- Don't use color photography that fights the teal-amber grade
- Don't use stock-photo people — keep it object-first, editorial
- Don't include emoji or hashtags inside the image
