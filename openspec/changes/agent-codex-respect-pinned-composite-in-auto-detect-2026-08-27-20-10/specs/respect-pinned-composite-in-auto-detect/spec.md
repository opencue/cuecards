## ADDED Requirements

### Requirement: Repository pin outranks historical partial choices
When repository-scoped profile suggestions are ranked, the system SHALL treat a
valid `.cue.profile` selector as the repository's authoritative current choice.

#### Scenario: Composite pin competes with repeated partial history
- **GIVEN** `.cue.profile` pins `medusa-vite+resend+hostinger+coolify`
- **AND** local history repeatedly chose `medusa-vite+resend`
- **WHEN** profile suggestions are ranked for that repository
- **THEN** the full pinned composite is ranked first
- **AND** the reason identifies the repository pin

#### Scenario: Deployment parts lack detector evidence
- **GIVEN** the pinned composite contains known profiles that repository
  detection does not independently support
- **WHEN** the support filter is applied
- **THEN** the pinned composite remains eligible
- **AND** historical, unpinned unsupported composites remain filtered out

#### Scenario: Pin contains an unknown profile
- **GIVEN** `.cue.profile` contains a profile name absent from the installed
  profile catalog
- **WHEN** suggestions are ranked
- **THEN** that pinned selector is not promoted
