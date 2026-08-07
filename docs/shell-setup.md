# Shell setup internals

How the `claude`/`codex` shims work, per shell. `cue setup` does all of this for
you — this page is for debugging or doing it by hand.

`cue setup` (or `cue shell install` on its own) writes the `~/.config/cue/shims/claude` shim and the PATH line for it. Two more lines round out the experience — drop them in your `.bashrc` / `.zshrc` / fish config:

```bash
eval "$(cue shell hook)"   # auto-switch profile when you cd into a project (bash/zsh/fish, auto-detected)
export CUE_KITTY=1          # inline profile-picker images in Kitty (CUE_DISABLE_KITTY_IMAGES=1 to opt out)
```

<details>
<summary><b>A real <code>.bashrc</code>, for reference</b> — agent wrappers, gitignored MCP secrets, parallel Claude accounts, and a per-session cost readout. Lift what's useful.</summary>

```bash
# --- cue -------------------------------------------------------------
eval "$(cue shell hook)"        # auto-switch profile on cd
export CUE_KITTY=1              # inline picker images in Kitty

# Source local MCP/API tokens so servers cue launches inherit them.
# Keep these files chmod 600 and out of git — never commit secrets.
[ -f "$HOME/.config/cue/secrets.env" ] && . "$HOME/.config/cue/secrets.env"
if [ -f "$HOME/.config/cue/runtime/<profile>/secrets.env" ]; then
  set -a; . "$HOME/.config/cue/runtime/<profile>/secrets.env"; set +a
fi

# Launch Codex through cue, inheriting GitHub auth from the gh keyring
# (token pulled at runtime, never written to the rc file).
codex() {
  local tok; command -v gh >/dev/null && tok="$(gh auth token 2>/dev/null)"
  local prof="${CUE_CODEX_PROFILE:-core}"
  if command -v cue >/dev/null && [ -z "${CUE_SKIP_LAUNCH:-}" ]; then
    GH_TOKEN="$tok" GITHUB_TOKEN="$tok" cue launch codex --cue-profile "$prof" "$@"
  else
    GH_TOKEN="$tok" GITHUB_TOKEN="$tok" command codex "$@"
  fi
}

# Parallel Claude accounts — each gets its own CLAUDE_CONFIG_DIR + profile.
# Usage: claude-acct work pick   |   claude-acct personal backend
claude-acct() {
  local dir="$HOME/.claude-accounts/$1" prof="${2:-pick}"; shift 2 2>/dev/null
  if [ "$prof" = "pick" ]; then
    CLAUDE_CONFIG_DIR="$dir" cue launch claude --cue-pick "$@"
  else
    CLAUDE_CONFIG_DIR="$dir" cue launch claude --cue-profile "$prof" "$@"
  fi
}

# Open Claude in a fresh detached Kitty window (sidesteps tmux repaint contention).
kcc() { kitty --detach --title "claude${1:+ ($1)}" -- bash -lc "cd ${1:-$PWD} && exec claude" & disown; }

# Per-session token + cost readout from the live Claude transcript.
cc-tokens() {
  local f; f=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1)
  [ -z "$f" ] && { echo "No session log found"; return 1; }
  python3 - "$f" <<'PY'
import sys, json, re
totals, turns = {}, 0
for line in open(sys.argv[1]):
    try: e = json.loads(line)
    except Exception: continue
    if e.get("type") != "assistant": continue
    u = e.get("message", {}).get("usage") or {}
    if not u: continue
    turns += 1
    m = re.sub(r"^[a-z]{2}\.", "", e["message"].get("model", "?"))
    t = totals.setdefault(m, {"in": 0, "out": 0, "cr": 0, "cc": 0})
    t["in"] += u.get("input_tokens", 0);  t["out"] += u.get("output_tokens", 0)
    t["cr"] += u.get("cache_read_input_tokens", 0); t["cc"] += u.get("cache_creation_input_tokens", 0)
PRICE = {  # $/Mtok: input, cache-read, cache-write, output
    "claude-opus-4-8": (15, 1.5, 18.75, 75), "claude-sonnet-4-6": (3, .3, 3.75, 15),
    "claude-haiku-4-5": (.8, .08, 1, 4)}
DEF = (3, .3, 3.75, 15)
print(f"\n{'Model':<20}{'In':>9}{'Out':>8}{'CacheR':>9}{'Cost$':>9}")
for m, t in totals.items():
    p = PRICE.get(m, DEF)
    cost = t['in']*p[0]/1e6 + t['cr']*p[1]/1e6 + t['cc']*p[2]/1e6 + t['out']*p[3]/1e6
    print(f"{m:<20}{t['in']:>9,}{t['out']:>8,}{t['cr']:>9,}${cost:>8.4f}")
print(f"\n{turns} turns this session")
PY
}
# --- /cue ------------------------------------------------------------
```

> Secrets are sourced from gitignored files (`chmod 600`), never hardcoded, and the GitHub token is read from `gh` at runtime — nothing sensitive lives in your rc. `cue cost` gives the per-profile budget; `cc-tokens` above is the live per-session spend.

</details>
