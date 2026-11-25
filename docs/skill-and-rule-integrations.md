# Skill and MCP discovery, and rule sync

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

## Find an MCP server in the official registry

```sh
cue mcps search filesystem
cue mcps search github --limit 5 --json
```

This command sends the search term and result limit to the [official MCP
Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md).
It searches published server names and returns metadata such as versions,
package identifiers, transport types, and source links. It does not read
project files, send configuration values, install packages, run servers, or
modify profiles. Don't include secrets in the search term. Set `CUE_OFFLINE=1`
to block the request.

`cue discover mcps` is a separate, GitHub-based search. Finding a server in the
registry is not a security endorsement. Review its source and setup instructions
before configuring it. Use `cue mcps health --shallow` to check your own
configuration without starting servers, or the upstream [MCP
Inspector](https://github.com/modelcontextprotocol/inspector) to debug a server
you already trust.

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
| Interoperability with project kits | [HarnessKit manifest](https://github.com/RealZST/HarnessKit/blob/12db128ad/crates/hk-core/src/kits/manifest.rs) and [install plan](https://github.com/RealZST/HarnessKit/blob/12db128ad/crates/hk-core/src/kits/install_plan.rs) | Cue already has portable profiles and an import preview. A separate adapter could preview which kit assets map onto that format without automatically running hooks or importing memory. |
| Pin a skill's repository, revision, exact path, and content hash | [Vercel Skills lockfile](https://github.com/vercel-labs/skills/blob/57217cf86ba3/src/local-lock.ts), [skills-sync import lock](https://github.com/ryanreh99/skills-sync/blob/9ab3191b9c99/src/lib/import-lock.js) | Extend Cue's existing `.source` metadata and pin history before adding automatic updates. |
| Preview and audit upstream changes before replacing local files | [Skillshare update handlers](https://github.com/runkids/skillshare/blob/78d3fa27bc02/cmd/skillshare/update_handlers.go), [Skills Manager updater](https://github.com/xingkongliang/skills-manager/blob/8bce085df8c2/src-tauri/src/core/skill_auto_updater.rs) | Keep update checks separate from applying changes; leave a working skill in place when the update is blocked. |
| Show why a skill matched | [Agentic Awesome Skills catalog search](https://github.com/sickn33/agentic-awesome-skills/blob/166f581cfdc3/apps/web-app/src/utils/catalogSearch.ts) | Add match reasons to the catalog when search ranking needs explanation. |
| Protect manually edited generated files | [Agent Layer ownership manifest](https://github.com/conn-castle/agent-layer/blob/97c16490d9c9/internal/install/ownership_manifest.go), [Caliber reconciliation](https://github.com/caliber-ai-org/ai-setup/blob/f5dbc002022a/src/sync/reconcile.ts) | If automated sync is added, record the last generated digest and quarantine conflicts rather than overwriting edits. |
| Check for secrets before sharing | [Gitleaks](https://github.com/gitleaks/gitleaks) | Optionally scan the raw files selected for a portable export; scanning base64-encoded payloads is not a substitute. |
| Explain missing tools | [mise](https://github.com/jdx/mise/blob/main/docs/dev-tools/index.md) | Show which tools a profile expects without trusting project configuration or installing them. |
| Find earlier agent work | [CASS](https://github.com/Dicklesworthstone/coding_agent_session_search/blob/main/SKILL.md), [Entire](https://github.com/entireio/cli/blob/main/docs/architecture/sessions-and-checkpoints.md) | CASS searches local sessions; Entire links session checkpoints to Git. Keep either opt-in: a profile launcher need not index or publish session history. |

## Open the upstream sources locally

With `opensrc` installed, run this from the Cue checkout. It returns cached
source paths for inspection; it does not install these tools or add them to
Cue's dependencies.

```sh
opensrc path --cwd "$PWD" \
  modelcontextprotocol/registry modelcontextprotocol/inspector \
  RealZST/HarnessKit vercel-labs/skills dyoshikawa/rulesync \
  ryanreh99/skills-sync runkids/skillshare gitleaks/gitleaks jdx/mise \
  Dicklesworthstone/coding_agent_session_search entireio/cli
```
