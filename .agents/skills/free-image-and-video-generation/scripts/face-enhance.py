#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "realesrgan-ncnn-py>=2.0.0",
#   "pillow>=10.0",
# ]
# ///

"""
Face / Image Enhancement - Real-ESRGAN (NCNN backend)
Enhance details by upscaling then downscaling, great for old photos and blurry faces
"""

import argparse
import os
import sys
from pathlib import Path
from PIL import Image, ImageEnhance

from realesrgan_ncnn_py import Realesrgan


def enhance_image(image, realesrgan, sharpness, contrast):
    original_size = image.size
    result = realesrgan.process_pil(image)
    result = result.resize(original_size, Image.LANCZOS)
    if sharpness != 1.0:
        result = ImageEnhance.Sharpness(result).enhance(sharpness)
    if contrast != 1.0:
        result = ImageEnhance.Contrast(result).enhance(contrast)
    return result


def process_image(input_path, output_path, realesrgan, mode, sharpness, contrast):
    try:
        image = Image.open(input_path).convert("RGB")
        w, h = image.size
        if mode == "enhance":
            result = enhance_image(image, realesrgan, sharpness, contrast)
            print(f"  {os.path.basename(input_path)}: {w}x{h} -> enhanced")
        else:
            result = realesrgan.process_pil(image)
            nw, nh = result.size
            print(f"  {os.path.basename(input_path)}: {w}x{h} -> {nw}x{nh}")
        result.save(output_path, quality=95)
        return True
    except Exception as e:
        print(f"  Failed {os.path.basename(input_path)}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AI Face/Image Enhancement (Real-ESRGAN NCNN)")
    parser.add_argument("input", help="Input image path or folder")
    parser.add_argument("-o", "--output", help="Output path (default: ./output/)")
    parser.add_argument("--mode", choices=["enhance", "upscale"], default="enhance",
                        help="Mode: enhance=detail boost keep size, upscale=4x enlarge (default: enhance)")
    parser.add_argument("--sharpness", type=float, default=1.3,
                        help="Sharpness factor, 1.0=unchanged (default: 1.3)")
    parser.add_argument("--contrast", type=float, default=1.1,
                        help="Contrast factor, 1.0=unchanged (default: 1.1)")
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

    mode_desc = "Detail enhancement (keep original size)" if args.mode == "enhance" else "4x upscale"
    print(f"Face/Image Enhancement - Real-ESRGAN (NCNN)")
    print(f"Mode: {mode_desc}")
    print(f"Device: {'CPU' if args.gpu == -1 else f'GPU {args.gpu}'}")
    print(f"Processing {len(files)} image(s)")
    print()

    realesrgan = Realesrgan(gpuid=args.gpu, model=0)

    success = 0
    for f in files:
        out_name = f.stem + "_enhanced.png"
        out_path = str(output_dir / out_name)
        if process_image(str(f), out_path, realesrgan, args.mode, args.sharpness, args.contrast):
            success += 1

    print(f"\nDone! {success}/{len(files)} image(s) saved to {output_dir}")


if __name__ == "__main__":
    main()
