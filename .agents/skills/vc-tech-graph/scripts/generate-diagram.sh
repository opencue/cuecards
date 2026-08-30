#!/usr/bin/env bash
set -euo pipefail

WIDTH=1920
SVG_FILE=""
PNG_FILE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|--output)
      SVG_FILE="$2"
      shift 2
      ;;
    -w|--width)
      WIDTH="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: generate-diagram.sh -o <svg-file> [-w <png-width>]

Validates the SVG, then exports a sibling PNG when `rsvg-convert` is available.
If `rsvg-convert` is missing, the command succeeds after validation and warns that SVG-only mode is active.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "$SVG_FILE" ]; then
  echo "Missing required -o <svg-file> argument" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$SCRIPT_DIR/validate-svg.sh" "$SVG_FILE"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert not found; SVG-only mode active. Skipping PNG export."
  exit 0
fi

PNG_FILE="${SVG_FILE%.svg}.png"
rsvg-convert -w "$WIDTH" "$SVG_FILE" -o "$PNG_FILE"
echo "PNG exported: $PNG_FILE"
