# Personal, always-on context-mode

Cue supports an explicit local installation without adding a server or dependency
to portable core profiles. Install and verify the upstream source first; keep the
checkout and runtime at stable absolute paths.

Create `~/.config/cue/context-mode.json` (or under `$XDG_CONFIG_HOME/cue`):

```json
{
  "enabled": true,
  "command": "/absolute/path/to/bun",
  "args": ["/absolute/path/to/context-mode/start.mjs"],
  "codexHooks": "/absolute/path/to/context-mode-codex-hooks.json",
  "claudeHooks": "/absolute/path/to/context-mode-claude-hooks.json"
}
```

The hook files use each client's native `{"hooks": {"Event": [...]}}` format.
Use the upstream hook definitions, replacing plugin-root placeholders and the
interpreter with the actual absolute installation paths. Back up existing client
settings before also installing these hooks for launches outside Cue.

On every materialization, Cue adds a pinned `context-mode` server, native hooks,
and concise routing guidance to both clients. Existing hooks remain intact.
This explicit opt-in also overrides remembered pruning of context-mode.
No installation file means no change. Set `enabled` to `false` to disable Cue's
integration; remove separately installed native hooks/MCP configuration separately.

Restart the agent after installation. Verify MCP initialization, an execute call,
index/search, and hook execution. A successful MCP connection alone does not prove
the client trusts or runs hooks. Context reduction is not evidence of improved
coding quality; compare identical tasks before claiming effectiveness gains.
