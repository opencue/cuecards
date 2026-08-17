#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pillow>=10.0",
# ]
# ///

"""
Media Processing Tool - FFmpeg-powered audio/video processing
Convert, compress, trim, merge, extract frames, create GIFs, and more
Requires FFmpeg installed: brew install ffmpeg / apt install ffmpeg
"""

import argparse
import os
import sys
import json
import subprocess
import shutil
from pathlib import Path


def check_ffmpeg():
    if not shutil.which("ffmpeg"):
        print("Error: FFmpeg not found")
        print("Install:")
        print("  macOS:   brew install ffmpeg")
        print("  Ubuntu:  sudo apt install ffmpeg")
        print("  Windows: winget install ffmpeg")
        sys.exit(1)


def run_ffmpeg(args, desc=""):
    cmd = ["ffmpeg", "-y"] + args
    if desc:
        print(f"  {desc}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  FFmpeg error: {result.stderr[:500]}")
        return False
    return True


def get_media_info(input_path):
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
           "-show_format", "-show_streams", input_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {}
    return json.loads(result.stdout)


def cmd_convert(args):
    check_ffmpeg()
    output = args.output or str(Path("./output") / Path(args.inputs[0]).with_suffix(f".{args.format or 'mp4'}").name)
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    ffargs = ["-i", args.inputs[0]]
    if args.format == "webm":
        ffargs += ["-c:v", "libvpx-vp9", "-c:a", "libopus"]
    elif args.format == "gif":
        ffargs += ["-vf", "fps=15,scale=480:-1:flags=lanczos"]
    ffargs.append(output)
    if run_ffmpeg(ffargs, f"Converting -> {output}"):
        print(f"\nDone! Saved to {output}")


def cmd_compress(args):
    check_ffmpeg()
    info = get_media_info(args.inputs[0])
    if not info:
        print("Error: cannot read media info")
        sys.exit(1)
    duration = float(info.get("format", {}).get("duration", 0))
    if duration <= 0:
        print("Error: cannot get video duration")
        sys.exit(1)
    target_bits = args.target_size * 8 * 1024 * 1024 * 0.95
    video_bitrate = int(target_bits / duration)
    output = args.output or str(Path("./output") / f"{Path(args.inputs[0]).stem}_compressed.mp4")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    original_size = os.path.getsize(args.inputs[0]) / (1024 * 1024)
    print(f"  Original: {original_size:.1f} MB -> Target: {args.target_size} MB")
    ffargs = ["-i", args.inputs[0], "-c:v", "libx264", "-b:v", str(video_bitrate),
              "-c:a", "aac", "-b:a", "128k", "-preset", "medium", output]
    if run_ffmpeg(ffargs, "Compressing..."):
        new_size = os.path.getsize(output) / (1024 * 1024)
        print(f"  Result: {new_size:.1f} MB ({(1 - new_size/original_size)*100:.0f}% reduction)")
        print(f"\nDone! Saved to {output}")


def cmd_resize(args):
    check_ffmpeg()
    output = args.output or str(Path("./output") / f"{Path(args.inputs[0]).stem}_resized.mp4")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    scale = f"scale={args.width}:{args.height}"
    ffargs = ["-i", args.inputs[0], "-vf", scale, "-c:a", "copy", output]
    if run_ffmpeg(ffargs, f"Resizing -> {args.width}x{args.height}"):
        print(f"\nDone! Saved to {output}")


def cmd_frames(args):
    check_ffmpeg()
    output_dir = Path(args.output) if args.output else Path("./output/frames")
    output_dir.mkdir(parents=True, exist_ok=True)
    ffargs = ["-i", args.inputs[0], "-vf", f"fps={args.fps}", str(output_dir / "frame_%04d.png")]
    if run_ffmpeg(ffargs, f"Extracting frames at {args.fps} fps..."):
        count = len(list(output_dir.glob("frame_*.png")))
        print(f"\nDone! Extracted {count} frames to {output_dir}")


def cmd_audio(args):
    check_ffmpeg()
    ext = Path(args.output).suffix if args.output else ".mp3"
    output = args.output or str(Path("./output") / f"{Path(args.inputs[0]).stem}{ext}")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    ffargs = ["-i", args.inputs[0], "-vn", "-acodec"]
    if ext == ".mp3":
        ffargs += ["libmp3lame", "-q:a", "2"]
    elif ext == ".wav":
        ffargs += ["pcm_s16le"]
    else:
        ffargs += ["copy"]
    ffargs.append(output)
    if run_ffmpeg(ffargs, "Extracting audio..."):
        print(f"\nDone! Saved to {output}")


def cmd_gif(args):
    check_ffmpeg()
    output = args.output or str(Path("./output") / f"{Path(args.inputs[0]).stem}.gif")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    vf_parts = [f"fps={args.fps}"]
    if args.width:
        vf_parts.append(f"scale={args.width}:-1:flags=lanczos")
    vf = ",".join(vf_parts)
    ffargs = ["-i", args.inputs[0]]
    if args.start is not None:
        ffargs = ["-ss", str(args.start)] + ffargs
    if args.duration is not None:
        ffargs += ["-t", str(args.duration)]
    ffargs += ["-vf", vf, "-loop", "0", output]
    if run_ffmpeg(ffargs, "Creating GIF..."):
        size = os.path.getsize(output) / (1024 * 1024)
        print(f"\nDone! Saved to {output} ({size:.1f} MB)")


def cmd_trim(args):
    check_ffmpeg()
    output = args.output or str(Path("./output") / f"{Path(args.inputs[0]).stem}_trimmed.mp4")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    ffargs = ["-i", args.inputs[0], "-ss", args.start]
    if args.end:
        ffargs += ["-to", args.end]
    elif args.duration:
        ffargs += ["-t", str(args.duration)]
    ffargs += ["-c", "copy", output]
    if run_ffmpeg(ffargs, f"Trimming {args.start} -> {args.end or 'end'}"):
        print(f"\nDone! Saved to {output}")


def cmd_merge(args):
    check_ffmpeg()
    output = args.output or str(Path("./output") / "merged.mp4")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    list_file = Path("./output/.merge_list.txt")
    list_file.parent.mkdir(parents=True, exist_ok=True)
    with open(list_file, "w") as f:
        for inp in args.inputs:
            f.write(f"file '{os.path.abspath(inp)}'\n")
    ffargs = ["-f", "concat", "-safe", "0", "-i", str(list_file), "-c", "copy", output]
    if run_ffmpeg(ffargs, f"Merging {len(args.inputs)} files..."):
        print(f"\nDone! Saved to {output}")
    list_file.unlink(missing_ok=True)


def cmd_watermark(args):
    check_ffmpeg()
    output = args.output or str(Path("./output") / f"{Path(args.inputs[0]).stem}_watermarked.mp4")
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    positions = {
        "top-left": "10:10", "top-right": "main_w-overlay_w-10:10",
        "bottom-left": "10:main_h-overlay_h-10",
        "bottom-right": "main_w-overlay_w-10:main_h-overlay_h-10",
        "center": "(main_w-overlay_w)/2:(main_h-overlay_h)/2",
    }
    pos = positions.get(args.position, positions["bottom-right"])
    ffargs = ["-i", args.inputs[0], "-i", args.image,
              "-filter_complex", f"overlay={pos}", "-c:a", "copy", output]
    if run_ffmpeg(ffargs, f"Adding watermark ({args.position})..."):
        print(f"\nDone! Saved to {output}")


def cmd_info(args):
    check_ffmpeg()
    info = get_media_info(args.inputs[0])
    if not info:
        print("Error: cannot read media info")
        sys.exit(1)
    fmt = info.get("format", {})
    print(f"\nFile: {os.path.basename(args.inputs[0])}")
    print(f"Format: {fmt.get('format_long_name', 'unknown')}")
    print(f"Duration: {float(fmt.get('duration', 0)):.1f}s")
    print(f"Size: {int(fmt.get('size', 0)) / (1024*1024):.1f} MB")
    print(f"Bitrate: {int(fmt.get('bit_rate', 0)) / 1000:.0f} kbps")
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            print(f"\nVideo:")
            print(f"  Codec: {stream.get('codec_name')}")
            print(f"  Resolution: {stream.get('width')}x{stream.get('height')}")
            fps = stream.get("r_frame_rate", "0/1")
            if "/" in fps:
                n, d = fps.split("/")
                print(f"  FPS: {int(n)/int(d):.2f}")
        elif stream.get("codec_type") == "audio":
            print(f"\nAudio:")
            print(f"  Codec: {stream.get('codec_name')}")
            print(f"  Sample rate: {stream.get('sample_rate')} Hz")
            print(f"  Channels: {stream.get('channels')}")


def main():
    parser = argparse.ArgumentParser(description="FFmpeg Media Processing Tool")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    p = subparsers.add_parser("convert", help="Format conversion")
    p.add_argument("inputs", nargs=1); p.add_argument("-o", "--output"); p.add_argument("--format")

    p = subparsers.add_parser("compress", help="Video compression")
    p.add_argument("inputs", nargs=1); p.add_argument("--target-size", type=float, required=True, help="Target size in MB"); p.add_argument("-o", "--output")

    p = subparsers.add_parser("resize", help="Resize video")
    p.add_argument("inputs", nargs=1); p.add_argument("--width", type=int, default=1280); p.add_argument("--height", type=int, default=-1); p.add_argument("-o", "--output")

    p = subparsers.add_parser("frames", help="Extract frames")
    p.add_argument("inputs", nargs=1); p.add_argument("--fps", type=float, default=1); p.add_argument("-o", "--output")

    p = subparsers.add_parser("audio", help="Extract audio")
    p.add_argument("inputs", nargs=1); p.add_argument("-o", "--output")

    p = subparsers.add_parser("gif", help="Create GIF")
    p.add_argument("inputs", nargs=1); p.add_argument("--start", type=float); p.add_argument("--duration", type=float); p.add_argument("--fps", type=int, default=15); p.add_argument("--width", type=int); p.add_argument("-o", "--output")

    p = subparsers.add_parser("trim", help="Trim video")
    p.add_argument("inputs", nargs=1); p.add_argument("--start", required=True); p.add_argument("--end"); p.add_argument("--duration", type=float); p.add_argument("-o", "--output")

    p = subparsers.add_parser("merge", help="Merge videos")
    p.add_argument("inputs", nargs="+"); p.add_argument("-o", "--output")

    p = subparsers.add_parser("watermark", help="Add watermark")
    p.add_argument("inputs", nargs=1); p.add_argument("--image", required=True); p.add_argument("--position", default="bottom-right", choices=["top-left", "top-right", "bottom-left", "bottom-right", "center"]); p.add_argument("-o", "--output")

    p = subparsers.add_parser("info", help="Show media info")
    p.add_argument("inputs", nargs=1)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)

    print(f"FFmpeg Media Processing - {args.command}")
    commands = {
        "convert": cmd_convert, "compress": cmd_compress, "resize": cmd_resize,
        "frames": cmd_frames, "audio": cmd_audio, "gif": cmd_gif,
        "trim": cmd_trim, "merge": cmd_merge, "watermark": cmd_watermark, "info": cmd_info,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
