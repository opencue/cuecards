#!/usr/bin/env node
/**
 * Attach to an existing Chrome tab via remote debugging WITHOUT navigating.
 * Captures console messages + network requests for a fixed duration.
 *
 * Usage:
 *   node attach-listener.js --duration 30000 --filter "[plan-b]" \
 *     --out /tmp/logs/session.json
 *
 * Designed to leave the page state intact (no goto, no reload).
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
  const duration = parseInt(args.duration || "30000", 10);
  const filter = args.filter || null;
  const out = args.out || null;
  const targetUrl = args["target-url"] || null;

  const browser = await puppeteer.connect({
    browserURL: browserUrl,
    defaultViewport: null,
  });

  const pages = await browser.pages();
  const page = targetUrl
    ? pages.find((p) => p.url().includes(targetUrl)) ?? pages[0]
    : pages.find((p) => p.url().startsWith("http")) ?? pages[0];

  if (!page) {
    console.error(JSON.stringify({ ok: false, error: "no page found" }));
    process.exit(1);
  }

  process.stderr.write(
    `[attach] target page: ${page.url().slice(0, 120)}\n`,
  );
  process.stderr.write(`[attach] listening for ${duration}ms\n`);

  const messages = [];
  const network = [];

  page.on("console", (msg) => {
    const text = msg.text();
    if (filter && !text.includes(filter)) return;
    messages.push({
      ts: Date.now(),
      type: msg.type(),
      text,
    });
  });

  page.on("pageerror", (err) => {
    messages.push({
      ts: Date.now(),
      type: "pageerror",
      text: err.message,
      stack: err.stack,
    });
  });

  // Network: only capture tRPC + WS for signal
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/trpc") || u.includes("/ws") || u.includes("getActiveRun")) {
      network.push({
        ts: Date.now(),
        kind: "request",
        method: req.method(),
        url: u.slice(0, 200),
      });
    }
  });
  page.on("response", (resp) => {
    const u = resp.url();
    if (u.includes("/api/trpc") || u.includes("getActiveRun")) {
      network.push({
        ts: Date.now(),
        kind: "response",
        status: resp.status(),
        url: u.slice(0, 200),
      });
    }
  });

  // Hook into CDP for WebSocket frames
  const cdp = await page.target().createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameReceived", (e) => {
    const payload = String(e.response?.payloadData || "").slice(0, 400);
    if (payload.includes("getActiveRun") || payload.includes("chat") || payload.includes("agent") || payload.includes("runId")) {
      network.push({
        ts: Date.now(),
        kind: "ws-recv",
        payload,
      });
    }
  });
  cdp.on("Network.webSocketFrameSent", (e) => {
    const payload = String(e.response?.payloadData || "").slice(0, 400);
    if (payload.includes("chat") || payload.includes("getActiveRun")) {
      network.push({
        ts: Date.now(),
        kind: "ws-send",
        payload,
      });
    }
  });

  await new Promise((r) => setTimeout(r, duration));

  const result = {
    ok: true,
    pageUrl: page.url(),
    messageCount: messages.length,
    networkCount: network.length,
    messages,
    network,
  };

  if (out) {
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    process.stderr.write(`[attach] wrote ${out}\n`);
    console.log(JSON.stringify({ ok: true, file: out, messageCount: messages.length, networkCount: network.length }));
  } else {
    console.log(JSON.stringify(result));
  }

  await browser.disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e) }));
  process.exit(1);
});
