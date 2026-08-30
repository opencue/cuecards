# cue self-learner — auto-improving profiles

> Status: **pilot** (wired into `skill-writer` only; default-OFF behind a flag).
> Goal: while Claude works, capture where the active profile's skills fall short,
> judge the gap, and feed a gated fix back so the profile sharpens over time.

## Why this shape

Claude Code has **no `SubagentStop`/post-task lifecycle event** (`profiles/schema.json`
hooks enum = PreToolUse/PostToolUse/SessionStart/SessionEnd/Stop). So "an agent that
always watches" cannot be a persona instruction — that is best-effort and gets skipped
under context pressure. The only deterministic always-on surface is a **Stop hook**.

A Stop hook that *spawns an agent and blocks* has two CRITICAL traps (proven taming in
`resources/hooks/auto-review.sh`): a Stop→work→Stop veto loop, and a spawned `claude -p`
re-firing the same hook into a fork-bomb. We avoid both by **never blocking** and by an
**inner-env recursion guard**.

## Layers

| Layer | Trigger | Cost | Output |
|---|---|---|---|
| **L1 capture** | every substantive Stop | ~0 (pure bash) | one `skill_gap` event (`source:"hook"`) with friction signals |
| **L0 live critic** | once per session (substantive) | one `claude -p` (240s budget) | one `skill_gap` event (`source:"critic"`) naming the weak skill + fix |
| **L2 synthesis** | on-demand `cue profile self-improve` | batched model call | ROI-ranked proposal across many sessions |
| **L3 apply** | inside L2 | low | auto-apply when `cue lint-skill` passes, else proposal; backup + `evolution-log.jsonl` |

L1+L0 live in one hook: `resources/hooks/profile-self-improve.sh`. L2/L3 are a later
slice (`cue profile self-improve` + `/profile-self-improve` skill).

> Note: L1 friction signals and the substance gate read the last 200KB of the
> transcript (`tail -c`), so on very long sessions early-turn signals are
> tail-biased. The consumer should treat `signals` as "recent friction", not a
> whole-session census. `first_prompt` is capped at 160 chars and empty when the
> first user turn is a tool_result array (no raw-line leak).

## Safety contract (non-negotiable)

1. **Never blocks Stop** — exit 0 always. The existing quality-gates stay the sole veto.
2. **Recursion guard** — `CUE_AUTO_IMPROVE_INNER=1` on the spawned critic; checked at top.
3. **Opt-in** — needs BOTH `~/.config/cue/.auto-improve-enabled` AND `~/.config/cue/.telemetry-consent`.
4. **Critic runs once per `session_id`** (sentinel under `~/.config/cue/self-improve/`).
5. **Hook never edits `profile.yaml`/`SKILL.md`** — it only appends signal events. All
   mutation happens later, behind `cue lint-skill` + backup + log + revert.
6. **Fail-open** — any missing dep / timeout / malformed input → exit 0, learn nothing.

## Enable / disable

```bash
touch ~/.config/cue/.auto-improve-enabled      # turn on (telemetry consent also required)
rm    ~/.config/cue/.auto-improve-enabled      # turn off
export CUE_SELF_IMPROVE_NO_CRITIC=1            # cheap capture only, skip the live critic
```

## The `skill_gap` event

Appended to the existing `~/.config/cue/analytics.jsonl` (a new variant of the
`SessionEvent` union in `src/lib/analytics.ts`, inert to current readers):

```jsonc
{ "ts","event":"skill_gap","profile","session_id","cwd","agent":"claude-code",
  "source":"hook"|"critic",
  "signals":["retry-loop","tool-error","soft-load:coolify"],  // L1 only
  "skill":"meta/foo","gap_type":"missing-skill|weak-description|weak-body|profile-composition",
  "suggestion":"<=140 chars","confidence":1-10,                // critic only
  "first_prompt":"<redacted, truncated>" }
```

## Rollout

1. Pilot: `profiles/skill-writer/profile.yaml` `hooks:` (done).
2. Promote the hook to `profiles/core/profile.yaml` once it earns its keep — fans out to
   every profile, still default-OFF behind the flag.
