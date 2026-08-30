#!/usr/bin/env node
/**
 * Inspect the chat page DOM to find the prompt input and send button selectors.
 */
import puppeteer from "puppeteer";

async function main() {
  const browser = await puppeteer.connect({
    browserURL: "http://localhost:9222",
    defaultViewport: null,
  });

  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes("chat")) ?? pages[0];

  if (!page) { console.log(JSON.stringify({ ok: false })); process.exit(1); }

  const result = await page.evaluate(() => {
    // Find textareas, contenteditables, and any send-like buttons.
    const inputs = Array.from(document.querySelectorAll("textarea, [contenteditable='true'], input[type='text']")).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      placeholder: el.getAttribute("placeholder"),
      contenteditable: el.getAttribute("contenteditable"),
      ariaLabel: el.getAttribute("aria-label"),
      id: el.id || null,
      className: (el.className || "").slice(0, 120),
      rect: el.getBoundingClientRect().toJSON(),
    }));
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => ({
      text: (b.innerText || "").slice(0, 60),
      ariaLabel: b.getAttribute("aria-label"),
      title: b.getAttribute("title"),
      disabled: b.disabled,
      type: b.getAttribute("type"),
      className: (b.className || "").slice(0, 100),
      rect: b.getBoundingClientRect().toJSON(),
    })).filter(b => {
      // Only buttons in lower 30% of viewport (chat input area)
      const r = b.rect;
      return r.width > 0 && r.top > window.innerHeight * 0.6;
    });
    return { inputs, buttons };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.disconnect();
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
