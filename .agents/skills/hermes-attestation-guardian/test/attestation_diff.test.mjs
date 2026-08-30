#!/usr/bin/env node
import assert from "node:assert/strict";
import { diffAttestations, highestSeverity, severityAtOrAbove } from "../lib/diff.mjs";

const baseline = {
  schema_version: "0.0.1",
  platform: "hermes",
  generator: { version: "0.0.1" },
  posture: {
    runtime: {
      gateways: { telegram: true, matrix: false, discord: false },
      risky_toggles: {
        allow_unsigned_mode: false,
        bypass_verification: false,
      },
    },
    feed_verification: { status: "verified" },
    integrity: {
      trust_anchors: [{ path: "/etc/hermes/trust.pem", sha256: "aaa" }],
      watched_files: [{ path: "/etc/hermes/config.json", sha256: "bbb" }],
    },
  },
};

const drifted = {
  schema_version: "0.0.1",
  platform: "hermes",
  generator: { version: "0.0.2" },
  posture: {
    runtime: {
      gateways: { telegram: true, matrix: true, discord: false },
      risky_toggles: {
        allow_unsigned_mode: true,
        bypass_verification: false,
      },
    },
    feed_verification: { status: "unverified" },
    integrity: {
      trust_anchors: [{ path: "/etc/hermes/trust.pem", sha256: "ccc" }],
      watched_files: [{ path: "/etc/hermes/config.json", sha256: "ddd" }],
    },
  },
};

const clean = JSON.parse(JSON.stringify(baseline));

const driftOut = diffAttestations(baseline, drifted);
assert.ok(Array.isArray(driftOut.findings));
assert.ok(driftOut.findings.length >= 4, "expected multiple meaningful drift findings");
assert.ok(driftOut.findings.some((f) => f.code === "UNSIGNED_MODE_ENABLED"));
assert.ok(driftOut.findings.some((f) => f.code === "FEED_VERIFICATION_REGRESSION"));
assert.ok(driftOut.findings.some((f) => f.code === "TRUST_ANCHOR_MISMATCH"));
assert.ok(driftOut.findings.some((f) => f.code === "WATCHED_FILE_DRIFT"));
assert.equal(highestSeverity(driftOut.findings), "critical");
assert.equal(severityAtOrAbove("critical", "high"), true);
assert.equal(severityAtOrAbove("low", "critical"), false);

const cleanOut = diffAttestations(baseline, clean);
assert.equal(cleanOut.findings.length, 0, "identical attestations should produce no findings");
assert.deepEqual(cleanOut.summary, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });

console.log("attestation_diff.test.mjs: ok");
