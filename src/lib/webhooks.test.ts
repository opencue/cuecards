/**
 * Tests for webhooks.ts.
 *
 * CONFIG_PATH in webhooks.ts is a module-level constant resolved from
 * XDG_CONFIG_HOME at import time.  To keep tests hermetic (never touching
 * ~/.config/cue), we:
 *   1. Set XDG_CONFIG_HOME to a temp dir BEFORE dynamically importing the module.
 *   2. Create / delete the config.yaml inside that temp dir between tests.
 *
 * Dynamic import must be used (not a top-level static import) because static
 * imports are hoisted and execute before beforeAll.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type FireWebhook = (
  event: "profile.modified" | "profile.created" | "profile.locked" | "profile.unlocked",
  payload: Record<string, unknown>,
) => Promise<void>;

let tmpDir: string;
let fireWebhook: FireWebhook;
let priorXdg: string | undefined;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cue-webhooks-test-"));
  priorXdg = process.env.XDG_CONFIG_HOME;
  // Point XDG_CONFIG_HOME at our sandbox BEFORE loading the module so
  // CONFIG_PATH bakes in the temp path, not the real ~/.config path.
  process.env.XDG_CONFIG_HOME = tmpDir;
  const mod = await import("./webhooks");
  fireWebhook = mod.fireWebhook;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = priorXdg;
});

describe("fireWebhook", () => {
  test("is a no-op when the config file does not exist", async () => {
    // The tmpDir/cue/config.yaml does not exist yet.
    const cfgPath = join(tmpDir, "cue", "config.yaml");
    expect(existsSync(cfgPath)).toBe(false);

    let fetchCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response();
    };

    try {
      await fireWebhook("profile.modified", { profile: "core" });
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("is a no-op when config.yaml has no webhooks key", async () => {
    const cfgDir = join(tmpDir, "cue");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "config.yaml"), "# empty config\n");

    let fetchCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response();
    };

    try {
      await fireWebhook("profile.modified", { profile: "core" });
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      rmSync(join(cfgDir, "config.yaml"));
    }
  });

  test("is a no-op when config has webhooks but none match the event", async () => {
    const cfgDir = join(tmpDir, "cue");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.yaml"),
      [
        "webhooks:",
        '  - url: "http://example.com/hook"',
        "    events:",
        '      - "profile.created"',
      ].join("\n") + "\n",
    );

    let fetchCalled = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response();
    };

    try {
      // Fire "profile.modified" — config only lists "profile.created"
      await fireWebhook("profile.modified", { profile: "core" });
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
      rmSync(join(cfgDir, "config.yaml"));
    }
  });

  test("calls fetch with correct URL and JSON body when event matches", async () => {
    const cfgDir = join(tmpDir, "cue");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.yaml"),
      [
        "webhooks:",
        '  - url: "http://hook.example/notify"',
        "    events:",
        '      - "profile.modified"',
      ].join("\n") + "\n",
    );

    const calls: { url: string; body: string }[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: (init?.body as string) ?? "" });
      return new Response(null, { status: 200 });
    };

    try {
      await fireWebhook("profile.modified", { profile: "test-profile" });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("http://hook.example/notify");
      const parsed = JSON.parse(calls[0]!.body);
      expect(parsed.event).toBe("profile.modified");
      expect(parsed.profile).toBe("test-profile");
      expect(typeof parsed.ts).toBe("string");
    } finally {
      globalThis.fetch = origFetch;
      rmSync(join(cfgDir, "config.yaml"));
    }
  });

  test("silently swallows fetch errors (best-effort semantics)", async () => {
    const cfgDir = join(tmpDir, "cue");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.yaml"),
      [
        "webhooks:",
        '  - url: "http://unreachable.example/hook"',
        "    events:",
        '      - "profile.locked"',
      ].join("\n") + "\n",
    );

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network error");
    };

    try {
      // Must not throw — webhooks are best-effort.
      await expect(fireWebhook("profile.locked", {})).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = origFetch;
      rmSync(join(cfgDir, "config.yaml"));
    }
  });
});
