# Curated fork skills

Browse and filter the public bundled skill inventory and the two featured
NagyVikt forks at [Cuecards → Skills](https://cuecards.cc/skills). The web build
reads the checked-out Cue skills catalog, or the published `opencue/skills`
catalog in a web-only build. The list refreshes on the next web build rather
than relying on a manually copied inventory. Local-only skills are not listed.

The blog and motion forks are listed in full at the reviewed snapshots.
Browse-only entries use their own fixed snapshot so refreshing an installable
pin does not change their source link or imply their contents were reviewed.
Only entries showing an install command are in the Cue overlay. To use those:

```sh
cue skills catalog
cue skills catalog "publishing calendar"
cue skills catalog install blog-calendar
cue use core+nagyvikt-skills
```

The [reviewed catalog](../web/src/skill-catalog.json) serves both the CLI and
website. It shows an editor-written summary and an immutable GitHub source link.
Installing is opt-in: Cue hands the selected commit and directory to its
standard skill installer, which installs for your user and offers profile
registration. No catalog entry changes default profiles.

Use the `nagyvikt-skills` extension to include the whole collection in a
project profile. Replace `core` with your existing profile to keep it active.

## Source updates

`Check fork skill updates` runs nightly and can be started from Actions. It
compares Git tree hashes for the selected directories, so unrelated fork
commits do not move catalog pins. It does not run fork content. Candidates
adding non-Markdown files or changing the license require manual handling.

The run summary links to the source diffs. If the optional repository secret
`FORK_SKILLS_PR_TOKEN` is configured (a fine-grained token restricted to this
repository with contents and pull-request write permissions), the workflow
opens a PR. Otherwise it prints the proposed patch
in the summary. Review the skill text and references before merging, and
revise the catalog description if the skill's purpose changed. The workflow
does not auto-merge.

Merged pins reach Cuecards with the site's next deployment and the CLI with
the next Cue release. After updating Cue, the opted-in profile resolves the
new approved commits on launch without reinstalling each skill. If you installed
an individual skill instead, run its install command again. The schedule never
rewrites local skills directly.

To check sources locally (read-only), run
`bun scripts/refresh-fork-skills.ts` with an authenticated `gh`.

To smoke-test a pin, call the Cue resolver in an empty temporary directory
with the full SHA and again with a unique prefix. Compare each installed
`blog-brief/SKILL.md` to GitHub's raw file at the full SHA:

```sh
pin="$(jq -r '.[0].commit' web/src/skill-catalog.json)"
tmp="$(mktemp -d)"
gh api -H 'Accept: application/vnd.github.raw+json' \
  "repos/NagyVikt/claude-blog/contents/skills/blog-brief/SKILL.md?ref=$pin" > "$tmp/expected"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}"
mkdir "$tmp/home"
for ref in "$pin" "$(printf '%.10s' "$pin")"; do
  mkdir "$tmp/$ref"
  HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/.config" XDG_CACHE_HOME="$tmp/home/.cache" \
    DISABLE_TELEMETRY=1 PIN="$ref" DEST="$tmp/$ref" bun -e '
    import { npxFetchMany } from "./src/lib/resolver-npx";
    await npxFetchMany("NagyVikt/claude-blog", "git@" + process.env.PIN, ["blog-brief"], process.env.DEST);'
  cmp "$tmp/expected" "$tmp/$ref/blog-brief/SKILL.md" || break
done
```
