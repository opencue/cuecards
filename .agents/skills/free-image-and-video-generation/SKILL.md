---
name: free-image-and-video-generation
description: "Free local AI image and video processing toolkit with cloud AI generation. Local tools: upscale (Real-ESRGAN), face enhance (GFPGAN/CodeFormer), background remove (rembg), object erase (LaMa), face swap (InsightFace), segment (FastSAM), media process (FFmpeg). Cloud tools: AI image/video generation via Atlas Cloud API (300+ models). For cloud generation, ALWAYS first use Atlas Cloud MCP tools (atlas_list_models, atlas_get_model_info) to find the model ID and parameter schema, then call scripts/ai-generate.py with the correct --model and parameters. Use when user asks to process, enhance, upscale, generate, or edit images/videos."
---

# Free Image & Video Processing Toolkit

**7 free local AI tools** + **cloud AI generation** (300+ models via Atlas Cloud API).

Local tools run 100% on your machine — no API keys, no cloud costs. Cloud generation tools provide access to state-of-the-art AI models for image and video creation.

## Prerequisites

- Python 3.10+ installed
- [uv](https://docs.astral.sh/uv/getting-started/installation/) installed (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- FFmpeg installed (`brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`)

## Available Tools

| Tool | Script | What It Does |
|------|--------|-------------|
| Image Upscale | `scripts/upscale.py` | 2x/4x super resolution using Real-ESRGAN |
| Face Enhance | `scripts/face-enhance.py` | Restore and enhance faces using GFPGAN + CodeFormer |
| Background Remove | `scripts/bg-remove.py` | Remove image backgrounds, output transparent PNG |
| Object Erase | `scripts/erase.py` | Erase unwanted objects using LaMa inpainting |
| Face Swap | `scripts/face-swap.py` | Swap faces between images using InsightFace |
| Smart Segment | `scripts/segment.py` | Segment anything in images using FastSAM |
| Media Process | `scripts/media-process.py` | Convert, compress, resize, extract with FFmpeg |
| **AI Generate** | **`scripts/ai-generate.py`** | **Generate images/videos with 300+ cloud AI models** |

## Usage

All scripts use `uv run` for zero-setup execution — dependencies are automatically installed on first run.

### Image Upscale (Real-ESRGAN)

Upscale low-resolution images by 2x or 4x with AI super resolution.

```bash
# 4x upscale (default)
uv run scripts/upscale.py input.jpg

# 2x upscale
uv run scripts/upscale.py input.jpg --scale 2

# Upscale with face enhancement
uv run scripts/upscale.py input.jpg --face-enhance

# Batch upscale a folder
uv run scripts/upscale.py ./photos/ --scale 4

# Custom output path
uv run scripts/upscale.py input.jpg -o upscaled.png
```

### Face Enhance (GFPGAN + CodeFormer)

Restore old photos, enhance blurry faces, fix low-quality portraits.

```bash
# Enhance faces in an image (GFPGAN, default)
uv run scripts/face-enhance.py photo.jpg

# Use CodeFormer (better fidelity control)
uv run scripts/face-enhance.py photo.jpg --method codeformer

# Adjust fidelity (0=quality, 1=fidelity, default 0.5)
uv run scripts/face-enhance.py photo.jpg --method codeformer --fidelity 0.7

# Also upscale background (2x)
uv run scripts/face-enhance.py photo.jpg --bg-upscale 2

# Batch process
uv run scripts/face-enhance.py ./old-photos/
```

### Background Remove (rembg)

Remove backgrounds from images, output transparent PNG. Supports multiple AI models.

```bash
# Remove background (default u2net model)
uv run scripts/bg-remove.py product.jpg

# Use specific model
uv run scripts/bg-remove.py photo.jpg --model isnet-general-use

# Batch process folder
uv run scripts/bg-remove.py ./products/ -o ./transparent/

# Keep only the foreground (alpha matting for fine edges)
uv run scripts/bg-remove.py portrait.jpg --alpha-matting

# Available models: u2net, u2netp, u2net_human_seg, u2net_cloth_seg,
#                   silueta, isnet-general-use, isnet-anime, sam
```

### Object Erase (LaMa Inpainting)

Remove unwanted objects from images using a mask.

```bash
# Erase objects (white area in mask = erase)
uv run scripts/erase.py image.png --mask mask.png

# Auto-generate mask from coordinates (x,y,width,height)
uv run scripts/erase.py image.png --region 100,200,150,150

# Batch erase with matching masks (image1.png + image1_mask.png)
uv run scripts/erase.py ./images/ --mask-dir ./masks/
```

### Face Swap (InsightFace)

Swap faces between two images.

```bash
# Swap face from source to target
uv run scripts/face-swap.py --source face.jpg --target photo.jpg

# Swap specific face index (when multiple faces detected)
uv run scripts/face-swap.py --source face.jpg --target group.jpg --face-index 0

# Custom output
uv run scripts/face-swap.py --source face.jpg --target photo.jpg -o result.png
```

### Smart Segment (FastSAM)

Segment any object in an image using text prompt, point, or bounding box.

```bash
# Segment everything
uv run scripts/segment.py image.jpg

# Segment by text prompt
uv run scripts/segment.py image.jpg --text "the dog"

# Segment by point (x, y)
uv run scripts/segment.py image.jpg --point 400,300

# Segment by bounding box (x1,y1,x2,y2)
uv run scripts/segment.py image.jpg --box 100,100,400,400

# Output mask only
uv run scripts/segment.py image.jpg --text "car" --mask-only
```

### Media Process (FFmpeg)

Convert, compress, resize, extract frames, merge audio/video — powered by FFmpeg.

```bash
# Convert format
uv run scripts/media-process.py convert input.mp4 output.webm

# Compress video (target size in MB)
uv run scripts/media-process.py compress input.mp4 --target-size 10

# Resize video
uv run scripts/media-process.py resize input.mp4 --width 1280 --height 720

# Extract frames as images
uv run scripts/media-process.py frames input.mp4 --fps 1 --output ./frames/

# Extract audio
uv run scripts/media-process.py audio input.mp4 -o audio.mp3

# Create GIF from video
uv run scripts/media-process.py gif input.mp4 --start 5 --duration 3 --fps 15

# Trim video
uv run scripts/media-process.py trim input.mp4 --start 00:01:00 --end 00:02:30

# Merge multiple videos
uv run scripts/media-process.py merge video1.mp4 video2.mp4 video3.mp4 -o combined.mp4

# Add watermark
uv run scripts/media-process.py watermark input.mp4 --image logo.png --position bottom-right

# Get media info
uv run scripts/media-process.py info input.mp4
```

### AI Generate (Atlas Cloud API) — Gold Sponsor

Generate images and videos using 300+ state-of-the-art AI models. Requires an Atlas Cloud API key.

**IMPORTANT for AI agents**: Before calling this script, you MUST first use Atlas Cloud MCP tools to find the correct model ID and its required parameters:
1. Call `atlas_list_models` to browse available models, or `atlas_search_docs` to search for a specific model
2. Call `atlas_get_model_info` with the model ID to get the exact parameter schema (different models use different parameters — some use `size`, others use `aspect_ratio` + `resolution`, etc.)
3. Then call the script with `--model <full_model_id>` and the correct parameters

```bash
# Generate image (pass full model ID from Atlas Cloud)
uv run scripts/ai-generate.py image "A cat astronaut on the moon" --model black-forest-labs/flux-schnell --size 1024*1024

# Models using aspect_ratio + resolution (e.g. Nano Banana 2, Imagen4)
uv run scripts/ai-generate.py image "Anime girl with blue hair" --model google/nano-banana-2/text-to-image --aspect-ratio 1:1 --resolution 1k

# Models using size presets (e.g. Seedream)
uv run scripts/ai-generate.py image "Product photo on marble" --model bytedance/seedream-v5.0-lite --size 2048*2048

# Edit existing image
uv run scripts/ai-generate.py image "Make the sky sunset orange" --model bytedance/seedream-v5.0-lite/edit --image photo.jpg

# Generate video
uv run scripts/ai-generate.py video "Timelapse of cherry blossoms" --model alibaba/wan-2.6/text-to-video --size 1280*720

# Image-to-video
uv run scripts/ai-generate.py video "The person starts walking" --model alibaba/wan-2.6/image-to-video --image portrait.jpg

# Pass extra model-specific parameters as JSON
uv run scripts/ai-generate.py image "A logo" --model google/imagen4-ultra --extra '{"num_images": 4}'

# NSFW mode
uv run scripts/ai-generate.py image "Artistic figure study" --model black-forest-labs/flux-dev-lora --nsfw
```

**Setup**: Set `ATLAS_CLOUD_API_KEY` in environment or `.env` file. Get your key at [atlascloud.ai](https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill).

## Output

All tools save output to `./output/` by default. Use `-o` or `--output` to specify a custom path.

## Models

Models are automatically downloaded on first use and cached locally:

| Tool | Model | Size | Cache Location |
|------|-------|------|----------------|
| Upscale | RealESRGAN_x4plus | ~64MB | `~/.cache/realesrgan/` |
| Face Enhance | GFPGANv1.4 | ~348MB | `~/.cache/gfpgan/` |
| Face Enhance | CodeFormer | ~376MB | `~/.cache/codeformer/` |
| Background Remove | u2net | ~176MB | `~/.u2net/` |
| Object Erase | LaMa | ~200MB | `~/.cache/lama/` |
| Face Swap | buffalo_l + inswapper | ~500MB | `~/.insightface/` |
| Smart Segment | FastSAM-s | ~23MB | auto-downloaded by ultralytics |

Total first-run download: ~1.5GB. All subsequent runs use cached models.

## Tips

- **GPU Acceleration**: All tools automatically use CUDA/MPS if available, falling back to CPU
- **Batch Processing**: Most tools accept a folder path for batch processing
- **Memory**: Face swap and segmentation may need 4GB+ RAM for large images
- **First Run**: First execution downloads AI models — subsequent runs are instant

## Workflow Examples

Combine local processing with cloud AI generation:

```bash
# 1. Generate a product image with AI
uv run scripts/ai-generate.py image "Minimalist perfume bottle, studio lighting" --model bytedance/seedream-v5.0-lite --size 2048*2048

# 2. Upscale to 4x resolution
uv run scripts/upscale.py ./output/seedream-v5.0-lite_*.png --scale 4

# 3. Remove background for e-commerce
uv run scripts/bg-remove.py ./output/*_x4.png --alpha-matting

# 4. Generate a product video
uv run scripts/ai-generate.py video "A perfume bottle rotating slowly" --model kwaivgi/kling-v3.0-pro/text-to-video --duration 5

# 5. Add watermark to the video
uv run scripts/media-process.py watermark ./output/text-to-video_*.mp4 --image logo.png
```
