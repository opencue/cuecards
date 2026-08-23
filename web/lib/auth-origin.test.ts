import { describe, expect, test } from "bun:test";

import { resolveAuthBaseUrl } from "./auth-origin.js";

describe("resolveAuthBaseUrl", () => {
  test("uses an explicit production origin and trims its trailing slash", () => {
    expect(resolveAuthBaseUrl({ BETTER_AUTH_URL: "https://cuecards.cc/" })).toBe("https://cuecards.cc");
  });

  test("derives an HTTPS origin for Vercel previews", () => {
    expect(resolveAuthBaseUrl({ VERCEL_URL: "cuecards-preview.vercel.app" })).toBe(
      "https://cuecards-preview.vercel.app",
    );
  });

  test("keeps the local auth server default outside Vercel", () => {
    expect(resolveAuthBaseUrl({})).toBe("http://localhost:3000");
  });
});
