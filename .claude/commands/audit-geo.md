---
description: Audit cuecards GEO health — verify AI-discoverability files are accurate, citation-ready, and consistent with the source code
---

# /audit-geo — GEO Health Check for cuecards

Audit cuecards' Generative Engine Optimisation (GEO) layer for accuracy and completeness.
GEO = making Cue easy for ChatGPT, Perplexity, Google AI Overviews, and similar systems
to understand, summarise, and cite correctly.

## What to check

### 1. llms.txt accuracy (root)
- Version/install command is current: `grep "npm install" llms.txt` matches current npm package
- Supported agent count matches `docs/llms-full.txt`

### 2. web/public/llms.txt accuracy
- Consistent with root `llms.txt`
- All linked GitHub URLs resolve (spot-check 3)

### 3. content/geo/entity-profile.json
- Valid JSON: `python3 -m json.tool content/geo/entity-profile.json > /dev/null`
- `@type` includes `SoftwareApplication`
- `featureList` count ≥ 8
- `keywords` list ≥ 8 terms
- `description` field matches README tagline (no drift)

### 4. content/geo/brand-facts.md
- Agent count in "Supported agents" section matches `docs/llms-full.txt`
- Install commands are syntactically valid bash
- Token cost claim (10–25×) matches README claim

### 5. content/geo/answer-engine-faq.md
- Every answer is ≥ 2 sentences (too short = not citation-worthy)
- Install commands match current `package.json` package name
- No questions reference outdated file names (e.g. `.cue-profile` should now be `.cue.profile`)

### 6. content/geo/ai-discovery-map.yml
- All `url:` values use the correct GitHub org (`opencue/cuecards`)
- No dead paths referenced (check `do_not_scrape` list is still accurate)

### 7. Consistency cross-check
- Product name: "cuecards" (lowercase) used consistently — not "CUE" or "Cue" as primary
- npm package: `cue-ai` consistent across all geo files
- Repository: `https://github.com/opencue/cuecards` consistent

## Report format

| File | Status | Issues |
|---|---|---|
| llms.txt (root) | ✅/❌ | ... |
| web/public/llms.txt | ✅/❌ | ... |
| entity-profile.json | ✅/❌ | ... |
| brand-facts.md | ✅/❌ | ... |
| answer-engine-faq.md | ✅/❌ | ... |
| ai-discovery-map.yml | ✅/❌ | ... |
| Cross-file consistency | ✅/❌ | ... |

Flag any factual drift (e.g. agent count changed, install command changed)
as HIGH priority — stale GEO content is worse than no GEO content.
