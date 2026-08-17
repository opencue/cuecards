# Changelog

Release notes for **`nsauditor-ai-agent-skill`** — installable knowledge package that teaches AI coding agents how to use NSAuditor AI's MCP tools, schemas, plugins, and security audit workflows.

---

## 0.1.41 (STAGED 2026-05-24 — pending trio-publish) — Paired-release pin for EE 0.12.0 + CE 0.1.74 — ISO/IEC 27001:2022 fifth-framework introduction

**Cycle hook**: EE 0.12.0 ships ISO/IEC 27001:2022 as the fifth Track 3 framework — 17 covered + 14 partial + 62 OOS across 93 Annex A controls (the complete Annex A universe across 4 themes). Statement of Applicability per Clause 6.1.3.d discipline + ISMS Clauses 4-10 OOS-by-design framing + 11 NEW 2022 controls + 5-attribute taxonomy + 2013-to-2022 transition discipline. Skill #18 `audit-iso-27001-2022-statement-of-applicability` authored 2026-05-24 via /skill-creator (705 lines / 5 files) per the institutional Per-Framework Adversarial-Audit Skill Pairing pattern. No agent-skill code changes — paired-publish for trio-publish discipline + customer discoverability.

**Plugin catalog**: UNCHANGED at 24 plugins; MCP tool signatures unchanged; schemas unchanged; workflows unchanged. **SOC 2 + HIPAA + NIST CSF + PCI DSS matrices ALL UNCHANGED**; **ISO/IEC 27001:2022 matrix NEW at 17/14/62 across 93 Annex A controls**.

**THIRTY-FIRST consecutive trio-publish** institutionalized 0.4.5–0.12.0.

---

## 0.1.40 (PUBLISHED 2026-05-23 to npm as `latest`) — Paired-release pin for EE 0.11.1 + CE 0.1.73 — PCI DSS v4.0.1 patch cycle (CAO authorship + 4 R-MEDIUM folds + `license --reset` subcommand)

**Cycle hook**: EE 0.11.1 ships the PCI DSS v4.0.1 patch cycle — the 4 R-MEDIUM authoring folds deferred from the EE 0.11.0 reviewer pass (CDE-scope badge + Req 12.8.5 TPSP matrix renderer + QSA enforcement-priority ranked view + CAO authorship for all 26 customized-eligible sub-requirements per Appendix D) PLUS the operator-discovered `nsauditor-ai license --reset` subcommand on the CE side. No agent-skill code changes — paired-publish for trio-publish discipline + customer discoverability.

**Plugin catalog**: UNCHANGED at 24 plugins; MCP tool signatures unchanged; schemas unchanged; workflows unchanged. **Coverage matrices ALL UNCHANGED** (SOC 2 10/4/33 + HIPAA 7/3/45 + NIST CSF 2.0 13/10/83 + PCI DSS 20/8/39 MVP-67 — pure patch cycle, no framework expansion).

**THIRTIETH consecutive trio-publish** institutionalized 0.4.5–0.11.1.

---

## 0.1.39 (PUBLISHED 2026-05-23) — Paired-release pin for EE 0.11.0 + CE 0.1.72 — PCI DSS v4.0.1 Track 3 fourth-framework cycle

**Cycle hook**: EE 0.11.0 introduces PCI DSS v4.0.1 (PCI SSC, June 2024 errata; supersedes v4.0 March 2022; v3.2.1 retired March 31, 2024) as the fourth compliance framework alongside SOC 2 (AICPA TSC 2017), HIPAA Security Rule §164.312, and NIST Cybersecurity Framework 2.0. The agent-skill catalog updates accordingly:

- `compliance_check` MCP tool description widened from "SOC 2 + HIPAA + NIST CSF 2.0" to "SOC 2 + HIPAA + NIST CSF 2.0 + PCI DSS v4.0.1" with the matching `--compliance soc2,hipaa,nist-csf,pci-dss` CSV invocation hint. PCI DSS sub-requirement examples baked into tool description: `Req 1.2.1` NSC config standards, `Req 8.4.1` MFA on non-console admin, `Req 10.2.1` audit logs enabled, `Req 11.3.1` quarterly internal vuln scans. Defined-vs-Customized Approach discipline per PCI DSS v4.0.1 Appendix E (15 Defined-only sub-requirements enforced at schema layer) + CHD Scope operator-attested via CDE Data Flow Diagram per Req 1.2.4 + card-brand AOC enforcement view (Visa CISP / Mastercard SDP / Amex DSOP / Discover DISC).
- `SKILL.md` framework-coverage table extended with PCI DSS v4.0.1 sub-requirement-level matrix (**20 covered / 8 partial / 39 OOS across 67 of ~250 sub-requirements at MVP-67 density**).
- `references/plugins.md` framework-bullet extended from "three compliance frameworks" to "four compliance frameworks" with PCI DSS v4.0.1 sub-requirement examples + Req 12 OOS-by-design entirely framing + Req 5 + Req 9 OOS-entirely framing + Drata PCI / Vanta PCI / AuditBoard PCI / OneTrust GRC pairing-platform names.

**Plugin catalog**: UNCHANGED at 24 plugins; MCP tool signatures unchanged; schemas unchanged; workflows unchanged. **Twenty-ninth consecutive trio-publish** institutionalized 0.4.5–0.11.0.

---

## 0.1.38 (PUBLISHED 2026-05-22) — Paired-release pin for EE 0.10.0 + CE 0.1.71 — NIST CSF 2.0 Track 3 third-framework cycle

**Cycle hook**: EE 0.10.0 introduces NIST Cybersecurity Framework 2.0 (NIST CSWP 29, February 2024) as the third compliance framework alongside SOC 2 (AICPA TSC 2017) and HIPAA Security Rule §164.312. The agent-skill catalog updates accordingly:

- `compliance_check` MCP tool description widened from "SOC 2 + HIPAA" to "SOC 2 + HIPAA + NIST CSF 2.0" with the matching `--compliance soc2,hipaa,nist-csf` CSV invocation hint.
- `SKILL.md` framework-coverage table extended with NIST CSF 2.0 Subcategory-level matrix (13 covered / 10 partial / 83 OOS across 106 of CSF 2.0's 107 Subcategories).
- `references/plugins.md` framework-bullet extended from "two compliance frameworks" to "three compliance frameworks" with NIST CSF 2.0 control-ID examples (PR.AA-01, DE.CM-01, RC.RP-03) + Implementation Tiers OOS disclaimer explanation + Tugboat Logic / Drata / Vanta / AuditBoard pairing-platform names.

**Plugin catalog**: UNCHANGED at 24 plugins; MCP tool signatures unchanged; schemas unchanged; workflows unchanged. **Twenty-eighth consecutive trio-publish** institutionalized 0.4.5–0.10.0.

**Why an agent-skill 0.1.38 release**: institutional pair-versioning. Every EE release gets a paired agent-skill version bump so operators using `npm view nsauditor-ai-agent-skill version` against an EE version can confirm the catalog targets the same trio. SKILL.md "post-EE 0.X.Y" version pointer updated to 0.10.0.

**EE 0.10.0 + CE 0.1.71 paired-release highlights** (full detail in respective CHANGELOGs):
- NEW `data/compliance/nist-csf.json` — auditor-canonical Subcategory-level mapping. 23 declared Subcategories + 6 OOS groups + schema-additive `function` / `categoryCode` / `subcategory` / `outcomeText` / `informativeReferences` fields. Inheritance contract: every titlePattern inherits from soc2.json's grep-verified pattern set, defended by 27-test anchor-drift suite.
- EXTENDED EE `utils/soc2_renderer.mjs` — `'nist-csf'` slot table in `frameworkControlCitation` with 8 slots incl. NEW `implementation-tiers` disclaimer. `isNistCsfReport` flag detection. Implementation Tiers OOS disclaimer section in BOTH markdown AND HTML render paths (R-HIGH-2 reviewer fold from 2nd reviewer pass — markdown-only was the pre-fold state).
- Schema-additive fields propagation to controlEntries — closes ghost-schema gap for `function`/`categoryCode`/`subcategory`/`outcomeText`/`informativeReferences` (NIST CSF) AND `requiredOrAddressable`/`standardOrSpec`/`ruleText` (HIPAA, EE 0.9.0 inherited gap) AND `manualProcedure` (SOC 2 + HIPAA, EE 0.9.3 + 0.9.4 inherited gap). R-HIGH-1 reviewer fold from 2nd reviewer pass.
- 91 net new tests across 3 new test files (27 anchor-drift + 39 mapping + 25 renderer) + 1 fold-driven SOC 2→NIST cross-framework leak test (R-MEDIUM-1 from 2nd reviewer pass)
- 560-line `docs/nist-csf-coverage.md`
- 2 reviewer passes (single-agent A combined NIST/code lens + parallel-reviewer B security/air-gap/citation-leak lens); 5 same-session folds total

**Reviewer pass discipline**: 2-reviewer parallel pass per the EE 0.9.0 institutional template. Reviewer A verdict "ship with 4 small folds — cycle is structurally clean"; Reviewer B verdict "ship with 2 small folds beyond Reviewer A's findings — 2 R-HIGH genuinely new + 3 polish". 5 of 10 findings applied same-session (3 from Reviewer B + 2 from Reviewer A); 5 deferred as defer-acceptable polish.

**Regression**: EE 6104/6104 across 983 suites (+92 vs 0.9.4 baseline — 91 cycle-new tests + 1 fold-driven cross-framework leak test). 75-session 100% green streak preserved. **Plugin count UNCHANGED at 24**; **SOC 2 + HIPAA coverage matrices UNCHANGED at 10/4/33 + 7/3/45**; **NIST CSF 2.0 coverage matrix introduced at 13/10/83**.

No breaking changes — additive only.

---

## 0.1.37 (PUBLISHED 2026-05-22 to npm as `latest`, superseded by 0.1.38 on trio-publish) — Paired-release pin for EE 0.9.1 + CE 0.1.70 — External-audit-findings ship-blocker patch (no catalog change; institutional pair-version)

**Cycle hook**: External adversarial-audit-skill cycle (2026-05-22) identified 10 ship-blockers in pre-existing EE 0.9.0 + CE 0.1.69 code; closed in <24h. All audit findings are against EE-side correctness paths (NVD offline feed importer + plugin 1110 KMS layer + plugin 1030 PRIVESC_ACTIONS) and CE-side license verifier (replay defense + signed revocation blocklist + monotonic-clock anchor). **No agent-skill catalog change is needed** — plugin catalog stays at 24 plugins; MCP tools unchanged; schemas unchanged; workflows unchanged. **Twenty-seventh consecutive trio-publish** institutionalized 0.4.5–0.9.1.

**Why an agent-skill 0.1.37 release**: institutional pair-versioning. Every EE release gets a paired agent-skill version bump so operators using `npm view nsauditor-ai-agent-skill version` against an EE version can confirm the catalog targets the same trio. SKILL.md "post-EE 0.X.Y" version pointer updated to 0.9.1.

**EE 0.9.1 + CE 0.1.70 paired-release highlights** (full detail in respective CHANGELOGs):
- **A-CRIT-1**: `feeds/nvd_feed_processor.mjs` real NVD JSON 2.0 importer (replaces 20-line stub; closes the air-gap claim). NDJSON persistence + atomic write + gzip-bomb cap. +37 new tests.
- **B-CRIT-1/2 + B-LABEL**: plugin 1110 KMS-grant + key-policy cross-reference. HIGH→INFO downgrade when no key trusts the principal; new `kms-grant-decrypt-no-identity-grant` MEDIUM emission (Pacu P-16 closure). Finding text preserves load-bearing prefix for soc2.json + hipaa.json titlePattern integrity. +22 new tests.
- **C-CRIT-1..4**: plugin 1030 PRIVESC_ACTIONS additions (9 canonical Pacu paths). +21 new tests.
- **D-HIGH-1/2/3**: CE-side license verifier hardening (replay + revocation + clock anchor). +33 new CE tests.

**Reviewer pass**: 2 general-purpose agents in parallel; 10 same-session folds.

**Regression**: EE 5970/5970 across 951 suites (+80 vs 0.9.0); CE 968 tests (+33 vs 0.1.69). 70-session 100% green streak preserved. **Plugin count UNCHANGED at 24**; **SOC 2 + HIPAA coverage matrices UNCHANGED**.

No breaking changes — additive only.

---

## 0.1.36 — Catalog refresh: EE 0.9.0 HIPAA FRAMEWORK CYCLE (first 0.9.x release; HIPAA Security Rule §164.312 Technical Safeguards ships as second supported compliance framework alongside SOC 2; HIPAA coverage matrix 7 covered + 3 partial + 45 OOS; HHS Required/Addressable discipline per control; §164.312(c)(1) ransomware-defense substrate via Logically Air-Gapped Backup Vault cross-verification; per-framework SLA-citation map closes cross-framework citation leak class; 6 same-session reviewer folds; +85 new tests across 3 new suites; plugin count UNCHANGED at 24; SOC 2 coverage matrix UNCHANGED at 10/4/33; EE regression 5890/5890 across 928 suites; 69-session 100% green streak preserved; twenty-sixth consecutive trio-publish; no breaking changes — additive only; agent-skill catalog refresh: SKILL.md HIPAA framework coverage block added, README "Plugin awareness" + "Compliance frameworks" capability rows updated, references/plugins.md Enterprise Plugins header corrected 18 → 24 with HIPAA framework mention)

**Trio-publish institutionalization continued.** Paired with EE 0.9.0 + CE 0.1.69 — **twenty-sixth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.9.0).

### Headline — EE 0.9.0 HIPAA framework cycle (first 0.9.x release)

HIPAA Security Rule §164.312 Technical Safeguards ships as the second supported compliance framework alongside SOC 2. Closes the long-standing "planned" gap in EE's `docs/architecture.md` for the highest-demand next framework after SOC 2.

**New deliverables in EE 0.9.0:**

- `data/compliance/hipaa.json` — 175 mappings across 10 §164.312 controls (7 covered + 3 partial) + 45 explicit OOS specs. Patterns inherited from soc2.json's grep-verified pattern set with HIPAA-grounded rationales. Schema-additive HHS-discipline fields: `requiredOrAddressable: 'R'|'A'` + `standardOrSpec: 'standard'|'implementation-specification'` + `ruleText: <HHS rule text>` per control.
- `docs/hipaa-coverage.md` (~440 lines) — mirror of `docs/soc2-coverage.md` shape; auditor-grade per-sub-criterion coverage doc with explicit §164.308 + §164.310 OOS framing.
- Per-framework SLA-citation map in `utils/soc2_renderer.mjs` — new `frameworkControlCitation(framework, slot)` helper threaded through markdown + HTML renderers. HIPAA reports cite `§164.312(b) audit-controls cadence` (SLA), `§164.308 administrative-safeguards governance — OOS for §164.312 Technical-Safeguards report` (governance sentinel), `§164.312(d) Person or Entity Authentication` (identity). SOC 2 reports remain byte-identical.

### HIPAA coverage matrix (7 covered + 3 partial + 45 OOS)

Within §164.312 Technical Safeguards:
- **Covered (7)**: §164.312(a)(1) Access Control, (a)(2)(i) Unique User ID, (a)(2)(iv) Encryption-at-rest, (b) Audit Controls, (d) Person/Entity Auth, (e)(1) Transmission Security, (e)(2)(ii) Transmission Encryption
- **Partial (3)**: §164.312(c)(1) Integrity (ransomware-defense substrate), (c)(2) ePHI integrity verification, (e)(2)(i) Transmission Integrity Controls
- **OOS within §164.312 (2)**: §164.312(a)(2)(ii) Emergency Access Procedure (procedural break-glass), (a)(2)(iii) Automatic Logoff (application-tier)

Plus:
- **§164.308 Administrative Safeguards entire (31 specs)** — workforce training, sanction policies, BAAs, contingency planning, incident procedures. Pair with HIPAA-focused GRC platforms (Drata HIPAA, Vanta HIPAA, Compliancy Group, Tugboat Logic).
- **§164.310 Physical Safeguards entire (12 specs)** — facility access, workstation security, device/media disposal. Pair with facilities-management + endpoint-management + asset-disposal vendors.

### §164.312(c)(1) Integrity ransomware-defense substrate (HHS-OCR 2024 enforcement-relevant)

EE's `aws-backup-auditor` Logically Air-Gapped Backup Vault cross-verification (KMS policy + Grants + replicas + VPC-endpoint composite attestation) produces the strongest substrate evidence available on the AWS layer. A composite-attestation PASS evidences that ePHI backups would survive a full source-account compromise — exactly the §164.312(c)(1) integrity-preservation posture HHS-OCR has highlighted in 2024 enforcement actions.

### Zero engine / CLI changes required

EE's `loadFrameworkMap` was already framework-agnostic (reads `data/compliance/{framework}.json` by parameter); CE's `--compliance` flag already accepts CSV (wired since EE 0.3.0). Multi-framework workflow shipping today: `nsauditor-ai scan --host aws --plugins all --compliance soc2,hipaa --out evidence/` produces separate `scan_compliance_soc2.{md,html,json}` AND `scan_compliance_hipaa.{md,html,json}` artifact sets in one scan.

### Zero BAA required (HIPAA §160.103)

Zero Data Exfiltration architecture means ePHI never leaves customer infrastructure. Nsasoft does not see, store, or process customer ePHI under any condition — no Business Associate Agreement needed. This is a self-hosted scanner, not a SaaS service.

### 6 same-session reviewer folds applied (2 R-HIGH + 2 R-MEDIUM + 1 R-LOW + 1 docstring; 0 R-CRITICAL)

Two parallel reviewers (HIPAA Security Officer perspective + senior code reviewer perspective). Confirmed: §164.312 sub-criteria routing clean (no CloudTrail in (a)(1), no MFA in (a)(1), no TLS in (a)(2)(iv)); HHS R/A classification correct per control; §164.308 + §164.310 OOS enumerations complete against 45 CFR; rationale spot-check zero cross-framework citation leak.

### +85 new tests across 3 new test suites

- `tests/hipaa_mapping_anchor_drift.test.mjs` (32) — load-bearing anchor-drift defense via INHERITANCE CONTRACT (every hipaa.json (source, titlePattern) pair MUST exist in soc2.json, which has its own plugin-side anchor-drift defenses).
- `tests/hipaa_mapping.test.mjs` (36) — engine-end-to-end fixture tests across all 7 covered + 3 partial §164.312 controls + sub-criteria discrimination tests + OOS-routing assertions.
- `tests/hipaa_renderer.test.mjs` (17) — per-framework citation correctness + SOC 2 regression-protection + helper API ergonomics (case-insensitivity, defensive type guard, sentinel-on-unknown-slot).

### AWS-dogfood verified — 2026-05-21 smoke scan

Against operator's test AWS account: 207 findings analyzed, all routed to correct §164.312 sub-criteria; per-framework citation map confirmed firing in production reports; ransomware-defense substrate §164.312(c)(1) surfaces correctly with 12 violations (S3 versioning disabled, Object Lock not configured, RDS BackupRetentionPeriod below baseline, single-AZ). Zero regression on SOC 2 path (same 207 findings → 9 FAIL + 4 PASS + 1 partial + 33 OOS matching 10/4/33 exactly).

### Agent-skill catalog refresh (this release — 0.1.36)

- `SKILL.md` — "EE SOC 2 substrate-evidence coverage" block updated to "post-EE 0.9.0" + SOC 2 matrix UNCHANGED note + NEW "EE HIPAA §164.312 Technical Safeguards substrate-evidence coverage" block enumerating 7+3+45 + R/A discipline + ransomware-substrate angle + Zero-BAA framing. `compliance_check` tool description updated to surface both SOC 2 AND HIPAA as actively shipped frameworks (previously listed alongside planned-only NIST/HIPAA/GDPR/PCI-DSS).
- `README.md` — "Plugin awareness" capability row updated 44+ → 50 (17 core + 6 discovery + 3 pro + 24 enterprise; corrects pre-existing stale 18-enterprise claim from when EE had 18 plugins); NEW "Compliance frameworks" capability row enumerating SOC 2 + HIPAA + multi-framework dual-publish + Zero-BAA. `references/plugins.md` reference description updated 44+ → 50.
- `references/plugins.md` — "Enterprise Plugins (18)" header corrected to "Enterprise Plugins (24)" (pre-existing stale count; EE has had 24 plugins since EE 0.7.0). Plugin-catalog intro extended to mention dual-framework SOC 2 + HIPAA support + multi-framework `--compliance soc2,hipaa` CSV workflow + Zero-BAA architecture for HIPAA.

### No breaking changes — additive only

The 0.8.0 customer migration carryover (suppressions targeting `match.source: 'azure-cloud-scanner'` silently no-op post-0.8.0) remains as-is. HIPAA framework cycle is opt-in via `--compliance hipaa` or `--compliance soc2,hipaa`.

**Plugin count UNCHANGED at 24**. **SOC 2 coverage matrix UNCHANGED at 10/4/33** (additive-only cycle; no SOC 2 mappings changed). **HIPAA coverage matrix introduced at 7/3/45**.

---

## 0.1.35 — Catalog refresh: EE 0.8.0 MINOR VERSION MILESTONE (EE-RT.23 Move B plugin 1022 per-dim source-attribution refactor + Engine `details.category` projection contract + Key Vault soc2.json gap closure +13 mappings; 7 same-session reviewer folds; +23 new tests / +6 new suites; plugin count UNCHANGED at 24; coverage matrix UNCHANGED at 10/4/33; EE regression 5805/5805 across 907 suites; 68-session 100% green streak preserved; twenty-fifth consecutive trio-publish; ⚠️ customer migration: `match.source: 'azure-cloud-scanner'` suppressions silently no-op post-0.8.0)

**Trio-publish institutionalization continued.** Paired with EE 0.8.0 + CE 0.1.68 — **twenty-fifth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.8.0).

### Headline — MINOR VERSION MILESTONE: EE-RT.23 Move B plugin 1022 Azure scanner per-dim source-attribution refactor

EE 0.8.0 closes the long-standing blocker (originally flagged in EE 0.6.9 R1-MEDIUM-1) for routing Azure storage findings into Appendix A "Cloud Bucket Exposure Attestation" without commingling NSG / RBAC / Key Vault. Plugin 1022 refactored so each of the 4 helpers (`auditNsgRules` / `auditRbac` / `auditStorageAccounts` / `auditKeyVaults`) attaches its own per-dim `source` field on every emission:

- `azure-nsg-auditor`
- `azure-rbac-auditor`
- `azure-storage-auditor`
- `azure-keyvault-auditor`

PLUGIN_ID stays `"1022"`; `--plugins 1022` continues to work. The umbrella `azure-cloud-scanner` source stays in `CLOUD_PLUGIN_SOURCE_MAP` as defense-in-depth fallback only (no soc2.json mappings).

### Engine `details.category` projection contract — minor-bump justification

EE 0.8.0's `normalizeFindings` + `analyseAgainstFramework` violation surface now carry `category` (additive, backward-compat via raw escape hatch). This is the institutional rationale for the **0.7.x → 0.8.0 MINOR bump** — touches the engine-side projection that every framework consumer reads. Future plugins (plugin 1024 GCS, plugin 1025 GCP IAM, and beyond) gain `v.category` as a first-class violation field for dim-discriminator use cases without the untyped `v.raw.details` escape hatch.

### Key Vault soc2.json gap closure — 13 new mappings

Pre-0.8.0 the Key Vault dim emitted 10 distinct `details.category` values but had ZERO soc2.json mapping coverage — latent silent false-clean class on CC6.1 / CC6.3 / C1.1 / A1.2 substrate evidence. Post-0.8.0:

- **CC6.1**: 3 entries (network-acl-allow, network-acl-absent, PASS attestation)
- **CC6.3**: 3 entries (legacy-access-policies, rbac-authorization-unknown, PASS attestation)
- **C1.1**: 3 entries (purge-protection-disabled, purge-protection-unknown, PASS attestation)
- **A1.2**: 4 entries (soft-delete-below-floor, soft-delete-below-institutional, soft-delete-unknown, PASS attestation)

All 10 KV anchor regexes use `^Key Vault '[^']+' <distinguishing-clause>` shape (literal-space anchors per `[[soc2_titlepattern_anchor_drift]]` discipline).

### 7 same-session reviewer folds applied (2 R-HIGH + 3 R-MEDIUM + 2 R-LOW; 0 R-CRITICAL)

- **F1 R-HIGH**: anchor-drift defense test now loads patterns from shipped soc2.json directly (single source of truth — closes test/production-regex drift structurally; pre-fold the test regex array was MORE permissive than the production regex — EE-RT.20-class-recurrence INSIDE the defense test).
- **F2 R-HIGH**: `computeBucketStats` dedup key provider-qualified `${source}::${resource}` (closes cross-cloud bucket-name collision for multi-cloud customers using shared naming conventions).
- **F3 R-MEDIUM**: empty-string `details.category` projects null (consistency with harvester source-preservation `length > 0` guard).
- **F4 R-MEDIUM**: SDK-error path coverage tests (KV throw + Storage throw — verifies soft-degrade doesn't accidentally emit findings with wrong source).
- **F5 R-MEDIUM**: partial-failure backward-compat test (RBAC helper throws; NSG/Storage/KV findings still surface with correct per-dim sources).
- **F6 R-LOW**: JSDoc documents `category` field on `analyseAgainstFramework` return shape.
- **F7 R-LOW**: NSG soc2.json regex tightened from `~/^NSG rule .* allows inbound/` to `~/^NSG rule "[^"]+" allows inbound/` (rule-name closure anchor; preemptive cross-mapping defense).

### ⚠️ Customer migration required

Any suppression file with `match.source: 'azure-cloud-scanner'` will silently no-op post-0.8.0. Split into per-dim entries — see CHANGELOG.md migration snippet.

### Regression preserved

EE full regression: **5805/5805 across 907 suites** (was 5782/900 at 0.7.3; +23 tests / +7 suites). **68-session 100% green streak preserved.** Plugin count UNCHANGED at 24. Coverage matrix UNCHANGED at 10/4/33 (pure substrate-evidence depth uplift on already-covered controls — but KV gap closure was a silent false-clean class).

---

## 0.1.34 — Catalog refresh: EE 0.7.3 R-CRITICAL hotfix closing 2 production bugs surfaced by EE 0.7.2 dogfood scan against operator's GCP test infra (cross-version google-auth-library fragmentation broke SA impersonation chains [R-CRITICAL — 100% false-clean impact on free-trial/gmail GCP customers + business GCP customers with no-long-lived-SA-keys policy]; GOOGLE_CLOUD_PROJECT_ID env-var alias silently skipped [R-MEDIUM]; +14 new tests across 2 new suites incl. regression pin replicating gax 5.x grpc adapter idiom; plugin count UNCHANGED at 24; coverage matrix UNCHANGED at 10/4/33; EE regression 5782/5782 across 900 suites; 67-session 100% green streak preserved; twenty-fourth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.7.3 + CE 0.1.67 — **twenty-fourth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.7.3).

### Headline — R-CRITICAL hotfix surfaced by EE 0.7.2 dogfood scan within 30 minutes of the 0.7.2 trio publish

EE 0.7.3 closes 2 production bugs that shipped silently in EE 0.7.0–0.7.2. Both bugs surfaced when running `nsauditor-ai scan --plugins 1025 --compliance soc2` against operator's GCP test infra immediately after the 0.7.2 trio publish.

**Gap #2 (R-CRITICAL)**: cross-version `google-auth-library` fragmentation. EE's `utils/gcp_auth.mjs` resolved `9.15.1` at the top level (hoisted via `googleapis@^144`); `@google-cloud/resource-manager@^6` bundles nested `10.6.2` + `google-gax@5.x` whose grpc adapter calls `headers.forEach((value, key) => ...)` expecting WHATWG Headers instance. 9.x returns plain object → `.forEach` undefined → TypeError → `2 UNKNOWN: Getting metadata from plugin failed with error: headers.forEach is not a function`. Plugin 1025's conservative classifier emitted `gcp-iam-project-unreadable` LOW + walkthroughRequired, masking the fact that ALL 7 dims silently skipped. Production false-clean impact: ~100% on any impersonation-using deployment in EE v0.7.0–0.7.2.

**Fix**: NEW `_wrapAuthClientHeadersShim` in `utils/gcp_auth.mjs` monkey-patches the Impersonated instance's `getRequestHeaders` to coerce 9.x's plain-object return into a Headers instance via `new Headers(plainObject)`. 10.x returns pass through unchanged. Version-agnostic, future-proof. +8 new tests including a regression pin that exactly replicates the gax 5.x grpc adapter idiom — catches any future shim regression at unit-test time.

**Customer-segment impact:**
- **GCP free-trial / gmail customers** — impersonation is the ONLY working credential model when `iam.disableServiceAccountKeyCreation` is enforced (Google's "Secure by default"). Pre-0.7.3 100% false-clean. **Post-0.7.3 audit works end-to-end.**
- **Business GCP customers with no-long-lived-SA-keys security policy** — many enterprise security teams mandate impersonation as their auth model. Same impact. **Post-0.7.3 audit works.**
- **Business GCP customers using JSON keyfiles or pure ADC** — unaffected (R-CRITICAL specific to impersonation injection; pure-ADC + keyfile paths use the nested 10.x auth chain entirely).

**Gap #1 (R-MEDIUM)**: operators following the `gcloud auth application-default login` setup convention (which writes `GOOGLE_CLOUD_PROJECT_ID` with `_ID` suffix) saw silent skip with `[plugin 1025] No GCP_PROJECT_ID configured`. Extended `loadConfig` + `preflight` from 2-way OR to 3-way OR: `opts.projectId > GCP_PROJECT_ID > GOOGLE_CLOUD_PROJECT > GOOGLE_CLOUD_PROJECT_ID`. +6 new tests covering all precedence paths + preflight failure-reason enumeration + end-to-end run() with env-only resolution.

### Dogfood validation post-fix

Re-ran the scan with both fixes applied. **8 findings emitted** (was 1 false-clean LOW pre-fix): 5 PASS + 2 MEDIUM + 1 LOW. All 7 dims exercise via the impersonated `nsauditor-readonly` audit SA. `accessDeniedByApi.listPolicies: 1` confirms the 0.7.2 R2-MED-13 counter wiring works end-to-end against real GCP.

### Regression preserved

EE full regression: **5782/5782 across 900 suites** (was 5768/5768 across 898 suites at 0.7.2; +14 tests / +2 suites). **67-session 100% green streak preserved.** Plugin count UNCHANGED at 24. Coverage matrix UNCHANGED at 10/4/33.

---

## 0.1.33 — Catalog refresh: EE 0.7.2 Move B pure-test functional patch closing 5 deferred 0.7.1 reviewer-pass coverage gaps (+50 new tests across 6 new suites; no production code changes; no plugin emissions changed; no soc2.json changes; no new SDK deps; plugin count UNCHANGED at 24; coverage matrix UNCHANGED at 10/4/33; EE regression 5768/5768 across 898 suites; 66-session 100% green streak preserved; twenty-third consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.7.2 + CE 0.1.66 — **twenty-third consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.7.2).

### Headline — pure-test functional patch (no plugin/soc2.json/SDK changes)

EE 0.7.2 is a pure-test functional patch closing the 5 test-coverage gaps deferred at 0.7.1's reviewer pass — bundled with the staged `peerDependencies.nsauditor-ai` bump (`^0.1.40` → `^0.1.65`) queued at 0.7.1 post-publish per `[[npm_tarball_replacement_trap]]` discipline. Plugin 1025 GCP IAM Project-Level Auditor's 7-dim coverage shipped in EE 0.7.1; this cycle backfills the test surface around it without altering production behavior.

### Test additions — 50 new tests across 6 new suites

- **R2-MED-7 BFS edge cases (+17)** — `_detectGcpImpersonationPaths` exercised against multiple disjoint cycles (Island A doesn't bleed into Island B), disconnected subgraphs, terminate-at-first-admin (multi-admin chain), parallel branches to distinct admins, depthCap exact-match + one-short + =1 boundaries, per-PATH visited Set semantics, malformed edges (null / missing-to / non-string-to), nonexistent edge targets, cycle through admin, self-loop on start, edge label fallback chain (label → displayName → key), fractional depthCap, parallel edges to same admin with different `via`.
- **R2-MED-13 counter wiring (+15 parameterized)** — 5 v2 apiName strings × 3 counter classes: `projects.roles.list` + `projects.serviceAccounts.list` + `projects.serviceAccounts.keys.list` + `projects.serviceAccounts.getIamPolicy` + `listPolicies` × throttle-retry + access-denied + wall-budget-exhausted. Closes the institutional contract "every API surface increments the right counter key" — prior cycle tested v1's `getIamPolicy` directly but only indirect coverage of v2 apiNames via run() integration.
- **R2-LOW-16/17 helper edges (+10)** — `_saEmailFromName`: trailing slash → `""`, leading slash → segment-after, only-slash → `""`, multiple slashes (lastIndexOf semantics), control-char strip BEFORE slash detection. `_parseIso8601ToMs`: positive `+HH:MM` offset (yields earlier UTC ms), negative `-HH:MM` offset (yields later UTC ms), date-only string (UTC midnight), fractional-seconds + Z, finite-return for well-formed-with-offset.
- **R2-HIGH-4 SDK loader graceful-degradation contract (+8)** — direct unit tests for `_loadGoogleApisIamAdminSdk` + `_loadOrgPolicySdk` missing-dep error branches. Both SDKs are in optionalDependencies and NOT installed in the EE working tree by default. The institutional contract: loader throws with dep-name + `Cannot find package` cause; run()'s catch handler converts to single-warning skip of the affected dim cohort.
- **R2-MED-12 buildGcpAuthOptions real-SDK fallback (+3)** — exercises the `deps._googleAuthLibrarySdk || await _loadGoogleAuthLibrarySdk()` fallback path that all other buildGcpAuthOptions tests bypass via dep injection. Uses `crypto.generateKeyPairSync` to write a valid PKCS#8 SA JSON keyfile to tmpdir, then verifies the real google-auth-library returns a real `Impersonated` instance with documented `targetPrincipal` + `lifetime` shape.

### Regression preserved

EE full regression: **5768/5768 across 898 suites** (was 5715/5715 across 892 suites at 0.7.1; +53 tests / +6 suites). **66-session 100% green streak preserved.** Plugin count UNCHANGED at 24. Coverage matrix UNCHANGED at 10/4/33.

---

## 0.1.32 — Catalog refresh: plugin 1025 GCP IAM Project-Level Auditor EXTENDED to v2 (3 dims → 7 dims) — paired with EE 0.7.1 trio-publish (EE-RT.22 v2 R2 expansion closing all 4 v1-deferred dims; +4 new dims: custom-role permission audit + SA key custody + SA impersonation graph BFS + Organization Policy constraint enumeration; NEW `utils/gcp_auth.mjs` helper honors `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`; **17 same-session reviewer folds = NEW HIGH-WATER MARK** vs 0.7.0's 12 (1 R-CRITICAL EE-RT.20 class recurrence catch + 7 R-HIGH + 8 R-MEDIUM + 1 R-LOW(+1 grouped)); plugin count UNCHANGED at 24; +22 new soc2.json mappings; new SDK deps `googleapis` + `@google-cloud/org-policy` in optionalDependencies; twenty-second consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.7.1 + CE 0.1.65 — **twenty-second consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.7.1).

### Headline — EE-RT.22 v2 plugin 1025 R2 expansion

Plugin 1025 GCP IAM Project-Level Auditor extended from 3 audit dimensions to **7** via in-place R2 expansion (closes all 4 v1-deferred dims from the EE 0.7.0 cycle). Plugin count UNCHANGED at 24 (v2 = in-place expansion, not new plugin). Coverage matrix UNCHANGED at 10/4/33 — pure substrate-evidence depth uplift on already-covered CC6.1 / CC6.6 / C1.1 controls.

The 4 new dimensions: **Dim 4 custom-role permission audit** (CC6.1; admin-equivalent permission allowlist), **Dim 5 SA key custody** (CC6.1 + C1.1; user-managed long-lived keys = HIGH), **Dim 6 SA impersonation graph BFS** (CC6.1 flagship dim; mirrors plugin 1030 shadow-admin BFS adapted to GCP), **Dim 7 Organization Policy constraint enumeration** (CC6.6 + C1.1; 4 sensitive constraints).

NEW `utils/gcp_auth.mjs` helper honors `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT` env var — closes the gap where GCP client libraries do NOT honor gcloud CLI's `auth/impersonate_service_account` config.

### Reviewer fold high-water mark — 17 same-session folds

NEW HIGH-WATER MARK vs 0.7.0's 12 folds. Distribution: 1 R-CRITICAL + 7 R-HIGH + 8 R-MEDIUM + 1 R-LOW(+1 grouped). The R-CRITICAL fold (R2-CRITICAL-1) was an EE-RT.20 R1-CRITICAL-1 class recurrence — soc2.json PASS-tier SA-key patterns silently failed to match when plugin emitted `(display: 'X')` between email and `has` clause. Production false-clean impact would have been ~100% on real GCP fixtures. Patterns rewritten to `'[^']+'.*has`.

### Cross-repo privacy scrub (parallel non-functional work)

Operator-flagged CRITICAL privacy class at 0.7.1 review: shipped npm files MUST NOT contain operator-private references. Substitutions applied across all 3 repos for personal emails / internal repo paths / real account IDs. New memory `[[npm_package_privacy]]` pinned. Force-push history rewrite applied to CE + agent-skill public repos to scrub identifiers from all historical commits.

---

## 0.1.31 — Catalog refresh: NEW EE-RT.22 v1 plugin 1025 GCP IAM Project-Level Auditor — paired with EE 0.7.0 trio-publish (MINOR-VERSION MILESTONE opening the v0.7.x cross-cloud-parity line; first plugin in the GCP-IAM-deep-audit cohort; 3 audit dimensions across CC6.1 + CC6.6; 12 R1 reviewer folds (0 R-CRITICAL + 2 R-HIGH + 5 R-MEDIUM + 5 R-LOW); plugin count 23 → 24; 11 new soc2.json mappings; new SDK dep `@google-cloud/resource-manager`; twenty-first consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.7.0 + CE 0.1.64 — **twenty-first consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.7.0).

### Changes

- **`references/plugins.md`** — added plugin 1025 row in sort order; demoted plugin 1024 (NEW EE 0.6.8) to non-NEW.
- **`SKILL.md`** — "post-EE 0.6.9" → "post-EE 0.7.0".

---

## 0.1.30 — Catalog refresh: EE-RT.21 v2 R2 cleanup for plugin 1024 GCP Cloud Storage Auditor — paired with EE 0.6.9 trio-publish (patch-level R2 reviewer-deferred-items cleanup: Appendix A multi-cloud renderer extension + evidence-gap soc2.json mappings; 5 R1 reviewer folds (0 R-CRITICAL + 1 R-HIGH + 1 R-MEDIUM + 3 R-LOW); plugin count UNCHANGED at 23; 3 new soc2.json mappings; NEW pre-publish doc-consistency gate; twentieth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.9 + CE 0.1.63 — **twentieth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.9).

### What changed

- **`references/plugins.md`** — no plugin catalog changes this cycle (plugin count unchanged at 23). Plugin 1024 row from 0.1.29 preserved.
- **`SKILL.md`** — "post-EE 0.6.8" → "post-EE 0.6.9".
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Reviewer-fold highlights (all closed same-session)

- **R1-HIGH-1 (mappings)** — Missing C1.1 dual-mapping for `_CAT_METADATA_UNREADABLE` (rationale prose vs JSON-structure drift). Added the parallel C1.1 entry; cross-cloud parity with plugin 1020 S3 precedent restored.
- **R1-MEDIUM-1 (renderer)** — Strengthened Azure-exclusion comment to cite the engine-projection constraint in addition to plugin-1022 commingling.
- **R1-LOW-1 (renderer + mappings)** — Cross-control uniqueBuckets dedup test + combined metadata+IAM-failure regression test.
- **R1-LOW-2 (renderer)** — Narrative phrasing tweak ("AWS S3 / GCS" → "AWS S3 or GCS" for disambiguation).

### NEW institutional discipline introduced this cycle

**Pre-publish doc-consistency gate** codified in EE's `tasks/CLAUDE.md` after the 0.6.8 → user-caught doc drift (6 stale "22 plugin" claims hid across 4 docs in 2 repos). 22 doc-surface audit checklist + auto-grep + SOC 2 matrix invariant check. Saved as `[[pre_publish_doc_consistency_gate]]` auto-memory for cross-session persistence.

### Tests + regression

- **EE full regression: 5423/5423 across 851 suites** (was 5415/5415 at 0.6.8 publish; +8 tests, suite count unchanged). **61-session 100% green streak preserved.**

---

## 0.1.29 — Catalog refresh: NEW plugin 1024 GCP Cloud Storage Auditor — paired with EE 0.6.8 trio-publish (first multi-cloud parity plugin in 6 months; mirrors plugin 1020 AWS S3 Auditor with 6 GCS-specific dimensions; 4 R1 reviewer folds (0 R-CRITICAL + 0 R-HIGH + 3 R-MEDIUM + 1 R-LOW — clean review pass); plugin count 22 → 23; 20 new soc2.json mappings; nineteenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.8 + CE 0.1.62 — **nineteenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.8).

### What changed

- **`references/plugins.md`** — new plugin 1024 row added (alphanumerically sorted between 1023 zero-trust-checker and 1030 IAM Deep Auditor):
  - **Plugin 1024 — GCP Cloud Storage Auditor** (NEW EE 0.6.8): multi-cloud parity sister of plugin 1020 AWS S3 Auditor. 6 dimensions: bucket-level IAM public bindings (CC6.6 — allUsers = CRITICAL, allAuthenticatedUsers = HIGH), Uniform Bucket-Level Access enforcement (CC6.6 + C1.1 dual-mapped — closes legacy bucket-ACL false-PASS class), Object Versioning (C1.1 + A1.2 dual-mapped), Bucket Lock retention policy (C1.1 + C1.2 dual-mapped; SEC 17a-4 / FINRA 4511 WORM-alignment), Customer-Managed Encryption Keys via Cloud KMS (CC6.1 four-tier custody ladder mirroring plugin 1140 v2 RDS), bucket-level access logging (CC7.1). NEW SDK dep `@google-cloud/storage` in optionalDependencies.
- **`SKILL.md`** — "post-EE 0.6.7" → "post-EE 0.6.8"; plugin 1024 highlights surfaced; plugin count enumeration 22 → 23.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Reviewer-fold highlights (all closed same-session)

- **R-MEDIUM-1** — Severity-ladder co-existence: when both `allUsers` and `allAuthenticatedUsers` are present in different bindings, CRITICAL finding surfaces the HIGH evidence in details + narrative.
- **R-MEDIUM-2** — Per-bucket runtime exception severity: run()-level catch INFO → LOW for consistency with `_auditBucket` metadata-error pattern.
- **R-MEDIUM-1 (mappings)** — Cross-cloud parity dual-mappings: 5 soc2.json entries dual-mapped to C1.2 + A1.2 matching AWS S3 precedents.
- **R-LOW-1** — CMEK regex tightened from substring to full-format 6-segment match.

### Tests + regression

- **EE full regression: 5415/5415 across 851 suites** (was 5314/5314 at 0.6.7 publish; +101 tests / +17 suites — all attributable to the new plugin file). **60-session 100% green streak preserved.**

---

## 0.1.28 — Catalog refresh: plugin 1170 v3.1 SG-reference-graph edge dedup + plugin 1200 v6.1 CloudWatch Logs probe retry-on-empty parity — paired with EE 0.6.7 trio-publish (patch-level R2 reviewer-deferred-items cleanup cycle: closes both R2 items from 0.6.6 reviewer pass; 4 R1 reviewer folds (0 R-CRITICAL + 0 R-HIGH + 1 R-MEDIUM + 3 R-LOW — clean review pass) + 1 unanticipated `_retryOnNotFound` two-phase restructure (caught by test interaction); plugin count UNCHANGED at 22; soc2.json UNCHANGED; eighteenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.7 + CE 0.1.61 — **eighteenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.7).

### What changed

- **`references/plugins.md`** — two plugin rows updated:
  - **Plugin 1170 v3.1** — extended row with edge-dedup discipline in `_buildSgReferenceGraph`: edges deduped by `(sourceGroupId, targetGroupId)` with `ports` aggregated as array of `{protocol, fromPort, toPort}`. Pre-fold a real-world ALB-fronting-app SG with 3 ingress perms on different ports (80/443/8080) referencing the same source SG emitted 3 distinct edges A→B; the BFS treated each as a separate chain, inflating `chainCount` 2-5× and exhausting per-target chain caps on noise. Post-fold the BFS sees exactly 1 chain per distinct (source, target) pair. `isCrossVpc` aggregation is AND-semantic — if ANY contributing pair is same-VPC, the merged edge is same-VPC (per `[[conservative_classifier_principle]]`). Classifier `_classifyTransitiveReachability` port-render accepts both v3.1 array shape and v3 single-object shape (back-compat preserved).
  - **Plugin 1200 v6.1** — extended row with CloudWatch Logs probe retry-on-empty parity. Pre-fold the CWL Logs probe was asymmetric: `DescribeLogGroups` returns `logGroups: []` (NOT a thrown exception) on missing groups, so the shared `_retryOnNotFound` helper's thrown-NotFound retry path never fired. A freshly-created CWL log group probed within seconds of creation could false-DEAD. Post-fold `_retryOnNotFound` accepts an optional retry-on-result predicate; the CWL call site passes a predicate that fires retry when the response carries no exact-name match (covers both empty and prefix-only-sibling responses). Eventual-consistency parity now uniform across IAM / Lambda / SNS / SQS / EventBridge API destination / CloudWatch Logs.
  - **Two-phase restructure of `_retryOnNotFound`** — initially the result-based retry was added inside the existing try block, but a compound-path test interaction (transient empty → second-call throws `ResourceNotFoundException`) caused 3 total network calls. Restructured to two mutually-exclusive phases — Phase 1 = initial call + thrown-NotFound retry; Phase 2 = result-based retry — capping total calls at 2 on all compound paths. The per-call-site outer catch routes a second-call thrown error (NotFound → DEAD; AccessDenied → UNVERIFIABLE).
  - **4 R1 reviewer folds applied** (0 R-CRITICAL + 0 R-HIGH + 1 R-MEDIUM + 3 R-LOW — clean review pass): R-MEDIUM-1 arrival-order-independent AND-aggregation (locked with 2 regression fixtures + JSDoc tightening) + R-LOW-1 partial-render contract on malformed port specs (locked with 2 regression fixtures) + R-LOW-2 `_portKeys` scratch-lifetime documented at function-signature comment + R-LOW-1 compound-path coverage (transient empty → second-call AccessDenied → UNVERIFIABLE / transient empty → second-call thrown RNF → DEAD; drives the two-phase restructure decision).
- **`SKILL.md`** — "post-EE 0.6.6" → "post-EE 0.6.7"; plugin 1170 v3.1 + plugin 1200 v6.1 highlights surfaced in plugin narratives; plugin count enumeration stays at 22.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### R2 reviewer-deferred (queued for 0.6.8+)

- **R-NIT (plugin 1200 v6.1)** — `retryOnResultPredicate` could be renamed to `shouldRetryOnResult` for question-form consistency with other EE predicates. Pure naming preference.
- **R-NIT (plugin 1200 v6.1)** — symmetry of comments between Phase 1 retry and Phase 2 retry blocks. Pure readability.
- **R-NIT (plugin 1170 — pre-existing)** — `// out-of-scope for v3 v1` typo at the cross-VPC BFS branch (pre-existing from 0.6.6).
- **Cross-plugin extraction candidate** — the `(source, target)` dedup pattern with aggregated-attribute array transfers to IAM trust-policy graphs, VPC peering graphs, KMS principal-reference graphs. Lift to `_lib/graph_edge_dedup.mjs` when the next plugin adopts it.

### Tests + regression

- **EE full regression: 5314/5314 across 834 suites** (was 5304/5304 at 0.6.6 publish; +10 tests, suite count unchanged). **59-session 100% green streak preserved.**

---

## 0.1.27 — Catalog refresh: plugin 1170 v3 SG→SG transitive reachability + plugin 1200 v6 dead-target probe warm-up — paired with EE 0.6.6 trio-publish (minor cycle: EE-RT.16 v3 transitive chain reachability + EE-RT.20.5 v6 IAM/API-destination/CW-Logs target probes; 5 R1 reviewer folds (1 R-HIGH + 2 R-MEDIUM + 2 R-LOW; 0 R-CRITICAL — clean review pass); plugin count UNCHANGED at 22; seventeenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.6 + CE 0.1.60 — **seventeenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.6).

### What changed

- **`references/plugins.md`** — two plugin rows updated:
  - **Plugin 1170 v3** — extended row with SG→SG transitive chain reachability dimension: BFS from public-CIDR roots through `UserIdGroupPairs` SG-references; 2-hop emits HIGH, 3+ hop emits CRITICAL (operator-blindness principle); cycle defense + depth cap (default 5, max 20) + per-target chain cap (default 10, max 100); cross-VPC edges skipped as INFO trailer; per-hop port-flow tracked but NOT intersected (v3 v1 simplification — walkthroughRequired=true). New operator opts: `skipTransitiveReachability` / `transitiveChainDepthCap` / `transitiveChainsPerTargetCap` / `transitiveChainSamplesPerFindingCap`. 3 new soc2.json mappings under CC6.6 (transitive-public HIGH + CRITICAL + INFO truncation).
  - **Plugin 1200 v6** — extended row with three new dead-target probe branches: IAM role (`iam:GetRole` on path-stripped role NAME) + EventBridge API destination (`events:DescribeApiDestination` reuses `_EventBridgeSdk`) + CloudWatch Logs (`logs:DescribeLogGroups` with `logGroupNamePrefix` filter + exact-name disambiguation guard). New SDK deps `@aws-sdk/client-iam` + `@aws-sdk/client-cloudwatch-logs` (both in optionalDependencies). Companion-LOW emission contract unchanged (existing CC7.1 titlePattern target-type-agnostic). **Operator note**: `iam:GetRole` is a global API resolving per-partition — orchestrators wiring `opts._iamClient` must construct a single global IAM client per-partition.
  - **5 v6 R1 reviewer folds applied** (0 R-CRITICAL — clean review pass; 1 R-HIGH + 2 R-MEDIUM + 2 R-LOW): R-HIGH-1 (plugin 1170 v3) BFS short-circuits enqueue past per-target cap (closes path-enumeration explosion on hub-and-spoke topologies — pre-fold the BFS marked the target truncated but kept cloning `path` and `visited` Sets and walking past the cap) + R-MEDIUM-1 (plugin 1200 v6) IAM `NoSuchEntityException` / `NoSuchEntity` lifted into `_DEAD_TARGET_NOTFOUND_ERROR_NAMES` Set (bare disjunction collapsed; eventual-consistency retry restored for IAM — the canonical worst case for AWS eventual consistency, with IAM lag 10-30s documented; **9th cumulative recurrence** of the `[[emit_literal_set_drift]]` class across the EE codebase) + R-MEDIUM-2 (plugin 1200 v6) IAM partition-routing contract documented at `_loadIamSdk` (orchestrator must construct global IAM client per-partition; doc-only fold) + R-LOW-2 (plugin 1170 v3) depth-cap-hit surfaced separately from per-target-cap (closes silent-deep-truncation false-CLEAN class — pre-fold a graph deeper than `transitiveChainDepthCap` silently truncated without operator-visible signal) + R-LOW-2 (plugin 1200 v6) API destination ARN regex future-proofed against alias-only ARN shapes.
- **`SKILL.md`** — "post-EE 0.6.5" → "post-EE 0.6.6"; plugin 1170 v3 + plugin 1200 v6 highlights surfaced in plugin-1200 narrative; plugin count enumeration stays at 22.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### R2 reviewer-deferred (queued for 0.6.7)

- **R-LOW-1 (plugin 1200 v6)**: CloudWatch Logs probe doesn't retry on empty result (logs:DescribeLogGroups returns `logGroups: []` not an exception, so `_retryOnNotFound` doesn't apply). Lower priority than IAM since CWL eventual-consistency is much narrower.
- **R-MEDIUM-1 (plugin 1170 v3)**: Edge dedup absent in `_buildSgReferenceGraph` — multi-rule references to the same SG (e.g., one perm per port) inflate chain counts 2-5×. Defer until operator feedback on chain-count noise.
- **R-NIT** documentation folds.

### Tests + regression

- **EE full regression: 5304/5304 across 834 suites** (was 5261/5261 across 825 at 0.6.5 publish; +43 tests, +9 suites — most are pre-fold v3/v6 base fixtures; 5 are fold-regression pins: hub-and-spoke per-target-cap + depthCapHit-true + depthCapHit-false + IAM transient-retry-succeeds + IAM lowercase-name-retry-then-DEAD). **58-session 100% green streak preserved.**

---

## 0.1.26 — Catalog refresh: plugin 1200 v5 v4-reviewer-cleanup cycle — paired with EE 0.6.5 trio-publish (patch-level cycle: R-NIT named-constants + sentinel observability + sessionToken cross-plugin sweep + dead-target companion-LOW; 5 R1 reviewer folds; plugin count UNCHANGED at 22; sixteenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.5 + CE 0.1.59 — **sixteenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.5).

### What changed

- **`references/plugins.md`** — plugin 1200 row updated with v5 dim list:
  - **Dead-target companion-LOW (item)** — per-target liveness probes for Lambda + SNS + SQS via new `_probeTargetLiveness` helper (parallel via Promise.all + 2s default timeout). New MEDIUM verdict `*-alerting-destination-dead-targets` emitted as companion alongside PASS when targets point to deleted resources. New operator opts: `skipTargetLivenessProbe: true` + `deadTargetProbeTimeoutMs`. IAM role + API destination + CloudWatch Logs target probes deferred to 0.6.6.
  - **Sentinel observability** — `targetVerificationReason` enum (AccessDenied / SdkUnavailable / BeyondCap / SkippedByOpts) on rule shape; classifier surfaces `targetVerificationReasonBreakdown` in finding details.
  - **R-NIT named-constants** — `SH_HUB_NOT_ENABLED_ERROR_NAMES` frozen Set replaces 2 bare-string sites in SecurityHub helpers per `[[emit_literal_set_drift]]`.
  - **5 R1 reviewer folds applied** (0 R-CRITICAL — clean review pass; 3 R-HIGH + 1 R-MEDIUM + 1 consolidated R-LOW/R-NIT): R-HIGH-1 case-insensitive NotFound matching + R-HIGH-2 one-retry on NotFound (eventual-consistency defense) + R-HIGH-3 Lambda probe passes FULL ARN (alias-correctness server-side) + R-HIGH (Explore) parallel probes with per-target timeout + R-MEDIUM-1 SQS partition-aware via `GetQueueUrl` (closes false-DEAD on aws-cn / aws-us-gov / aws-iso partitions).
- **Cross-plugin sessionToken sweep** — note added to the EE plugin catalog narrative: 18 EE AWS plugins (1020-1200) now thread `sessionToken` through their AWS-SDK credentials block. AssumeRole-style auditor credentials work uniformly across the entire EE catalog.
- **`SKILL.md`** — "post-EE 0.6.4" → "post-EE 0.6.5"; plugin count enumeration stays at 22.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Why the catalog refresh matters

AI coding agents using this skill now know that plugin 1200:

- **Verifies per-target liveness** for Lambda / SNS / SQS targets via probes — a verified rule with a Target.Arn pointing to a deleted resource emits a companion LOW alongside the PASS verdict (not just a count-based PASS).
- Distinguishes **eventual-consistency NotFound from real DEAD** via a one-retry with 750ms backoff (defends against false-DEAD on freshly-created resources).
- Calls `events:ListTargetsByRule` with **full qualified Lambda ARNs** to verify alias/version correctness server-side (alias `PROD` pointing to a deleted version surfaces as DEAD).
- Supports **GovCloud / aws-cn / aws-iso SQS targets** via `GetQueueUrl` (partition-aware) instead of synthesized commercial-AWS URL.
- Surfaces unverifiable rules with **explicit failure-mode taxonomy** (AccessDenied / SdkUnavailable / BeyondCap / SkippedByOpts) so auditors can drill down.

AI coding agents using this skill also now know that **all 18 EE AWS plugins** support AssumeRole-style auditor credentials uniformly — auditors no longer need to inject ambient credentials separately.

### Compatibility

No agent-skill API surface changes; pure documentation refresh. AI agents using earlier agent-skill versions against EE 0.6.5 still work, they just lack the v5 dim awareness.

**Customer install (paired):**

```bash
npm install -g nsauditor-ai@0.1.59 @nsasoft/nsauditor-ai-ee@0.6.5
npm install nsauditor-ai-agent-skill@0.1.26
```

---

## 0.1.25 — Catalog refresh: plugin 1200 v4 reviewer-cleanup cycle — paired with EE 0.6.4 trio-publish (patch-level cycle: EventBridge target verification + multi-failedAccount surface + trigger uniformity; 5 R1 reviewer folds incl. R-HIGH-1 cap-skew classifier closure; plugin count UNCHANGED at 22; fifteenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.4 + CE 0.1.58 — **fifteenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.4).

### What changed

- **`references/plugins.md`** — plugin 1200 row updated with v4 dim list. **R-HIGH-2 EventBridge target verification (item)**: new `_listEventBridgeRuleTargets` helper with defensive pagination; `events:ListTargetsByRule` per matched rule (cap default 10 via `opts.targetVerificationRuleCap`; opt-out via `opts.skipEventBridgeTargetVerification`); new MEDIUM verdict `*-alerting-destination-targetless` for sink-less rules. **R-MEDIUM-2 multi-failedAccount surface**: Inspector2 helper return-shape `{accountStatus, accessDenied, failedAccounts: array}` (renamed plural; capped at AWS-documented 100); caller emits one LOW per failed account with per-region emission cap 10 + rollup LOW per region. **R-LOW-2 trigger uniformity**: GuardDuty alerting-destination trigger gates on `detector.Status === ENABLED` (symmetric with Inspector2). **5 R1 reviewer folds applied** (0 R-CRITICAL — clean review pass): R-HIGH-1 cap-skew classifier branch (LOW UNVERIFIABLE not MEDIUM TARGETLESS when cap-exceeded rules could be the actual sink) + R-HIGH consolidated pagination + JSDoc clarity + R-MEDIUM-1 multi-failedAccount per-region emission cap (10 + rollup) + R-MEDIUM-4 boundary tests + R-HIGH-2 dead-target documented-limitation note.
- **`SKILL.md`** — "post-EE 0.6.3" → "post-EE 0.6.4"; plugin count enumeration stays at 22.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Why the catalog refresh matters

AI coding agents using this skill now know that plugin 1200:

- **Verifies EventBridge target presence per matched rule** — a rule with zero `Targets` (or just `ENABLED` state but no targets configured) routes to MEDIUM TARGETLESS instead of PASS. Closes the substrate-without-sink false-PASS class at the rule level.
- **Emits one LOW per failed Inspector2 account** for delegated-admin scans — was first-failedAccount-only pre-fold; rest were silently dropped. Per-region emission cap of 10 + rollup LOW per region bounds finding pollution.
- Exposes new operator opts: `skipEventBridgeTargetVerification: true` (cost-sensitive opt-out OR no IAM grant) + `targetVerificationRuleCap: 1..100` (per-rule verification cap; default 10).
- **Distinguishes cap-skew unverifiable from sink-less rules** — when target-less rules exist AND others are beyond the verification cap (could be the real sink), emits LOW UNVERIFIABLE with `capExceeded: true` per `[[conservative_classifier_principle]]` rather than overclaiming MEDIUM TARGETLESS.

### Documented limitation queued for 0.6.5

The target COUNT is verified but per-target LIVENESS is not (Target.Arn could point to deleted Lambda / detached SNS topic). The soc2.json PASS rationale now calls this out explicitly; a companion-LOW finding for dead-target ARNs is queued for the 0.6.5 cycle (would require ~6 new IAM grants on Lambda / SNS / SQS / etc.).

### Compatibility

No agent-skill API surface changes; pure documentation refresh. AI agents using earlier agent-skill versions against EE 0.6.4 still work, they just lack the v4 dim awareness.

**Customer install (paired):**

```bash
npm install -g nsauditor-ai@0.1.58 @nsasoft/nsauditor-ai-ee@0.6.4
npm install nsauditor-ai-agent-skill@0.1.25
```

---

## 0.1.24 — Catalog refresh: plugin 1200 v3 alerting-destination dim — paired with EE 0.6.3 trio-publish (patch-level extension: substrate-without-sink false-PASS closure via EventBridge rule + SecurityHub product subscription detection; R-CRITICAL Inspector Classic ARN-collision fold; SH-only MEDIUM tier; plugin count UNCHANGED at 22; fourteenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.3 + CE 0.1.57 — **fourteenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.3).

### What changed

- **`references/plugins.md`** — plugin 1200 row updated with v3 dim list. NEW alerting-destination dim (item c) verifies EventBridge rule + SecurityHub product subscription per service per region. New SDK deps `@aws-sdk/client-eventbridge` + `@aws-sdk/client-securityhub` (optionalDependencies). 4 same-session R1 reviewer folds applied: R-CRITICAL-1 SH product ARN substring collision closure (Inspector Classic vs Inspector2; boundary-anchored helper) + R-HIGH-1 SH-only PASS narrative split (SH-only is MEDIUM aggregation-only; auditor walkthrough required for SH → downstream paging) + R-HIGH-3 EventBridge content-filter grammar (`{prefix}` / `{wildcard}` matchers; regex-meta escape for operator IaC defense) + R-LOW-1 source case normalization. Also surfaces R-MEDIUM-2 (Inspector2 helper return-shape `{accountStatus, accessDenied, failedAccount}`) + item (d) BatchGetAccountStatus contract verification with `failedAccounts[]` per-account error channel surfaced via new `_CAT_INS_FAILED_ACCOUNT` LOW.
- **`SKILL.md`** — "post-EE 0.6.2" → "post-EE 0.6.3"; plugin count enumeration stays at 22 (existing plugin grew in scope).
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Why the catalog refresh matters

AI coding agents using this skill now know that plugin 1200:

- Audits **alerting-destination presence** per service per region (closing the substrate-without-sink false-PASS class) — operators wiring GuardDuty / Inspector2 without an EventBridge rule or SecurityHub integration get a HIGH finding rather than a misleading PASS.
- Distinguishes **PASS** (EventBridge rule present), **MEDIUM SH-only** (SecurityHub aggregates but no proactive paging), **HIGH missing** (no path), and **LOW unverifiable** (AccessDenied / SDK unavailable).
- Supports **EventBridge content-filter grammar** — `{prefix: "aws."}` catch-all rules and `{wildcard: "aws.guard*"}` glob rules both match correctly.
- Exposes new operator opt: `skipAlertingDestination: true` for cost-sensitive runs.
- Distinguishes a **true AccessDenied** from an **empty-body response** (R-MEDIUM-2 close-out) — `_getInspector2AccountStatus` no longer conflates the two cases.
- Surfaces the **AWS-published `failedAccounts[]` per-account error channel** with `errorCode + errorMessage` via new `_CAT_INS_FAILED_ACCOUNT` LOW (item d close-out).

### R-CRITICAL-1 closure (worth a callout)

The pre-fold substring check `:product/aws/inspector` would have matched BOTH Inspector Classic (deprecated 2024) and Inspector2 ARNs — a substrate-without-sink false-PASS where a stale Classic subscription emitting zero findings would have satisfied the Inspector2 dim. The R-CRITICAL fold uses boundary-anchored substring matching + the strict `/aws/inspector2` constant, and pins the regression with a dedicated test that asserts the Classic ARN does NOT match the Inspector2 dim.

### Compatibility

No agent-skill API surface changes; pure documentation refresh. AI agents using earlier agent-skill versions against EE 0.6.3 still work, they just lack the v3 dim awareness.

**Customer install (paired):**

```bash
npm install -g nsauditor-ai@0.1.57 @nsasoft/nsauditor-ai-ee@0.6.3
npm install nsauditor-ai-agent-skill@0.1.24
```

---

## 0.1.23 — Catalog refresh: plugin 1200 v2 evidence-acquisition extension — paired with EE 0.6.2 trio-publish (patch-level extension: multi-region GuardDuty + Inspector2 enumeration + GovCloud / ISO region support + `FindingPublishingFrequency` check + Inspector2 baseline expansion; plugin count UNCHANGED at 22; thirteenth consecutive trio-publish)

**Trio-publish institutionalization continued.** Paired with EE 0.6.2 + CE 0.1.56 — **thirteenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.2).

### What changed

- **`references/plugins.md`** — plugin 1200 row updated with v2 dim list. Multi-region enumeration (item a) replaces single-region scope; `FindingPublishingFrequency` check (item b) added as CC7.1 detection-latency dimension; Inspector2 baseline expansion (item e) grows scan-target baseline from {ec2, ecr, lambda} → {ec2, ecr, lambda, lambdaCode, codeRepository}. 4 same-session R1 reviewer folds applied (0 R-CRITICAL clean review pass): R-HIGH-1 region regex GovCloud + ISO support (closes FedRAMP / StateRAMP / IL5+ false-PASS class) + R-HIGH-2 frequency ordering not equality + R-MEDIUM-1 region cap defensibility + R-LOW-1 EC2 client instrumentation parity.
- **`SKILL.md`** — "post-EE 0.6.1" → "post-EE 0.6.2"; plugin count enumeration stays at 22 (existing plugin grew in scope).
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Why the catalog refresh matters

AI coding agents using this skill now know that plugin 1200:

- Audits GuardDuty and Inspector2 across **all opted-in regions** by default (not just the client's configured region).
- Supports **GovCloud (`us-gov-*`) and ISO (`us-iso*-*`) regions** — operators on those substrates were silently skipped pre-0.6.2.
- Classifies the GuardDuty `FindingPublishingFrequency` against an institutional baseline of 15 minutes (operator-tunable).
- Treats Inspector2 Lambda code scanning and code-repository scanning as part of the institutional baseline (Inspector2 GA 2024+ scan-target additions).
- Exposes operator opts: `regions: string[]` / `skipMultiRegion: true` / `regionListCap: 1..256` / `gdFrequencyPassFrequency: FIFTEEN_MINUTES | ONE_HOUR | SIX_HOURS`.

### Compatibility

No agent-skill API surface changes; pure documentation refresh. AI agents using earlier agent-skill versions against EE 0.6.2 still work, they just lack the v2 dim awareness.

**Customer install (paired):**

```bash
npm install -g nsauditor-ai@0.1.56 @nsasoft/nsauditor-ai-ee@0.6.2
npm install nsauditor-ai-agent-skill@0.1.23
```

---

## 0.1.22 — Catalog refresh: NEW plugin 1200 AWS Inspector2 / GuardDuty Enablement Auditor — paired with EE 0.6.1 trio-publish (patch-level new-plugin extension — first AWS-managed-threat-detection substrate audit; plugin count 21 → 22)

**Trio-publish institutionalization continued.** Paired with EE 0.6.1 + CE 0.1.55 — **twelfth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.1).

### What changed

- **`references/plugins.md`** — **NEW plugin 1200 row** added: 4 active SOC 2 dimensions (GuardDuty Detector enablement per region CC7.1, GuardDuty protection-feature coverage CC7.1 — institutional baseline S3_DATA_EVENTS / EKS_AUDIT_LOGS / EBS_MALWARE_PROTECTION / RDS_LOGIN_EVENTS / LAMBDA_NETWORK_LOGS / RUNTIME_MONITORING, Inspector2 enablement CC7.1+CC7.2, Inspector2 scan-target coverage CC7.1 zero / CC7.2 partial). First AWS-managed-threat-detection substrate audit. HIGH on `gd-not-enabled` silent-blind class; HIGH on `inspector2-disabled` / SUSPENDED silent-blind class for CVE coverage on EC2/ECR/Lambda; HIGH on `inspector2-coverage-zero` (enabled overall but zero scan targets active); MEDIUM on partial coverage with explicit `disabledResources`. **6 same-session R1 reviewer folds applied** including R1-CRITICAL-1 soc2.json titlePattern misalignment closure (4 patterns; would have silently failed CC7.1/CC7.2 compliance routing) + R1-CRITICAL-1 AccessDenied distinct findings + R1-CRITICAL-2 legacy DataSources case normalization + R1-HIGH-2 SUSPENDED/DISABLED Detector silent-blind closure + R1-HIGH-3/4 dead-code drift closures.
- **`SKILL.md`** — plugin count enumeration 21 → 22; "post-EE 0.6.0" → "post-EE 0.6.1".
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Recommended upgrade path

```bash
npm install nsauditor-ai-agent-skill@0.1.22
# (paired with EE 0.6.1 + CE 0.1.55; AI-coding-agent users only)
```

---

## 0.1.21 — Catalog refresh: NEW plugin 1160 AWS VPC Endpoints / PrivateLink Auditor — paired with EE 0.6.0 trio-publish (minor-version milestone — first new plugin since EE 0.4.7; plugin count 20 → 21)

**Trio-publish institutionalization continued.** Paired with EE 0.6.0 + CE 0.1.54 — **eleventh consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.6.0). Opens the v0.6.x line with new plugin breadth.

### What changed

- **`references/plugins.md`** — **NEW plugin 1160 row** added: 4 SOC 2 dimensions (endpoint policy permissive principals CC6.6, PrivateDNS enabled CC6.6, endpoint state A1.2+CC7.2, type substrate Privacy+CC6.6). First plugin to specifically audit the PrivateLink isolation boundary. CRITICAL on unconditional wildcard breaking isolation; MEDIUM on PrivateDNS-disabled silent-bypass; HIGH on `failed` state silent-failure.
- **`SKILL.md`** — plugin count enumeration 20 → 21; "post-EE 0.5.4" → "post-EE 0.6.0".
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Recommended upgrade path

```bash
npm install nsauditor-ai-agent-skill@0.1.21
# (paired with EE 0.6.0 + CE 0.1.54; AI-coding-agent users only)
```

---

## 0.1.20 — Catalog refresh: cross-plugin Thread H sweep — §7.5 `_promote*FromKms` signature hardening (plugin 1140 v2 + 1180 v2) + §8 operator-config DoS caps (plugin 1170 v2) — paired with EE 0.5.4 trio-publish

**Trio-publish institutionalization continued.** Paired with EE 0.5.4 + CE 0.1.53 — **tenth consecutive trio-publish across EE + CE + agent-skill in a single session** (0.4.5–0.5.4). Final v0.5.x close-out cycle.

### What changed

- **`references/plugins.md`** — cross-plugin notes added: plugins 1140 v2 + 1180 v2 `_promote*FromKms` accept BOTH legacy `keyManager` string OR new `keyManagerByArn: Map<arn, keyManager>` form (Map looks up by `finding.details.kmsKeyArn` — single source of truth; closes parallel-threading false-CLEAN class). Plugin 1170 v2 adds `_OPERATOR_CONFIG_MAX_ENTRIES = 1000` constant + operator-tunable caps via `opts.additionalRestrictedPortsCap` / `opts.additionalSystemManagedSgNamePrefixesCap`.
- **`SKILL.md`** — "post-EE 0.5.3" → "post-EE 0.5.4". EE plugin count UNCHANGED at 20.

### Notes

- Pure catalog refresh; no SKILL contract changes.
- v0.5.x close-out summary: 5 ship cycles (0.5.0–0.5.4). Ready for 0.6.0 milestone.

### Recommended upgrade path

```bash
npm install nsauditor-ai-agent-skill@0.1.20
# (paired with EE 0.5.4 + CE 0.1.53; AI-coding-agent users only)
```

---

## 0.1.19 — Catalog refresh: plugin 1190 AWS SES Email Integrity Auditor v3 extension (Part A DKIM public-key fingerprint capture/pin + Part B in-band DMARC alignment classifier; 5 same-session reviewer folds incl. 1 R-CRITICAL false-CLEAN closure on truncated DKIM keys) — EE 0.5.3; plugin count UNCHANGED at 20

**Trio-publish institutionalization continued.** Paired with EE 0.5.3 + CE 0.1.52 — **ninth consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5/0.4.6/0.4.7/0.4.8/0.4.9/0.5.0/0.5.1/0.5.2). The 0.1.19 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin extension.

### What changed

- **`references/plugins.md`** — **plugin 1190 row** updated v2.1 → v3: 2 NEW evidence dimensions (Part A DKIM public-key fingerprint capture/pin + Part B in-band DMARC alignment classifier). NEW emission categories: `ses-dkim-fingerprint-verified` (PASS) / `ses-dkim-fingerprint-mismatch` (HIGH — operator-supplied pin store enables unauthorized rotation / key substitution attack detection) / `ses-dkim-fingerprint-unverifiable` (LOW + evidenceGap) + `ses-dmarc-alignment-strict-met` (PASS) / `ses-dmarc-alignment-relaxed` (INFO) / `ses-dmarc-alignment-dkim-strict-impossible` (HIGH — adkim=s + DKIM disabled) / `ses-dmarc-alignment-spf-strict-impossible` (HIGH — aspf=s + no custom MailFrom) / `ses-dmarc-alignment-unverifiable` (LOW). NEW kill-switches `_skipDkimFingerprintCapture` + `_skipDmarcAlignmentCheck`. R-CRITICAL closure (discovered via test): `_stripControlChars` 256-char truncation corrupted long DKIM keys → new `_stripControlCharsNoTruncate` helper.
- **`SKILL.md`** — plugin 1190 v3 narrative added; "post-EE 0.5.2" → "post-EE 0.5.3". EE plugin count UNCHANGED at 20.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Recommended upgrade path

```bash
npm install nsauditor-ai-agent-skill@0.1.19
# (paired with EE 0.5.3 + CE 0.1.52; AI-coding-agent users only)
```

### Notes

- No SKILL contract changes; pure catalog refresh.
- Ninth consecutive trio-publish institutionalizes the discipline across 9 ship cycles.

---

## 0.1.18 — Catalog refresh: plugin 1190 AWS SES Email Integrity Auditor v2.1 deferred-items sweep (7 deferred reviewer-fold items closed from 0.5.0 cycle + 6 same-session reviewer folds incl. 1 CRITICAL soc2 mapping closure + silent-loss-class closure on SES classic API quota exhaustion) — EE 0.5.2; plugin count UNCHANGED at 20

**Trio-publish institutionalization continued.** Paired with EE 0.5.2 + CE 0.1.51 — **eighth consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5/0.4.6/0.4.7/0.4.8/0.4.9/0.5.0/0.5.1). The 0.1.18 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin consolidation.

### What changed

- **`references/plugins.md`** — **plugin 1190 row** updated v2 → v2.1: 7 deferred reviewer-fold items closed. NEW emission category `ses-dkim-dns-partial-with-transients` MEDIUM (matched>0 + transient on remainder — preserves partial-match evidence rather than collapsing to LOW). NEW named Sets `_DNS_TRANSIENT_ERROR_CODES` + `_SES_CLASSIC_NOT_FOUND_ERROR_NAMES` + `_SES_CLASSIC_QUOTA_ERROR_NAMES` per [[emit_literal_set_drift]] discipline. NEW module-load-time disjointness IIFE `_assertDnsErrorCodeSetsDisjoint()` promotes invariant from test-time to Node startup. R-LOW-6 producer→consumer identityType normalization at both promoter sites.
- **`SKILL.md`** — plugin 1190 v2.1 narrative added; "post-EE 0.5.1" → "post-EE 0.5.2". EE plugin count UNCHANGED at 20.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Why

The agent-skill catalog must stay current with EE plugin consolidation cycles so that AI coding agents (Claude Code / Cursor / Windsurf / VS Code Copilot) querying the skill for plugin-1190 capabilities get accurate guidance on the v2.1 emission categories (especially the new `ses-dkim-dns-partial-with-transients` MEDIUM and the `cause: "classic-sdk-quota-exhausted"` LOW + evidenceGap) — without the catalog refresh, agents would incorrectly tell users that plugin 1190 only emits 4 DKIM-DNS categories and 3 classic-policy categories.

### Recommended upgrade path

```bash
npm install nsauditor-ai-agent-skill@0.1.18
# (paired with EE 0.5.2 + CE 0.1.51; AI-coding-agent users only)
```

### Notes

- No SKILL contract changes; pure catalog refresh.
- `references/schemas.md` + `references/workflows.md` unchanged (no plugin-schema or workflow changes in EE 0.5.2; plugin 1190 v2.1 consolidation uses the same `cloudScanners` capability + same `run()` envelope established in EE-RT.12.25).
- Eighth consecutive trio-publish institutionalizes the discipline across 8 ship cycles.

---

## 0.1.17 — Catalog refresh: plugin 1150 AWS SQS/SNS Auditor v2 extension (5 → 7 dimensions: CloudWatch alarm coverage on SQS ApproximateAgeOfOldestMessage + SNS NumberOfNotificationsFailed; first plugin-1150 dim to cross an SDK boundary — SQS+SNS → CloudWatch) — EE 0.5.1; plugin count UNCHANGED at 20

**Trio-publish institutionalization continued.** Paired with EE 0.5.1 + CE 0.1.50 — **seventh consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5/0.4.6/0.4.7/0.4.8/0.4.9/0.5.0). The 0.1.17 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin extension.

### What changed

- **`references/plugins.md`** — **plugin 1150 row** updated v1 → v2: 5 → 7 dimensions. v1 dims preserved (encryption + transit-policy + topic-policy + DLQ). v2 NEW dims: **dim 6 SQS ApproximateAgeOfOldestMessage CloudWatch alarm coverage** (CC7.2 + A1.2 dual-mapped) — per-queue PASS / MEDIUM (silent backlog growth) / LOW (actions-disabled OR empty AlarmActions) / LOW + evidenceGap (CW SDK unavailable / AccessDenied / name un-extractable / truncated); **dim 7 SNS NumberOfNotificationsFailed CloudWatch alarm coverage** (CC7.2 + A1.2 dual-mapped) — per-topic analogue with same severity ladder. v2 single-fetch budget via `_enumerateMetricAlarms` + `_buildAlarmIndex` (mirrors plugin 1040's `_auditAlarmCoverage` scaffold). Soft-degrade contract: CW SDK load failure routes per-resource to LOW + evidenceGap rather than blocking primary substrate audit. **R-CRITICAL v2 fold (false-CLEAN closure)**: `actionable` requires BOTH `ActionsEnabled=true` AND non-empty `AlarmActions[]` (CloudWatch fires NO operator paging when AlarmActions=[] even with ActionsEnabled=true). **R-HIGH v2 fold**: soc2.json PASS-tier titlePatterns narrowed to anchor on namespace:metric clauses.
- **`SKILL.md`** — plugin 1150 v2 narrative added to enumeration; "post-EE 0.5.0" → "post-EE 0.5.1". EE plugin count UNCHANGED at 20 (no new plugin in 0.5.1; existing plugin 1150 grew in scope across new dims 6 + 7).
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### Why

The agent-skill catalog must stay current with EE plugin extensions so that AI coding agents (Claude Code / Cursor / Windsurf / VS Code Copilot) querying the skill for plugin-1150 capabilities get accurate guidance on the v2 alarm-coverage dimensions — without the catalog refresh, agents would incorrectly tell users that plugin 1150 only has 5 dimensions and miss the CC7.2 + A1.2 alarm-coverage outcomes.

### Recommended upgrade path

```bash
npm install nsauditor-ai-agent-skill@0.1.17
# (paired with EE 0.5.1 + CE 0.1.50; AI-coding-agent users only)
```

### Notes

- No SKILL contract changes; pure catalog refresh.
- `references/schemas.md` + `references/workflows.md` unchanged (no plugin-schema or workflow changes in EE 0.5.1; plugin 1150 v2 extension uses the same `cloudScanners` capability + same `run()` envelope established in EE-RT.12.25).
- Seventh consecutive trio-publish institutionalizes the discipline across 7 ship cycles (0.4.5/0.4.6/0.4.7/0.4.8/0.4.9/0.5.0/0.5.1).

---

## 0.1.16 — Catalog refresh: plugin 1190 AWS SES Email Integrity Auditor v2 extension (DKIM CNAME DNS resolution + DMARC TXT record parser + SES classic API parity; first plugin in EE to depend on node:dns/promises for live DNS cross-reference) — EE 0.5.0; plugin count UNCHANGED at 20

**Trio-publish institutionalization continued.** Paired with EE 0.5.0 + CE 0.1.49 — **sixth consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5/0.4.6/0.4.7/0.4.8/0.4.9). The 0.1.16 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin extension.

### What changed

- **`references/plugins.md`** — **plugin 1190 row** updated v1 → v2: dim 1 DKIM now includes CNAME DNS resolution (each `<token>._domainkey.<domain>` resolved + matched against `<token>.dkim.amazonses.com`; four outcomes including HIGH `ses-dkim-dns-missing` false-CLEAN closure); dim 2 MailFrom now includes DMARC TXT record parser + MailFrom promotion (RFC 7489 §6.4 tag-list parser; five outcomes including HIGH `ses-dmarc-missing` + HIGH `ses-dmarc-policy-none`); dim 4 sending-auth policies now includes SES classic GetIdentityPolicies cross-API parity (HIGH `ses-classic-policy-discrepancy` on classic-only policies — canonical false-NEGATIVE class). v1 base preserved (TLS + dedicated IP + suppression list dimensions).
- **`SKILL.md`** — plugin 1190 v2 narrative added to enumeration; "post-EE 0.4.9" → "post-EE 0.5.0". EE plugin count UNCHANGED at 20 (no new plugin in 0.5.0; existing plugin 1190 grew in scope across dims 1 + 2 + 4).
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### EE 0.5.0 paired-release context

- **EE plugin count UNCHANGED at 20** — the 0.5.0 minor-version milestone bump is a single-plugin EXTENSION (fourth extension cycle after EE-RT.16 v2 in 0.4.6 + EE-RT.14 v3 in 0.4.8 + EE-RT.17 v2 in 0.4.9). Plugin 1190 v2 closes the canonical false-CLEAN window where SES `Status=SUCCESS` substrate alone could not rule out post-verification DNS drift.
- **Part A — DKIM CNAME DNS resolution promotion** (dim 1) — `_resolveDkimCnames` + `_promoteDkimFromDns`. Each `<token>._domainkey.<identityDomain>` CNAME resolved via node:dns/promises + matched against `<token>.dkim.amazonses.com` (case-insensitive per RFC 1035 §2.3.3). Four outcomes: PASS `ses-dkim-dns-verified` / MEDIUM `ses-dkim-dns-partial` / HIGH `ses-dkim-dns-missing` (production false-CLEAN closure) / LOW + evidenceGap `ses-dkim-dns-unverifiable`.
- **Part B — DMARC TXT record parser + MailFrom promotion** (dim 2) — RFC 7489 §6.4 tag-list parser + `_dmarc.<identityDomain>` TXT lookup. Five outcomes. **R-CRITICAL-1 same-session fold (false-CLEAN closure)**: `pct=0` on `p=reject`/`p=quarantine` functionally equivalent to `p=none`; now routes to HIGH `ses-dmarc-policy-none`. **R-HIGH-1 same-session fold (subdomain-takeover false-NEGATIVE closure)**: `sp` subdomain-policy override now evaluated — `p=reject; sp=none` downgrades to HIGH.
- **Part C — SES classic GetIdentityPolicies parity** (dim 4) — `_loadSesClassicSdk` restored (was removed in v1 reviewer-fold MEDIUM as dead-code load-check). Cross-API discrepancy detection emits HIGH `ses-classic-policy-discrepancy` on classic-only policies (canonical false-NEGATIVE class). Conservative on classic SDK unavailable / AccessDenied → LOW + evidenceGap `ses-classic-policy-unverifiable`.
- **8 same-session reviewer folds across the cycle** (1 CRITICAL + 3 HIGH + 2 MEDIUM + 2 LOW); 6 queued in Pick-up Block.
- **First plugin in EE to depend on `node:dns/promises`** — first ship to add NETWORK-LAYER cross-reference to AWS-SDK-substrate evidence baseline; structurally distinct evidence-acquisition surface from prior 0.4.x cycles.
- **Real-DNS smoke validation END-TO-END** against production DNS resolvers — `_dmarc.nsasoft.us` parsed correctly: `p=reject, sp=reject (default), pct=100`; forward-compat `fo=1` tag preserved in `rawTags`. Empty-account SESv2 enumeration baseline succeeded end-to-end against <operator-test-account>.
- **EE full regression: 4787/4787** (was 4696 at EE 0.4.9 publish; +91 tests cumulative across the v2 cycle). 46-session 100% green streak preserved.
- **Coverage matrix UNCHANGED at 10/4/33** — substrate evidence depth growth on already-covered CC6.1 + CC6.6 via 11 new aws-ses-auditor mapping rules. The 0.5.0 bump (vs the natural 0.4.10) is an institutional milestone marker — first non-0.4.x release in the 0.4.5–0.5.0 trio-publish series + first ship to add NETWORK-LAYER cross-reference.

**Recommended install path:** `npm install nsauditor-ai-agent-skill@0.1.16` (for AI-coding-agent users; pair with `npm install -g nsauditor-ai@0.1.49 @nsasoft/nsauditor-ai-ee@0.5.0`).

---

## 0.1.15 — Catalog refresh: plugin 1180 AWS ElastiCache Redis Auditor v2 extension (kms:DescribeKey promotion + subnet route-table verifier; closes both v1 deferred items) — EE 0.4.9; plugin count UNCHANGED at 20

**Trio-publish institutionalization continued.** Paired with EE 0.4.9 + CE 0.1.48 — **fifth consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5/0.4.6/0.4.7/0.4.8). The 0.1.15 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin extension.

### What changed

- **`references/plugins.md`** — **plugin 1180 row** updated v1 → v2: dim 2 at-rest+KMS now includes kms:DescribeKey cross-reference promotion (mirrors plugin 1140 v2 pattern: UNVERIFIABLE `:key/UUID` → PASS/MEDIUM via KeyMetadata.KeyManager); dim 6 subnet placement now includes ec2:DescribeRouteTables verifier (HIGH on IGW-routed subnets with per-subnet `igwDestinationsBySubnet` evidence; PASS on all-verified-private; LOW + evidenceGap on main-RT-inheritance per R-MEDIUM-2 false-NEGATIVE closure; LOW + evidenceGap on AccessDenied). Cross-plugin sister of plugin 1170 SG perimeter (layer-3 subnet→IGW vs layer-4 SG ingress). Per-resource caching (kmsKeyManagerCache + subnetGroupCache + subnetSetRoutingCache).
- **`SKILL.md`** — plugin 1180 v2 narrative added to enumeration; "post-EE 0.4.8" → "post-EE 0.4.9". EE plugin count UNCHANGED at 20 (no new plugin in 0.4.9; existing plugin 1180 grew in scope).
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40`.

### EE 0.4.9 paired-release context

- **EE plugin count UNCHANGED at 20** — seventh-ship-cycle in the 0.4.x stream is another single-plugin EXTENSION (third extension cycle after EE-RT.16 v2 in 0.4.6 + EE-RT.14 v3 in 0.4.8). Plugin 1180 v2 closes **both** v1 deferred items (R-MEDIUM-3 KMS-DescribeKey promotion + R-LOW-2 subnet route-table cross-reference).
- **Part A — kms:DescribeKey cross-reference promotion** (dim 2 at-rest encryption; mirrors plugin 1140 v2 pattern). UNVERIFIABLE `:key/UUID` ARN shapes promoted via `KeyMetadata.KeyManager` to deterministic PASS (CUSTOMER) / MEDIUM (AWS). Conservative on AccessDenied / NotFound / unknown KeyManager.
- **Part B — Subnet route-table verifier** (dim 6 subnet placement; closes v1 R-LOW-2). `elasticache:DescribeCacheSubnetGroups` + `ec2:DescribeRouteTables` walk. Per-subnet IGW-route detection via `/^igw-[a-f0-9]+$/i` (correctly excludes egress-only `eigw-`). HIGH on IGW-routed subnet(s) (with per-subnet `igwDestinationsBySubnet` evidence per R-HIGH-1 fold) / PASS on all-verified-private / **LOW + evidenceGap on main-RT-inheritance per R-MEDIUM-2 reviewer-fold false-NEGATIVE closure** (default-VPC main-RT typically routes `0.0.0.0/0 → igw-*`).
- **7 same-session reviewer folds across the cycle** (independent `general-purpose-agent` review yielded 12 findings; 7 folded same-session, 1 deferred to cross-plugin Thread H sweep, 4 withdrawn after verification).
- **No new SDK dependencies** — `@aws-sdk/client-kms` + `@aws-sdk/client-ec2` already declared in optionalDependencies since EE 0.4.5.
- **Real-AWS smoke validation END-TO-END**: smoke against `<operator-test-account>` (no fixture changes needed). `redis-leaky-cache` → dim 6 LOW `elasticache-subnet-main-rt-inheritance` (the R-MEDIUM-2 fold escalation demonstrably firing against the real default-VPC main-RT-inheritance pattern); `findingsBySeverity: { pass:1, medium:3, high:5, low:2, info:1 }`; durationMs=1428. KMS promotion path NOT exercised against real AWS (existing fixtures use alias-form CMK keys; unit tests + plugin 1140 v2 real-AWS validation cover the promotion path).
- **EE full regression: 4696/4696** (was 4642 at EE 0.4.8 publish; +54 tests). 45-session 100% green streak preserved.
- **Coverage matrix UNCHANGED at 10/4/33** — substrate evidence depth growth on already-covered CC6.6 + C1.1 via 5 new aws-elasticache-redis-auditor mapping rules.

**Recommended install path:** `npm install nsauditor-ai-agent-skill@0.1.15` (for AI-coding-agent users; pair with `npm install -g nsauditor-ai@0.1.48 @nsasoft/nsauditor-ai-ee@0.4.9`).

---

## 0.1.14 — Catalog refresh: plugin 1140 AWS RDS Auditor v3 extension (7 → 10 dimensions; +database audit-logging) — EE 0.4.8; plugin count UNCHANGED at 20

**Trio-publish institutionalization continued.** Paired with EE 0.4.8 + CE 0.1.47 — **fourth consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5 institutionalized the pattern, 0.4.6 confirmed it as institutional discipline, 0.4.7 ratified the cadence). The 0.1.14 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin extension.

### What changed

- **`references/plugins.md`** — **plugin 1140 row** updated to reflect v3 extension (7 → 10 dimensions; +database audit-logging triad: pgAudit / CloudWatch Logs exports / CloudWatch Logs retention; aurora-aware log-path detection per R-HIGH-1 reviewer-fold). Notes the false-PASS closure on `rds-pgaudit-misconfigured` (Postgres silently ignores pgaudit.log when shared_preload_libraries omits pgaudit per R-MEDIUM-2 reviewer-fold). Engine-dispatched essential/optional CloudWatch log type policy via `_RDS_ENGINE_CWL_NAMES` covering mysql/mariadb/aurora-mysql/postgres/aurora-postgresql/oracle-*/sqlserver-* variants.
- **`SKILL.md`** — plugin 1140 v3 enumeration line updated with v3 narrative; "post-EE 0.4.7" → "post-EE 0.4.8". EE plugin count UNCHANGED at 20 (no new plugin in 0.4.8; existing plugin 1140 grew in scope).
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40` (EE 0.4.0-cohort paired-release floor).

### EE 0.4.8 paired-release context

- **EE plugin count UNCHANGED at 20** — sixth-ship-cycle in the 0.4.x stream is a single-plugin EXTENSION rather than NEW plugin. Plugin 1140 `aws-rds-auditor` grew from 7 → 10 dimensions via **EE-RT.14 v3** — first 0.4.x extension cycle of an existing plugin since EE-RT.16 v2 (plugin 1170 RESTRICTED_PORTS extension in 0.4.6).
- Closes the "database activity logs" SOC 2 dimension per `tasks/things-to-check.md` §4 audit-canonical checklist (CC7.2 + CC7.3 continuous monitoring + event evaluation).
- **9 same-session reviewer folds across the cycle** (independent `general-purpose-agent` review yielded 12 findings; 9 folded same-session, 3 deferred to v3.1 / cross-plugin sweep).
- **HIGH-1 closure** — Aurora cluster log-path detection (pre-fold whole Aurora fleet returned false-INFO MEDIUM on dim 10 because helper hard-coded `/aws/rds/instance/<id>/` even for aurora-* engines that publish to `/aws/rds/cluster/<DBClusterIdentifier>/`).
- **MEDIUM-2 closure** — pgAudit + shared_preload_libraries cross-check (Postgres silently ignores `pgaudit.log` when SPL omits pgaudit = false-PASS class).
- **MEDIUM-3/4/5 closures** — cwl-opt-out + retentionDistribution + non-AccessDenied transient errors all surfaced as distinct categories for auditor evidence-pack legibility.
- **Real-AWS smoke validation END-TO-END**: in-place modification of `rds-compliant-cluster` fixture (cost $0; brief Multi-AZ failover during apply-immediately reboot) validated ALL 3 v3 PASS-path classifiers; unmodified `rds-violator-db` validated HIGH path. **First 0.4.x extension cycle to validate BOTH PASS-path AND HIGH-path classifiers** against real AWS in the same smoke run.
- **EE full regression: 4642/4642** (was 4574 at EE 0.4.7 publish; +68 tests). 44-session 100% green streak preserved.
- **Coverage matrix UNCHANGED at 10/4/33** — substrate evidence depth growth on already-covered CC7.2 + CC7.3 via 7 new aws-rds-auditor mapping rules.

**Recommended install path:** `npm install nsauditor-ai-agent-skill@0.1.14` (for AI-coding-agent users; pair with `npm install -g nsauditor-ai@0.1.47 @nsasoft/nsauditor-ai-ee@0.4.8`).

---

## 0.1.13 — Catalog refresh: EE plugin count 19 → 20 (plugin 1190 AWS SES Email Integrity Auditor — NEW EE 0.4.7; first plugin in the 1190-1199 ID range)

**Trio-publish institutionalization continued.** Paired with EE 0.4.7 + CE 0.1.46 — **third consecutive trio-publish across EE + CE + agent-skill in a single session** (after 0.4.5 institutionalized the pattern and 0.4.6 confirmed it as institutional discipline). The 0.1.13 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin growth.

### What changed

- **`references/plugins.md`** — added **plugin 1190 row** (AWS SES Email Integrity Auditor; 6 dimensions: DKIM enablement + signing status / custom MailFrom domain alignment / configuration set TLS enforcement / identity sending authorization policy permissive principals / dedicated IP pool sending posture / suppression list state; CC6.1 / CC6.6 / C1.1 / CC7.1-substrate / Privacy-substrate). Notes the **multi-class wildcard detector** (bare `"*"` / `{AWS:*}` / `{Service:*}` / `{Federated:*}` / `{CanonicalUser:*}` / array forms per R-HIGH-4 reviewer-fold) + **distinct HIGH `ses-sending-auth-notprincipal-allow` category** per R-CRITICAL-1 reviewer-fold catching the NotPrincipal+Effect=Allow wildcard-EQUIVALENT class (matches plugins 1070 + 1150 NotPrincipal+Allow discipline) + **LOW + evidenceGap `ses-sending-auth-malformed-statement`** per R-HIGH-2 reviewer-fold for Effect-missing send-action statements + **ZDE invariant** at run() envelope boundary (NEVER reads suppressed-destination email addresses).
- **`SKILL.md`** — added plugin 1190 to the EE plugin enumeration; updated "post-EE 0.4.6" → "post-EE 0.4.7"; bumped EE plugin count 19 → 20 and ID range 1020-1180 → 1020-1190 in the Editions table.
- **`README.md`** — bumped EE plugin count 19 → 20 and ID range 1020-1180 → 1020-1190 in the Editions table.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40` (EE 0.4.0-cohort paired-release floor).

### EE 0.4.7 paired-release context

- **EE plugin count: 19 → 20** — fifth plugin-count growth in the 0.4.x cycle. NEW plugin **1190 AWS SES Email Integrity Auditor** (EE-RT.18 v1) covers 6 SOC 2 evidence dimensions spanning confidentiality + email-integrity. Closes the next-highest-priority gap from `tasks/things-to-check.md` AWS SOC 2 audit-canonical compliance checklist after Redis closed in 0.4.6. Dual API surface discipline: v1 uses SESv2 only (canonical modern API surface covers all 6 dimensions); `@aws-sdk/client-ses` declared in optionalDependencies for v2+ cross-API parity.
- **11 same-session reviewer folds across the cycle** — **ties the single-cycle reviewer-fold record** for security-classifier-correctness-surface plugins (independent `general-purpose-agent` review yielded 12 findings; 11 folded same-session, 1 deferred to cross-plugin Thread H sweep).
- **CRITICAL-1 closure** — NotPrincipal+Effect=Allow distinct HIGH category (pre-fold silently classified as bounded = false-CLEAN class).
- **HIGH-4 closure** — `_isWildcardPrincipal` walks every Principal class value (pre-fold only `principal.AWS` was inspected, leaking `{Service:"*"}` + `{Federated:"*"}` as silent CLEAN).
- **HIGH-2 closure** — missing-Effect on send-action statement now surfaces LOW + evidenceGap `ses-sending-auth-malformed-statement` (was silent-dropped pre-fold).
- **Fourth EE plugin to ship without smoke-time SDK hotfix** — preemptive `@aws-sdk/client-ses` + `@aws-sdk/client-sesv2` addition.
- **EE full regression: 4574/4574** (was 4458 at EE 0.4.6 publish; +116 tests across the cycle: 94 EE-RT.18 v1 unit-test suite + 22 reviewer-fold pin tests). 43-session 100% green streak preserved.
- **Coverage matrix UNCHANGED at 10/4/33** — substrate-evidence depth growth on already-covered CC6.1 / CC6.6 / C1.1 via 8 new aws-ses-auditor mapping rules.
- **No real-AWS smoke against violation-tier fixtures** — operator's internal test infrastructure has NO SES paired fixtures yet (full-stack fixtures deferred to EE-RT.18 v2 alongside DKIM CNAME DNS resolution + DMARC TXT record parsing). Empty-account smoke baseline against <operator-test-account> DID succeed end-to-end (plugin loads via CE→EE binding, all 4 SESv2 API enumerations succeed, baseline 2 INFO findings emit correctly, durationMs=842, ZDE invariant preserved).
- **Memory tag closures:** `aws_string_case_normalization` at **20×** with explicit SPLIT-SURFACE callout (DKIM/Tls/MailFromStatus enums upcased / IAM Action/Effect lowercased); `conservative_classifier_principle` reinforced in 5 new fold sites; `emit_literal_set_drift` extended with `_DKIM_STATUS_VALID` + `_MAILFROM_STATUS_SUCCESS` + `_TLS_POLICY_VALID` named-constant discipline.

**Recommended install path:** `npm install nsauditor-ai-agent-skill@0.1.13` (for AI-coding-agent users; pair with `npm install -g nsauditor-ai@0.1.46 @nsasoft/nsauditor-ai-ee@0.4.7`).

---

## 0.1.12 — Catalog refresh: EE plugin count 18 → 19 (plugin 1180 AWS ElastiCache Redis Auditor; plugin 1170 v2 RESTRICTED_PORTS 13 → 23 ports per CIS AWS Foundations v3.0)

**Trio-publish institutionalization.** Paired with EE 0.4.6 + CE 0.1.45 — second trio-publish across EE + CE + agent-skill in a single session, institutionalizing the pattern that started with the 0.4.5 cycle (closing 14 months of stale catalog drift). The 0.1.12 refresh keeps the AI-coding-agent knowledge surface current with the latest EE plugin growth.

### What changed

- **`references/plugins.md`** — added **plugin 1180 row** (AWS ElastiCache Redis Auditor; 6 dimensions: transit + at-rest+KMS / AUTH / Multi-AZ / SnapshotRetention / subnet; CC6.1 / CC6.2 / CC6.6 / A1.2 / C1.1). Updated plugin **1170 row** to reflect v2 RESTRICTED_PORTS extension (13 → 23 ports per CIS AWS Foundations v3.0; adds Redshift, K8s API, etcd, Kibana, InfluxDB, Kafka, Consul, ZooKeeper, Vault) + new `opts.additionalRestrictedPorts` operator-config knob + per-SG cardinality cap + system-managed-SG name-prefix exclusion list.
- **`SKILL.md`** — added plugin 1180 to the EE plugin enumeration; updated "post-EE 0.4.5" → "post-EE 0.4.6"; bumped EE plugin count 18 → 19 and ID range 1020-1170 → 1020-1180 in the Editions table.
- **`README.md`** — bumped EE plugin count 18 → 19 and ID range 1020-1170 → 1020-1180 in the Editions table.
- **`peerDependencies`** floor: unchanged at `nsauditor-ai >=0.1.40` (EE 0.4.0-cohort paired-release floor).

### EE 0.4.6 paired-release context

- **EE plugin count: 18 → 19** — fourth plugin-count growth in the 0.4.x cycle. NEW plugin **1180 AWS ElastiCache Redis Auditor** (EE-RT.17 v1) covers 6 SOC 2 substrate-evidence dimensions spanning confidentiality + availability + segmentation. Dual API enumeration (DescribeReplicationGroups + DescribeCacheClusters) with inter-API dedup; Memcached out-of-scope by design.
- **Plus EE-RT.16 v2** — plugin 1170 RESTRICTED_PORTS grown 13 → 23 ports per CIS AWS Foundations v3.0 + operator-config + per-SG cardinality cap with rollup trailer + system-managed-SG name-prefix exclusion list.
- **10 same-session reviewer folds across the cycle** (7 EE-RT.16 v2 incl. 2 CONVERGENT-CRITICAL findings + 3 EE-RT.17 v1) — most-folds-in-a-single-cycle for 0.4.x to date.
- **Third EE plugin to ship without smoke-time SDK hotfix** — preemptive `@aws-sdk/client-elasticache` addition.
- **EE full regression: 4458/4458** (was 4361 at EE 0.4.5 publish; +97 tests). 42-session 100% green streak preserved.
- **Coverage matrix UNCHANGED at 10/4/33** — substrate-evidence depth growth on already-covered CC6.1 / CC6.2 / CC6.6 / A1.2 / C1.1.

**Recommended install path:** `npm install nsauditor-ai-agent-skill@0.1.12` (for AI-coding-agent users; pair with `npm install -g nsauditor-ai@0.1.45 @nsasoft/nsauditor-ai-ee@0.4.6`).

---

## 0.1.11 — Catalog refresh: EE plugin count 4 → 18; ID-range renumbered 020s → 1020s; SOC 2 evidence taxonomy added

**Major catalog overhaul.** The agent-skill was last published in April 2024 (version 0.1.10) and had not tracked the EE 0.3.x / 0.4.x evolution. This release brings the Enterprise plugin catalog current to **EE 0.4.5** (paired with CE 0.1.44).

### What changed

- **EE plugin count: 4 → 18.** Added 14 new Enterprise plugins to `references/plugins.md`: 1030 IAM Deep Auditor, 1040 CloudTrail Operational Integrity, 1050 API Gateway Assurance, 1060 DynamoDB Audit Integrity, 1070 KMS Auditor, 1080 Lambda Security Auditor, 1090 Secrets Manager + SSM Parameter Store, 1100 CodePipeline + CodeBuild, 1110 IAM Effective Decrypt-Path, 1120 S3 Lifecycle + Cross-Region Replication, 1130 Backup Auditor (headline 12-dimension air-gapped vault attestation arc), 1140 RDS Auditor v2 (7 dims + kms:DescribeKey cross-reference), 1150 SQS/SNS Auditor, 1170 EC2 SG Perimeter Auditor.
- **EE plugin IDs renumbered 020s → 1020s.** All EE plugins moved to the disjoint 1000+ ID range at EE 0.3.9 (2026-05-12) to avoid CE collision. Previously the agent-skill advertised plugin `020 AWS Cloud Scanner` which AI coding agents would have suggested for users to run — but that ID no longer exists in EE. The corrected ID is `1020`.
- **SOC 2 substrate-evidence taxonomy added.** Every Enterprise plugin row now lists the SOC 2 Trust Services Criteria controls it produces evidence under. Aggregate coverage: 10 covered controls (CC6.1 / CC6.2 / CC6.6 / CC6.7 / CC6.8 / CC7.1 / CC7.2 / CC7.3 / C1.1 / C1.2) + 4 partial (CC6.3 / CC8.1 / A1.2 / PI1.5) + 33 OOS for static substrate scanning. Coverage matrix is institutionally honest: substrate-evidence depth grows release-over-release without the matrix being shifted (matrix-shift requires net-new control coverage, not just deeper evidence on already-covered controls).
- **`SKILL.md` plugin summary updated:** "44+ Scanners" (was "27+"). Enterprise (18) line lists all plugins by ID. Editions table updated with accurate edition-feature deltas.
- **`README.md` updated:** plugin awareness "44+ scanner plugins (23 CE + 3 Pro + 18 Enterprise)" (was "30+"). Editions table now reflects correct per-edition feature deltas.
- **`peerDependencies` floor bumped:** `nsauditor-ai >=0.1.10` → `>=0.1.40`. CE 0.1.40 (published 2026-05-13) is the EE 0.4.0-cohort paired-release floor — the EE plugin ID range only makes sense against CE 0.1.40+.
- **CHANGELOG.md added** to track future release history; included in `files` array.

### What did NOT change

- **CE Pro plugin section (040 / 050 / 060) is still accurate.** The 040 TLS Certificate & Cipher Auditor, 050 TRIBE v2 Probe, 060 DNS Security Auditor are CE-Pro-tier plugins (not EE) and did NOT move with the EE renumbering. The agent-skill's documentation of these is correct.
- **Core (17) + Discovery (6) plugin sections** — unchanged; no renumbering at CE side.
- **MCP tool surface, schemas, workflows** — unchanged; this release is a catalog refresh, not an MCP API change.

### Recommended pairing

`npm install nsauditor-ai-agent-skill@0.1.11 nsauditor-ai@0.1.44` (CE pairing).

For Enterprise users running EE plugins: pair `nsauditor-ai@0.1.44` + `@nsasoft/nsauditor-ai-ee@0.4.5`.

---

## 0.1.10 — Initial release (April 2024)

First publication. Established the SKILL.md / references/ / examples/ structure. Documented:

- 17 Core + 6 Discovery scanners (CE-tier).
- 3 Pro plugins (040 TLS / 050 TRIBE / 060 DNS).
- 4 Enterprise plugins by pre-renumber IDs (020 AWS / 021 GCP / 022 Azure / 023 Zero Trust).
- MCP tool reference for `scan_host` / `list_plugins` / `probe_service` / `get_vulnerabilities`.
- Multi-step workflow recipes.

**Note:** the EE plugin IDs documented in 0.1.10 (020/021/022/023) were renumbered to 1020/1021/1022/1023 at EE 0.3.9 (2026-05-12). Refresh to 0.1.11+ for the corrected catalog.
