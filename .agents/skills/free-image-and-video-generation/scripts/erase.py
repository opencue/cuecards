#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "simple-lama-inpainting>=0.1.0",
#   "pillow>=10.0",
#   "numpy<2",
# ]
# ///

"""
Object Eraser - Remove unwanted objects using LaMa (Large Mask Inpainting)
Supports mask images and coordinate-based region specification
"""

import argparse
import os
import sys
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw

from simple_lama_inpainting import SimpleLama


def create_region_mask(image_size, regions):
    mask = Image.new("L", image_size, 0)
    draw = ImageDraw.Draw(mask)
    for region in regions:
        parts = [int(x.strip()) for x in region.split(",")]
        if len(parts) == 4:
            x, y, w, h = parts
            draw.rectangle([x, y, x + w, y + h], fill=255)
        else:
            print(f"  Warning: invalid region '{region}', format: x,y,width,height")
    return mask


def process_image(input_path, output_path, mask_path, regions, lama):
    try:
        image = Image.open(input_path).convert("RGB")
        if mask_path:
            mask = Image.open(mask_path).convert("L")
            if mask.size != image.size:
                mask = mask.resize(image.size)
        elif regions:
            mask = create_region_mask(image.size, regions)
        else:
            print(f"  Skipped {os.path.basename(input_path)}: no mask or region specified")
            return False

        result = lama(image, mask)
        result.save(output_path)
        print(f"  {os.path.basename(input_path)} -> {os.path.basename(output_path)}")
        return True
    except Exception as e:
        print(f"  Skipped {os.path.basename(input_path)}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AI Object Eraser (LaMa Inpainting)")
    parser.add_argument("input", help="Input image path or folder")
    parser.add_argument("-o", "--output", help="Output path (default: ./output/)")
    parser.add_argument("--mask", help="Mask image path (white area = erase)")
    parser.add_argument("--mask-dir", help="Mask folder for batch (e.g. img1_mask.png)")
    parser.add_argument("--region", action="append",
                        help="Rectangle region to erase: x,y,width,height (can specify multiple)")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output) if args.output else Path("./output")
    output_dir.mkdir(parents=True, exist_ok=True)

    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}

    print("Object Eraser - LaMa Inpainting")
    print("Loading model...")
    lama = SimpleLama()

    if input_path.is_dir():
        files = sorted([f for f in input_path.iterdir() if f.suffix.lower() in image_exts])
        mask_dir = Path(args.mask_dir) if args.mask_dir else None

        print(f"Processing {len(files)} image(s)\n")
        success = 0
        for f in files:
            mask_path = None
            if mask_dir:
                for suffix in ["_mask", ""]:
                    candidate = mask_dir / (f.stem + suffix + ".png")
                    if candidate.exists():
                        mask_path = str(candidate)
                        break
            out_name = f.stem + "_erased" + f.suffix
            out_path = str(output_dir / out_name)
            if process_image(str(f), out_path, mask_path, args.region, lama):
                success += 1
        print(f"\nDone! {success}/{len(files)} image(s) saved to {output_dir}")

    elif input_path.is_file():
        print()
        out_name = input_path.stem + "_erased" + input_path.suffix
        out_path = str(output_dir / out_name)
        if process_image(str(input_path), out_path, args.mask, args.region, lama):
            print(f"\nDone! Saved to {out_path}")
        else:
            sys.exit(1)
    else:
        print(f"Error: not found {input_path}")
        sys.exit(1)


if __name__ == "__main__":
    main()
