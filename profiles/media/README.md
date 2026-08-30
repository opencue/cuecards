# 🎬 media

Generative media profile — generate, edit, and remix AI **images, video, and audio**
via the [muapi](https://muapi.ai) model catalog (100+ models: Flux, Midjourney v7,
Kling 3.0, Veo3, Seedance 2.0, Suno V5).

Vendored from [SamurAIGPT/Generative-Media-Skills](https://github.com/SamurAIGPT/Generative-Media-Skills)
— 4 core primitives + 56 ready-to-run creative recipes, wired flat into the
`media/` skill namespace.

## Prerequisites (the bundled scripts need these)

```bash
# 1. Install the muapi CLI (engine for the core scripts)
npm install -g muapi-cli        # or: pip install muapi-cli

# 2. Configure your API key (get one at https://muapi.ai)
muapi auth configure --api-key "YOUR_MUAPI_KEY"
# ...or export it. Most engine scripts read MUAPI_KEY; ai-clipping and
#    platform setup read MUAPI_API_KEY — set BOTH to be safe:
export MUAPI_KEY="YOUR_MUAPI_KEY"
export MUAPI_API_KEY="YOUR_MUAPI_KEY"

# 3. jq and curl must be on PATH (the core scripts use them directly)
```

The **`kdenlive`** skill is local and needs no muapi key — just its own tools:

```bash
sudo apt-get install -y kdenlive melt ffmpeg mediainfo fonts-montserrat
```

Generated files default to `./media_outputs/` in your current working directory.

## What's inside

| Group | Count | Examples |
|---|---|---|
| **Core primitives** | 4 | `core-media` (generate image/video/music, upload), `core-edit` (edit/enhance/lipsync/effects), `core-platform` (auth + polling), `workflow` (recipe runner) |
| **Motion / video** | 21 | `cinema-director`, `seedance-2`, `ugc-video-factory`, `product-ad-cinematic`, `music-video` |
| **Social** | 7 | `instagram-post`, `youtube-shorts`, `product-campaign`, `social-pack` |
| **Edit / clipping** | 1 | `ai-clipping` (long video → ranked vertical shorts) |
| **Visual / design** | 27 | `nano-banana`, `logo-creator`, `ui-design`, `ad-creative`, `youtube-thumbnail`, `brand-kit` |
| **Local edit / render** | 1 | `kdenlive` — headless NLE via melt+ffmpeg: stitch, crossfade, title, score, render `.kdenlive` projects, reframe to 9:16. **No API key.** |

Use the recipes over the raw primitives — they bake in cinematography, atomic
design, and branding logic. Browse them with the `workflow` skill.

## Note on the import

The upstream repo is a single intact tree where library scripts reach back into
`../../../../core/media/*.sh` and read `../../schema_data.json` from the repo root.
cue uses a **flat 2-level** skill layout (`media/<slug>`), and the runtime
materializes every profile skill as a flat sibling under `runtime/skills/`. So the
cross-tree references were mechanically repointed to flat-sibling form
(`$SCRIPT_DIR/../../core-media/…`, `$SKILLS_ROOT/<slug>/…`), and `schema_data.json`
was vendored into `core-media/`. Recipe content (the SKILL.md prompts/logic) is
unchanged — only the helper-script paths were rewritten so they resolve in both the
source tree and the materialized runtime.

Descriptions are kept verbatim from upstream (feature-first), so the skills are
**invokable by name** but don't yet auto-trigger on natural-language prompts. Run
`/description-optimizer` on a skill to add `Use when user says "…"` trigger phrases.

## Activate

```bash
cue use media        # pin to the current directory
cue summon media     # soft-load into the live session (no restart)
```
