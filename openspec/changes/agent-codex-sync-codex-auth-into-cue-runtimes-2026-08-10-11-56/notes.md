# agent-codex-sync-codex-auth-into-cue-runtimes-2026-08-10-11-56 (minimal / T1)

Branch: `agent/<your-name>/<branch-slug>`

Describe the change in a sentence or two. Commit message is the spec of record.

## Handoff

- Handoff: change=`agent-codex-sync-codex-auth-into-cue-runtimes-2026-08-10-11-56`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-codex-sync-codex-auth-into-cue-runtimes-2026-08-10-11-56` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-codex-sync-codex-auth-into-cue-runtimes-2026-08-10-11-56/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
# Codex auth sync

- Cause: Cue launches Codex with a profile-isolated `CODEX_HOME`, while AuthMux manages `~/.codex/auth.json`.
- Fix: copy canonical auth into the selected runtime before launch, then copy refreshed runtime auth back after exit.
- Verification: `bun test src/lib/codex-auth-sync.test.ts`; `bunx tsc --noEmit`.
