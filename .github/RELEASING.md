# Releasing cue-ai

The [publish workflow](workflows/publish-npm.yml) runs after successful **CI**
on a push to `main`. It publishes the tested commit only if it is still the
tip of `main`. No manual tag or `npm publish` is needed. The workflow installs
and runs the exact tarball before publishing it. It creates the matching GitHub
release only after downloading the same tarball from public npm, checking its
integrity, and installing and running it again.

The next version is a patch above npm's `latest`, unless `package.json` sets
a higher version. To make the next release a minor or major, raise that version
in a PR. Automatic patches update the manifest in the packaged artifact, not
in Git. If public verification times out while npm is processing the package,
rerun only the failed jobs; this repeats verification without publishing again.
If publishing itself fails due to an external setting, fix it and rerun the
failed jobs. A fix committed to `main` triggers its own release through CI.

## One-time npm setup

In the [npm package settings](https://www.npmjs.com/package/cue-ai/access),
configure a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/):

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization | `opencue` |
| Repository | `cuecards` |
| Workflow filename | `publish-npm.yml` |
| Environment | Leave blank |
| Allowed actions | Allow `npm publish` |

The workflow uses OIDC; it does not need an `NPM_TOKEN` secret.
