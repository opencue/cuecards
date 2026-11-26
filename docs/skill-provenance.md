# Preview upstream skill changes

Run `cue skills update <skill-id> --preview` to compare the exact recorded
upstream commit with the current default-branch commit. Add `--json` for
structured output. For a repo-bundled skill, use its `category/name` ID; for
a globally installed Claude or Codex skill, use its installed name.

The preview lists added, modified, and removed paths under the recorded
upstream skill directory. It reports local modifications separately by
comparing the installed copy's SHA-256 fingerprint with its recorded value.
It does not download or execute skill content, update the install or its
pins, or change profiles or caches. Without `--preview`, the command still
repairs missing companion files.

Cue records the repository, full Git commit, repository-relative directory
and installed fingerprint in `.source` when it can verify the installed
`SKILL.md` against the resolved revision. It does this for new global
`cue skills add owner/repo` installs and during companion recovery when
the revision can be resolved. The fingerprint covers relative file paths,
file bytes, executable bits, and symlink targets (not their contents).
It excludes the root `.source` file and `.git` metadata. It describes the
installed files, which may be a subset of upstream.

Legacy `.source` files still support companion repair, but do not provide
an exact preview baseline. Cue does not infer a historical commit from a
branch or tag name when previewing. If provenance could not be verified,
the preview reports that it is unavailable.
