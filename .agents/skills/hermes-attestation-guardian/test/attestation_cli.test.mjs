#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, "..");
const generatorScript = path.join(skillRoot, "scripts", "generate_attestation.mjs");
const verifierScript = path.join(skillRoot, "scripts", "verify_attestation.mjs");

function runNode(scriptPath, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: skillRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hag-cli-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const attestationsDir = path.join(hermesHome, "security", "attestations");
  const outputPath = path.join(attestationsDir, "current.json");
  const baselinePath = path.join(attestationsDir, "baseline.json");
  const watchedPath = path.join(tempDir, "config.json");

  await fs.mkdir(attestationsDir, { recursive: true });
  await fs.writeFile(watchedPath, JSON.stringify({ secure: true }), "utf8");

  const generatedAt = "2026-04-15T18:01:00.000Z";
  const generate = runNode(
    generatorScript,
    ["--output", outputPath, "--watch", watchedPath, "--generated-at", generatedAt, "--write-sha256"],
    { HERMES_HOME: hermesHome },
  );

  assert.equal(generate.status, 0, `generate failed: ${generate.stderr}`);
  const attestationRaw = await fs.readFile(outputPath, "utf8");
  const attestation = JSON.parse(attestationRaw);
  assert.equal(attestation.platform, "hermes");
  assert.equal(attestation.generated_at, generatedAt);

  const verify = runNode(verifierScript, ["--input", outputPath]);
  assert.equal(verify.status, 0, `verify should pass: ${verify.stderr}`);

  const feedConfigFailureOutputPath = path.join(attestationsDir, "feed-config-fallback.json");
  const generateWithBrokenFeedConfig = runNode(
    generatorScript,
    ["--output", feedConfigFailureOutputPath, "--generated-at", generatedAt],
    {
      HERMES_HOME: hermesHome,
      HERMES_ADVISORY_CACHED_FEED: path.join(tempDir, "outside-cached-feed.json"),
      HERMES_ADVISORY_FEED_STATE_PATH: path.join(tempDir, "outside-state.json"),
    },
  );
  assert.equal(
    generateWithBrokenFeedConfig.status,
    0,
    `generator must tolerate invalid feed config paths: ${generateWithBrokenFeedConfig.stderr}`,
  );
  const fallbackAttestation = JSON.parse(await fs.readFile(feedConfigFailureOutputPath, "utf8"));
  assert.equal(fallbackAttestation.posture.feed_verification.status, "unknown");
  assert.equal(fallbackAttestation.posture.feed_verification.configured, false);
  assert.equal(
    fallbackAttestation.posture.feed_verification.state_path,
    path.join(hermesHome, "security", "advisories", "feed-verification-state.json"),
  );
  assert.ok(
    String(fallbackAttestation.posture.feed_verification.config_warning || "").includes("outside HERMES_HOME"),
    `expected explicit config warning, got: ${fallbackAttestation.posture.feed_verification.config_warning}`,
  );

  const outOfScope = runNode(generatorScript, ["--output", path.join(tempDir, "outside.json")], { HERMES_HOME: hermesHome });
  assert.notEqual(outOfScope.status, 0, "generator must reject out-of-scope --output");
  assert.ok(outOfScope.stderr.includes("output path must stay under"), outOfScope.stderr);

  await fs.writeFile(baselinePath, attestationRaw, "utf8");
  const baselineDigest = crypto.createHash("sha256").update(attestationRaw).digest("hex");

  const verifyUntrustedBaseline = runNode(verifierScript, ["--input", outputPath, "--baseline", baselinePath]);
  assert.notEqual(verifyUntrustedBaseline.status, 0, "baseline diff must fail when baseline is unauthenticated");
  assert.ok(verifyUntrustedBaseline.stdout.includes("BASELINE_UNTRUSTED"), verifyUntrustedBaseline.stdout);

  const verifyTrustedBaseline = runNode(verifierScript, [
    "--input",
    outputPath,
    "--baseline",
    baselinePath,
    "--baseline-expected-sha256",
    baselineDigest,
  ]);
  assert.equal(verifyTrustedBaseline.status, 0, `trusted baseline should verify: ${verifyTrustedBaseline.stderr}`);

  const hardLinkPath = path.join(attestationsDir, "current-hardlink.json");
  const oldContent = "old-attestation-body\n";
  await fs.writeFile(outputPath, oldContent, "utf8");
  await fs.link(outputPath, hardLinkPath);

  const atomicRewrite = runNode(generatorScript, ["--output", outputPath, "--generated-at", generatedAt], {
    HERMES_HOME: hermesHome,
  });
  assert.equal(atomicRewrite.status, 0, `atomic rewrite failed: ${atomicRewrite.stderr}`);

  const rewrittenContent = await fs.readFile(outputPath, "utf8");
  const hardLinkedContent = await fs.readFile(hardLinkPath, "utf8");
  assert.notEqual(rewrittenContent, hardLinkedContent, "output rewrite should atomically replace file entry");
  assert.equal(hardLinkedContent, oldContent, "hard link should preserve previous file body after atomic replace");

  const invalidCurrent = JSON.parse(attestationRaw);
  delete invalidCurrent.platform;
  await fs.writeFile(outputPath, JSON.stringify(invalidCurrent, null, 2), "utf8");

  const verifyInvalidCurrent = runNode(verifierScript, ["--input", outputPath]);
  assert.notEqual(verifyInvalidCurrent.status, 0, "schema-invalid current attestation must be rejected");
  assert.ok(verifyInvalidCurrent.stdout.includes("SCHEMA_INVALID"), verifyInvalidCurrent.stdout);

  await fs.writeFile(outputPath, attestationRaw, "utf8");

  const baselineCanonicalMismatch = JSON.parse(attestationRaw);
  baselineCanonicalMismatch.posture.runtime.risky_toggles.allow_unsigned_mode = true;
  const baselineCanonicalMismatchRaw = JSON.stringify(baselineCanonicalMismatch, null, 2);
  await fs.writeFile(baselinePath, baselineCanonicalMismatchRaw, "utf8");
  const baselineCanonicalMismatchDigest = crypto.createHash("sha256").update(baselineCanonicalMismatchRaw).digest("hex");

  const verifyBaselineCanonicalMismatch = runNode(verifierScript, [
    "--input",
    outputPath,
    "--baseline",
    baselinePath,
    "--baseline-expected-sha256",
    baselineCanonicalMismatchDigest,
  ]);
  assert.notEqual(verifyBaselineCanonicalMismatch.status, 0, "baseline canonical digest mismatch must be rejected");
  assert.ok(
    verifyBaselineCanonicalMismatch.stdout.includes("BASELINE_CANONICAL_DIGEST_MISMATCH"),
    verifyBaselineCanonicalMismatch.stdout,
  );

  const baselineSchemaInvalid = JSON.parse(attestationRaw);
  delete baselineSchemaInvalid.platform;
  const baselineSchemaInvalidRaw = JSON.stringify(baselineSchemaInvalid, null, 2);
  await fs.writeFile(baselinePath, baselineSchemaInvalidRaw, "utf8");
  const baselineSchemaInvalidDigest = crypto.createHash("sha256").update(baselineSchemaInvalidRaw).digest("hex");

  const verifyBaselineSchemaInvalid = runNode(verifierScript, [
    "--input",
    outputPath,
    "--baseline",
    baselinePath,
    "--baseline-expected-sha256",
    baselineSchemaInvalidDigest,
  ]);
  assert.notEqual(verifyBaselineSchemaInvalid.status, 0, "schema-invalid baseline must be rejected");
  assert.ok(verifyBaselineSchemaInvalid.stdout.includes("BASELINE_SCHEMA_INVALID"), verifyBaselineSchemaInvalid.stdout);

  const baselineTampered = JSON.parse(attestationRaw);
  baselineTampered.posture.runtime.risky_toggles.allow_unsigned_mode = true;
  await fs.writeFile(baselinePath, JSON.stringify(baselineTampered, null, 2), "utf8");

  const verifyTamperedBaseline = runNode(verifierScript, [
    "--input",
    outputPath,
    "--baseline",
    baselinePath,
    "--baseline-expected-sha256",
    baselineDigest,
  ]);
  assert.notEqual(verifyTamperedBaseline.status, 0, "tampered baseline must be rejected");
  assert.ok(verifyTamperedBaseline.stdout.includes("BASELINE_DIGEST_MISMATCH"), verifyTamperedBaseline.stdout);

  const tampered = JSON.parse(attestationRaw);
  tampered.posture.runtime.risky_toggles.allow_unsigned_mode = true;
  await fs.writeFile(outputPath, JSON.stringify(tampered, null, 2), "utf8");

  const verifyTampered = runNode(verifierScript, ["--input", outputPath]);
  assert.notEqual(verifyTampered.status, 0, "verify must fail closed after tampering");
  assert.ok(
    verifyTampered.stderr.includes("CRITICAL") || verifyTampered.stdout.includes("CANONICAL_DIGEST_MISMATCH"),
    `expected critical verification signal, got stdout=${verifyTampered.stdout} stderr=${verifyTampered.stderr}`,
  );
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const securityDir = path.join(hermesHome, "security");
  const attestationsDir = path.join(securityDir, "attestations");
  const escapedDir = path.join(tempDir, "escaped-attestations");
  const outputPath = path.join(attestationsDir, "current.json");

  await fs.mkdir(securityDir, { recursive: true });
  await fs.mkdir(escapedDir, { recursive: true });
  await fs.symlink(escapedDir, attestationsDir, "dir");

  const symlinkEscape = runNode(generatorScript, ["--output", outputPath], {
    HERMES_HOME: hermesHome,
  });
  assert.notEqual(symlinkEscape.status, 0, "generator must reject symlink-based output path escapes");
  assert.ok(symlinkEscape.stderr.includes("output path must stay under"), symlinkEscape.stderr);
});

await withTempDir(async (tempDir) => {
  const hermesHome = path.join(tempDir, ".hermes");
  const attestationsDir = path.join(hermesHome, "security", "attestations");
  const outputPath = path.join(attestationsDir, "broken-link.json");

  await fs.mkdir(attestationsDir, { recursive: true });
  await fs.symlink(path.join(tempDir, "outside-target.json"), outputPath);

  const brokenSymlinkOutput = runNode(generatorScript, ["--output", outputPath], {
    HERMES_HOME: hermesHome,
  });
  assert.notEqual(brokenSymlinkOutput.status, 0, "generator must reject broken symlink output paths");
  assert.ok(brokenSymlinkOutput.stderr.includes("output path must not be a symlink"), brokenSymlinkOutput.stderr);
});

console.log("attestation_cli.test.mjs: ok");
