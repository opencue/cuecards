#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  defaultOutputPath,
  sha256Hex,
  stableStringify,
  validateAttestationSchema,
  validateDigestBinding,
} from "../lib/attestation.mjs";
import { diffAttestations, highestSeverity, severityAtOrAbove } from "../lib/diff.mjs";

const SEVERITIES = ["critical", "high", "medium", "low", "info", "none"];

function parseArgs(argv) {
  const args = {
    input: defaultOutputPath(),
    expectedSha256: null,
    signaturePath: null,
    publicKeyPath: null,
    baselinePath: process.env.HERMES_ATTESTATION_BASELINE || null,
    baselineExpectedSha256: process.env.HERMES_ATTESTATION_BASELINE_SHA256 || null,
    baselineSignaturePath: process.env.HERMES_ATTESTATION_BASELINE_SIGNATURE || null,
    baselinePublicKeyPath: process.env.HERMES_ATTESTATION_BASELINE_PUBLIC_KEY || null,
    failOnSeverity: process.env.HERMES_ATTESTATION_FAIL_ON_SEVERITY || "critical",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "--input") {
      args.input = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--expected-sha256") {
      args.expectedSha256 = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--signature") {
      args.signaturePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--public-key") {
      args.publicKeyPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline") {
      args.baselinePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline-expected-sha256") {
      args.baselineExpectedSha256 = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }
    if (token === "--baseline-signature") {
      args.baselineSignaturePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline-public-key") {
      args.baselinePublicKeyPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--fail-on-severity") {
      args.failOnSeverity = String(argv[i + 1] || "").trim().toLowerCase();
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/verify_attestation.mjs [options]",
      "",
      "Options:",
      "  --input <path>             Attestation JSON path",
      "  --expected-sha256 <hex>    Require exact file SHA256 match",
      "  --signature <path>         Detached signature file path (base64 or raw binary)",
      "  --public-key <path>        Public key PEM for signature verification",
      "  --baseline <path>                  Baseline attestation for diffing",
      "  --baseline-expected-sha256 <hex>    Trusted baseline file SHA256",
      "  --baseline-signature <path>         Baseline detached signature",
      "  --baseline-public-key <path>        Public key PEM for baseline signature verification",
      "  --fail-on-severity <level>          none|critical|high|medium|low|info (default: critical)",
      "  --help                     Show this help",
      "",
    ].join("\n"),
  );
}

function parseSignature(signaturePath) {
  const raw = fs.readFileSync(signaturePath);
  const utf8 = raw.toString("utf8").trim();
  if (/^[A-Za-z0-9+/=\n\r]+$/.test(utf8)) {
    try {
      return Buffer.from(utf8.replace(/\s+/g, ""), "base64");
    } catch {
      return raw;
    }
  }
  return raw;
}

function verifyDetachedSignature({ inputBytes, signaturePath, publicKeyPath }) {
  const signature = parseSignature(signaturePath);
  const pubKeyPem = fs.readFileSync(publicKeyPath, "utf8");
  const pubKey = crypto.createPublicKey(pubKeyPem);
  return crypto.verify(null, inputBytes, pubKey, signature);
}

function isSha256Hex(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());
}

function printFinding(finding) {
  const sev = String(finding.severity || "info").toUpperCase();
  process.stdout.write(`${sev}: ${finding.code} - ${finding.message}\n`);
}

function validateSchemaAndDigestBinding({ attestation, schemaInvalidCode, canonicalDigestMismatchCode, verificationFindings, failures }) {
  const schemaErrors = validateAttestationSchema(attestation);
  for (const message of schemaErrors) {
    verificationFindings.push({ severity: "critical", code: schemaInvalidCode, message });
    failures.push(message);
  }

  const digestBindingError = validateDigestBinding(attestation);
  if (digestBindingError) {
    verificationFindings.push({ severity: "critical", code: canonicalDigestMismatchCode, message: digestBindingError });
    failures.push(digestBindingError);
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!SEVERITIES.includes(args.failOnSeverity)) {
    throw new Error(`Invalid --fail-on-severity: ${args.failOnSeverity}`);
  }

  if (!args.baselinePath && (args.baselineExpectedSha256 || args.baselineSignaturePath || args.baselinePublicKeyPath)) {
    throw new Error("baseline verification flags require --baseline");
  }

  const verificationFindings = [];
  const failures = [];

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`input attestation not found: ${inputPath}`);
  }

  const inputBytes = fs.readFileSync(inputPath);
  let attestation;
  try {
    attestation = JSON.parse(inputBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid JSON attestation: ${error.message}`);
  }

  validateSchemaAndDigestBinding({
    attestation,
    schemaInvalidCode: "SCHEMA_INVALID",
    canonicalDigestMismatchCode: "CANONICAL_DIGEST_MISMATCH",
    verificationFindings,
    failures,
  });

  const fileDigest = sha256Hex(inputBytes);
  if (args.expectedSha256) {
    if (!isSha256Hex(args.expectedSha256)) {
      throw new Error("--expected-sha256 must be a 64-char sha256 hex string");
    }
    if (args.expectedSha256 !== fileDigest) {
      const message = `file sha256 mismatch expected=${args.expectedSha256} actual=${fileDigest}`;
      verificationFindings.push({ severity: "critical", code: "FILE_DIGEST_MISMATCH", message });
      failures.push(message);
    }
  }

  if ((args.signaturePath && !args.publicKeyPath) || (!args.signaturePath && args.publicKeyPath)) {
    const message = "signature verification requires both --signature and --public-key";
    verificationFindings.push({ severity: "critical", code: "SIGNATURE_CONFIG_INVALID", message });
    failures.push(message);
  }

  if (args.signaturePath && args.publicKeyPath) {
    const ok = verifyDetachedSignature({
      inputBytes,
      signaturePath: path.resolve(args.signaturePath),
      publicKeyPath: path.resolve(args.publicKeyPath),
    });
    if (!ok) {
      const message = "detached signature verification failed";
      verificationFindings.push({ severity: "critical", code: "SIGNATURE_INVALID", message });
      failures.push(message);
    }
  }

  let diff = null;
  if (args.baselinePath) {
    const baselinePath = path.resolve(args.baselinePath);
    if (!fs.existsSync(baselinePath)) {
      const message = `baseline not found: ${baselinePath}`;
      verificationFindings.push({ severity: "critical", code: "BASELINE_MISSING", message });
      failures.push(message);
    } else {
      const baselineBytes = fs.readFileSync(baselinePath);
      const baselineTrustViaDigest = !!args.baselineExpectedSha256;
      const baselineTrustViaSignature = !!args.baselineSignaturePath || !!args.baselinePublicKeyPath;

      if (!baselineTrustViaDigest && !baselineTrustViaSignature) {
        const message =
          "baseline authenticity required: provide --baseline-expected-sha256 or both --baseline-signature and --baseline-public-key";
        verificationFindings.push({ severity: "critical", code: "BASELINE_UNTRUSTED", message });
        failures.push(message);
      }

      if (baselineTrustViaDigest) {
        if (!isSha256Hex(args.baselineExpectedSha256)) {
          throw new Error("--baseline-expected-sha256 must be a 64-char sha256 hex string");
        }
        const baselineDigest = sha256Hex(baselineBytes);
        if (baselineDigest !== args.baselineExpectedSha256) {
          const message = `baseline file sha256 mismatch expected=${args.baselineExpectedSha256} actual=${baselineDigest}`;
          verificationFindings.push({ severity: "critical", code: "BASELINE_DIGEST_MISMATCH", message });
          failures.push(message);
        }
      }

      if (baselineTrustViaSignature) {
        if (!args.baselineSignaturePath || !args.baselinePublicKeyPath) {
          const message = "baseline signature verification requires both --baseline-signature and --baseline-public-key";
          verificationFindings.push({ severity: "critical", code: "BASELINE_SIGNATURE_CONFIG_INVALID", message });
          failures.push(message);
        } else {
          const ok = verifyDetachedSignature({
            inputBytes: baselineBytes,
            signaturePath: path.resolve(args.baselineSignaturePath),
            publicKeyPath: path.resolve(args.baselinePublicKeyPath),
          });
          if (!ok) {
            const message = "baseline detached signature verification failed";
            verificationFindings.push({ severity: "critical", code: "BASELINE_SIGNATURE_INVALID", message });
            failures.push(message);
          }
        }
      }

      try {
        const baseline = JSON.parse(baselineBytes.toString("utf8"));
        validateSchemaAndDigestBinding({
          attestation: baseline,
          schemaInvalidCode: "BASELINE_SCHEMA_INVALID",
          canonicalDigestMismatchCode: "BASELINE_CANONICAL_DIGEST_MISMATCH",
          verificationFindings,
          failures,
        });

        if (failures.length === 0) {
          diff = diffAttestations(baseline, attestation);
        }
      } catch (error) {
        const message = `invalid baseline JSON: ${error.message}`;
        verificationFindings.push({ severity: "critical", code: "BASELINE_JSON_INVALID", message });
        failures.push(message);
      }
    }
  }

  for (const finding of verificationFindings) {
    printFinding(finding);
  }
  if (diff) {
    for (const finding of diff.findings) {
      printFinding(finding);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`CRITICAL: verification failed with ${failures.length} error(s)\n`);
    process.exit(1);
  }

  const diffHighest = highestSeverity(diff?.findings || []);
  if (diffHighest && severityAtOrAbove(diffHighest, args.failOnSeverity)) {
    process.stderr.write(
      `CRITICAL: diff severity threshold exceeded (highest=${diffHighest}, threshold=${args.failOnSeverity})\n`,
    );
    process.exit(2);
  }

  process.stdout.write(
    `${stableStringify({
      level: "INFO",
      status: "verified",
      input: inputPath,
      file_sha256: fileDigest,
      baseline_compared: !!diff,
      diff_summary: diff?.summary || null,
    })}\n`,
  );
}

try {
  run();
} catch (error) {
  process.stderr.write(`CRITICAL: ${error?.message || String(error)}\n`);
  process.exit(1);
}
