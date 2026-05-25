---
description: Brand-aware article-writer wrapper — picks the right preset + voice mix for the brand, then hands off to the article-writer skill
argument-hint: <brand> <preset> "<topic>" [--length short|standard|long] [--lang en|hu]
---

# /article-as <brand> <preset> "<topic>"

Brand-aware shortcut around the `article-writer` skill. Picks the
correct composite voice mix automatically from the brand's `brand.md`,
so you don't have to type it every time.

## Parse arguments

- `<brand>` — must match `profiles/postizz/brands/<brand>/`
- `<preset>` — one of `qa-interview`, `op-ed`, `sector-analysis`, `listicle`, `breaking-news`
- `<topic>` — quoted, free-text
- `--length short|standard|long` — passed through to article-writer
- `--lang en|hu` — passed through

## Phase 1 — resolve brand → voice mix

Read `profiles/postizz/brands/<brand>/brand.md`. Find the **Composite
voices** table. Look up `<preset>` → `Default voice mix`.

If `<brand>` doesn't have a Composite voices section, fall back to
`--voices none` and warn the user (single author voice; consider adding
voice mixes to the brand kit).

## Phase 2 — restate and confirm

```
About to draft under VOLARIA:
  Preset:  sector-analysis
  Voices:  macro-strategist, quant-hedge, ai-infra-founder
  Topic:   <topic>
  Length:  standard
  Lang:    en

Proceed? [y/N]
```

## Phase 3 — invoke article-writer

Construct the equivalent `/article` invocation and hand off:

```
/article <preset> "<topic>" --voices <resolved> [--length …] [--lang …]
```

After the article is written, remind the user:

> Article draft saved. Use `/post-as <brand>` to publish a teaser card
> linking back to this article.
