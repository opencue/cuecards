#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "ultralytics>=8.3.0",
#   "opencv-python-headless>=4.8",
#   "numpy<2",
#   "pillow>=10.0",
#   "torch>=2.0",
#   "torchvision>=0.15",
# ]
# ///

"""
Smart Segmentation Tool - Segment any object in images using FastSAM
Supports text prompts, point prompts, bounding box prompts
"""

import argparse
import os
import sys
from pathlib import Path

from ultralytics import FastSAM


def main():
    parser = argparse.ArgumentParser(description="Smart Segmentation (FastSAM)")
    parser.add_argument("input", help="Input image path")
    parser.add_argument("-o", "--output", help="Output directory (default: ./output/)")
    parser.add_argument("--text", help="Segment by text prompt (e.g. 'the dog')")
    parser.add_argument("--point", help="Segment by point x,y")
    parser.add_argument("--box", help="Segment by bounding box x1,y1,x2,y2")
    parser.add_argument("--model", default="FastSAM-s.pt",
                        choices=["FastSAM-s.pt", "FastSAM-x.pt"],
                        help="Model size (default: FastSAM-s.pt, 23MB)")
    parser.add_argument("--conf", type=float, default=0.4, help="Confidence threshold (default: 0.4)")
    parser.add_argument("--iou", type=float, default=0.9, help="IoU threshold (default: 0.9)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: file not found {input_path}")
        sys.exit(1)

    output_dir = Path(args.output) if args.output else Path("./output")
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Smart Segmentation - FastSAM")
    print(f"Input: {input_path}")
    print(f"Model: {args.model}")

    # Detect device
    import torch
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Device: {device}")
    print()

    # Load model and run inference
    model = FastSAM(args.model)

    # Build prompts
    prompts = {}
    if args.text:
        print(f"Text prompt: '{args.text}'")
        prompts["texts"] = args.text
    elif args.point:
        parts = [int(x) for x in args.point.split(",")]
        prompts["points"] = [[parts[0], parts[1]]]
        prompts["labels"] = [1]
        print(f"Point prompt: {prompts['points']}")
    elif args.box:
        parts = [int(x) for x in args.box.split(",")]
        prompts["bboxes"] = [[parts[0], parts[1], parts[2], parts[3]]]
        print(f"Box prompt: {prompts['bboxes']}")
    else:
        print("Segment Everything mode")

    # Run prediction
    results = model(
        str(input_path),
        device=device,
        retina_masks=True,
        imgsz=1024,
        conf=args.conf,
        iou=args.iou,
    )

    # Save results
    for r in results:
        if prompts:
            r = r.prompt(**prompts)
        out_path = str(output_dir / f"{input_path.stem}_segmented.png")
        r.save(out_path)
        print(f"\nResult saved to {out_path}")

    print(f"\nDone! Results saved to {output_dir}")


if __name__ == "__main__":
    main()
