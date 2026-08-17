#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <svg-file>" >&2
  exit 1
fi

SVG_FILE="$1"

if [ ! -f "$SVG_FILE" ]; then
  echo "SVG file not found: $SVG_FILE" >&2
  exit 1
fi

if ! grep -q "</svg>" "$SVG_FILE"; then
  echo "Missing closing </svg> tag: $SVG_FILE" >&2
  exit 1
fi

python3 - "$SVG_FILE" <<'PY'
import sys
import xml.etree.ElementTree as ET

path = sys.argv[1]
try:
    ET.parse(path)
except ET.ParseError as exc:
    print(f"XML parse error in {path}: {exc}", file=sys.stderr)
    raise SystemExit(1)
PY

if command -v rsvg-convert >/dev/null 2>&1; then
  TMP_PNG="$(mktemp /tmp/tech-graph-validate-XXXXXX.png)"
  trap 'rm -f "$TMP_PNG"' EXIT
  if ! rsvg-convert "$SVG_FILE" -o "$TMP_PNG" >/dev/null 2>&1; then
    echo "rsvg-convert rejected SVG: $SVG_FILE" >&2
    exit 1
  fi
fi

echo "SVG validation passed: $SVG_FILE"
