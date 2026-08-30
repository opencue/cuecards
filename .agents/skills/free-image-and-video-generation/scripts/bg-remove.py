#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "rembg[cpu]>=2.0.50",
#   "pillow>=10.0",
# ]
# ///

"""
Background Removal - Remove image backgrounds using rembg (U2-Net)
Outputs transparent PNG, supports multiple AI models and batch processing
"""

import argparse
import os
import sys
from pathlib import Path
from PIL import Image
from rembg import remove, new_session


MODELS = [
    "u2net",              # General purpose (default, 176MB)
    "u2netp",             # Lightweight (4MB, faster)
    "u2net_human_seg",    # Human segmentation
    "u2net_cloth_seg",    # Clothing segmentation
    "silueta",            # Lightweight general
    "isnet-general-use",  # High accuracy general
    "isnet-anime",        # Anime images
]


def process_image(input_path, output_path, session, alpha_matting):
    try:
        img = Image.open(input_path)
        result = remove(
            img,
            session=session,
            alpha_matting=alpha_matting,
            alpha_matting_foreground_threshold=240 if alpha_matting else None,
            alpha_matting_background_threshold=10 if alpha_matting else None,
        )
        if not output_path.lower().endswith(".png"):
            output_path = os.path.splitext(output_path)[0] + ".png"
        result.save(output_path)
        print(f"  {os.path.basename(input_path)} -> {os.path.basename(output_path)}")
        return True
    except Exception as e:
        print(f"  Skipped {os.path.basename(input_path)}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AI Background Removal (rembg)")
    parser.add_argument("input", help="Input image path or folder")
    parser.add_argument("-o", "--output", help="Output path (default: ./output/)")
    parser.add_argument("--model", default="u2net", choices=MODELS,
                        help="AI model (default: u2net)")
    parser.add_argument("--alpha-matting", action="store_true",
                        help="Enable fine edge processing (better for hair, fur)")
    parser.add_argument("--list-models", action="store_true", help="List available models")
    args = parser.parse_args()

    if args.list_models:
        print("Available models:")
        for m in MODELS:
            print(f"  {m}")
        sys.exit(0)

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

    print(f"Background Removal - Model: {args.model}")
    if args.alpha_matting:
        print("Alpha matting enabled (fine edge processing)")
    print(f"Processing {len(files)} image(s)")
    print()

    session = new_session(args.model)

    success = 0
    for f in files:
        out_name = f.stem + "_nobg.png"
        out_path = str(output_dir / out_name)
        if process_image(str(f), out_path, session, args.alpha_matting):
            success += 1

    print(f"\nDone! {success}/{len(files)} image(s) saved to {output_dir}")


if __name__ == "__main__":
    main()
