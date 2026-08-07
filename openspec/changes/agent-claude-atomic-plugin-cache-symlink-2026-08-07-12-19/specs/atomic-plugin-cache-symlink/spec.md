## ADDED Requirements

### Requirement: Plugin cache links are swapped atomically
Runtimes are re-materialized while agent sessions are live, and those sessions
resolve plugin install paths under `<runtime>/plugins/cache`. Replacing a
managed plugin entry SHALL NOT leave its path absent at any instant.

#### Scenario: A reader never observes a missing entry
- **WHEN** `linkPluginCache` replaces an entry that is already a symlink
- **THEN** a concurrent reader polling that path observes either the previous
  link or the new one
- **AND** never observes ENOENT.

#### Scenario: Claude's lazy empty directory is still replaced
- **WHEN** the target entry is a real directory rather than a symlink
- **THEN** it is removed and replaced with the symlink
- **AND** this fallback applies only on a first materialization, before a
  session can read the path.

#### Scenario: A failed swap preserves the existing entry
- **WHEN** staging or renaming the replacement fails
- **THEN** the existing entry is left in place
- **AND** no staging entry is left behind in the plugins directory.
