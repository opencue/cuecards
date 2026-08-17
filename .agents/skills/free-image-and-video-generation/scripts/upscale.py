#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "realesrgan-ncnn-py>=2.0.0",
#   "pillow>=10.0",
# ]
# ///

"""
Image Super Resolution - Real-ESRGAN (NCNN backend)
2x/4x AI upscaling with Vulkan GPU acceleration, no PyTorch required
"""

import argparse
import os
import sys
from pathlib import Path
from PIL import Image

from realesrgan_ncnn_py import Realesrgan


MODEL_MAP = {
    "x4plus": 0,        # General 4x upscale (default)
    "x4plus-anime": 1,  # Anime-optimized 4x
    "animevideo-x2": 2, # Anime video 2x
}


def process_image(input_path: str, output_path: str, realesrgan):
    try:
        image = Image.open(input_path).convert("RGB")
        w, h = image.size
        result = realesrgan.process_pil(image)
        result.save(output_path, quality=95)
        nw, nh = result.size
        print(f"  {os.path.basename(input_path)}: {w}x{h} -> {nw}x{nh}")
        return True
    except Exception as e:
        print(f"  Failed {os.path.basename(input_path)}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Real-ESRGAN Image Super Resolution (NCNN)")
    parser.add_argument("input", help="Input image path or folder")
    parser.add_argument("-o", "--output", help="Output path (default: ./output/)")
    parser.add_argument("--model", default="x4plus", choices=list(MODEL_MAP.keys()),
                        help="Model variant (default: x4plus)")
    parser.add_argument("--gpu", type=int, default=0,
                        help="GPU ID, -1 for CPU (default: 0)")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output) if args.output else Path("./output")
    output_dir.mkdir(parents=True, exist_ok=True)

    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}
    if input_path.is_dir():
        files = sorted([f for f in input_path.iterdir() if f.suffix.lower() in image_exts])
    elif input_path.is_file():
        files = [input_path]
    else:
        print(f"Error: not found {input_path}")
        sys.exit(1)

    if not files:
        print("No image files found")
        sys.exit(1)

    scale_label = "2x" if args.model == "animevideo-x2" else "4x"
    print(f"Real-ESRGAN {scale_label} Super Resolution (NCNN)")
    print(f"Model: {args.model}")
    print(f"Device: {'CPU' if args.gpu == -1 else f'GPU {args.gpu}'}")
    print(f"Processing {len(files)} image(s)")
    print()

    realesrgan = Realesrgan(gpuid=args.gpu, model=MODEL_MAP[args.model])

    success = 0
    for f in files:
        out_name = f.stem + f"_{scale_label}.png"
        out_path = str(output_dir / out_name)
        if process_image(str(f), out_path, realesrgan):
            success += 1

    print(f"\nDone! {success}/{len(files)} image(s) saved to {output_dir}")


if __name__ == "__main__":
    main()
