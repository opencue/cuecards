// Browser smoke for the API tokens UI. Drives the real React app through the
// Vite dev server: register a new user, then create an API token, asserting the
// copy-once banner renders the token. Saves a screenshot for visual proof.
//
// Prereqs: Vite dev on :5173 (AUTH_TARGET -> auth server), auth server running,
// and Playwright available. If Playwright is installed globally rather than in
// this project, point PW_PKG at its package dir, e.g.
//   PW_PKG="$(npm root -g)/playwright" node scripts/smoke-ui.mjs
// Run: node scripts/smoke-ui.mjs
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const c of ["playwright", process.env.PW_PKG].filter(Boolean)) {
    try { return require(c); } catch { /* try next */ }
  }
  throw new Error("could not resolve 'playwright' — install it or set PW_PKG");
}
const { chromium } = loadPlaywright();

const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const SHOT = process.env.SHOT ?? "/tmp/cuecards-api-tokens.png";
const email = `ui+${Date.now()}@cuecards.cc`;

const fail = (msg) => { console.error(`FAIL ${msg}`); process.exit(1); };

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM, // optional explicit path
});
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [browser error]", m.text()); });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  // Open the API tokens view from the rail.
  await page.click('[data-label="API tokens"]');

  // Register.
  await page.waitForSelector("text=Create your free account", { timeout: 8000 });
  await page.fill('input[autocomplete="name"]', "UI Smoke");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "Test-passw0rd!");
  await page.click('button:has-text("Create account")');

  // Token page.
  await page.waitForSelector("h1:has-text('API')", { timeout: 8000 });
  console.log(`ok   registered + landed on token page (${email})`);

  // Create a token.
  await page.click('button:has-text("New token")');
  await page.fill(".api-newtoken-name", "claude");
  await page.click('.api-newtoken button:has-text("Create")');

  // Copy-once banner with a token.
  await page.waitForSelector(".api-tokenbanner", { timeout: 8000 });
  await page.click('.api-tokenbox button[title="Reveal"]');
  const token = (await page.textContent(".api-tokenbox code"))?.trim() ?? "";
  if (token.length < 20) fail(`token banner empty or too short: "${token}"`);
  console.log(`ok   created token, shown once (${token.slice(0, 6)}…)`);

  // A token row should now be listed.
  const rows = await page.locator(".api-tokenrow").count();
  if (rows < 1) fail("no token rows listed after create");
  console.log(`ok   token row listed (count=${rows})`);

  // Regenerate (create-then-delete): a fresh token appears and exactly one row
  // survives — proving the rotation didn't leave the user with zero tokens.
  const before = (await page.textContent(".api-tokenbox code"))?.trim() ?? "";
  await page.click('.api-tokenrow button:has-text("Regenerate")');
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector(".api-tokenbox code");
      return el && el.textContent && el.textContent.trim() !== prev;
    },
    before, { timeout: 8000 },
  );
  await page.waitForTimeout(300); // let reload() settle the list
  const afterRows = await page.locator(".api-tokenrow").count();
  if (afterRows !== 1) fail(`regenerate left ${afterRows} rows, expected exactly 1`);
  console.log(`ok   regenerate       -> new token, exactly ${afterRows} row survives`);

  await page.screenshot({ path: SHOT, fullPage: true });
  console.log(`\nPASS  UI smoke: register -> token page -> create token (shot: ${SHOT})`);
} catch (err) {
  await page.screenshot({ path: "/tmp/cuecards-api-fail.png" }).catch(() => {});
  fail(String(err));
} finally {
  await browser.close();
}
