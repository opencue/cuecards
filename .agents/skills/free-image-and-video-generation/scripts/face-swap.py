#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "insightface>=0.7.3",
#   "onnxruntime>=1.16.0",
#   "opencv-python-headless>=4.8",
#   "numpy<2",
#   "pillow>=10.0",
# ]
# ///

"""
Face Swap - Swap faces between images using InsightFace (ArcFace + Inswapper)
Supports single image and face index selection for group photos
"""

import argparse
import os
import sys
import cv2
import numpy as np
from pathlib import Path

import insightface
from insightface.app import FaceAnalysis


def download_inswapper():
    model_dir = os.path.expanduser("~/.insightface/models")
    model_path = os.path.join(model_dir, "inswapper_128.onnx")
    if not os.path.exists(model_path):
        os.makedirs(model_dir, exist_ok=True)
        print("Downloading inswapper model...")
        url = "https://huggingface.co/deepinsight/inswapper/resolve/main/inswapper_128.onnx"
        import urllib.request
        urllib.request.urlretrieve(url, model_path)
        print("Model downloaded")
    return model_path


def main():
    parser = argparse.ArgumentParser(description="AI Face Swap (InsightFace)")
    parser.add_argument("--source", required=True, help="Source face image")
    parser.add_argument("--target", required=True, help="Target image (receives face)")
    parser.add_argument("-o", "--output", help="Output path (default: ./output/swapped.png)")
    parser.add_argument("--face-index", type=int, default=0,
                        help="Face index in target (for group photos, default: 0)")
    args = parser.parse_args()

    source_path = Path(args.source)
    target_path = Path(args.target)

    if not source_path.exists():
        print(f"Error: source image not found {source_path}")
        sys.exit(1)
    if not target_path.exists():
        print(f"Error: target image not found {target_path}")
        sys.exit(1)

    output_dir = Path("./output")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output or str(output_dir / f"{target_path.stem}_swapped.png")

    print("Face Swap - InsightFace")
    print(f"Source: {source_path}")
    print(f"Target: {target_path}")
    print()

    print("Loading models...")
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))

    model_path = download_inswapper()
    swapper = insightface.model_zoo.get_model(model_path, providers=["CPUExecutionProvider"])

    source_img = cv2.imread(str(source_path))
    target_img = cv2.imread(str(target_path))

    if source_img is None or target_img is None:
        print("Error: cannot read image(s)")
        sys.exit(1)

    source_faces = app.get(source_img)
    target_faces = app.get(target_img)

    if not source_faces:
        print("Error: no face detected in source image")
        sys.exit(1)
    if not target_faces:
        print("Error: no face detected in target image")
        sys.exit(1)

    print(f"Source: {len(source_faces)} face(s) detected")
    print(f"Target: {len(target_faces)} face(s) detected")

    if args.face_index >= len(target_faces):
        print(f"Error: face index {args.face_index} out of range (total {len(target_faces)} faces)")
        sys.exit(1)

    source_face = source_faces[0]
    target_face = target_faces[args.face_index]

    result = swapper.get(target_img, target_face, source_face, paste_back=True)
    cv2.imwrite(output_path, result)

    print(f"\nDone! Saved to {output_path}")


if __name__ == "__main__":
    main()
