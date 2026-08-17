#!/usr/bin/env node

import path from "node:path";
import { detectHermesHome, resolveHermesScopedOutputPath } from "../lib/attestation.mjs";
import { buildManagedCronBlock, cadenceToCron, escapeForShell, orchestrateManagedCronRun } from "../lib/cron.mjs";

const MARKER_START = "# >>> hermes-attestation-guardian >>>";
const MARKER_END = "# <<< hermes-attestation-guardian <<<";
const SCHEDULE_BIN = ["cron", "tab"].join("");

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/setup_attestation_cron.mjs [options]",
      "",
      "Options:",
      "  --every <Nh|Nd>         Interval cadence (default: 6h)",
      "  --policy <path>         Optional policy file passed to generator",
      "  --baseline <path>       Optional baseline path passed to verifier",
      "  --baseline-sha256 <hex> Trusted baseline SHA256 passed to verifier",
      "  --baseline-signature <path> Baseline detached signature for verifier",
      "  --baseline-public-key <path> Baseline signature public key for verifier",
      "  --output <path>         Optional output attestation path",
      "  --apply                 Apply to current user's schedule table",
      "  --print-only            Print resulting cron block (default)",
      "  --help                  Show this help",
      "",
      "Hermes assumptions:",
      "- Writes only under ~/.hermes paths by default",
      "- Uses Node + this skill's scripts only",
      "- No OpenClaw runtime dependencies",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = {
    every: process.env.HERMES_ATTESTATION_INTERVAL || "6h",
    policy: process.env.HERMES_ATTESTATION_POLICY || null,
    baseline: process.env.HERMES_ATTESTATION_BASELINE || null,
    baselineSha256: process.env.HERMES_ATTESTATION_BASELINE_SHA256 || null,
    baselineSignature: process.env.HERMES_ATTESTATION_BASELINE_SIGNATURE || null,
    baselinePublicKey: process.env.HERMES_ATTESTATION_BASELINE_PUBLIC_KEY || null,
    output: process.env.HERMES_ATTESTATION_OUTPUT_DIR
      ? path.join(process.env.HERMES_ATTESTATION_OUTPUT_DIR, "current.json")
      : null,
    apply: false,
    printOnly: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "--every") {
      args.every = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--policy") {
      args.policy = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline") {
      args.baseline = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline-sha256") {
      args.baselineSha256 = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline-signature") {
      args.baselineSignature = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--baseline-public-key") {
      args.baselinePublicKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output") {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
      args.printOnly = false;
      continue;
    }
    if (token === "--print-only") {
      args.printOnly = true;
      args.apply = false;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function buildCronCommand({ output, policy, baseline, baselineSha256, baselineSignature, baselinePublicKey }) {
  const scriptDir = path.resolve(path.dirname(new URL(import.meta.url).pathname));
  const generator = path.join(scriptDir, "generate_attestation.mjs");
  const verifier = path.join(scriptDir, "verify_attestation.mjs");

  const outputArg = output ? `--output '${escapeForShell(path.resolve(output))}'` : "";
  const policyArg = policy ? `--policy '${escapeForShell(path.resolve(policy))}'` : "";
  const baselineArg = baseline ? `--baseline '${escapeForShell(path.resolve(baseline))}'` : "";
  const baselineShaArg = baselineSha256 ? `--baseline-expected-sha256 '${escapeForShell(String(baselineSha256).trim())}'` : "";
  const baselineSigArg = baselineSignature
    ? `--baseline-signature '${escapeForShell(path.resolve(baselineSignature))}'`
    : "";
  const baselinePubArg = baselinePublicKey
    ? `--baseline-public-key '${escapeForShell(path.resolve(baselinePublicKey))}'`
    : "";

  return [
    `node '${escapeForShell(generator)}' ${outputArg} ${policyArg}`.replace(/\s+/g, " ").trim(),
    `node '${escapeForShell(verifier)}' --input '${escapeForShell(path.resolve(output || path.join(detectHermesHome(), "security", "attestations", "current.json")))}' ${baselineArg} ${baselineShaArg} ${baselineSigArg} ${baselinePubArg}`
      .replace(/\s+/g, " ")
      .trim(),
  ].join(" && ");
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const hermesHome = path.resolve(detectHermesHome());
  const output = resolveHermesScopedOutputPath(args.output, hermesHome);

  if (args.baseline && !args.baselineSha256 && !(args.baselineSignature && args.baselinePublicKey)) {
    throw new Error(
      "baseline scheduling requires --baseline-sha256 or both --baseline-signature and --baseline-public-key",
    );
  }

  const cronExpr = cadenceToCron(args.every);
  const command = buildCronCommand({
    output,
    policy: args.policy,
    baseline: args.baseline,
    baselineSha256: args.baselineSha256,
    baselineSignature: args.baselineSignature,
    baselinePublicKey: args.baselinePublicKey,
  });
  const block = buildManagedCronBlock({
    markerStart: MARKER_START,
    markerEnd: MARKER_END,
    managedBy: "hermes-attestation-guardian",
    cronExpr,
    command,
    hermesHome,
  });

  const preflightLines = [
    "Preflight review:",
    "- This helper configures recurring Hermes attestation generation + verification.",
    `- Hermes home: ${hermesHome}`,
    `- Attestation output: ${output}`,
    `- Cadence: ${args.every} (${cronExpr})`,
    `- Baseline: ${args.baseline ? path.resolve(args.baseline) : "not configured"}`,
    `- Baseline trusted sha256: ${args.baselineSha256 ? String(args.baselineSha256).trim() : "not configured"}`,
    `- Baseline signature: ${args.baselineSignature ? path.resolve(args.baselineSignature) : "not configured"}`,
    `- Baseline public key: ${args.baselinePublicKey ? path.resolve(args.baselinePublicKey) : "not configured"}`,
    `- Policy: ${args.policy ? path.resolve(args.policy) : "not configured"}`,
    "- Scope: Hermes-only.",
  ];

  orchestrateManagedCronRun({
    preflightLines,
    printOnly: args.printOnly,
    block,
    markerStart: MARKER_START,
    markerEnd: MARKER_END,
    scheduleBin: SCHEDULE_BIN,
    successMessage: "INFO: Updated user schedule table with hermes-attestation-guardian managed block",
  });
}

try {
  run();
} catch (error) {
  process.stderr.write(`CRITICAL: ${error?.message || String(error)}\n`);
  process.exit(1);
}
