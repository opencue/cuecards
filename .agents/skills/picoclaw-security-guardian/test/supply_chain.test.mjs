import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyChecksums, verifyDetachedSignature, verifySupplyChain } from "../lib/supply_chain.mjs";
import { sha256FileHex } from "../lib/profile.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picoclaw-supply-"));
const artifact = path.join(dir, "picoclaw");
fs.writeFileSync(artifact, "binary", "utf8");
const manifest = path.join(dir, "checksums.json");
fs.writeFileSync(manifest, JSON.stringify({ files: { picoclaw: { sha256: sha256FileHex(artifact) } } }), "utf8");
assert.equal(verifyChecksums({ artifactPath: artifact, checksumsPath: manifest }).ok, true);
assert.equal(verifySupplyChain({ artifactPath: artifact, checksumsPath: manifest }).ok, false);

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const sig = crypto.sign(null, fs.readFileSync(manifest), privateKey).toString("base64");
const pub = path.join(dir, "pub.pem");
const sigPath = path.join(dir, "checksums.json.sig");
fs.writeFileSync(pub, publicKey.export({ type: "spki", format: "pem" }));
fs.writeFileSync(sigPath, sig);
assert.equal(verifyDetachedSignature({ manifestPath: manifest, signaturePath: sigPath, publicKeyPath: pub }).ok, true);
assert.equal(verifySupplyChain({ artifactPath: artifact, checksumsPath: manifest, signaturePath: sigPath, publicKeyPath: pub }).ok, true);
console.log("supply_chain.test.mjs PASS");
