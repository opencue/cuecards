# Skill discovery and rule sync

## Find a skill on skills.sh

```sh
cue discover search --skills-sh "frontend design" --limit 10
cue discover search --skills-sh react --json
```

This opt-in search sends the query to [Vercel's skills.sh index](https://skills.sh).
It returns the skill, source repository, and reported install count. It does not
install anything, update profiles, or change the GitHub discovery cache. Review
the skill and its source before installing. Without `--skills-sh`, discovery
still searches GitHub. The skills.sh endpoint is used by
[Vercel's CLI](https://github.com/vercel-labs/skills/blob/57217cf86ba3/src/find.ts),
but is not a documented stable API.

## Preview or check a Rulesync project

With a trusted [Rulesync](https://github.com/dyoshikawa/rulesync) executable on
`PATH` and a `rulesync.jsonc` in the project (on Windows, use the native
[release executable](https://github.com/dyoshikawa/rulesync/releases) as
`rulesync.exe`, not an npm `.cmd` shim):

```sh
cue ruler --rulesync --dir .
cue ruler --rulesync --dir . --check
```

The first command previews the output for the project's configured targets.
The second preserves Rulesync's exit code, so it can detect drift in CI.
Cue does not download Rulesync or apply its generated files. The existing
`cue ruler` command still uses the active Cue profile's own rules. Avoid
letting both tools own the same output files.

## Further ideas from upstream

These are follow-ups, not features shipped by the commands above:

| Idea | Upstream reference | Where it fits in Cue |
|---|---|---|
| Portable bundles with a preview | [HarnessKit manifest](https://github.com/RealZST/HarnessKit/blob/12db128ad/crates/hk-core/src/kits/manifest.rs) and [install plan](https://github.com/RealZST/HarnessKit/blob/12db128ad/crates/hk-core/src/kits/install_plan.rs) | Extend `cue export --portable` and the existing pack resolver. Preview collisions and exclude secret values from exports. |
| Pin a skill's repository, revision, exact path, and content hash | [Vercel Skills lockfile](https://github.com/vercel-labs/skills/blob/57217cf86ba3/src/local-lock.ts), [skills-sync import lock](https://github.com/ryanreh99/skills-sync/blob/9ab3191b9c99/src/lib/import-lock.js) | Extend Cue's existing `.source` metadata and pin history before adding automatic updates. |
| Preview and audit upstream changes before replacing local files | [Skillshare update handlers](https://github.com/runkids/skillshare/blob/78d3fa27bc02/cmd/skillshare/update_handlers.go), [Skills Manager updater](https://github.com/xingkongliang/skills-manager/blob/8bce085df8c2/src-tauri/src/core/skill_auto_updater.rs) | Keep update checks separate from applying changes; leave a working skill in place when the update is blocked. |
| Show why a skill matched | [Agentic Awesome Skills catalog search](https://github.com/sickn33/agentic-awesome-skills/blob/166f581cfdc3/apps/web-app/src/utils/catalogSearch.ts) | Add match reasons to the catalog when search ranking needs explanation. |
| Protect manually edited generated files | [Agent Layer ownership manifest](https://github.com/conn-castle/agent-layer/blob/97c16490d9c9/internal/install/ownership_manifest.go), [Caliber reconciliation](https://github.com/caliber-ai-org/ai-setup/blob/f5dbc002022a/src/sync/reconcile.ts) | If automated sync is added, record the last generated digest and quarantine conflicts rather than overwriting edits. |
