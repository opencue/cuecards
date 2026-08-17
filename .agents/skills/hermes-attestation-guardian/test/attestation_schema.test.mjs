#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildAttestation,
  computeCanonicalDigest,
  parseAttestationPolicy,
  stableStringify,
  validateAttestationSchema,
  validateDigestBinding,
} from "../lib/attestation.mjs";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hag-schema-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function withPatchedEnv(patch, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function testBuildAttestationIsSchemaValidAndDeterministic() {
  await withTempDir(async (tempDir) => {
    const watchedFile = path.join(tempDir, "watch.txt");
    const trustAnchor = path.join(tempDir, "anchor.pem");
    await fs.writeFile(watchedFile, "watch-contents\n", "utf8");
    await fs.writeFile(trustAnchor, "trust-anchor\n", "utf8");

    const policy = parseAttestationPolicy(
      JSON.stringify({ watch_files: [watchedFile], trust_anchor_files: [trustAnchor] }),
    );

    const generatedAt = "2026-04-15T18:00:00.000Z";
    const first = buildAttestation({ generatedAt, policy });
    const second = buildAttestation({ generatedAt, policy });

    assert.deepEqual(first, second, "attestation must be deterministic for fixed inputs");
    assert.equal(first.platform, "hermes");
    assert.equal(first.schema_version, "0.0.1");
    assert.equal(first.generated_at, generatedAt);

    const schemaErrors = validateAttestationSchema(first);
    assert.equal(schemaErrors.length, 0, `schema errors: ${schemaErrors.join(", ")}`);

    const computedDigest = computeCanonicalDigest(first);
    assert.equal(first.digests.canonical_sha256, computedDigest, "digest must match canonical payload");

    const stableOne = stableStringify(first);
    const stableTwo = stableStringify(second);
    assert.equal(stableOne, stableTwo, "stable stringify should produce same output ordering");
  });
}

function testSchemaValidationFailsClosed() {
  const invalid = {
    schema_version: "0.0.0",
    platform: "openclaw",
    generated_at: "not-a-date",
    digests: { canonical_sha256: "1234" },
  };
  const errors = validateAttestationSchema(invalid);
  assert.ok(errors.length >= 4, "invalid schema should emit multiple errors");
  assert.ok(errors.some((msg) => msg.includes("platform must be hermes")));
}

function testDigestBindingRejectsUnsupportedAlgorithm() {
  const attestation = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  attestation.digests.algorithm = "sha1";

  const schemaErrors = validateAttestationSchema(attestation);
  assert.ok(schemaErrors.some((msg) => msg.includes("digests.algorithm must be sha256")));

  const digestBindingError = validateDigestBinding(attestation);
  assert.ok(digestBindingError?.includes("unsupported digest algorithm"));
}

function testSchemaValidationRequiresGeneratorVersionNonEmptyString() {
  const missingVersion = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  delete missingVersion.generator.version;
  const missingVersionErrors = validateAttestationSchema(missingVersion);
  assert.ok(missingVersionErrors.includes("generator.version must be a non-empty string"));

  const nonStringVersion = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  nonStringVersion.generator.version = 7;
  const nonStringVersionErrors = validateAttestationSchema(nonStringVersion);
  assert.ok(nonStringVersionErrors.includes("generator.version must be a non-empty string"));

  const emptyVersion = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  emptyVersion.generator.version = "   ";
  const emptyVersionErrors = validateAttestationSchema(emptyVersion);
  assert.ok(emptyVersionErrors.includes("generator.version must be a non-empty string"));
}

function testSchemaValidationRequiresRuntimeGatewaysAndRiskyTogglesBooleans() {
  const valid = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  const validErrors = validateAttestationSchema(valid);
  assert.equal(validErrors.length, 0, `valid attestation should pass schema: ${validErrors.join(", ")}`);

  const missingGateways = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  delete missingGateways.posture.runtime.gateways;
  const missingGatewaysErrors = validateAttestationSchema(missingGateways);
  assert.ok(missingGatewaysErrors.includes("posture.runtime.gateways object is required"));

  const malformedGateways = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  malformedGateways.posture.runtime.gateways = "enabled";
  const malformedGatewaysErrors = validateAttestationSchema(malformedGateways);
  assert.ok(malformedGatewaysErrors.includes("posture.runtime.gateways object is required"));

  const invalidGatewayLeaf = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  delete invalidGatewayLeaf.posture.runtime.gateways.matrix;
  invalidGatewayLeaf.posture.runtime.gateways.telegram = "true";
  const invalidGatewayLeafErrors = validateAttestationSchema(invalidGatewayLeaf);
  assert.ok(invalidGatewayLeafErrors.includes("posture.runtime.gateways.telegram must be a boolean"));
  assert.ok(invalidGatewayLeafErrors.includes("posture.runtime.gateways.matrix must be a boolean"));

  const missingRiskyToggles = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  delete missingRiskyToggles.posture.runtime.risky_toggles;
  const missingRiskyTogglesErrors = validateAttestationSchema(missingRiskyToggles);
  assert.ok(missingRiskyTogglesErrors.includes("posture.runtime.risky_toggles object is required"));

  const malformedRiskyToggles = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  malformedRiskyToggles.posture.runtime.risky_toggles = [];
  const malformedRiskyTogglesErrors = validateAttestationSchema(malformedRiskyToggles);
  assert.ok(malformedRiskyTogglesErrors.includes("posture.runtime.risky_toggles object is required"));

  const invalidRiskyToggleLeaf = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  delete invalidRiskyToggleLeaf.posture.runtime.risky_toggles.bypass_verification;
  invalidRiskyToggleLeaf.posture.runtime.risky_toggles.allow_unsigned_mode = "false";
  const invalidRiskyToggleLeafErrors = validateAttestationSchema(invalidRiskyToggleLeaf);
  assert.ok(
    invalidRiskyToggleLeafErrors.includes("posture.runtime.risky_toggles.allow_unsigned_mode must be a boolean"),
  );
  assert.ok(
    invalidRiskyToggleLeafErrors.includes("posture.runtime.risky_toggles.bypass_verification must be a boolean"),
  );
}

function testSchemaValidationRequiresIntegrityEntryShapes() {
  const attestation = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  attestation.posture.integrity.watched_files = [
    null,
    { path: "", exists: true, sha256: null },
    { path: "/etc/hermes/config.json", exists: "yes", sha256: "abc" },
  ];
  attestation.posture.integrity.trust_anchors = [{ exists: false, sha256: 7 }];

  const errors = validateAttestationSchema(attestation);
  assert.ok(errors.includes("posture.integrity.watched_files[0] must be an object"));
  assert.ok(errors.includes("posture.integrity.watched_files[1].path must be a non-empty string"));
  assert.ok(errors.includes("posture.integrity.watched_files[2].exists must be a boolean"));
  assert.ok(
    errors.includes("posture.integrity.watched_files[2].sha256 must be null or a 64-char sha256 hex string"),
  );
  assert.ok(errors.includes("posture.integrity.trust_anchors[0].path must be a non-empty string"));
  assert.ok(errors.includes("posture.integrity.trust_anchors[0].sha256 must be null or a 64-char sha256 hex string"));

  const valid = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
  valid.posture.integrity.watched_files = [{ path: "/tmp/a", exists: false, sha256: null }];
  valid.posture.integrity.trust_anchors = [
    {
      path: "/tmp/t.pem",
      exists: true,
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  ];

  const validErrors = validateAttestationSchema(valid);
  assert.equal(validErrors.length, 0, `valid integrity entries should pass schema: ${validErrors.join(", ")}`);
}

async function testAttestationFeedConfigFailuresFallBackToUnknownStatus() {
  await withTempDir(async (tempDir) => {
    const hermesHome = path.join(tempDir, ".hermes");
    await fs.mkdir(hermesHome, { recursive: true });

    await withPatchedEnv(
      {
        HERMES_HOME: hermesHome,
        HERMES_ADVISORY_CACHED_FEED: path.join(tempDir, "outside-feed.json"),
        HERMES_ADVISORY_FEED_STATE_PATH: path.join(tempDir, "outside-state.json"),
      },
      async () => {
        const attestation = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
        assert.equal(attestation.posture.feed_verification.status, "unknown");
        assert.equal(attestation.posture.feed_verification.configured, false);
        assert.equal(
          attestation.posture.feed_verification.state_path,
          path.join(hermesHome, "security", "advisories", "feed-verification-state.json"),
        );
        assert.ok(
          String(attestation.posture.feed_verification.config_warning || "").includes("outside HERMES_HOME"),
          `expected explicit config warning, got: ${attestation.posture.feed_verification.config_warning}`,
        );
      },
    );
  });
}

async function testBooleanConfigCoercionDoesNotEnableFalseStrings() {
  await withTempDir(async (tempDir) => {
    const hermesHome = path.join(tempDir, ".hermes");
    await fs.mkdir(hermesHome, { recursive: true });
    await fs.writeFile(
      path.join(hermesHome, "config.json"),
      JSON.stringify({
        gateways: {
          telegram: { enabled: "false" },
          matrix: { enabled: "0" },
          discord: { enabled: "off" },
        },
        security: {
          allow_unsigned_mode: "false",
          bypass_verification: "off",
        },
      }),
      "utf8",
    );

    await withPatchedEnv(
      {
        HERMES_HOME: hermesHome,
        HERMES_GATEWAY_TELEGRAM_ENABLED: "true",
        HERMES_GATEWAY_MATRIX_ENABLED: "1",
        HERMES_GATEWAY_DISCORD_ENABLED: "yes",
        HERMES_ALLOW_UNSIGNED_MODE: "true",
        HERMES_BYPASS_VERIFICATION: "true",
      },
      async () => {
        const attestation = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
        assert.equal(attestation.posture.runtime.gateways.telegram, false);
        assert.equal(attestation.posture.runtime.gateways.matrix, false);
        assert.equal(attestation.posture.runtime.gateways.discord, false);
        assert.equal(attestation.posture.runtime.risky_toggles.allow_unsigned_mode, false);
        assert.equal(attestation.posture.runtime.risky_toggles.bypass_verification, false);
      },
    );

    await withPatchedEnv(
      {
        HERMES_HOME: hermesHome,
        HERMES_GATEWAY_TELEGRAM_ENABLED: "true",
      },
      async () => {
        await fs.writeFile(path.join(hermesHome, "config.json"), JSON.stringify({}), "utf8");
        const attestation = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
        assert.equal(attestation.posture.runtime.gateways.telegram, true);
      },
    );

    await withPatchedEnv(
      {
        HERMES_HOME: hermesHome,
        HERMES_GATEWAY_TELEGRAM_ENABLED: "true",
        HERMES_ALLOW_UNSIGNED_MODE: "true",
      },
      async () => {
        await fs.writeFile(
          path.join(hermesHome, "config.json"),
          JSON.stringify({
            gateways: {
              telegram: { enabled: "maybe" },
            },
            security: {
              allow_unsigned_mode: { bad: true },
            },
          }),
          "utf8",
        );
        const attestation = buildAttestation({ generatedAt: "2026-04-15T18:00:00.000Z" });
        assert.equal(attestation.posture.runtime.gateways.telegram, false);
        assert.equal(attestation.posture.runtime.risky_toggles.allow_unsigned_mode, false);
      },
    );
  });
}

await testBuildAttestationIsSchemaValidAndDeterministic();
testSchemaValidationFailsClosed();
testDigestBindingRejectsUnsupportedAlgorithm();
testSchemaValidationRequiresGeneratorVersionNonEmptyString();
testSchemaValidationRequiresRuntimeGatewaysAndRiskyTogglesBooleans();
testSchemaValidationRequiresIntegrityEntryShapes();
await testAttestationFeedConfigFailuresFallBackToUnknownStatus();
await testBooleanConfigCoercionDoesNotEnableFalseStrings();
console.log("attestation_schema.test.mjs: ok");
