# Releasing cue-ai

The [publish workflow](workflows/publish-npm.yml) runs after successful **CI**
on a push to `main`. It publishes the tested commit only if it is still the
tip of `main`. No manual tag or `npm publish` is needed. After npm accepts the
package, the workflow creates the matching GitHub release.

The next version is a patch above npm's `latest`, unless `package.json` sets
a higher version. To make the next release a minor or major, raise that version
in a PR. Automatic patches update the manifest in the packaged artifact, not
in Git. If publishing fails, rerun the failed jobs after fixing the cause.

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
