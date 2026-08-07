/**
 * `cue feedback` — collect lightweight opt-in feedback from users.
 *
 * - Stored locally at ~/.config/cue/feedback.log (one JSON line per submission)
 * - On first opt-in submission, asks if the user wants to share it as a GitHub
 *   issue on opencue/cuecards. Always opt-in; never automatic.
 * - Three questions: how-found, what-using-for, what-blocked.
 *
 * Run with --view to dump local entries. Run with --share <id> to open a
 * gh issue from a past entry.
 *
 * Privacy: nothing is sent anywhere without the user pressing through a
 * confirm prompt. The local log lives on the user's disk only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const LOG_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue",
  "feedback.log",
);

interface FeedbackEntry {
  id: string;
  ts: string;
  cue_version: string;
  how_found?: string;
  using_for?: string;
  what_blocked?: string;
  shared_issue_url?: string;
}

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getCueVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname ?? __dirname, "..", "..", "package.json"), "utf8"));
    return pkg.version ?? "unknown";
  } catch { return "unknown"; }
}

function loadEntries(): FeedbackEntry[] {
  if (!existsSync(LOG_PATH)) return [];
  return readFileSync(LOG_PATH, "utf8")
    .split("\n")
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e): e is FeedbackEntry => !!e);
}

function saveEntry(entry: FeedbackEntry): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
}

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = await rl.question(`\n  ${bold(question)}\n  ${dim("(press Enter to skip)")} > `);
  return answer.trim();
}

async function viewCmd(): Promise<number> {
  const entries = loadEntries();
  if (entries.length === 0) {
    process.stdout.write(`\n  ${dim("No feedback entries yet.")} Run ${bold("cue feedback")} to add one.\n\n`);
    return 0;
  }
  process.stdout.write(`\n  ${bold(`${entries.length} feedback entries`)} ${dim("(local — never sent unless you explicitly share)")}\n\n`);
  for (const e of entries) {
    process.stdout.write(`  ${cyan(e.id)}  ${dim(e.ts)}  ${dim("cue " + e.cue_version)}\n`);
    if (e.how_found) process.stdout.write(`     ${dim("how found:")} ${e.how_found}\n`);
    if (e.using_for) process.stdout.write(`     ${dim("using for:")} ${e.using_for}\n`);
    if (e.what_blocked) process.stdout.write(`     ${dim("blocked:")} ${e.what_blocked}\n`);
    if (e.shared_issue_url) process.stdout.write(`     ${green("shared:")} ${e.shared_issue_url}\n`);
    process.stdout.write("\n");
  }
  process.stdout.write(`  ${dim(`Local log:`)} ${LOG_PATH}\n\n`);
  return 0;
}

function buildIssueBody(e: FeedbackEntry): string {
  return `> Feedback submitted via \`cue feedback --share\`. Posted with the user's explicit consent.

**cue version**: ${e.cue_version}
**timestamp**: ${e.ts}

### How did you find cue?
${e.how_found || "_(skipped)_"}

### What are you using cue for?
${e.using_for || "_(skipped)_"}

### What's blocking you / what's missing?
${e.what_blocked || "_(skipped)_"}

---

<sub>Anonymous submission from \`cue feedback\`. The user chose to share this as a GitHub issue; nothing was sent automatically.</sub>`;
}

async function shareCmd(args: string[]): Promise<number> {
  const id = args.find(a => !a.startsWith("-"));
  const entries = loadEntries();
  const entry = id
    ? entries.find(e => e.id === id)
    : entries[entries.length - 1];
  if (!entry) {
    process.stderr.write(`No feedback entry found${id ? ` for id "${id}"` : ""}.\n`);
    return 1;
  }
  if (entry.shared_issue_url) {
    process.stdout.write(`  ${dim("Already shared:")} ${entry.shared_issue_url}\n`);
    return 0;
  }
  if (!hasGh()) {
    process.stderr.write("gh CLI not found. Install: https://cli.github.com/\n");
    return 1;
  }
  const title = `Feedback — cue ${entry.cue_version} (${entry.id})`;
  const body = buildIssueBody(entry);
  const dryRun = args.includes("--dry-run");
  if (dryRun) {
    process.stdout.write(`\n  ${bold("Would post to opencue/cuecards:")}\n\n  ${bold("Title:")} ${title}\n\n  ${bold("Body:")}\n${body}\n\n  ${dim("(dry-run — pass without --dry-run to post)")}\n\n`);
    return 0;
  }
  const res = spawnSync("gh", [
    "issue", "create",
    "--repo", "opencue/cuecards",
    "--title", title,
    "--body", body,
    "--label", "feedback",
  ], { encoding: "utf8", timeout: 15000 });
  if (res.status !== 0) {
    process.stderr.write(`Failed to post issue: ${res.stderr?.trim()}\n`);
    return 1;
  }
  const url = res.stdout.trim();
  entry.shared_issue_url = url;
  // Rewrite log with the URL added (replace the matching line).
  const all = loadEntries().map(e => e.id === entry.id ? entry : e);
  writeFileSync(LOG_PATH, all.map(e => JSON.stringify(e)).join("\n") + "\n");
  process.stdout.write(`  ${green("✓ Shared:")} ${url}\n`);
  return 0;
}

function hasGh(): boolean {
  return spawnSync("gh", ["--version"], { stdio: "ignore", timeout: 1000 }).status === 0;
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`cue feedback — share what's working and what isn't

Usage:
  cue feedback                     Submit a new feedback entry (local only)
  cue feedback --view              Show all local entries
  cue feedback --share [id]        Share a past entry as a GitHub issue (consent required)
  cue feedback --share [id] --dry-run    Preview the issue body, don't post

All entries are stored locally at:
  ${LOG_PATH}

Entries are NEVER sent anywhere without your explicit consent. The --share
flag opens a GitHub issue on opencue/cuecards under your own gh identity.

Examples:
  cue feedback                     # walks through 3 questions
  cue feedback --view              # see what you've submitted
  cue feedback --share             # share the most recent entry
`);
    return 0;
  }

  if (args.includes("--view")) return viewCmd();
  if (args.includes("--share")) return shareCmd(args.slice(args.indexOf("--share") + 1));

  process.stdout.write(`\n  ${bold("cue feedback")} ${dim("· local-only, opt-in to share")}\n`);
  process.stdout.write(`  ${dim("Three short questions. Skip any with Enter. Nothing is sent unless you run --share.")}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const how_found = await ask(rl, "1. How did you find cue?");
    const using_for = await ask(rl, "2. What are you using cue for? (one or two sentences)");
    const what_blocked = await ask(rl, "3. What's blocking you, or what's missing? (any pain point)");

    const entry: FeedbackEntry = {
      id: genId(),
      ts: new Date().toISOString(),
      cue_version: getCueVersion(),
      ...(how_found ? { how_found } : {}),
      ...(using_for ? { using_for } : {}),
      ...(what_blocked ? { what_blocked } : {}),
    };
    saveEntry(entry);
    process.stdout.write(`\n  ${green("✓ Saved locally")} ${dim(`(id: ${entry.id})`)}\n`);
    process.stdout.write(`  ${dim("Path:")} ${LOG_PATH}\n\n`);
    process.stdout.write(`  ${bold("Want to share this as a GitHub issue on opencue/cuecards?")}\n`);
    const share = await rl.question(`  ${dim("Posts under your gh identity. y/N > ")}`);
    if (share.trim().toLowerCase().startsWith("y")) {
      await shareCmd([entry.id]);
    } else {
      process.stdout.write(`  ${dim("Skipped. You can share later with:")} ${bold(`cue feedback --share ${entry.id}`)}\n\n`);
    }
  } finally {
    rl.close();
  }
  return 0;
}
