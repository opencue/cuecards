#!/usr/bin/env node
import { verifySupplyChain } from "../lib/supply_chain.mjs";
import { stableStringify } from "../lib/profile.mjs";

function parse(argv) {
  const args = { allowUnsignedChecksums: false, manifestName: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--artifact") args.artifactPath = argv[++i];
    else if (token === "--checksums") args.checksumsPath = argv[++i];
    else if (token === "--signature") args.signaturePath = argv[++i];
    else if (token === "--public-key") args.publicKeyPath = argv[++i];
    else if (token === "--manifest-name") args.manifestName = argv[++i];
    else if (token === "--allow-unsigned-checksums") args.allowUnsignedChecksums = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.artifactPath || !args.checksumsPath) throw new Error("--artifact and --checksums are required");
  return args;
}
const result = verifySupplyChain(parse(process.argv.slice(2)));
console.log(stableStringify(result));
if (!result.ok) process.exit(2);
