#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  buildAttestation,
  defaultOutputPath,
  parseAttestationPolicy,
  resolveHermesScopedOutputPath,
  sha256FileHex,
  stableStringify,
} from "../lib/attestation.mjs";

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/generate_attestation.mjs [options]",
      "",
      "Options:",
      "  --output <path>          Output file path (default: ~/.hermes/security/attestations/current.json)",
      "  --policy <path>          JSON policy file with watch_files and trust_anchor_files arrays",
      "  --watch <path>           Extra watched file path (repeatable)",
      "  --trust-anchor <path>    Extra trust anchor file path (repeatable)",
      "  --generated-at <iso>     Override generated_at for deterministic testing",
      "  --write-sha256           Also write <output>.sha256 with file digest",
      "  --compact                Write compact JSON (no indentation)",
      "  --help                   Show this help",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = {
    output: defaultOutputPath(),
    policyPath: null,
    watch: [],
    trustAnchor: [],
    generatedAt: process.env.HERMES_ATTESTATION_GENERATED_AT || null,
    writeSha256: false,
    compact: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--help") {
      args.help = true;
      continue;
    }
    if (token === "--output") {
      args.output = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--policy") {
      args.policyPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--watch") {
      args.watch.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--trust-anchor") {
      args.trustAnchor.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--generated-at") {
      args.generatedAt = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--write-sha256") {
      args.writeSha256 = true;
      continue;
    }
    if (token === "--compact") {
      args.compact = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function isSymlinkPath(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function writeAtomically(outPath, body) {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath);
  const tempPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let fd = null;

  try {
    fd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, body, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    if (isSymlinkPath(outPath)) {
      throw new Error(`output path must not be a symlink: ${outPath}`);
    }

    fs.renameSync(tempPath, outPath);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort cleanup
      }
    }
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (args.generatedAt && Number.isNaN(Date.parse(args.generatedAt))) {
    throw new Error(`Invalid --generated-at value: ${args.generatedAt}`);
  }

  const policy = args.policyPath
    ? parseAttestationPolicy(fs.readFileSync(path.resolve(args.policyPath), "utf8"))
    : parseAttestationPolicy(null);

  const attestation = buildAttestation({
    generatedAt: args.generatedAt,
    policy,
    extraWatchFiles: args.watch,
    extraTrustAnchorFiles: args.trustAnchor,
  });

  const outPath = resolveHermesScopedOutputPath(args.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = stableStringify(attestation, args.compact ? 0 : 2);
  writeAtomically(outPath, `${body}\n`);

  if (args.writeSha256) {
    const shaPath = `${outPath}.sha256`;
    const digest = sha256FileHex(outPath);
    fs.writeFileSync(shaPath, `${digest}  ${path.basename(outPath)}\n`, "utf8");
  }

  process.stdout.write(
    `${stableStringify({
      level: "INFO",
      message: "attestation generated",
      output: outPath,
      canonical_sha256: attestation.digests.canonical_sha256,
    })}\n`,
  );
}

try {
  run();
} catch (error) {
  process.stderr.write(`CRITICAL: ${error?.message || String(error)}\n`);
  process.exit(1);
}
