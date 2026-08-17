import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sha256FileHex } from "./profile.mjs";

function normalizeManifestPath(value) {
  return String(value || "").trim().replace(/^\.\//, "");
}

function parseChecksums(raw) {
  const text = String(raw || "");
  const trimmed = text.trim();
  if (!trimmed) throw new Error("checksum manifest is empty");

  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    const source = parsed.files && typeof parsed.files === "object" ? parsed.files : parsed;
    const out = {};
    for (const [manifestPath, entry] of Object.entries(source)) {
      const normalized = normalizeManifestPath(manifestPath);
      const hash = typeof entry === "string" ? entry : entry?.sha256;
      if (typeof hash === "string" && /^[a-fA-F0-9]{64}$/.test(hash.trim())) {
        if (out[normalized]) throw new Error(`duplicate checksum entry: ${normalized}`);
        out[normalized] = hash.trim().toLowerCase();
      }
    }
    return out;
  }

  const out = {};
  const basenameCounts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!m) continue;
    const manifestPath = normalizeManifestPath(m[2]);
    if (out[manifestPath]) throw new Error(`duplicate checksum entry: ${manifestPath}`);
    out[manifestPath] = m[1].toLowerCase();
    const base = path.basename(manifestPath);
    basenameCounts.set(base, (basenameCounts.get(base) || 0) + 1);
  }
  for (const [base, count] of basenameCounts.entries()) {
    if (count > 1) throw new Error(`ambiguous duplicate checksum basename: ${base}`);
  }
  return out;
}

function expectedForArtifact(files, artifactPath, manifestName = null) {
  const candidates = [manifestName, artifactPath, path.basename(artifactPath)]
    .filter(Boolean)
    .map(normalizeManifestPath);
  for (const candidate of candidates) {
    if (files[candidate]) return files[candidate];
  }
  return null;
}

export function verifyChecksums({ artifactPath, checksumsPath, manifestName = null }) {
  const files = parseChecksums(fs.readFileSync(checksumsPath, "utf8"));
  const expected = expectedForArtifact(files, artifactPath, manifestName);
  if (!expected) {
    return { ok: false, status: "missing", artifact: artifactPath, message: "artifact not present in checksum manifest" };
  }
  const actual = sha256FileHex(artifactPath);
  return { ok: actual === expected, status: actual === expected ? "verified" : "mismatch", artifact: artifactPath, expected, actual };
}

export function verifyDetachedSignature({ manifestPath, signaturePath, publicKeyPath }) {
  const manifestBytes = fs.readFileSync(manifestPath);
  const signatureText = fs.readFileSync(signaturePath, "utf8").trim();
  const sig = Buffer.from(signatureText.replace(/\s+/g, ""), "base64");
  const key = crypto.createPublicKey(fs.readFileSync(publicKeyPath, "utf8"));
  const ok = crypto.verify(null, manifestBytes, key, sig);
  return { ok, status: ok ? "verified" : "mismatch", manifest: manifestPath, signature: signaturePath };
}

export function verifySupplyChain(options) {
  const checksum = verifyChecksums(options);
  if (!options.allowUnsignedChecksums && (!options.signaturePath || !options.publicKeyPath)) {
    return {
      checksum,
      signature: { ok: false, status: "missing" },
      ok: false,
      message: "detached signature and trusted public key are required for supply-chain verification",
    };
  }
  const result = { checksum, signature: { ok: null, status: "not_checked" }, ok: checksum.ok };
  if (options.signaturePath && options.publicKeyPath) {
    result.signature = verifyDetachedSignature({
      manifestPath: options.checksumsPath,
      signaturePath: options.signaturePath,
      publicKeyPath: options.publicKeyPath,
    });
    result.ok = checksum.ok && result.signature.ok;
  } else {
    result.signature = { ok: null, status: "unsigned_checksum_only" };
    result.ok = checksum.ok;
  }
  return result;
}
