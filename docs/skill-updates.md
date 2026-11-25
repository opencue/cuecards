# Updating tracked catalog skills

`cue skills catalog install <id>` still installs the catalog's pinned version
via the regular global installer. It does not enroll that copy in updates.
To opt in for a skill in a Cue profile, install a separate Cue-managed copy:

```sh
cue skills catalog track blog-brief
cue skills add-to-profile catalog/blog-brief
```

The `catalog/` prefix selects the managed copy explicitly. Existing global
skills and manual profile pins aren't rewritten or enrolled. An explicit
`skills.npx` entry for the same skill and agent takes precedence, even if
that entry is unavailable.

If you install Cue globally through npm, keep your editable profile in a
user-owned `CUE_PROFILES_DIR` along with any profiles it inherits (such as
`core`). Keep that directory outside the npm package so upgrading does not
replace your profile changes.

After upgrading Cue, run `cue skills catalog update`. This is the recurring
trigger: run it after each Cue upgrade, or schedule that same command if you
manage Cue upgrades separately. The command only considers tracked IDs and
full Git commit hashes already reviewed and shipped in the installed Cue
release. It doesn't look for an upstream branch's latest commit. Launch
only reads the selected local snapshot; it never checks for catalog updates.

For an npm-managed installation, call the commands in this order from your
own update job:

```sh
npm install -g cue-ai@latest && cue skills catalog update
```

For example, if `command -v cue` returns `/usr/local/bin/cue`, this entry
in your user crontab checks just the skills daily at 03:17:

```cron
17 3 * * * PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/cue skills catalog update
```

Substitute your absolute CLI path and use the same `XDG_CONFIG_HOME` as when
you enrolled the skill. This job doesn't upgrade Cue itself.

Updates select each skill independently. A failed download or missing
approved revision returns a nonzero status and leaves the current snapshot
and its rollback option intact. Use `--json` for per-skill results.

```sh
cue skills catalog rollback blog-brief
```

Rollback restores the previous local snapshot without network access. A
routine update won't reapply the rolled-back revision; a different reviewed
revision can still be selected. New launches use the selected snapshot.
Snapshots live in `$XDG_CONFIG_HOME/cue/catalog-skills` (default:
`~/.config/cue/catalog-skills`). Cue retains them so running sessions can
finish without losing their source files.
If a process was killed during selection and the command keeps reporting
that the skill is busy, remove that skill's empty `.selection-lock` directory
only after confirming no catalog command is running.
