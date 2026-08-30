# Manual smoke — cue launch end-to-end

Run these steps by hand after `cue shell install`. Each step has an expected
result; note any divergence and file a bug before declaring the task done.

---

## 0. Pre-req

```bash
# Ensure PATH ordering is correct
echo $PATH | tr ':' '\n' | head -5   # ~/.local/bin must appear before the real claude/codex dirs
which claude                          # should print ~/.local/bin/claude
which codex                           # should print ~/.local/bin/codex
cue --version                         # prints the cue version
```

If `which claude` does not print `~/.local/bin/claude`, re-run `cue shell install`
and add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc, then open a new
terminal.

---

## 1. Symlink migration (only if upgrading from cue)

If you were previously running `cue`, run the migrate-symlinks command to update
any existing symlinks that still point into the old `cue/` directory tree:

```bash
cue migrate-symlinks \
  --map "$HOME/Documents/cue=$HOME/Documents/cue" \
  --map "$HOME/Documents/cue/skills=$HOME/Documents/cue/resources/skills" \
  --map "$HOME/Documents/cue/mcps=$HOME/Documents/cue/resources/mcps"
```

This is a dry run by default. Inspect the printed list. If it looks correct, apply:

```bash
cue migrate-symlinks \
  --map "$HOME/Documents/cue=$HOME/Documents/cue" \
  --map "$HOME/Documents/cue/skills=$HOME/Documents/cue/resources/skills" \
  --map "$HOME/Documents/cue/mcps=$HOME/Documents/cue/resources/mcps" \
  --apply
```

Expected: `updated > 0`, `errors: []`. Spot-check 2–3 of the rewritten symlinks
with `ls -la ~/.codex/skills | head -5` — targets should now point into
`$HOME/Documents/cue/resources/...`.

---

## 2. First launch in a new repo — TUI picker opens

```bash
mkdir -p /tmp/cue-smoke && cd /tmp/cue-smoke
claude
```

Expected:
- The profile picker opens (cue TUI via `@clack/prompts`).
- Arrow-key navigation works; pressing Enter selects a profile.
- After picking, `.cue-profile` is written to `/tmp/cue-smoke/`.
- Claude Code launches with that profile's skills and MCPs active.
- `CLAUDE_CONFIG_DIR` is set to `~/.config/cue/runtime/<profile>/claude/`.

---

## 3. Re-launch — picker is skipped

```bash
cd /tmp/cue-smoke
claude
```

Expected: no picker; Claude launches directly with the previously pinned profile.

---

## 4. Force picker

```bash
cd /tmp/cue-smoke
claude --cue-pick
```

Expected: picker opens despite the existing `.cue-profile` pin file.

---

## 5. Profile flag

```bash
claude --cue-profile frontend
```

Expected: launches under the `frontend` profile even though `.cue-profile` says
otherwise. The pin file is unchanged after this.

---

## 6. Dry-run

```bash
cd /tmp/cue-smoke
cue launch claude --dry-run
```

Expected: JSON payload printed to stdout with `profile`, `agent`, `runtimeDir`,
`rebuilt`, `hash`, `env`, `command`. No actual Claude process is started.

Run a second time:

```bash
cue launch claude --dry-run
```

Expected: `"rebuilt": false` — the content hash matched.

---

## 7. In-session commands (after Claude is running)

Inside a live Claude session:

```
/cue current         # prints active profile name, skill/MCP/plugin counts, runtime dir
/cue                 # shows numbered list of profiles; reply with a number or name
/cue switch backend  # pins backend to .cue-profile without opening the picker
/cue reload          # exec ~/.local/bin/claude — restarts with the new profile
```

Expected after `/cue reload`: Claude restarts with the profile set by `/cue switch`.

---

## 8. Codex parity

Repeat steps 2–6 with `codex` in place of `claude`. The shim at
`~/.local/bin/codex` calls `cue launch codex`; the runtime dir is
`~/.config/cue/runtime/<profile>/codex/` and `CODEX_HOME` is set instead of
`CLAUDE_CONFIG_DIR`.

---

## 9. Bypass paths

```bash
# Skip cue entirely — exec real claude with no profile
CUE_BYPASS=1 claude --version

# Explicit absolute path bypasses shim via PATH lookup
/usr/local/bin/claude --version
```

Expected: both print Claude's version string and nothing else — no `▸ claude ·
<profile>` banner, no loadout/MCP lines, no picker, no materializer. Under
`CUE_BYPASS=1` cue execs the real binary and gets out of the way; anything cue
prints here means the short-circuit in `launch.run()` was missed.

---

## 10. Recursion guard

Temporarily remove the real claude binary from its location on PATH (do NOT run
this in production — use a test PATH):

```bash
PATH="$HOME/.local/bin" claude
```

Expected: cue prints `shim recursion detected — check PATH ordering
(~/.local/bin must precede the real claude/codex location)` and exits 2.
Restore the real PATH after the check.
