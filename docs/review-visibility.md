# Live code-review visibility

> See what a code review is doing in **real time** — which file/dimension is under
> review and findings as they land — instead of an opaque "Precipitating…" spinner.

Claude Code renders a running subagent as a collapsed spinner (harness-fixed, not
ours to change). So instead of trying to repaint it, every cue reviewer streams
progress to a shared, tail-able log, and you watch that.

## Watch a review live

Run this in a second pane (or split):

```bash
cue-review-watch            # follows the latest review, live
cue-review-watch --id <id>  # a specific review
cue-review-watch --once     # print progress so far and exit
```

You'll see, as it happens:

```
16:42:01  ▶ review started  (8 files) auto-review
16:42:03  📄 tracker.html
16:42:03     → injection
16:42:09     🟠 HIGH  tracker.html:412  innerHTML from localStorage (XSS)
16:42:10     → races
16:42:14  📄 db.ts
16:45:30  ✅ review complete  1 HIGH, 0 CRITICAL
```

## How it works

Storage (append-only JSONL, tail-friendly):

```
~/.config/cue/review-progress/<id>.jsonl   # one event per line
~/.config/cue/review-progress/latest       # pointer holding the current <id>
```

Event schema (the contract every reviewer writes):

```jsonc
{ "ts","id","kind":"start|file|dim|finding|note|end",
  "file":"path", "dim":"injection", "severity":"CRITICAL|HIGH|MEDIUM|LOW",
  "title":"short", "detail":"longer (optional)" }
```

## Emitting progress from a reviewer

**Stop-hook reviewer (`auto-review.sh`)** — wired and tested. It tells its headless
reviewer to print `PROGRESS:` / `FOUND:` lines, captures the full output, replays
those lines to the JSONL, and parses the `REVIEW_CLEAN` / `CRITICAL:`/`HIGH:` verdict
with the progress side-channel filtered out — so verdict integrity never depends on a
pipe staying open, and progress text can't be misread as a verdict. The truly
real-time path is the Agent-subagent reviewer below, which calls the emitter directly.
See `resources/hooks/review-progress.test.ts`.

**Subagent / skill reviewers** (`/code-review`, `/code-review-deep`, `/ship` Step 9,
a `code-reviewer` Agent) — call the emitter as you review, so the watcher pane fills:

```bash
ID=$(cue-review-progress start --label "PR #2 diff" --files 8)
cue-review-progress emit --kind file --file tracker.html
cue-review-progress emit --kind dim  --file tracker.html --dim injection
cue-review-progress emit --kind finding --file tracker.html --dim injection \
  --severity HIGH --title "innerHTML from localStorage (XSS)"
cue-review-progress end --summary "1 HIGH, 0 CRITICAL"
```

`bin/` is on PATH for cue installs; from a checkout use `bin/cue-review-progress`.

## Roadmap

- **Now:** terminal watcher (`cue-review-watch`) fed by the JSONL; `auto-review.sh` wired.
- **Next:** a dashboard "Live Review" panel — one GET route reading the newest JSONL,
  polled every 2s (reuse the `handleGates` poll pattern; do NOT ride the SSE stream,
  it's hardwired to `buildTimeline`). Optional tmux `@cue_review` badge.
- **Later:** workflow-per-dimension reviewer (per-stage rows in `/workflows`).
