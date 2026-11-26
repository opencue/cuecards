# Preview a HarnessKit kit in Cue

```sh
cue import --harnesskit ./manifest.json
```

Pass the local `manifest.json` member of a HarnessKit `.hk-kit.zip` archive,
not the archive itself. Cue recognizes HarnessKit's v1 Kit manifest and
previews candidate Cue mappings for skills, MCP references, and rules. These
are hints, not verified references or an install plan that Cue can apply.

Cue flags unsafe names or archive paths, duplicate archive paths or candidate
references, and a kit name that matches an existing Cue profile. Other assets,
including hooks, CLI bundles, memory and agent settings, have no mapping.

This mode reads metadata only. It does not open kit assets, fetch remote
sources, show source URLs or secret values, run hooks, or write profiles or
configuration. It does not accept `--apply`, `--name` or `--sha256`.
