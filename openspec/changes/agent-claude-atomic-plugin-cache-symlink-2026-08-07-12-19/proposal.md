## Why

A Stop hook died mid-session with:

```
Plugin directory does not exist: <runtime>/plugins/cache/thedotmack/claude-mem/13.13.1
(claude-mem@thedotmack — run /plugin to reinstall)
```

The plugin was not missing. Its payload has been on disk since 2026-08-04; only
the runtime's `plugins/cache` symlink was gone, recreated seconds later
(observed 2026-08-07: `installed_plugins.json` written 10:10:57Z, the symlink
recreated at 10:11:07Z, hooks firing in between).

`linkPluginCache()` replaces each entry with `rm()` followed by `symlink()`.
Between those two awaits the path does not exist. Re-materializing a runtime
happens while sessions are live, so any hook that resolves a plugin installPath
in that window fails — with the exact error the function's own doc comment says
it exists to prevent.

The window is not theoretical. A reader polling the path across 300 swaps
observes **441** ENOENTs against the old implementation and **0** against the
new one.

## What Changes

Stage the replacement symlink beside the target and `rename()` it over.
`rename(2)` within one directory is atomic, so a concurrent reader sees either
the old entry or the new one, never neither.

`rename()` refuses to clobber a real directory, so the previous
remove-then-create is kept as a fallback for that one case: Claude's lazy empty
`cache/` copy on a first materialization, before any session can read it.

On failure the staged link is cleaned up and the existing entry is left in
place, rather than removed.

## Impact

- `src/lib/runtime-materializer.ts` — `linkPluginCache()` only.
- No behavior change in the steady state: the resulting symlinks are identical.
- New coverage in `src/lib/runtime-materializer.plugin-cache.test.ts`, including
  a race assertion that fails against the old implementation. That test cannot
  false-fail: an atomic rename has no window in which the entry is absent.
