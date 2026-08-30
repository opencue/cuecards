---
name: nsauditor-ai
description: >
  Use this skill whenever the user wants to perform network security scanning, auditing,
  vulnerability assessment, or host reconnaissance using NSAuditor AI. Triggers include:
  any mention of 'scan', 'audit', 'vulnerability', 'CVE', 'network security', 'port scan',
  'service detection', 'OS fingerprinting', 'security assessment', 'penetration test',
  'probe', 'MITRE ATT&CK', 'CPE', 'NVD', 'TLS audit', 'cipher check', 'banner grab',
  'SNMP', 'NetBIOS', 'SMB', 'DNS security', 'DKIM', 'SPF', 'DMARC', 'DNSSEC',
  'certificate audit', 'SARIF', 'CTEM', 'continuous monitoring', 'host discovery',
  'mDNS', 'UPnP', 'SSDP', 'ARP scan', 'subnet scan', or references to NSAuditor,
  nsauditor-ai, or the nsauditor MCP server. Also triggers when the user asks to check
  if a host is up, enumerate services, detect TLS versions, find open ports, look up
  CVEs for a software version, audit DNS records, check certificate expiry, or perform
  continuous security monitoring. Use this skill even if the user doesn't explicitly say
  "NSAuditor" — if they want network security scanning and the nsauditor-ai MCP tools
  are available, this is the skill to use. Do NOT use for general coding tasks, web
  development, or non-security topics.
---

# NSAuditor AI — Agent Skill

> **Version:** 0.1.10 · **Source:** [github.com/nsasoft/nsauditor-ai](https://github.com/nsasoft/nsauditor-ai) · **npm:** `nsauditor-ai` · **License:** MIT (CE)

NSAuditor AI is a modular, AI-assisted network security audit platform with 27+ scanner
plugins, CVE matching, MITRE ATT&CK mapping, and Zero Data Exfiltration by design. This
skill teaches you how to operate it via MCP tools and CLI.

---

## MCP Tools Reference

NSAuditor AI exposes tools via Model Context Protocol (stdio transport). Available tools
depend on the license tier (Community / Pro / Enterprise).

### Community Edition Tools (always available)

#### `scan_host`
Run a full plugin scan against a target host. Executes ALL enabled plugins in priority
order (discovery → service probes → OS detection → result fusion).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `host` | string | ✅ | — | Target hostname or IP address |
| `timeout` | number | ❌ | 30000 | Per-plugin timeout in ms |

**Returns:** `{ summary, host, services[], findings[] }` — see `references/schemas.md`

**Example:**
```json
{ "host": "192.168.1.1", "timeout": 10000 }
```

**Important:**
- For RFC 1918 / private IPs, the MCP server must have `NSA_ALLOW_ALL_HOSTS=1` set.
- The server blocks loopback (127.x, ::1), link-local (169.254.x, fe80:), and cloud
  metadata endpoints (169.254.169.254) — this is SSRF protection, not a bug.
- Plugins with unmet requirements auto-skip (e.g., SSH scanner skips if port 22 is closed).

---

#### `list_plugins`
List all available scanner plugins with metadata.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | — | — | — |

**Returns:** Array of `{ id, name, description, priority, protocols[], ports[], requirements }`

**When to use:** Before a scan to understand available plugins, or to help the user select
specific plugins for a targeted probe.

---

#### `probe_service` *(Pro license required)*
Run a single plugin against a specific host:port for deep-dive investigation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `host` | string | ✅ | Target hostname or IP |
| `pluginName` | string | ✅ | Plugin name or numeric ID (e.g. `"ssh_scanner"` or `"002"`) |
| `port` | number | ✅ | Target port number |

**Returns:** Raw plugin output with full evidence for that specific service.

**Common plugin IDs:**
| ID | Name | Best For |
|----|------|----------|
| 002 | SSH Scanner | Banner, version, weak algorithms/ciphers |
| 004 | FTP Banner | FTP daemon identification, anonymous login |
| 006 | HTTP Probe | Server headers, tokens, vendor hints |
| 007 | SNMP Scanner | Device info via sysDescr, hardware/firmware |
| 009 | DNS Scanner | DNS server version (CHAOS query) |
| 010 | Webapp Detector | Technology stack fingerprinting (Wappalyzer) |
| 011 | TLS Scanner | TLS versions, cipher suites, deprecation |
| 014 | NetBIOS Scanner | SMB/NetBIOS enumeration, null sessions |
| 040 | TLS Cert & Cipher Auditor | Certificate chain, expiry, weak ciphers *(Pro)* |
| 050 | TRIBE v2 Probe | Debug leaks, stack traces, CORS misconfig *(Pro)* |
| 060 | DNS Security Auditor | SPF/DKIM/DMARC, DNSSEC, zone transfer *(Pro)* |

---

#### `get_vulnerabilities` *(Pro license required)*
Look up known CVEs for a CPE string via the NVD 2.0 API.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cpe` | string | ✅ | CPE 2.3 format (see CPE guide below) |
| `maxResults` | number | ❌ | Max CVE results to return |

**Returns:** `{ cpe, totalResults, vulnerabilities[] }` — each CVE includes ID, description,
CVSS v3.1 score, severity, vector string, publication date.

**CPE Construction Guide:**

Format: `cpe:2.3:a:<vendor>:<product>:<version>:*:*:*:*:*:*:*`

| Detected Program | Detected Version | CPE String |
|------------------|------------------|------------|
| OpenSSH | 8.9p1 | `cpe:2.3:a:openbsd:openssh:8.9p1:*:*:*:*:*:*:*` |
| Apache httpd | 2.4.54 | `cpe:2.3:a:apache:http_server:2.4.54:*:*:*:*:*:*:*` |
| nginx | 1.24.0 | `cpe:2.3:a:f5:nginx:1.24.0:*:*:*:*:*:*:*` |
| OpenSSL | 3.0.8 | `cpe:2.3:a:openssl:openssl:3.0.8:*:*:*:*:*:*:*` |
| ISC BIND | 9.18.12 | `cpe:2.3:a:isc:bind:9.18.12:*:*:*:*:*:*:*` |
| vsftpd | 3.0.5 | `cpe:2.3:a:beasts:vsftpd:3.0.5:*:*:*:*:*:*:*` |
| Samba | 4.17.5 | `cpe:2.3:a:samba:samba:4.17.5:*:*:*:*:*:*:*` |
| Log4j | 2.14.1 | `cpe:2.3:a:apache:log4j:2.14.1:*:*:*:*:*:*:*` |
| MySQL | 8.0.32 | `cpe:2.3:a:oracle:mysql:8.0.32:*:*:*:*:*:*:*` |
| PostgreSQL | 15.2 | `cpe:2.3:a:postgresql:postgresql:15.2:*:*:*:*:*:*:*` |

**Tip:** If vendor is ambiguous, search NVD with just the product name first.

---

### Pro/Enterprise Tools (license gated)

These tools return a license upgrade prompt on CE installations:

| Tool | Tier | Purpose |
|------|------|---------|
| `risk_summary` | Pro | Prioritized risk overview with severity breakdown |
| `scan_compare` | Pro | Diff two scan results with risk-weighted delta analysis |
| `save_finding` | Pro | Persist a validated finding to the finding queue |
| `start_assessment` | Enterprise | Multi-host orchestrated security assessment |
| `prioritize_risks` | Enterprise | Cross-host risk prioritization and ranking |
| `compliance_check` | Enterprise | SOC 2 (AICPA TSC 2017) + HIPAA (§164.312 Technical Safeguards) + NIST CSF 2.0 Core + PCI DSS v4.0.1 (sub-requirement-level for QSA RoC; PCI SSC June 2024 errata) + **ISO/IEC 27001:2022** (per-Annex-A-code-level for ISO/IEC 17021-1 certification body assessors; ISO + IEC October 2022; 2013 edition retired October 31, 2025) gap analysis — all five shipped (SOC 2 EE 0.3.x; HIPAA EE 0.9.0; NIST CSF 2.0 EE 0.10.0; PCI DSS v4.0.1 EE 0.11.0; **ISO/IEC 27001:2022 EE 0.12.0**). CIS Controls v8 planned. Multi-framework via `--compliance soc2,hipaa,nist-csf,pci-dss,iso-27001` (any CSV subset; penta-framework one-scan produces five complete auditor-ready evidence packs). ISO 27001 Annex A code examples: `A.5.15` Access control, `A.5.23` NEW 2022 Cloud services, `A.8.5` Secure authentication, `A.8.9` NEW 2022 Configuration management, `A.8.16` NEW 2022 Monitoring activities, `A.8.24` Use of cryptography. Statement of Applicability per Clause 6.1.3.d discipline + ISMS Clauses 4-10 OOS-by-design framing (7 Major Nonconformity classes — absence of internal audit per Clause 9.2 or management review per Clause 9.3 = auto-fail Stage 2) + 5-attribute taxonomy NEW in 2022 (controlType / informationSecurityProperties / cybersecurityConcepts [5 categories, NOT 6 like NIST CSF 2.0] / operationalCapabilities / securityDomains) + 2013-to-2022 transition discipline. Pair with ISO-aware GRC (Drata ISO 27001 / Vanta ISO 27001 / AuditBoard / OneTrust ISMS / Secureframe ISO 27001) for SoA workflow + internal audit + management review. PCI DSS sub-requirement examples: `Req 1.2.1` NSC config standards, `Req 8.4.1` MFA on non-console admin, `Req 10.2.1` audit logs enabled, `Req 11.3.1` quarterly internal vuln scans. Defined-vs-Customized Approach discipline per Appendix E (15 Defined-only sub-requirements enforced at schema layer; CHD Scope operator-attested via CDE DFD per Req 1.2.4; card-brand AOC enforcement view — Visa CISP / Mastercard SDP / Amex DSOP / Discover DISC). |
| `export_report` | Enterprise | Formatted compliance/risk report (PDF, HTML) |

---

## Five-Phase Pipeline Architecture

NSAuditor AI follows an institutional five-phase pipeline:

```
Phase 1: DISCOVERY (CE)        License → Plugin loading → PluginManager.run() → Concluder
                                Output: Fused scan with summary, OS, services[], evidence[]
                                        ↓
Phase 2: BASIC ANALYSIS (CE)   Redaction → MITRE mapping → AI analysis (any provider)
                                Output: Admin raw JSON/HTML + AI reports + scan history
                                        ↓
                                   [ License Gate: Pro required ]
                                        ↓
Phase 3: INTELLIGENCE (Pro)    CPE generation → NVD CVE lookup → Parallel verification agents:
                                  • Auth Agent (weak auth, default credentials)
                                  • Crypto Agent (TLS, ciphers, certificates)
                                  • Config Agent (misconfigs, debug exposure, CORS)
                                  • Service Agent (CVE-specific targeted probes)
                                Output: Structured finding queue
                                        ↓
Phase 4: VERIFICATION (Pro)    For each finding: run SAFE non-destructive verification probe
                                Classify: VERIFIED | POTENTIAL | FALSE_POSITIVE
                                Output: Verified finding queue with evidence
                                        ↓
Phase 5: SCORING (Pro/Ent)     Risk scoring → Pro AI prompts → Compliance mapping
                                Output: Risk report + compliance report + PDF
```

---

## Plugin Reference (44+ Scanners)

See `references/plugins.md` for the complete catalog. Summary:

**Core (17):** Ping, SSH, Port Scanner, FTP, Host Up, HTTP Probe, SNMP, Result Concluder,
DNS, Webapp Detector, TLS, OpenSearch, OS Detector, NetBIOS/SMB, SUN RPC, WS-Discovery,
TCP SYN (Nmap wrapper)

**Discovery (6):** ARP, mDNS/Bonjour, UPnP/SSDP, DNS-SD, LLMNR, DB Scanner

**Pro (3):** TLS Certificate & Cipher Auditor, TRIBE v2 Probe, DNS Security Auditor

**Enterprise (18):** AWS Cloud Scanner (1020), GCP Cloud Scanner (1021), Azure Cloud
Scanner (1022), Zero Trust Checker (1023), AWS IAM Deep Auditor (1030), AWS CloudTrail
Operational Integrity (1040), AWS API Gateway Assurance (1050), AWS DynamoDB Audit
Integrity (1060), AWS KMS Auditor (1070), AWS Lambda Security Auditor (1080), AWS
Secrets Manager + SSM Parameter Store Auditor (1090), AWS CodePipeline + CodeBuild
Operational Integrity (1100), AWS IAM Effective Decrypt-Path Auditor (1110), AWS S3
Lifecycle + Cross-Region Replication Auditor (1120), AWS Backup Auditor (1130), AWS
RDS Auditor (1140 v3 — extended in EE 0.4.8 with database audit-logging; 7→10 dims:
+pgAudit / +CloudWatch Logs exports / +CloudWatch Logs retention; aurora-aware
log-path detection per R-HIGH-1 reviewer-fold), AWS SQS/SNS Auditor (1150 v2 —
extended in EE 0.5.1: 5 → 7 dims with CloudWatch alarm coverage on SQS
ApproximateAgeOfOldestMessage + SNS NumberOfNotificationsFailed; closes 1 CRITICAL
false-CLEAN class on empty-AlarmActions silent-PASS per R-CRITICAL fold; first
plugin-1150 dim to cross an SDK boundary — SQS+SNS → CloudWatch), AWS EC2
SG Perimeter Auditor (1170 v2 — RESTRICTED_PORTS 23 ports per CIS AWS Foundations
v3.0), AWS VPC Endpoints / PrivateLink Auditor (1160 — NEW in EE 0.6.0; first plugin
to audit the PrivateLink isolation boundary; 4 dims: endpoint policy permissive
principals CC6.6, PrivateDNS enabled CC6.6, endpoint state A1.2+CC7.2, type substrate
Privacy+CC6.6), AWS ElastiCache Redis Auditor (1180 v2 — extended in EE 0.4.9:
kms:DescribeKey promotion + subnet route-table verifier; closes both v1 deferred items
R-MEDIUM-3 + R-LOW-2; main-RT-inheritance false-NEGATIVE closure per R-MEDIUM-2
reviewer-fold), AWS SES Email Integrity Auditor (1190 v3 — extended in EE 0.5.0 +
consolidated in EE 0.5.2 + v3 extension in EE 0.5.3: DKIM CNAME DNS resolution + DMARC
TXT record parser + SES classic API parity + deferred-items sweep + DKIM public-key
fingerprint capture/pin + in-band DMARC alignment classifier; closes 1 CRITICAL
false-CLEAN class on DMARC pct=0 per R-CRITICAL-1 fold + 1 HIGH false-NEGATIVE class
on DMARC sp subdomain-policy override per R-HIGH-1 fold + new MEDIUM
ses-dkim-dns-partial-with-transients per v2.1 R-MEDIUM-2 fold + silent-loss-class
closure on SES classic API quota exhaustion via cause: "classic-sdk-quota-exhausted"
per v2.1 R-HIGH-2 reviewer-fold; first plugin in EE to depend on node:dns/promises
for live DNS cross-reference), AWS Inspector2 / GuardDuty Enablement Auditor (1200 v6 —
NEW in EE 0.6.1, extended through EE 0.6.6; first AWS-managed-threat-detection
substrate audit; bundles two services per the plugin 1150 precedent.
**v4 EE 0.6.4 reviewer-cleanup cycle** (closes 3 of 4 R2-deferred items from
EE-RT.20.2): **R-HIGH-2 EventBridge target verification** — new `_listEventBridgeRuleTargets`
helper with defensive NextToken pagination; per-rule target verification via
`events:ListTargetsByRule` (cap default 10 via `opts.targetVerificationRuleCap`;
opt-out via `opts.skipEventBridgeTargetVerification`); new MEDIUM verdict
`*-alerting-destination-targetless` for sink-less rules (zero Targets — substrate-
without-sink at the rule level). **R-MEDIUM-2 multi-failedAccount surface** —
helper return-shape `{accountStatus, accessDenied, failedAccounts: array}`
(renamed plural; capped at AWS-documented 100); caller emits one LOW per failed
account with per-region emission cap 10 + rollup LOW. **R-LOW-2 trigger
uniformity** — GuardDuty alerting-destination trigger gates on `detector.Status
=== ENABLED` (matches Inspector2 enabled-only semantic). **5 v4 R1 folds**
(0 R-CRITICAL): R-HIGH-1 cap-skew classifier branch (LOW UNVERIFIABLE not
MEDIUM TARGETLESS when cap-exceeded rules could be the actual sink) +
R-HIGH consolidated `_listEventBridgeRuleTargets` pagination + JSDoc clarity +
R-MEDIUM-1 multi-failedAccount per-region emission cap (10 + rollup) +
R-MEDIUM-4 boundary tests + R-HIGH-2 dead-target documented-limitation note.
**v3 EE 0.6.3 alerting-destination dim preserved**: EventBridge rule on source
`aws.guardduty`/`aws.inspector2` OR SecurityHub product subscription (boundary-
anchored `_shArnMatchesProduct` helper + strict `/aws/inspector2` constant per
v3 R-CRITICAL-1); verdict tiers PASS / MEDIUM SH-only / MEDIUM TARGETLESS (v4
added) / HIGH missing / LOW UNVERIFIABLE; new SDK deps `@aws-sdk/client-eventbridge`
+ `@aws-sdk/client-securityhub`. **v2 EE 0.6.2 preserved**: multi-region via
ec2:DescribeRegions + GuardDuty FindingPublishingFrequency check + Inspector2
baseline expansion (+lambdaCode +codeRepository). Operator opts: `regions[]` /
`skipMultiRegion` / `regionListCap` / `gdFrequencyPassFrequency` /
`skipAlertingDestination` / `skipEventBridgeTargetVerification` /
`targetVerificationRuleCap` / `skipTargetLivenessProbe` / `deadTargetProbeTimeoutMs`.
**v5 EE 0.6.5 closes the 0.6.4 R-HIGH-2 documented limitation** via per-target
liveness probes for Lambda (`lambda:GetFunction` on full qualified ARN — alias/
version correctness verified server-side) + SNS (`sns:GetTopicAttributes`) +
SQS (`sqs:GetQueueUrl` + `GetQueueAttributes` — partition-aware via SDK URL
resolution; works on aws-cn / aws-us-gov / aws-iso). Companion-LOW emitted
alongside PASS when targets dead. Parallel probes via Promise.all + 2s default
timeout. One-retry on NotFound with 750ms backoff (eventual-consistency defense).
Case-insensitive NotFound matching per `[[aws_string_case_normalization]]`.
Sentinel observability — `targetVerificationReason` enum (AccessDenied /
SdkUnavailable / BeyondCap / SkippedByOpts) on rule shape. R-NIT
`SH_HUB_NOT_ENABLED_ERROR_NAMES` frozen Set. **v6 EE 0.6.6 closes the long
tail of unverifiable ARN shapes**: IAM role (`iam:GetRole` on path-stripped role
NAME; new SDK dep `@aws-sdk/client-iam`) + EventBridge API destination
(`events:DescribeApiDestination` reuses `_EventBridgeSdk`) + CloudWatch Logs
(`logs:DescribeLogGroups` with `logGroupNamePrefix` filter + exact-name
disambiguation guard so prefix-match siblings don't false-LIVE; new SDK dep
`@aws-sdk/client-cloudwatch-logs`). **Operator note (v6 R-MEDIUM-2)**:
`iam:GetRole` is a global API resolving per-partition; orchestrators wiring
`opts._iamClient` must construct a single global IAM client per-partition (NOT
per-region). **v6 R-MEDIUM-1 fold**: IAM `NoSuchEntityException` /
`NoSuchEntity` lifted into `_DEAD_TARGET_NOTFOUND_ERROR_NAMES` Set; bare
disjunction collapsed; eventual-consistency retry restored for IAM (the canonical
worst case — 9th cumulative recurrence of `[[emit_literal_set_drift]]` class).
**v6 R-LOW-2 fold**: API destination ARN regex future-proofed against alias-only
ARN shapes. **v6.1 EE 0.6.7 closes the Logs probe retry-on-empty parity**:
`_retryOnNotFound` accepts an optional retry-on-result predicate; CWL Logs probe
fires retry when the response carries no exact-name match (covers both empty
and prefix-only-sibling responses). **Restructured to two-phase to cap total
network calls at 2 on compound paths** — Phase 1 = initial call + thrown-
NotFound retry; Phase 2 = result-based retry; phases are mutually exclusive
(per-call-site outer catch routes a second-call thrown error). Existing call
sites (Lambda / SNS / SQS / IAM / EventBridge API destination) pass only two
args; default `retryOnResultPredicate = null` cleanly skips Phase 2. Dim 5
org-scope still deferred to a future cycle. Total folds across all cycles:
6 v1 + 4 v2 + 4 v3 (1 R-CRITICAL) + 5 v4 + 5 v5 + 4 v6 (0 R-CRITICAL) + 1 v6.1
(0 R-CRITICAL / 0 R-HIGH) = 29 R1 folds applied same-session.

**v5 also brings a cross-plugin contract change**: all 18 EE AWS plugins
(1020-1200) now thread `sessionToken` through their AWS-SDK credentials block,
unblocking AssumeRole-style auditor credentials uniformly across the catalog).
**EE plugin IDs use the disjoint 1000+ range** (per EE 0.3.9 renumbering) to avoid
CE collision. CE reserves 001-099.

**Plugin 1170 v3 (EE 0.6.6) SG→SG transitive chain reachability** — `aws-ec2-sg-perimeter-auditor` v3 extension. Pre-v3 each Security Group was audited in isolation; a SG with no direct public-CIDR ingress would emit the PASS-tier "no direct public-internet ingress CIDR rules" finding even if transitively reachable from the internet through a `UserIdGroupPairs` chain. v3 builds the SG-reference graph (`_buildSgReferenceGraph`), identifies public-CIDR roots (`_findPubliclyReachableSgs` — 0.0.0.0/0 / ::/0 ingress), and BFS-walks the graph (`_walkTransitiveReachability`) with cycle defense + depth cap (default 5, max 20) + per-target chain cap (default 10, max 100). 2-hop chains emit **HIGH**; 3+ hop chains emit **CRITICAL** (operator-blindness principle — deeper chains less likely to be noticed). Cross-VPC edges skipped (out-of-scope for v3 v1; INFO trailer). v3 v1 simplification: per-hop port-flow tracked but NOT intersected (`walkthroughRequired=true`). New operator opts: `skipTransitiveReachability` / `transitiveChainDepthCap` / `transitiveChainsPerTargetCap` / `transitiveChainSamplesPerFindingCap`. **v3 R-HIGH-1 fold**: BFS short-circuits enqueue past per-target cap (closes path-enumeration explosion on hub-and-spoke topologies — pre-fold the BFS kept cloning `path` and `visited` Sets and walking past the cap). **v3 R-LOW-2 fold**: depth-cap-hit surfaced separately from per-target-cap (closes silent-deep-truncation false-CLEAN class). 3 new soc2.json mappings under CC6.6 (transitive HIGH + CRITICAL + INFO truncation). **v3.1 EE 0.6.7 closes the edge-dedup R2-deferred item**: `_buildSgReferenceGraph` now dedupes edges by `(sourceGroupId, targetGroupId)` with `ports` aggregated as array of `{protocol, fromPort, toPort}`. Pre-fold a real-world ALB-fronting-app SG with 3 ingress perms on different ports (80/443/8080) referencing the same source SG emitted 3 distinct edges A→B; the BFS treated each as a separate chain, inflating `chainCount` 2-5× and exhausting per-target chain caps on noise. Post-fold the BFS sees exactly 1 chain per distinct (source, target) pair. `isCrossVpc` aggregation is AND-semantic — if ANY contributing pair is same-VPC, the merged edge is same-VPC (per `[[conservative_classifier_principle]]`: walk possibly-same-VPC chains rather than silently skip). Classifier port-render accepts both v3.1 array shape and v3 single-object shape (back-compat). **v3.1 R-MEDIUM-1 fold**: arrival-order independence locked with 2 regression fixtures + JSDoc tightening. **v3.1 R-LOW-1 fold**: partial-render contract on malformed port specs locked with 2 fixtures. **v3.1 R-LOW-2 fold**: `_portKeys` scratch-lifetime documented (MUST NOT escape).

**EE SOC 2 substrate-evidence coverage (post-EE 0.10.0):** 10 covered controls (CC6.1 /
CC6.2 / CC6.6 / CC6.7 / CC6.8 / CC7.1 / CC7.2 / CC7.3 / C1.1 / C1.2) + 4 partial
(CC6.3 / CC8.1 / A1.2 / PI1.5) + 33 OOS for static substrate scanning. **SOC 2 matrix
UNCHANGED post-EE 0.10.0 — the NIST CSF 2.0 cycle is additive-only; no SOC 2 mappings
changed. NIST CSF 2.0 introduced as third Track 3 framework with its own 13/10/83
matrix across 106 of CSF 2.0 Core's 107 Subcategories; Govern function OOS-by-design
with GV.SC-04 partial as substrate-evidence exception; Respond function OOS-entirely;
Implementation Tiers 1-4 OOS as organizational-maturity claim.**
Coverage matrix is institutionally honest: substrate-evidence depth grows release-over-release
without the matrix being shifted (the matrix-shift requires net-new control coverage, not just
more evidence on already-covered controls).

**EE HIPAA §164.312 Technical Safeguards substrate-evidence coverage (NEW EE 0.9.0):**
7 covered sub-criteria (§164.312(a)(1) Access Control, (a)(2)(i) Unique User ID,
(a)(2)(iv) Encryption-at-rest, (b) Audit Controls, (d) Person/Entity Auth, (e)(1)
Transmission Security, (e)(2)(ii) Transmission Encryption) + 3 partial (§164.312(c)(1)
Integrity — ransomware-defense substrate via Logically Air-Gapped Backup Vault
cross-verification, (c)(2) Mechanism to Authenticate ePHI, (e)(2)(i) Transmission
Integrity Controls) + 45 OOS (2 within-§164.312 + entire §164.308 Administrative
Safeguards [31 specs: workforce training, BAAs, contingency planning, etc.] + entire
§164.310 Physical Safeguards [12 specs: facility access, workstation security, device
disposal]). The §164.308 + §164.310 OOS sets are *architecturally* OOS for any
infrastructure scanner — pair with HIPAA-focused GRC platforms (Drata HIPAA, Vanta HIPAA,
Compliancy Group, Tugboat Logic) for those families. HHS Required vs Addressable
discipline surfaced per control. **Zero BAA required** — Zero Data Exfiltration
architecture means ePHI never leaves customer infrastructure. Use `--compliance hipaa`
or `--compliance soc2,hipaa` (CSV; wired since EE 0.3.0) for HIPAA-only or dual-framework
evidence packs from a single scan. 175 mappings inherited from soc2.json's grep-verified
pattern set with HIPAA-grounded rationales. New `data/compliance/hipaa.json`. New
`docs/hipaa-coverage.md`. **EE regression: 5890/5890 across 928 suites; 69-session
100% green streak preserved.** AWS-dogfood verified against operator's test account
(207 findings, per-framework citation map confirmed firing, ransomware-substrate
surfaces correctly).

Execution order: Discovery (100–150) → Service probes (200–400) → OS Detector (99000) →
Result Concluder (100000). Plugins with unmet requirements auto-skip.

---

## Workflow Recipes

See `references/workflows.md` for detailed multi-step patterns:

1. **Full Security Audit** — list_plugins → scan_host → get_vulnerabilities per service
2. **Targeted Service Investigation** — probe_service(pluginId) → get_vulnerabilities
3. **Subnet Discovery** — CLI: `nsauditor-ai scan --host <CIDR> --parallel 10`
4. **CI/CD Pipeline** — SARIF output with `--fail-on` severity gating
5. **Continuous Monitoring (CTEM)** — `--watch --interval <min> --webhook-url <url>`
6. **AI-Powered Report** — Scan with AI provider (OpenAI/Codex/Ollama) + redaction

### Decision Tree: Which Tool to Use

```
User wants to...
├── Scan a host comprehensively         → scan_host
├── Check a specific service/port       → probe_service (Pro)
├── Look up CVEs for software version   → get_vulnerabilities (Pro)
├── See available plugins               → list_plugins
├── Audit TLS certificates              → probe_service with plugin 040 (Pro)
├── Check DNS security (SPF/DKIM/DMARC) → probe_service with plugin 060 (Pro)
├── Detect debug leaks / CORS issues    → probe_service with plugin 050 (Pro)
├── Scan a subnet                       → CLI with --parallel (not MCP)
├── Set up continuous monitoring         → CLI with --watch (not MCP)
├── Compare two scans                   → scan_compare (Pro)
└── Generate compliance report          → compliance_check + export_report (Enterprise)
```

---

## Data Schemas

See `references/schemas.md` for complete structures:

- **Scan Result** — `{ summary, host{os,mac,vendor,names}, services[], findings[] }`
- **ServiceRecord** — `{ port, protocol, service, program, version, status, banner, evidence[] }`
- **Finding** — `{ id, category, severity, title, evidence, remediation, cwe, mitre_attack[] }`
- **CVE Response** — `{ cpe, totalResults, vulnerabilities[]{cve_id, cvss, severity} }`
- **Plugin Interface** — `{ id, name, priority, run(), conclude(), requirements }`
- **SARIF Output** — 2.1.0 format for CI/CD consumers

---

## Security Constraints

**CRITICAL — Always observe these constraints:**

1. **Zero Data Exfiltration (ZDE):** NSAuditor AI NEVER sends scan data externally unless
   the user explicitly opts in to AI analysis with their own API keys. Nsasoft infrastructure
   never sees scan data. Never suggest workflows that violate this boundary.

2. **SSRF Protection:** The MCP server blocks loopback (127.x, ::1), link-local (169.254.x,
   fe80:), and cloud metadata endpoints. Set `NSA_ALLOW_ALL_HOSTS=1` **only** for legitimate
   local network auditing. DNS rebinding is also blocked via pre-resolution.

3. **AI Redaction:** When AI analysis is enabled, the redaction pipeline scrubs:
   - Private IPv4 addresses → `[REDACTED]`
   - MAC addresses → `[MAC]`
   - Serial numbers → `[REDACTED_HIDDEN]`
   - Email addresses → `[REDACTED_EMAIL]`
   - Bearer tokens → `[REDACTED_BEARER]`
   - AWS keys → `[REDACTED_AWS_KEY]`
   - Configurable via `CONFIDENTIAL_KEYWORDS` env var

4. **Scan Authorization:** ALWAYS confirm the user has authorization to scan the target.
   Never scan hosts without explicit user instruction. Unauthorized scanning is illegal.

5. **Non-Destructive:** All verification probes are safe read-only queries. NSAuditor AI
   never exploits vulnerabilities or modifies target systems.

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `NSA_ALLOW_ALL_HOSTS` | unset | Set to `1` to scan RFC 1918 private ranges |
| `PLUGIN_TIMEOUT_MS` | 30000 | Global per-plugin timeout |
| `AI_ENABLED` | false | Enable AI analysis |
| `AI_PROVIDER` | openai | `openai` · `Codex` · `ollama` |
| `OPENAI_API_KEY` | — | OpenAI API key (or `keychain:OPENAI_API_KEY`) |
| `ANTHROPIC_API_KEY` | — | Codex/Anthropic API key |
| `OPENAI_MODEL` | gpt-4o-mini | OpenAI model name |
| `ANTHROPIC_MODEL` | Codex-sonnet-4-20250514 | Anthropic model name |
| `OPENAI_REDACT` | true | Redact PII before AI submission |
| `CONFIDENTIAL_KEYWORDS` | serial,password,token,secret | Comma-separated keys to scrub |
| `NSAUDITOR_LICENSE_KEY` | — | Pro/Enterprise JWT license key |
| `SCAN_OUT_PATH` | out/ | Output directory for scan results |
| `SMB_NULL_SESSION` | false | Allow SMB null session probe |
| `ENABLE_SYN_SCAN` | false | Enable Nmap TCP SYN scanning (requires root) |

### Plugin-Specific Timeouts

| Variable | Default | Plugin |
|----------|---------|--------|
| `TLS_SCANNER_TIMEOUT_MS` | 8000 | TLS Scanner |
| `HTTP_PROBE_TIMEOUT_MS` | 6000 | HTTP Probe |
| `WEBAPP_DETECTOR_TIMEOUT_MS` | 6000 | Webapp Detector |
| `DNS_TIMEOUT_MS` | 800 | DNS Scanner |
| `OPENSEARCH_SCANNER_TIMEOUT_MS` | 6000 | OpenSearch Scanner |

---

## Installation & Setup

```bash
# Install globally
npm install -g nsauditor-ai

# Start MCP server (stdio transport)
nsauditor-ai-mcp

# Or via npx (no global install)
npx nsauditor-ai-mcp
```

### Agent Integration

**Codex:**
```bash
Codex mcp add nsauditor-ai -- npx nsauditor-ai-mcp
```

**Codex Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "nsauditor-ai": {
      "command": "npx",
      "args": ["-y", "nsauditor-ai-mcp"],
      "env": {
        "NSA_ALLOW_ALL_HOSTS": "1",
        "PLUGIN_TIMEOUT_MS": "5000"
      }
    }
  }
}
```

**Cursor / Windsurf / VS Code:**
Add to your MCP configuration with the same command/args pattern.

---

## Editions & Licensing

| Edition | Price | Key Features |
|---------|-------|-------------|
| **Community** | Free / MIT | 27 plugins (service probes + host/network discovery + intelligence/meta), basic AI, CTEM, SARIF, scan history |
| **Pro** | $49/mo | + CVE matching, verification probes, risk scoring, Pro plugins (040 TLS / 050 TRIBE / 060 DNS) |
| **Enterprise** | $2k+/yr | + 22 cloud-substrate auditor plugins (1020-1200 range) covering AWS / GCP / Azure against SOC 2 (10 covered + 4 partial controls); Zero Trust; SOC 2 evidence-pack generation; RFC 3161 timestamps; chain-of-custody attestations; air-gapped deployment |

→ [Pricing](https://www.nsauditor.com/ai/pricing/)

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| SSRF block | Target is loopback/metadata/private | Set `NSA_ALLOW_ALL_HOSTS=1` for local scanning |
| License gate (`🔒`) | Pro/Enterprise tool on CE | Upgrade license or use CE alternative |
| Plugin timeout | Network unreachable / slow target | Increase `timeout` param or `PLUGIN_TIMEOUT_MS` |
| No DNS banner | Provider blocks CHAOS/TXT queries | Expected; not all DNS servers expose version |
| CPE format error | Malformed CPE string | Use `cpe:2.3:a:vendor:product:version:*:*:*:*:*:*:*` |
| No services found | Host down or heavily firewalled | Try `NSA_VERBOSE=true` to debug; check connectivity |
| AI analysis failed | Bad API key or provider down | Check `AI_PROVIDER` and API key env vars |

---

## MITRE ATT&CK Mapping

Findings are auto-tagged with MITRE techniques:

| Finding Type | Technique | ID |
|-------------|-----------|-----|
| SSH vulnerability | Remote Services: SSH | T1021.004 |
| SMB vulnerability | Remote Services: SMB | T1021.002 |
| FTP anonymous login | Valid Accounts | T1078 |
| DNS zone transfer | Gather Victim Network Info | T1590.002 |
| SNMP default community | Network Sniffing | T1040 |
| TLS weakness | Adversary-in-the-Middle | T1557 |
| Debug/stack trace exposure | Gather Victim Host Info | T1592 |
| Weak authentication | Brute Force | T1110 |

---

## Output Formats

| File | Format | Purpose |
|------|--------|---------|
| `scan_conclusion_raw.json` | JSON | Full unredacted scan data (admin) |
| `scan_conclusion_raw.html` | HTML | Admin dashboard with filters |
| `scan_response_ai_payload.json` | JSON | Redacted payload sent to AI |
| `scan_response_ai.html` | HTML | Styled report with CVE links, severity badges |
| `scan_response_ai.txt` | Markdown | AI vulnerability assessment (text) |
| SARIF | JSON | CI/CD integration (GitHub Advanced Security, Azure DevOps) |
| CSV | CSV | Tabular export of findings |
| JSONL | JSONL | Scan history for CTEM delta analysis |
