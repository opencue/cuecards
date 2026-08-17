# NSAuditor AI — Example Agent Interactions

Reasoning chains showing how an AI agent should use NSAuditor AI tools.

---

## Example 1: "Scan my router for vulnerabilities"

**Agent reasoning:** User wants a full security audit. Use `scan_host` first, then
`get_vulnerabilities` for each detected service with a version.

```
1. scan_host({ host: "192.168.1.1" })
   → Result: {
       summary: { services_found: 4, findings_count: 1 },
       host: { os: "Linux", vendor: "Ubiquiti" },
       services: [
         { port: 22, service: "ssh", program: "OpenSSH", version: "8.9p1" },
         { port: 53, service: "dns", program: "dnsmasq", version: "2.89" },
         { port: 443, service: "https", program: "lighttpd", version: "1.4.69" },
         { port: 161, service: "snmp", program: null, version: null }
       ],
       findings: [
         { severity: "MEDIUM", title: "SNMP default community string 'public'" }
       ]
     }

2. get_vulnerabilities({ cpe: "cpe:2.3:a:openbsd:openssh:8.9p1:*:*:*:*:*:*:*" })
   → CVE-2023-38408 (CRITICAL 9.8), CVE-2023-48795 (MEDIUM 5.9)

3. get_vulnerabilities({ cpe: "cpe:2.3:a:thekelleys:dnsmasq:2.89:*:*:*:*:*:*:*" })
   → CVE-2023-50387 (HIGH 7.5) — KeyTrap DNS vulnerability

4. get_vulnerabilities({ cpe: "cpe:2.3:a:lighttpd:lighttpd:1.4.69:*:*:*:*:*:*:*" })
   → No known CVEs

5. Present findings sorted by severity:
   CRITICAL: CVE-2023-38408 — OpenSSH ssh-agent RCE (upgrade to 9.3p2+)
   HIGH: CVE-2023-50387 — dnsmasq KeyTrap DoS (upgrade to 2.90+)
   MEDIUM: CVE-2023-48795 — SSH Terrapin attack (upgrade OpenSSH)
   MEDIUM: SNMP default community string (change community string)
   INFO: SNMP on port 161 has no version — manual investigation recommended
```

---

## Example 2: "What plugins does NSAuditor have?"

**Agent reasoning:** Simple metadata query — use `list_plugins`.

```
1. list_plugins()
   → Return formatted list grouped by category:

   Core Scanners (17):
   • 001 Ping Checker — ICMP/ARP reachability + TTL OS hints
   • 002 SSH Scanner — SSH banner, version, weak algorithms
   • 003 Port Scanner — TCP/UDP bulk scan (~1000 ports)
   [... full list ...]

   Discovery (6):
   • 025 DB Scanner — MySQL, PostgreSQL, Redis detection
   [... etc ...]
```

---

## Example 3: "Check if port 443 on example.com has weak TLS"

**Agent reasoning:** Targeted single-service probe — use `probe_service` with TLS scanner.

```
1. probe_service({ host: "example.com", pluginName: "011", port: 443 })
   → Result: {
       program: "nginx",
       version: "1.24.0",
       data: [{
         probe_info: "TLS handshake",
         tls_versions: ["TLSv1.2", "TLSv1.3"],
         ciphers: ["TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256"],
         weakProtocols: [],
         weakCiphers: []
       }]
     }

2. Analysis: No deprecated TLS versions found. TLSv1.0 and TLSv1.1 are NOT
   supported. All cipher suites are strong (AES-256-GCM, ChaCha20).
   Verdict: TLS configuration is secure.
```

---

## Example 4: "Is Log4j 2.14.1 vulnerable?"

**Agent reasoning:** Direct CVE lookup — no scan needed. Construct CPE and query.

```
1. get_vulnerabilities({
     cpe: "cpe:2.3:a:apache:log4j:2.14.1:*:*:*:*:*:*:*",
     maxResults: 10
   })
   → [
       CVE-2021-44228 (Log4Shell) — CRITICAL 10.0 — RCE via JNDI injection
       CVE-2021-45046 — CRITICAL 9.0 — Incomplete fix for Log4Shell
       CVE-2021-45105 — HIGH 7.5 — DoS via crafted lookup
       CVE-2021-44832 — MEDIUM 6.6 — RCE via JDBC appender
     ]

2. Present with urgency: "Log4j 2.14.1 is critically vulnerable to Log4Shell
   (CVE-2021-44228, CVSS 10.0) which enables remote code execution. Upgrade
   immediately to Log4j 2.17.1+ or migrate to a maintained logging framework."
```

---

## Example 5: "Set up continuous monitoring for my subnet"

**Agent reasoning:** CTEM is a CLI feature, not available via MCP. Advise with the
correct CLI command.

```
Agent response:
"Continuous monitoring uses the CLI's watch mode (not available via MCP tools).

Run:
  nsauditor-ai scan --host 192.168.1.0/24 --plugins all \
    --watch --interval 15 \
    --webhook-url https://your-webhook.example.com/alerts \
    --alert-severity high

This rescans every 15 minutes, detects changes (new/removed services, version
changes, new findings), and sends webhook alerts for high+ severity changes.

Scan history is stored in .scan_history/ as JSONL for trend analysis."
```

---

## Example 6: "Audit DNS security for example.com" (Pro)

**Agent reasoning:** Use the DNS Security Auditor plugin for comprehensive DNS assessment.

```
1. probe_service({ host: "example.com", pluginName: "060", port: 53 })
   → Result: {
       spf: { valid: true, record: "v=spf1 include:_spf.google.com ~all" },
       dkim: { found: true, selectors: ["google"] },
       dmarc: { valid: true, policy: "reject", rua: "dmarc@example.com" },
       dnssec: { signed: false },
       axfr: { allowed: false },
       mx: [{ host: "alt1.gmail-smtp-in.l.google.com", starttls: true }],
       caa: [{ value: "letsencrypt.org" }]
     }

2. Present findings:
   ✅ SPF configured (includes Google)
   ✅ DKIM found (google selector)
   ✅ DMARC policy set to 'reject' (strongest setting)
   ⚠  DNSSEC not enabled (recommended for integrity)
   ✅ Zone transfer (AXFR) properly blocked
   ✅ MX servers support STARTTLS
   ✅ CAA restricts certificates to Let's Encrypt
```

---

## Example 7: Error Handling — SSRF Block

**Agent reasoning:** User asked to scan localhost, which triggers SSRF protection.

```
1. scan_host({ host: "127.0.0.1" })
   → Error: "SSRF protection: loopback addresses are blocked"

2. Agent response:
   "NSAuditor AI blocks scanning of loopback addresses (127.x.x.x) as a security
   measure. This prevents SSRF attacks when the scanner is exposed as an MCP tool.

   If you need to scan your local machine, you have two options:
   1. Use the CLI directly: nsauditor-ai scan --host 127.0.0.1
   2. Set NSA_ALLOW_ALL_HOSTS=1 in the MCP server's environment

   Note: Only enable this for legitimate local auditing, never in production
   MCP deployments."
```

---

## Example 8: Error Handling — License Gate

**Agent reasoning:** User requested a Pro feature on Community Edition.

```
1. User: "Check vulnerabilities for OpenSSH 8.9"

2. get_vulnerabilities({ cpe: "cpe:2.3:a:openbsd:openssh:8.9p1:*:*:*:*:*:*:*" })
   → Error: "🔒 get_vulnerabilities requires a Pro license"

3. Agent response:
   "CVE lookup via NSAuditor requires a Pro license. Here are your options:

   1. View Pro/Enterprise pricing: https://www.nsauditor.com/ai/pricing/
   2. Set NSAUDITOR_LICENSE_KEY in your MCP server environment
   3. Manual lookup: search nvd.nist.gov for 'openssh 8.9' directly

   Meanwhile, I can still run scan_host (available in Community Edition) to
   detect the service and identify potential risks from the scan evidence."
```

---

## Example 9: Full Audit with AI Report

**Agent reasoning:** User wants a comprehensive security assessment with AI analysis.

```
1. Confirm: "I'll scan 192.168.1.1. Do you have authorization to audit this host?"
   → User confirms

2. scan_host({ host: "192.168.1.1" })
   → 4 services detected, 2 findings

3. get_vulnerabilities for each versioned service
   → 5 CVEs found across 2 services

4. Present consolidated report:

   ═══════════════════════════════════════
   Security Audit Report: 192.168.1.1
   ═══════════════════════════════════════

   Host: Linux (Ubuntu 22.04) — Ubiquiti device
   Services: 4 (SSH, DNS, HTTPS, SNMP)
   Findings: 7 total (1 Critical, 1 High, 3 Medium, 2 Info)

   CRITICAL FINDINGS:
   • CVE-2023-38408 (CVSS 9.8) — OpenSSH ssh-agent RCE
     → Upgrade OpenSSH from 8.9p1 to 9.3p2+

   HIGH FINDINGS:
   • CVE-2023-50387 (CVSS 7.5) — dnsmasq KeyTrap DoS
     → Upgrade dnsmasq from 2.89 to 2.90+

   [... continued ...]

   For AI-enhanced analysis with remediation priorities, enable AI:
     AI_ENABLED=true AI_PROVIDER=ollama nsauditor-ai scan --host 192.168.1.1
```
