#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildPicoclawProfile, confineOutputToPicoclawHome, defaultOutputPath, defaultPicoclawHome, stableStringify } from "../lib/profile.mjs";

function parse(argv) {
  const args = { watch: [], artifact: [], output: null, home: defaultPicoclawHome(), generatedAt: null, config: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--output") args.output = argv[++i];
    else if (token === "--home") args.home = argv[++i];
    else if (token === "--watch") args.watch.push(argv[++i]);
    else if (token === "--artifact") args.artifact.push(argv[++i]);
    else if (token === "--generated-at") args.generatedAt = argv[++i];
    else if (token === "--config") args.config = argv[++i];
    else if (token === "--help") {
      console.log("Usage: node scripts/generate_profile.mjs [--output path] [--home path] [--config path] [--watch path] [--artifact path]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!args.output) args.output = defaultOutputPath(args.home);
  return args;
}

function writeNoFollow(outPath, body) {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(outPath, flags, 0o600);
  try {
    fs.writeFileSync(fd, body, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

const args = parse(process.argv.slice(2));
const profile = buildPicoclawProfile({
  picoclawHome: args.home,
  generatedAt: args.generatedAt,
  configPath: args.config,
  watchFiles: args.watch,
  releaseArtifacts: args.artifact,
});
const out = confineOutputToPicoclawHome(args.output, args.home);
fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
const checkedOut = confineOutputToPicoclawHome(out, args.home);
writeNoFollow(checkedOut, `${stableStringify(profile)}\n`);
console.log(stableStringify({ message: "picoclaw profile generated", output: checkedOut, canonical_sha256: profile.digests.canonical_sha256 }, 0));
