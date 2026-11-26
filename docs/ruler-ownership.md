# Check generated rule files

Run `cue ruler --check` in a project to compare its native rule files with the
active Cue profile. Select other targets with `--profile`, `--agents` or
`--all`. The check writes nothing and exits 1 if a target is missing, stale
or in conflict; use that exit code as a CI check.

Cue puts the hash of the generated content in the file. When
`CUE_RULER_AUTO=1`, launch can refresh an unedited file after the source
rules change. It leaves hand-written or edited files alone. A file generated
by an older Cue release without a hash can be upgraded automatically only
when the old-format content exactly matches the current rules.

For a conflict, move local edits into the source rules or keep the local file
and disable automatic sync. An explicit `cue ruler` still replaces selected
files and keeps the first backup; preview with `cue ruler --dry-run` first.
For a project managed by Rulesync instead of Cue, use
`cue ruler --rulesync --check`.
