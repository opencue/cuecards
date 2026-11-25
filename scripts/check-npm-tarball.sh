#!/usr/bin/env bash
# Smoke-test an exact tarball, without installing anything globally.
set -euo pipefail

version="$1"
tarball="$2"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fetch=(--registry https://registry.npmjs.org --cache "$tmp/cache" --prefer-online --fetch-retries=0 --fetch-timeout=30000)

if [[ "$tarball" == registry ]]; then
  expected_integrity="${3:?expected npm integrity}"
  for ((attempt = 1; attempt <= 20; attempt++)); do
    if npm pack "cue-ai@$version" --json --pack-destination "$tmp" "${fetch[@]}" >"$tmp/pack.json" 2>"$tmp/pack.log"; then
      break
    fi
    if (( attempt == 20 )); then
      cat "$tmp/pack.log" >&2
      echo "cue-ai@$version is not downloadable yet. Rerun the failed verification job; do not publish again." >&2
      exit 1
    fi
    echo "Waiting for cue-ai@$version on npm ($attempt/20)."
    sleep 45
  done
  actual_integrity="$(jq -er '.[0].integrity' "$tmp/pack.json")"
  if [[ "$actual_integrity" != "$expected_integrity" ]]; then
    echo "Unexpected integrity for cue-ai@$version." >&2
    exit 1
  fi
  tarball="$tmp/$(jq -er '.[0].filename' "$tmp/pack.json")"
fi

npm install --prefix "$tmp/install" --ignore-scripts --no-audit --no-fund "${fetch[@]}" "$tarball"
installed_version="$(cd "$tmp" && "$tmp/install/node_modules/.bin/cue" --version)"
if [[ "$installed_version" != "$version" ]]; then
  echo "Expected cue --version to print $version; got $installed_version." >&2
  exit 1
fi
echo "Installed and ran cue-ai@$installed_version."
