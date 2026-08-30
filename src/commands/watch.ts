/**
 * `cue watch` — output a shell hook that auto-switches profile on cd.
 *
 * Usage:
 *   eval "$(cue watch bash)"   # add to ~/.bashrc
 *   eval "$(cue watch zsh)"    # add to ~/.zshrc
 *
 * The hook runs after every `cd` and checks if the .cue.profile changed.
 * If it did, it shows a notification with the new profile.
 */

function bashHook(): string {
  return `# cue watch — auto-switch profile on cd
# Add to ~/.bashrc: eval "$(cue watch bash)"
__cue_last_profile=""

__cue_watch() {
  local profile_file=""
  local dir="$PWD"

  # Walk up to find .cue.profile
  while [[ "$dir" != "/" && "$dir" != "$HOME" ]]; do
    if [[ -f "$dir/.cue.profile" ]]; then
      profile_file="$dir/.cue.profile"
      break
    fi
    dir="$(dirname "$dir")"
  done

  if [[ -z "$profile_file" ]]; then
    if [[ -n "$__cue_last_profile" ]]; then
      __cue_last_profile=""
    fi
    return
  fi

  local profile
  profile="$(cat "$profile_file" 2>/dev/null | tr -d '\\n')"

  if [[ "$profile" != "$__cue_last_profile" && -n "$profile" ]]; then
    local prev="$__cue_last_profile"
    __cue_last_profile="$profile"

    # Show notification
    if [[ -n "$prev" ]]; then
      printf '\\033[1m⚡ cue:\\033[0m profile switched \\033[2m%s\\033[0m → \\033[1m%s\\033[0m\\n' "$prev" "$profile"
    else
      printf '\\033[1m⚡ cue:\\033[0m profile active → \\033[1m%s\\033[0m\\n' "$profile"
    fi
  fi
}

# Hook into cd
__cue_cd() {
  builtin cd "$@" && __cue_watch
}
alias cd='__cue_cd'

# Run on shell start
__cue_watch
`;
}

function zshHook(): string {
  return [
    "# cue watch — auto-switch profile on cd",
    '# Add to ~/.zshrc: eval "$(cue watch zsh)"',
    '__cue_last_profile=""',
    "",
    "__cue_watch() {",
    '  local profile_file=""',
    '  local dir="$PWD"',
    "",
    "  # Walk up to find .cue.profile",
    '  while [[ "$dir" != "/" && "$dir" != "$HOME" ]]; do',
    '    if [[ -f "$dir/.cue.profile" ]]; then',
    '      profile_file="$dir/.cue.profile"',
    "      break",
    "    fi",
    '    dir="${dir:h}"',
    "  done",
    "",
    '  if [[ -z "$profile_file" ]]; then',
    '    if [[ -n "$__cue_last_profile" ]]; then',
    '      __cue_last_profile=""',
    "    fi",
    "    return",
    "  fi",
    "",
    "  local profile",
    '  profile="$(<"$profile_file")"',
    "  profile=\"${profile%%$'\\n'}\"",
    "",
    '  if [[ "$profile" != "$__cue_last_profile" && -n "$profile" ]]; then',
    '    local prev="$__cue_last_profile"',
    '    __cue_last_profile="$profile"',
    "",
    '    if [[ -n "$prev" ]]; then',
    '      printf \'\\033[1m⚡ cue:\\033[0m profile switched \\033[2m%s\\033[0m → \\033[1m%s\\033[0m\\n\' "$prev" "$profile"',
    "    else",
    '      printf \'\\033[1m⚡ cue:\\033[0m profile active → \\033[1m%s\\033[0m\\n\' "$profile"',
    "    fi",
    "  fi",
    "}",
    "",
    "# Hook into chpwd (zsh's built-in cd hook)",
    "autoload -Uz add-zsh-hook",
    "add-zsh-hook chpwd __cue_watch",
    "",
    "# Run on shell start",
    "__cue_watch",
  ].join("\n") + "\n";
}

export async function run(args: string[]): Promise<number> {
  const shell = args[0] ?? (process.env.SHELL?.includes("zsh") ? "zsh" : "bash");

  if (shell === "zsh") {
    process.stdout.write(zshHook());
  } else if (shell === "bash") {
    process.stdout.write(bashHook());
  } else if (shell === "--help" || shell === "-h") {
    process.stdout.write(
      "cue watch — auto-switch profile notification on cd\n\n" +
      "Usage:\n" +
      '  eval "$(cue watch bash)"   # add to ~/.bashrc\n' +
      '  eval "$(cue watch zsh)"    # add to ~/.zshrc\n\n' +
      "When you cd into a directory with a .cue.profile, it shows:\n" +
      "  ⚡ cue: profile switched frontend → backend\n"
    );
  } else {
    process.stderr.write(`cue watch: unsupported shell "${shell}"\n`);
    process.stderr.write('Usage: eval "$(cue watch bash)"\n');
    return 1;
  }
  return 0;
}
