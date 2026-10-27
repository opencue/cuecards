#!/usr/bin/env bash
# Seed the PATCHED oh-my-claudecode (omc) marketplace into every cue runtime so
# OMC loads in all profiles with working (PATH-resolving) hooks instead of a
# fresh GitHub clone that reintroduces bare-`node` hooks.
#
# Idempotent: safe to re-run. Run after adding a new profile or after a cue
# upgrade. Source of truth = the patched clone in the account2 credentials dir.
set -euo pipefail

SRC="${OMC_SRC:-$HOME/.claude-accounts/account2/plugins/marketplaces/omc}"
RUNTIME_ROOT="${CUE_RUNTIME_ROOT:-$HOME/.config/cue/runtime}"
REPO="Yeachan-Heo/oh-my-claudecode"

if [ ! -f "$SRC/.claude-plugin/plugin.json" ]; then
  echo "ERROR: patched omc source not found at $SRC" >&2
  exit 1
fi
# Refuse to propagate an unpatched clone (guards against re-spreading broken hooks).
if ! grep -q 'echo \$PATH' "$SRC/hooks/hooks.json"; then
  echo "ERROR: $SRC/hooks/hooks.json is NOT PATH-patched — refusing to seed broken hooks" >&2
  exit 1
fi

seeded=0
skipped=0
for claudedir in "$RUNTIME_ROOT"/*/claude; do
  # CRITICAL: skip runtimes whose plugins dir is a SYMLINK (they share the
  # credentials-source plugins dir — that target is seeded separately). Writing
  # through the symlink, or rm -rf'ing through it, would corrupt the shared source.
  if [ -L "$claudedir/plugins" ]; then skipped=$((skipped+1)); continue; fi
  [ -d "$claudedir/plugins/marketplaces" ] || continue
  dest="$claudedir/plugins/marketplaces/omc"
  # Only remove a real (non-symlink) destination directory.
  if [ -L "$dest" ]; then rm -f "$dest"; elif [ -d "$dest" ]; then rm -rf "$dest"; fi
  cp -a "$SRC" "$dest"
  # Register in this runtime's known_marketplaces.json.
  kf="$claudedir/plugins/known_marketplaces.json"
  [ -f "$kf" ] || echo '{}' > "$kf"
  node -e '
    const f=process.argv[1], dest=process.argv[2], repo=process.argv[3];
    const k=require(f);
    k.omc={source:{source:"github",repo},installLocation:dest,lastUpdated:new Date().toISOString()};
    require("fs").writeFileSync(f, JSON.stringify(k,null,2)+"\n");
  ' "$kf" "$dest" "$REPO"
  echo "seeded: $claudedir"
  seeded=$((seeded+1))
done
echo "done — seeded $seeded real-dir runtime(s); skipped $skipped symlinked (covered via credentials source)"
