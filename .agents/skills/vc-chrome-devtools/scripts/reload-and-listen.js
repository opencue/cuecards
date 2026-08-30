#!/usr/bin/env node
/**
 * Reload the active Flowser page and capture all console logs
 * for a fixed window. Used to verify reconciliation diagnostic instrumentation.
 *
 * Usage:
 *   node reload-and-listen.js --duration 8000 --target-url "linkedin-brand/chat" \
 *     [--no-reload]
 */
import puppeteer from "puppeteer";
import fs from "fs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browserUrl = args["browser-url"] || "http://localhost:9222";
  const duration = parseInt(args.duration || "8000", 10);
  const targetUrl = args["target-url"] || "chat";
  const out = args.out || null;
  const doReload = args["no-reload"] !== "true";

  const browser = await puppeteer.connect({
    browserURL: browserUrl,
    defaultViewport: null,
  });

  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes(targetUrl)) ?? pages[0];

  if (!page) {
    console.error(JSON.stringify({ ok: false, error: "no page" }));
    process.exit(1);
  }

  process.stderr.write(`[reload] target: ${page.url().slice(0, 120)}\n`);

  const messages = [];

  page.on("console", async (msg) => {
    // Resolve all JSHandle args to JSON strings so objects don't show as [object Object].
    let resolvedText = msg.text();
    try {
      const args = msg.args();
      const parts = await Promise.all(
        args.map(async (h) => {
          try {
            return await h.evaluate((v) => {
              if (v === undefined) return "undefined";
              if (v === null) return "null";
              if (typeof v === "object") {
                try { return JSON.stringify(v); } catch { return String(v); }
              }
              return String(v);
            });
          } catch { return "<unresolvable>"; }
        }),
      );
      resolvedText = parts.join(" ");
    } catch { /* fall back to msg.text() */ }
    messages.push({
      ts: Date.now(),
      type: msg.type(),
      text: resolvedText,
    });
  });

  page.on("pageerror", (err) => {
    messages.push({
      ts: Date.now(),
      type: "pageerror",
      text: err.message,
    });
  });

  if (doReload) {
    process.stderr.write(`[reload] reloading...\n`);
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  await new Promise((r) => setTimeout(r, duration));

  const planB = messages.filter((m) => m.text.includes("[plan-b]"));
  const ws = messages.filter((m) => m.text.includes("[WS"));
  const errors = messages.filter((m) => m.type === "error" || m.type === "pageerror");

  const result = {
    ok: true,
    pageUrl: page.url(),
    totalMessages: messages.length,
    planBCount: planB.length,
    wsCount: ws.length,
    errorCount: errors.length,
    allMessages: messages, // include everything
    planB,
  };

  if (out) {
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      ok: true,
      file: out,
      planBCount: planB.length,
      wsCount: ws.length,
      totalMessages: messages.length,
    }));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  await browser.disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});
