#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "requests>=2.31",
#   "pillow>=10.0",
# ]
# ///

"""
AI Image & Video Generation via Atlas Cloud API
Supports any model available on Atlas Cloud (300+ models)
AI agents should use Atlas Cloud MCP tools to search models before calling this script
Powered by Atlas Cloud (Gold Sponsor)
"""

import argparse
import os
import sys
import time
import json
import requests
from pathlib import Path


API_BASE = "https://api.atlascloud.ai/api/v1/model"


def get_api_key():
    key = os.environ.get("ATLAS_CLOUD_API_KEY") or os.environ.get("ATLASCLOUD_API_KEY")
    if not key:
        env_files = [".env", os.path.expanduser("~/.env")]
        for env_file in env_files:
            if os.path.exists(env_file):
                with open(env_file) as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("ATLAS_CLOUD_API_KEY=") or line.startswith("ATLASCLOUD_API_KEY="):
                            key = line.split("=", 1)[1].strip().strip('"').strip("'")
                            break
            if key:
                break
    if not key:
        print("Error: Atlas Cloud API Key not found")
        print()
        print("Setup (choose one):")
        print("  1. Environment: export ATLAS_CLOUD_API_KEY=your_key")
        print("  2. .env file:   echo 'ATLAS_CLOUD_API_KEY=your_key' >> .env")
        print()
        print("Get your free API key: https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill")
        print("New users get free credits, no credit card required")
        sys.exit(1)
    return key


def submit_request(endpoint, payload, api_key):
    url = f"{API_BASE}/{endpoint}"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    resp = requests.post(url, json=payload, headers=headers, timeout=30)
    if resp.status_code != 200:
        print(f"API error ({resp.status_code}): {resp.text[:500]}")
        sys.exit(1)
    data = resp.json()
    if data.get("code") != 200:
        print(f"API error: {data.get('message', 'Unknown error')}")
        sys.exit(1)
    request_id = data.get("data", {}).get("id")
    if not request_id:
        print(f"Unexpected API response: {json.dumps(data, indent=2)}")
        sys.exit(1)
    return request_id


def poll_result(request_id, api_key, max_wait=300):
    url = f"{API_BASE}/result/{request_id}"
    headers = {"Authorization": f"Bearer {api_key}"}
    start_time = time.time()
    while time.time() - start_time < max_wait:
        try:
            resp = requests.get(url, headers=headers, timeout=30)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            time.sleep(3)
            continue
        if resp.status_code != 200:
            time.sleep(3)
            continue
        data = resp.json().get("data", resp.json())
        status = data.get("status", "")
        if status in ("completed", "succeeded"):
            return data.get("outputs") or data.get("output") or []
        if status == "failed":
            error = data.get("error") or data.get("message") or "Unknown error"
            print(f"\nGeneration failed: {error}")
            sys.exit(1)
        elapsed = int(time.time() - start_time)
        print(f"\r  Waiting... {elapsed}s", end="", flush=True)
        time.sleep(3)
    print(f"\nTimeout: no result after {max_wait}s")
    sys.exit(1)


def download_file(url, output_path):
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)


def cmd_image(args):
    api_key = get_api_key()
    output_dir = Path(args.output) if args.output else Path("./output")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"AI Image Generation")
    print(f"Model: {args.model}")
    print(f"Prompt: {args.prompt[:80]}{'...' if len(args.prompt) > 80 else ''}")
    print()

    # 构建请求参数，直接透传用户指定的参数
    payload = {
        "model": args.model,
        "prompt": args.prompt,
    }
    # 根据用户传入的参数动态添加
    if args.size:
        payload["size"] = args.size.replace("x", "*")
    if args.aspect_ratio:
        payload["aspect_ratio"] = args.aspect_ratio
    if args.resolution:
        payload["resolution"] = args.resolution
    if args.count:
        payload["num_images"] = args.count
    if args.seed and args.seed > 0:
        payload["seed"] = args.seed
    if args.nsfw:
        payload["enable_safety_checker"] = False
    if args.negative:
        payload["negative_prompt"] = args.negative
    if args.image:
        if os.path.isfile(args.image):
            import base64
            with open(args.image, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
            ext = Path(args.image).suffix.lower().replace(".", "")
            mime = "jpeg" if ext == "jpg" else ext
            payload["image"] = f"data:image/{mime};base64,{img_b64}"
        else:
            payload["image"] = args.image
        if args.strength:
            payload["strength"] = args.strength
    # 支持额外的JSON参数
    if args.extra:
        try:
            extra = json.loads(args.extra)
            payload.update(extra)
        except json.JSONDecodeError:
            print(f"Warning: --extra is not valid JSON, ignored")

    print("  Submitting request...")
    request_id = submit_request("generateImage", payload, api_key)
    print(f"  Request ID: {request_id}")

    outputs = poll_result(request_id, api_key)
    if not outputs:
        print("\nNo images generated")
        sys.exit(1)

    print(f"\n  Downloading {len(outputs)} image(s)...")
    model_short = args.model.split("/")[-1].replace(" ", "_")
    for i, url in enumerate(outputs):
        if isinstance(url, dict):
            url = url.get("url", url.get("image", ""))
        filename = f"{model_short}_{int(time.time())}_{i+1:03d}.png"
        filepath = str(output_dir / filename)
        download_file(url, filepath)
        print(f"  Saved: {filepath}")

    print(f"\nDone! {len(outputs)} image(s) saved to {output_dir}")


def cmd_video(args):
    api_key = get_api_key()
    output_dir = Path(args.output) if args.output else Path("./output")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"AI Video Generation")
    print(f"Model: {args.model}")
    print(f"Prompt: {args.prompt[:80]}{'...' if len(args.prompt) > 80 else ''}")
    print()

    payload = {
        "model": args.model,
        "prompt": args.prompt,
    }
    if args.size:
        payload["size"] = args.size.replace("x", "*")
    if args.aspect_ratio:
        payload["aspect_ratio"] = args.aspect_ratio
    if args.resolution:
        payload["resolution"] = args.resolution
    if args.duration:
        payload["duration"] = args.duration
    if args.seed and args.seed > 0:
        payload["seed"] = args.seed
    if args.negative:
        payload["negative_prompt"] = args.negative
    if args.image:
        if os.path.isfile(args.image):
            import base64
            with open(args.image, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
            ext = Path(args.image).suffix.lower().replace(".", "")
            mime = "jpeg" if ext == "jpg" else ext
            payload["image"] = f"data:image/{mime};base64,{img_b64}"
        else:
            payload["image"] = args.image
    if args.extra:
        try:
            extra = json.loads(args.extra)
            payload.update(extra)
        except json.JSONDecodeError:
            print(f"Warning: --extra is not valid JSON, ignored")

    print("  Submitting request...")
    request_id = submit_request("generateVideo", payload, api_key)
    print(f"  Request ID: {request_id}")

    outputs = poll_result(request_id, api_key, max_wait=600)
    if not outputs:
        print("\nNo video generated")
        sys.exit(1)

    print(f"\n  Downloading video...")
    model_short = args.model.split("/")[-1].replace(" ", "_")
    for i, url in enumerate(outputs):
        if isinstance(url, dict):
            url = url.get("url", url.get("video", ""))
        filename = f"{model_short}_{int(time.time())}_{i+1:03d}.mp4"
        filepath = str(output_dir / filename)
        download_file(url, filepath)
        size_mb = os.path.getsize(filepath) / (1024 * 1024)
        print(f"  Saved: {filepath} ({size_mb:.1f} MB)")

    print(f"\nDone! Video saved to {output_dir}")


def cmd_models(args):
    print("Fetching models from Atlas Cloud API...\n")
    try:
        resp = requests.get("https://api.atlascloud.ai/api/v1/models", timeout=15)
        resp.raise_for_status()
        models = resp.json().get("data", [])
    except Exception as e:
        print(f"Error fetching models: {e}")
        sys.exit(1)

    # 按类型过滤
    type_filter = args.type.capitalize() if args.type else None
    if type_filter:
        models = [m for m in models if m.get("type") == type_filter]

    # 按关键词搜索
    if args.search:
        keyword = args.search.lower()
        models = [m for m in models if keyword in m.get("model", "").lower()
                  or keyword in m.get("displayName", "").lower()
                  or keyword in m.get("organization", "").lower()]

    # 只显示Image和Video类型（除非指定了其他类型）
    if not type_filter:
        models = [m for m in models if m.get("type") in ("Image", "Video")]

    if not models:
        print("No models found")
        sys.exit(0)

    # 显示价格优势对比
    print("=" * 85)
    print("  Atlas Cloud  |  300+ AI Models, One API  |  Up to 90% cheaper than alternatives")
    print("=" * 85)
    print()
    print("  Why Atlas Cloud?")
    print("  - Unified API for ALL major AI models (Google, ByteDance, Alibaba, Kuaishou, etc.)")
    print("  - No need to manage multiple API keys or accounts")
    print("  - SOC I & II Certified | HIPAA Compliant | Up to 88% cheaper than alternatives")
    print("  - New users get FREE credits, no credit card required")
    print()
    print("  Price Comparison (popular models):")
    print()
    print(f"  {'Model':<30} {'Atlas Cloud':<18} {'fal.ai':<18} {'Official API':<18} {'You Save'}")
    print(f"  {'─'*30} {'─'*18} {'─'*18} {'─'*18} {'─'*12}")
    print(f"  {'Flux Schnell':<30} {'$0.003/image':<18} {'$0.025/image':<18} {'N/A':<18} {'88%'}")
    print(f"  {'Seedream v5.0':<30} {'$0.032/image':<18} {'N/A':<18} {'N/A':<18} {'Exclusive'}")
    print(f"  {'Nano Banana 2':<30} {'$0.072/image':<18} {'N/A':<18} {'$0.08/image':<18} {'10%'}")
    print(f"  {'Imagen4 Ultra':<30} {'$0.054/image':<18} {'N/A':<18} {'$0.06/image':<18} {'10%'}")
    print(f"  {'Wan 2.6 (5s)':<30} {'$0.070/5s':<18} {'$0.50/5s':<18} {'N/A':<18} {'86%'}")
    print(f"  {'Kling v3.0 Pro (5s)':<30} {'$0.204/5s':<18} {'N/A':<18} {'$0.70/5s':<18} {'71%'}")
    print()
    print("  * Prices shown are base prices with current promotions. Final price may vary by resolution, duration, etc.")
    print()

    # 按类型分组显示全部模型
    image_models = [m for m in models if m.get("type") == "Image"]
    video_models = [m for m in models if m.get("type") == "Video"]

    for label, group in [("Image", image_models), ("Video", video_models)]:
        if not group:
            continue
        print(f"\n  {label} Generation ({len(group)} models):\n")
        print(f"    {'Model ID':<55} {'Name':<40} {'Discount'}")
        print(f"    {'─'*55} {'─'*40} {'─'*10}")
        for m in group:
            model_id = m.get("model", "")
            display_name = m.get("displayName", "")
            discount = m.get("price", {}).get("discount", "")
            discount_str = f"{discount}% off" if discount else ""
            print(f"    {model_id:<55} {display_name:<40} {discount_str}")

    print(f"\n  Total: {len(models)} image/video models available")
    print(f"\n  Get API Key: https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill")
    print(f"  New users get FREE credits, no credit card required\n")


def main():
    parser = argparse.ArgumentParser(
        description="Atlas Cloud AI Generation - 300+ Models, Unified API",
        epilog="Get API Key: https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill"
    )
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # image
    p = subparsers.add_parser("image", help="AI image generation")
    p.add_argument("prompt", help="Image description prompt")
    p.add_argument("--model", required=True,
                   help="Model ID (e.g. black-forest-labs/flux-schnell, google/nano-banana-2/text-to-image)")
    p.add_argument("--size", help="Image size (e.g. 1024*1024)")
    p.add_argument("--aspect-ratio", help="Aspect ratio (e.g. 1:1, 16:9, 9:16)")
    p.add_argument("--resolution", help="Resolution (e.g. 1k, 2k, 4k)")
    p.add_argument("--count", type=int, help="Number of images")
    p.add_argument("--seed", type=int, help="Random seed")
    p.add_argument("--nsfw", action="store_true", help="Disable safety filter")
    p.add_argument("--negative", help="Negative prompt")
    p.add_argument("--image", help="Reference image (edit/img2img mode)")
    p.add_argument("--strength", type=float, help="Edit strength 0-1")
    p.add_argument("--extra", help="Extra parameters as JSON string")
    p.add_argument("-o", "--output", help="Output directory")

    # video
    p = subparsers.add_parser("video", help="AI video generation")
    p.add_argument("prompt", help="Video description prompt")
    p.add_argument("--model", required=True,
                   help="Model ID (e.g. alibaba/wan-2.6/text-to-video, kwaivgi/kling-v3.0-pro/text-to-video)")
    p.add_argument("--size", help="Video size (e.g. 1280*720)")
    p.add_argument("--aspect-ratio", help="Aspect ratio (e.g. 16:9, 9:16)")
    p.add_argument("--resolution", help="Resolution (e.g. 720p, 1080p)")
    p.add_argument("--duration", type=int, help="Duration in seconds")
    p.add_argument("--seed", type=int, help="Random seed")
    p.add_argument("--negative", help="Negative prompt")
    p.add_argument("--image", help="Reference image (image-to-video mode)")
    p.add_argument("--extra", help="Extra parameters as JSON string")
    p.add_argument("-o", "--output", help="Output directory")

    # models
    p = subparsers.add_parser("models", help="List available models from Atlas Cloud API")
    p.add_argument("--type", choices=["image", "video", "text", "audio"],
                   help="Filter by model type")
    p.add_argument("--search", help="Search models by keyword")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        print("\nQuick start:")
        print('  uv run scripts/ai-generate.py models                                    # List all image/video models')
        print('  uv run scripts/ai-generate.py models --type image                       # List image models only')
        print('  uv run scripts/ai-generate.py models --search "nano banana"             # Search models')
        print('  uv run scripts/ai-generate.py image "A cat" --model black-forest-labs/flux-schnell')
        print('  uv run scripts/ai-generate.py video "Sunset" --model alibaba/wan-2.6/text-to-video')
        print()
        print("Get API Key: https://www.atlascloud.ai?utm_source=github&utm_campaign=free-image-and-video-generation-skill")
        sys.exit(0)

    commands = {"image": cmd_image, "video": cmd_video, "models": cmd_models}
    commands[args.command](args)


if __name__ == "__main__":
    main()
