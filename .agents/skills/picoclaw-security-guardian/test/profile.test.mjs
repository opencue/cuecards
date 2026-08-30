import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPicoclawProfile, confineOutputToPicoclawHome } from "../lib/profile.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picoclaw-profile-"));
fs.writeFileSync(path.join(dir, "config.yaml"), "bind: 0.0.0.0\nauth: false\nmcp:\n", "utf8");
const profile = buildPicoclawProfile({ picoclawHome: dir, generatedAt: "2026-04-25T00:00:00.000Z" });
assert.equal(profile.platform, "picoclaw");
assert.equal(profile.posture.runtime.ui.public_web_ui, true);
assert.equal(profile.posture.runtime.ui.auth_disabled, true);
assert.equal(profile.posture.runtime.mcp.enabled, true);
assert.match(profile.digests.canonical_sha256, /^[a-f0-9]{64}$/);
assert.throws(() => confineOutputToPicoclawHome(path.join(dir, "..", "escape.json"), dir), /must stay under/);
console.log("profile.test.mjs PASS");
