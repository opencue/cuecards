import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getSecret, initSecretStore, listSecrets } from "./workspace-secrets";

// ---------------------------------------------------------------------------
// Harness — redirect all file-based operations to a throwaway temp dir so the
// real ~/.config/cue is never touched (and age is never invoked in tests that
// don't need it).
// ---------------------------------------------------------------------------

let scratch: string;
let prevXdg: string | undefined;

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  scratch = mkdtempSync(join(tmpdir(), "cue-ws-secrets-"));
  process.env.XDG_CONFIG_HOME = scratch;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch { /* ignore */ }
});

/** Create a synthetic key file in the scratch secrets dir. */
function plantKeyFile(): void {
  const cueDir = join(scratch, "cue");
  mkdirSync(cueDir, { recursive: true });
  // Mimics age-keygen output format: comment + public-key comment + private key.
  writeFileSync(
    join(cueDir, "workspace-secrets.key"),
    "# created: 2026-01-01T00:00:00Z\n# public key: age1testpubkeyabcdef0123456789\nAGE-SECRET-KEY-1TESTPRIVATEKEY\n",
    { mode: 0o600 },
  );
}

// ---------------------------------------------------------------------------
// listSecrets
// ---------------------------------------------------------------------------

describe("listSecrets", () => {
  test("returns [] when the store file does not exist", () => {
    // No store file at XDG_CONFIG_HOME/cue/workspace-secrets.json.age
    expect(listSecrets()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSecret
// ---------------------------------------------------------------------------

describe("getSecret", () => {
  test("returns null when the store file does not exist", () => {
    expect(getSecret("MY_TOKEN")).toBeNull();
  });

  test("returns null for an empty-string name when store is absent", () => {
    expect(getSecret("")).toBeNull();
  });

  test("returns null for various name formats when store is absent", () => {
    expect(getSecret("API_KEY")).toBeNull();
    expect(getSecret("some-hyphenated-key")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// initSecretStore
// ---------------------------------------------------------------------------

describe("initSecretStore", () => {
  test("does not throw when the key file already exists", () => {
    // Pre-plant the key file; initSecretStore should skip age-keygen entirely.
    plantKeyFile();
    expect(() => initSecretStore()).not.toThrow();
  });

  test("is idempotent: calling twice with key present does not throw", () => {
    plantKeyFile();
    expect(() => {
      initSecretStore();
      initSecretStore();
    }).not.toThrow();
  });

  test("secrets directory exists after call when key was pre-planted", () => {
    // plantKeyFile creates the dir implicitly, then initSecretStore is a no-op
    // beyond the mkdirSync({recursive:true}). Verify the dir is still present.
    plantKeyFile();
    initSecretStore();
    expect(existsSync(join(scratch, "cue"))).toBe(true);
  });
});
