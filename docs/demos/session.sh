# Sourced by VHS in its capture shell, from the repository root.
demo=$(mktemp -d) || return
trap 'rm -r -- "$demo"' EXIT
export DEMO_CUE="$PWD/bin/cue"
# Start at the picker, after one-time global setup.
mkdir -p "$demo/home/.config/cue" "$demo/project" || return
touch "$demo/home/.config/cue/.onboarded" || return
cat > "$demo/codex" <<'EOF'
#!/bin/sh
set -eu
test -s "$CODEX_HOME/config.toml"
printf '\n\033[1;35m◆ SIMULATED CODEX\033[0m  ·  no model calls\n'
printf '  Profile  %s\n  Runtime  config.toml received ✓\n' "$CUE_PROFILE"
sleep 1
case "$CUE_PROFILE" in
  core) sample='List project files, then locate the test entry point.' ;;
  *) sample='Trace the request from the API handler to the UI.' ;;
esac
printf '  Sample   %s\n' "$sample"
EOF
chmod +x "$demo/codex" || return
cue() {
  env -i HOME="$demo/home" PATH="$demo:$PATH" TERM="$TERM" LANG=C.UTF-8 \
    CUE_OFFLINE=1 CUE_NO_UPDATE_CHECK=1 CUE_PROFILE_ADVISOR=off "$DEMO_CUE" "$@"
}
cd "$demo/project" || exit
PS1=$'\[\e[38;5;117m\]cue-demo ❯\[\e[0m\] '
