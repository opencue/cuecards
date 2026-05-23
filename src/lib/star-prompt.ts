/**
 * First-run star prompt — ask user to star the repo once.
 * Stores flag in ~/.config/cue/starred so it only asks once.
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue");
const FLAG_FILE = join(CONFIG_DIR, ".star-prompted");
const ANALYTICS_FILE = join(CONFIG_DIR, "analytics.jsonl");
const REPO = "recodeee/cue";
const SESSION_THRESHOLD = 10;

export async function maybePromptStar(): Promise<void> {
  // Only prompt once ever
  if (existsSync(FLAG_FILE)) return;
  // Only in interactive TTY
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  // Only after N sessions
  let sessionCount = 0;
  try {
    const content = require("node:fs").readFileSync(ANALYTICS_FILE, "utf8");
    sessionCount = (content.match(/"event":"start"/g) ?? []).length;
  } catch {}
  if (sessionCount < SESSION_THRESHOLD) return;
  // Check if gh CLI is available
  const ghCheck = spawnSync("gh", ["--version"], { encoding: "utf8", timeout: 3000 });
  if (ghCheck.status !== 0) { markDone(); return; }

  // Check if already starred
  const starCheck = spawnSync("gh", ["api", `user/starred/${REPO}`, "--silent"], {
    encoding: "utf8", timeout: 5000,
  });
  if (starCheck.status === 0) {
    // Already starred
    markDone();
    return;
  }

  // Prompt
  process.stdout.write("\n");
  process.stdout.write("  ⭐ Enjoying cue? Star the repo to help others find it!\n");
  process.stdout.write(`     https://github.com/${REPO}\n`);
  process.stdout.write("\n");
  process.stdout.write("  [y] Star it  [n] No thanks  [Enter] Skip\n");
  process.stdout.write("  > ");

  // Read one character
  const answer = await new Promise<string>((resolve) => {
    const onData = (data: Buffer) => {
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      resolve(data.toString().trim().toLowerCase());
    };
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", onData);
    // Timeout after 10s — don't block launch
    setTimeout(() => {
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      if (process.stdin.setRawMode) process.stdin.setRawMode(false);
      resolve("");
    }, 10000);
  });

  if (answer === "y" || answer === "yes") {
    const res = spawnSync("gh", ["api", "-X", "PUT", `user/starred/${REPO}`], {
      encoding: "utf8", timeout: 10000,
    });
    if (res.status === 0) {
      process.stdout.write("  ⭐ Starred! Thanks for supporting cue.\n\n");
    } else {
      process.stdout.write(`  Could not star (${res.stderr?.trim()}). Star manually: https://github.com/${REPO}\n\n`);
    }
  } else {
    process.stdout.write("\n");
  }

  markDone();
}

function markDone(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(FLAG_FILE, new Date().toISOString());
}
