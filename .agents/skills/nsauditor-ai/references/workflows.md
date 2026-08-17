# NSAuditor AI — Workflow Recipes

Multi-step patterns for common security audit scenarios.

---

## 1. Full Security Audit

The most common workflow: comprehensive scan followed by vulnerability lookup.

```
Step 1: list_plugins()
        → Understand available scanners, confirm what will run

Step 2: scan_host({ host: "<target>" })
        → Returns fused results: summary, host{os}, services[], findings[]

Step 3: For each service with a detected program + version:
        → Construct CPE: cpe:2.3:a:<vendor>:<product>:<version>:*:*:*:*:*:*:*
        → get_vulnerabilities({ cpe: "<constructed_cpe>" })

Step 4: Correlate CVEs with scan findings
        → Present prioritized list: Critical → High → Medium → Low
        → Include remediation guidance for each finding
```

### CPE Construction Guide

Map detected program names to CPE vendor:product notation:

| Detected Program | Detected Version | CPE String |
|------------------|------------------|------------|
| OpenSSH | 8.9p1 | `cpe:2.3:a:openbsd:openssh:8.9p1:*:*:*:*:*:*:*` |
| Apache httpd | 2.4.54 | `cpe:2.3:a:apache:http_server:2.4.54:*:*:*:*:*:*:*` |
| nginx | 1.24.0 | `cpe:2.3:a:f5:nginx:1.24.0:*:*:*:*:*:*:*` |
| OpenSSL | 3.0.8 | `cpe:2.3:a:openssl:openssl:3.0.8:*:*:*:*:*:*:*` |
| ISC BIND | 9.18.12 | `cpe:2.3:a:isc:bind:9.18.12:*:*:*:*:*:*:*` |
| vsftpd | 3.0.5 | `cpe:2.3:a:beasts:vsftpd:3.0.5:*:*:*:*:*:*:*` |
| ProFTPD | 1.3.8 | `cpe:2.3:a:proftpd:proftpd:1.3.8:*:*:*:*:*:*:*` |
| Samba | 4.17.5 | `cpe:2.3:a:samba:samba:4.17.5:*:*:*:*:*:*:*` |
| MySQL | 8.0.32 | `cpe:2.3:a:oracle:mysql:8.0.32:*:*:*:*:*:*:*` |
| PostgreSQL | 15.2 | `cpe:2.3:a:postgresql:postgresql:15.2:*:*:*:*:*:*:*` |
| Redis | 7.0.8 | `cpe:2.3:a:redis:redis:7.0.8:*:*:*:*:*:*:*` |
| MongoDB | 6.0.4 | `cpe:2.3:a:mongodb:mongodb:6.0.4:*:*:*:*:*:*:*` |
| Elasticsearch | 8.7.0 | `cpe:2.3:a:elastic:elasticsearch:8.7.0:*:*:*:*:*:*:*` |
| Log4j | 2.14.1 | `cpe:2.3:a:apache:log4j:2.14.1:*:*:*:*:*:*:*` |

**Tips:**
- If vendor is ambiguous, try NVD search with just the product name first
- Use `a` (application) for software, `o` (OS) for operating systems, `h` (hardware) for devices
- Strip Debian/Ubuntu suffixes from versions (e.g., `8.9p1` not `8.9p1 Ubuntu-3ubuntu0.4`)

---

## 2. Targeted Service Investigation (Pro)

Deep-dive into a single service when you know the target port.

```
Step 1: probe_service({ host: "<target>", pluginName: "<id>", port: <port> })
        → Raw plugin output with full evidence

Step 2: From the probe result, extract program + version
        → get_vulnerabilities({ cpe: "<constructed_cpe>" })

Step 3: Analyze evidence for specific weaknesses:
        - SSH: weak algorithms (weakAlgorithms[]), weak ciphers (weakCiphers[])
        - TLS: deprecated protocols (weakProtocols[]), cipher strength
        - FTP: anonymous login (anonymousLogin)
        - SNMP: default community strings (community)
        - HTTP: dangerous methods (dangerousMethods[])
```

### Plugin Selection for Targeted Probes

| Plugin ID | Name | Best For |
|-----------|------|----------|
| 002 | SSH Scanner | SSH banner, version, key exchange, weak algorithms |
| 004 | FTP Banner | FTP daemon identification, anonymous login check |
| 006 | HTTP Probe | Web server headers, tokens, redirects |
| 007 | SNMP Scanner | Device info, hardware, firmware via SNMP |
| 009 | DNS Scanner | DNS server version (CHAOS query) |
| 010 | Webapp Detector | Technology stack fingerprinting |
| 011 | TLS Scanner | TLS versions, cipher suites |
| 012 | OpenSearch Scanner | Elasticsearch/OpenSearch detection |
| 014 | NetBIOS Scanner | SMB/NetBIOS enumeration |
| 015 | SUN RPC Scanner | NFS, portmapper services |
| 040 | TLS Cert & Cipher Auditor | Full certificate chain audit *(Pro)* |
| 050 | TRIBE v2 Probe | Debug leaks, CORS misconfig *(Pro)* |
| 060 | DNS Security Auditor | SPF/DKIM/DMARC, DNSSEC *(Pro)* |

---

## 3. Subnet Discovery

Map an entire network segment.

```bash
# CLI (recommended for subnet scanning):
nsauditor-ai scan --host 192.168.1.0/24 --plugins all --parallel 10

# Via MCP: iterate individual IPs (MCP doesn't support CIDR directly)
for each IP in range:
  scan_host({ host: "<ip>" })
```

**Note:** For large subnets, use the CLI with `--parallel` to limit concurrent scans
and avoid network congestion. The MCP server processes one scan at a time.

---

## 4. CI/CD Pipeline Integration

Gate deployments on security findings using SARIF output.

```bash
# Scan with SARIF output and severity gating
nsauditor-ai scan --host $TARGET \
  --plugins all \
  --output-format sarif \
  --fail-on high

# Exit codes:
#   0 = all clear (below threshold)
#   2 = findings at or above severity threshold
```

### GitHub Actions Example

```yaml
- name: Security Scan
  run: |
    npx nsauditor-ai scan --host ${{ env.TARGET_HOST }} \
      --output-format sarif \
      --fail-on high \
      > results.sarif

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

### SARIF Severity Mapping

| NSAuditor Severity | SARIF Level | Gate Behavior |
|-------------------|-------------|---------------|
| CRITICAL | error | Blocks on `--fail-on critical` and above |
| HIGH | error | Blocks on `--fail-on high` and above |
| MEDIUM | warning | Blocks on `--fail-on medium` and above |
| LOW | note | Blocks on `--fail-on low` and above |
| INFO | note | Never blocks |

---

## 5. Continuous Monitoring (CTEM)

Watch mode with delta detection and webhook alerts.

```bash
nsauditor-ai scan --host 192.168.1.0/24 --plugins all \
  --watch \
  --interval 15 \
  --webhook-url https://hooks.example.com/security \
  --alert-severity high
```

**Features:**
- Rescans on configurable interval (minutes)
- Delta detection: new services, removed services, version changes
- Fires JSON POST webhook on changes exceeding severity threshold
- Scan history stored in `.scan_history/` (JSONL format)
- CE: 7-day retention; Pro/Enterprise: configurable

**Webhook Payload:**

```json
{
  "event": "scan_delta",
  "timestamp": "2026-04-11T12:00:00Z",
  "host": "192.168.1.1",
  "changes": {
    "new_services": [{ "port": 8080, "service": "http" }],
    "removed_services": [],
    "changed_services": [{ "port": 22, "old_version": "8.9p1", "new_version": "9.6p1" }],
    "new_findings": [{ "severity": "HIGH", "title": "..." }]
  }
}
```

---

## 6. AI-Powered Vulnerability Report

Combine scan results with AI analysis using your own API keys.

### Local-Only Analysis (Ollama)

```bash
# Zero data leaves your machine
AI_ENABLED=true AI_PROVIDER=ollama OLLAMA_MODEL=llama3 \
  nsauditor-ai scan --host 192.168.1.1 --plugins all
```

### Cloud AI Analysis (OpenAI / Claude)

```bash
# Data is redacted before submission
AI_ENABLED=true AI_PROVIDER=openai OPENAI_API_KEY=sk-... OPENAI_REDACT=true \
  nsauditor-ai scan --host 192.168.1.1 --plugins all
```

### Output Files Generated

| File | Purpose |
|------|---------|
| `scan_conclusion_raw.json` | Full unredacted data (admin reference) |
| `scan_conclusion_raw.html` | Admin HTML dashboard with filters |
| `scan_response_ai_payload.json` | Redacted payload sent to AI |
| `scan_response_ai.html` | Styled HTML report with CVE links, severity badges |
| `scan_response_ai.txt` | AI vulnerability assessment in markdown |

### AI Prompt Modes

| Mode | Env Var | Behavior |
|------|---------|----------|
| `basic` | `OPENAI_PROMPT_MODE=basic` | Simple summary with next-action suggestions |
| `pro` | `OPENAI_PROMPT_MODE=pro` | Evidence-based analysis: Confirmed Vulns + Leads tables |
| `optimized` | `OPENAI_PROMPT_MODE=optimized` | Full reasoning framework with quality checks |

**Pro mode rules:**
- Only map CVEs when BOTH product AND version are in evidence
- Never speculate — quote exact banner lines as proof
- Preserve `[REDACTED_HIDDEN]` placeholders in output
- Treat Webapp Detector results as leads unless version confirmed

---

## 7. Comparing Scans (Pro)

Track security posture changes over time.

```
Step 1: scan_host({ host: "<target>" })  → baseline scan
Step 2: (time passes, changes made)
Step 3: scan_host({ host: "<target>" })  → follow-up scan
Step 4: scan_compare()                   → risk-weighted diff

Look for:
  - New services (unexpected exposure)
  - Removed services (decommissioning verified)
  - Version changes (patches applied or regressed)
  - New/resolved findings
```

---

## Decision Tree: Which Tool to Use

```
User wants to...
├── Scan a host comprehensively         → scan_host
├── Check a specific service/port       → probe_service (Pro)
├── Look up CVEs for software version   → get_vulnerabilities (Pro)
├── See available plugins               → list_plugins
├── Audit TLS certificates              → probe_service with plugin 040 (Pro)
├── Check DNS security (SPF/DKIM/DMARC) → probe_service with plugin 060 (Pro)
├── Detect debug leaks / CORS issues    → probe_service with plugin 050 (Pro)
├── Scan a subnet                       → CLI: --host CIDR --parallel N
├── Set up continuous monitoring         → CLI: --watch --interval N
├── Compare two scans                   → scan_compare (Pro)
├── Get risk overview                   → risk_summary (Pro)
├── Check compliance gaps               → compliance_check (Enterprise)
└── Generate formatted report           → export_report (Enterprise)
```

---

## Troubleshooting Workflows

### "scan_host returns no services"

1. Check host reachability: is the target online?
2. Is `NSA_ALLOW_ALL_HOSTS=1` set for private IP ranges?
3. Firewall may block all probes — try increasing timeout
4. Run with `NSA_VERBOSE=true` to see per-plugin output
5. Try targeted probe: `probe_service` on a known-open port

### "get_vulnerabilities returns empty"

1. Verify CPE format: `cpe:2.3:a:vendor:product:version:*:*:*:*:*:*:*`
2. Check vendor spelling matches NVD (e.g., `f5` not `nginx` for nginx vendor)
3. NVD API rate limits apply — wait and retry if rate-limited
4. Not all software has NVD entries; absence ≠ safety

### "License gate (🔒) error"

1. `probe_service` and `get_vulnerabilities` require Pro license
2. Set `NSAUDITOR_LICENSE_KEY` environment variable
3. CE alternative: use `scan_host` (always available) + manual CVE research
4. Pro/Enterprise pricing: https://www.nsauditor.com/ai/pricing/
