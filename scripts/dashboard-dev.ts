#!/usr/bin/env bun
/**
 * One-command dev launcher for the cue dashboard.
 *
 * Boots the Bun-side `cue dashboard` API server (port 7891) AND the Vite
 * dev server (port 5173) in parallel, prefixes their logs so it's clear
 * which output belongs to which, and propagates SIGINT to both so a single
 * Ctrl-C tears down cleanly.
 *
 * Run from inside web/:  npm run dev:full
 * Or from repo root:    bun scripts/dashboard-dev.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = resolve(REPO_ROOT, "web");

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function pipe(label: string, color: string, child: ChildProcess): void {
  const prefix = `${color}[${label}]${COLORS.reset} `;
  child.stdout?.on("data", (buf: Buffer) => {
    for (const line of buf.toString("utf8").split("\n")) {
      if (line.length === 0) continue;
      process.stdout.write(`${prefix}${line}\n`);
    }
  });
  child.stderr?.on("data", (buf: Buffer) => {
    for (const line of buf.toString("utf8").split("\n")) {
      if (line.length === 0) continue;
      process.stderr.write(`${prefix}${line}\n`);
    }
  });
}

const dashboard = spawn(
  "bun",
  ["src/index.ts", "dashboard", "--no-open"],
  { cwd: REPO_ROOT, env: process.env },
);
pipe("dash", COLORS.magenta, dashboard);

// Cosmetic stagger: the API banner prints first in mixed logs.
// This delay is not a correctness dependency — vite starts safely regardless.
await new Promise((r) => setTimeout(r, 250));

const vite = spawn(
  "npx",
  ["vite", "--host", "127.0.0.1"],
  { cwd: WEB_DIR, env: process.env },
);
pipe("vite", COLORS.cyan, vite);

const shutdown = (signal: NodeJS.Signals = "SIGTERM") => {
  process.stdout.write(`\n${COLORS.dim}cue dashboard dev: shutting down…${COLORS.reset}\n`);
  for (const child of [dashboard, vite]) {
    try { child.kill(signal); } catch { /* already dead */ }
  }
};

process.on("SIGINT", () => { shutdown("SIGINT"); process.exit(130); });
process.on("SIGTERM", () => { shutdown("SIGTERM"); process.exit(143); });

// If either child exits unexpectedly, kill the other so the user doesn't
// end up with a half-running setup.
dashboard.on("exit", (code) => {
  if (code !== null && code !== 0) {
    process.stderr.write(`${COLORS.red}[dash]${COLORS.reset} exited with code ${code}\n`);
  }
  try { vite.kill("SIGTERM"); } catch { /* ignore */ }
});
vite.on("exit", (code) => {
  if (code !== null && code !== 0) {
    process.stderr.write(`${COLORS.red}[vite]${COLORS.reset} exited with code ${code}\n`);
  }
  try { dashboard.kill("SIGTERM"); } catch { /* ignore */ }
});

// Keep this process alive until both children exit.
await new Promise((resolveProc) => {
  let remaining = 2;
  const tick = () => { if (--remaining === 0) resolveProc(null); };
  dashboard.on("exit", tick);
  vite.on("exit", tick);
});
