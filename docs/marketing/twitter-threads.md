# Twitter / X drafts

One thread per release. Keep them visual — every tweet should have a screenshot,
asciinema GIF, or terminal capture. Text-only threads on developer X get ignored.

## Release thread template

Use for every minor version bump (`v0.x.0`).

### Tweet 1 (hook)

```
new in cue v0.X.0 — [one-line headline]

cue is the profile manager for Claude Code & Codex. Today's release adds
[the thing], which means [the user-facing outcome].

🎥 demo: ↓
```

Attach: 30-second asciinema GIF or screen recording showing the feature in action.

### Tweet 2 (the demo)

```
[Screenshot or GIF of cue actually doing the thing]

[two-line caption explaining what's happening on screen]
```

### Tweet 3 (the why)

```
why this matters:

[2-3 bullet points on the problem this solves]
```

### Tweet 4 (CTA)

```
try it:

  npm install -g cue-ai
  cue discover [...]

repo: github.com/opencue/cuecards
docs: opencue.github.io/cue/

★ if useful, RT if cursed.
```

## Concrete release threads

### v0.X — "Hidden Gem" notifications

```
1/ Just shipped a tokscale-style notification system in cue.

When cue's discovery engine indexes your repo, it opens ONE issue thanking
you, with hero badges showing your score, stars, and assigned profile.

cue is a profile manager for Claude Code / Codex. Open source, MIT.

🧵
```

```
2/ Here's what the issue looks like — score + tier badge, stars badge,
profile badge, then a collapsed score breakdown so you can see exactly
why your repo was picked.

[screenshot of issue body]
```

```
3/ It's idempotent. One issue per repo, ever. The dedup log lives at
~/.config/cue/discover-notified.json — no surprise spam.

Opt-out is literally just closing the issue.
```

```
4/ Why it matters:

- Maintainers find out their work is being used (often surprising them)
- Backlinks to cue from every indexed repo's issue page
- The visibility table in the issue body shows them exactly where they appear
```

```
5/ Want to discover gems yourself?

  npm install -g cue-ai
  cue discover

repo: github.com/opencue/cuecards

★ if you've ever wished GitHub had better discovery for AI agent skills.
```

### v0.X — Profile decomposition (rust split)

```
1/ Just split cue's rust profile into 8 sub-profiles.

The kitchen-sink "rust" profile was hitting 40+ skills, burning context tokens.
New shape:

rust-core      → foundation (everyone inherits)
rust           → general dev
rust-web       → axum/reqwest/sqlx
rust-cli       → clap/ratatui
rust-ffi       → pyo3/napi-rs/uniffi
rust-embedded  → probe-rs/embassy
rust-game      → bevy
rust-wasm      → wasm-pack/trunk

🧵
```

```
2/ The split is via `inherits:` — same skills on disk, no duplication, but
each profile only loads what's relevant to that subdomain.

Working on a wasm SPA? `echo rust-wasm > .cue.profile` and cue loads
exactly that subset.
```

```
3/ Token cost dropped from ~60 CLI deps to 20-35 depending on sub-profile.

Claude Code sessions load faster, agent responses are more focused, and
the profile-fit-monitor skill (always-on) suggests when you're in the
wrong sub-profile.
```

```
4/ try it:

  npm install -g cue-ai
  cd your/rust/project
  cue init       # auto-suggests the right rust* sub-profile

40+ profiles available across rust, python, frontend, backend,
cybersecurity, marketing, creative-media…

repo: github.com/opencue/cuecards
```

### Single-tweet demos (for off-release weeks)

```
the discover command in cue is criminally underused

`cue discover --tier premium --not-installed` shows you high-quality
agent skills that aren't yet in any of your profiles

[screenshot of tiered output]

(MIT, open source: github.com/opencue/cuecards)
```

```
TIL cue's profile-fit-monitor detects when your active profile mismatches
the project you're in

cd into a rust project with the marketing profile pinned → it suggests
switching to rust-core before you've even sent a message

[screenshot of the suggestion]
```

## Anti-patterns

- ❌ Threads without images / GIFs — read past at 90%+ rate
- ❌ Mentioning competitors by name in a negative frame — backfires
- ❌ Engagement-bait first tweet ("guess what we shipped today 👀")
- ❌ Tagging large accounts in the hook ("@AnthropicAI look!") — most consider it spam

## Posting schedule

- Tuesday 10am ET (your timezone-equivalent) — best engagement window for dev twitter
- Avoid weekends + Mondays
- Don't post if the thread isn't ready — half-finished threads get pulled forever
