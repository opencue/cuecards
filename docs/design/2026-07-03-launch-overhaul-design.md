# Launch overhaul — freeze fix + lean-launch (2026-07-03)

Follow-up to the `claude-account1` launch-freeze debugging session. The freeze
had two root causes (both fixed first): cue forwarded `--` to the agent so
`claude -- --version` opened an interactive session on a non-TTY stdin and hung;
and the smart-subset classifier booted the account's full MCP + plugin stack on
every uncached launch, blowing its budget. This overhaul hardens the launch path
around those fixes.

## Shipped

| Item | Change | Effect |
|---|---|---|
| **A** | `mcpPrune: all` on `profiles/core/profile.yaml` | Every core-inheriting profile drops unused/global MCP servers at launch. Escape: `CUE_PRUNE_MCPS=off`, the picker. |
| **B** | Delete the captured-first-prompt classifier fallback (`launch.ts`) | Bare TUI launches classify NOTHING (zero LLM call). Classification runs only with a real prompt (`--subset` or a `-p` fold). `-p` prompts now use the keep-set cache (`subsetExplicit`), so repeat launches don't re-call the classifier. |
| **C** | Drop `pickedProfileInteractively` from the MCP-toggle force-open predicate | A remembered MCP choice is honored — picking a profile from the startup menu no longer re-forces the toggle. Extracted `shouldOpenMcpPicker` (pure, tested). |
| **E** | Classifier spawns with an ephemeral `CLAUDE_CONFIG_DIR` (copied creds, empty settings) | The classifier no longer loads the user's plugins (claude-mem worker daemon per call), fires hooks, or writes phantom sessions. Rotation-safe: a newer token copies back to source. |
| **F** | `cue gc` + throttled post-session auto-sweep (`src/lib/runtime-gc.ts`) | Deletes runtimes idle > `CUE_RUNTIME_GC_DAYS` (default 30, `0` disables), never the just-used one, rescuing newer creds first. Runs after the session ends → zero launch latency. |

Prior to this overhaul, the classifier already got `--strict-mcp-config --model
haiku` and cue already consumes the `--` separator — those two were the direct
freeze fixes and shipped first.

## Not shipped — D (parallelize classifier ‖ materialize)

Measured, then dropped. Materialize is **0.66s**; the classifier is **~8s**. The
classifier dominates, so materialize already hides under it — parallelizing saves
≤0.66s. Worse, the only way to overlap them is materialize-full-then-prune, a
double disk pass that risks corrupting a runtime. The original "9s → 5-6s" premise
was wrong: the 9s was almost entirely the classifier, which item B removes from
the common (bare-TUI) path. Net: high risk, ≤0.66s reward → not worth it.

## Verification

- `bun test`: 1516 tests, 0 fail. New tests: `launch.parse.test.ts` (separator +
  subset origin + toggle predicate), `skill-subset.isolation.test.ts`,
  `runtime-gc.test.ts`.
- E2E smoke: the original freeze command `cue launch claude --cue-profile core --
  --version` now prints the version and exits in ~0.75s (was: never exited).
- Classifier isolation confirmed: no claude-mem worker spawned, temp home cleaned.

## Known follow-ups (out of scope)

- `resources/hooks/first-prompt-capture.sh` is now a dead writer (item B removed
  its only reader). Harmless; unwire when convenient.
- `cue clean --force` treats any runtime dir whose name isn't a base profile as
  "stale" — that includes composite/account runtimes (`core@account1`,
  `seo+gstack+core`). Pre-existing; `cue gc` (age-based) is the safe alternative.
