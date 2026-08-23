import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_API_URL,
  clearCredentials,
  loadCredentials,
  resolveApiUrl,
  resolveToken,
  saveCredentials,
} from "./cue-credentials";

let dir: string;
let prevXdg: string | undefined;
let prevToken: string | undefined;
let prevUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cue-creds-"));
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevToken = process.env.CUE_API_TOKEN;
  prevUrl = process.env.CUE_API_URL;
  process.env.XDG_CONFIG_HOME = dir; // configDir() → <dir>/cue
  delete process.env.CUE_API_TOKEN;
  delete process.env.CUE_API_URL;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevToken === undefined) delete process.env.CUE_API_TOKEN; else process.env.CUE_API_TOKEN = prevToken;
  if (prevUrl === undefined) delete process.env.CUE_API_URL; else process.env.CUE_API_URL = prevUrl;
  rmSync(dir, { recursive: true, force: true });
});

describe("cue-credentials", () => {
  test("returns null when nothing is saved", () => {
    expect(loadCredentials()).toBeNull();
    expect(resolveToken()).toBeNull();
  });

  test("saves and reloads a token", () => {
    const path = saveCredentials({ apiUrl: "https://cuecards.cc", token: "cue_sk_abc" });
    expect(path).toContain("credentials.json");
    const creds = loadCredentials();
    expect(creds?.token).toBe("cue_sk_abc");
    expect(resolveToken()).toBe("cue_sk_abc");
  });

  test("writes the credentials file with 0600 perms", () => {
    const path = saveCredentials({ apiUrl: DEFAULT_API_URL, token: "secret" });
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    // sanity: the secret is actually persisted
    expect(readFileSync(path, "utf8")).toContain("secret");
  });

  test("tightens permissions when replacing an existing credential file", () => {
    const path = saveCredentials({ apiUrl: DEFAULT_API_URL, token: "first" });
    chmodSync(path, 0o644);

    saveCredentials({ apiUrl: DEFAULT_API_URL, token: "second" });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toContain("second");
  });

  test("does not treat a retired GitHub cloud credential as an API token", () => {
    const path = saveCredentials({ apiUrl: DEFAULT_API_URL, token: "placeholder" });
    writeFileSync(path, '{"token":"gho_secret","user":"octocat"}\n');

    expect(loadCredentials()).toBeNull();
    expect(resolveToken()).toBeNull();
  });

  test("clearCredentials is idempotent", () => {
    const path = saveCredentials({ apiUrl: DEFAULT_API_URL, token: "secret" });
    expect(existsSync(path)).toBe(true);
    expect(clearCredentials()).toBe(path);
    expect(clearCredentials()).toBe(path);
    expect(existsSync(path)).toBe(false);
  });

  test("resolution order: flag > env > file", () => {
    saveCredentials({ apiUrl: DEFAULT_API_URL, token: "from-file" });
    expect(resolveToken("from-flag")).toBe("from-flag");
    process.env.CUE_API_TOKEN = "from-env";
    expect(resolveToken()).toBe("from-env");
    expect(resolveToken("from-flag")).toBe("from-flag");
    delete process.env.CUE_API_TOKEN;
    expect(resolveToken()).toBe("from-file");
  });

  test("resolveApiUrl honors env, then saved, then default; trims trailing slash", () => {
    expect(resolveApiUrl(null)).toBe(DEFAULT_API_URL);
    expect(resolveApiUrl({ apiUrl: "https://my.host/", token: "t" })).toBe("https://my.host");
    process.env.CUE_API_URL = "http://localhost:3000/";
    expect(resolveApiUrl({ apiUrl: "https://my.host", token: "t" })).toBe("http://localhost:3000");
  });
});
