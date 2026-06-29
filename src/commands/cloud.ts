/**
 * `cue login` — authenticate with cue cloud.
 * `cue push <profile>` — upload a profile to cloud.
 * `cue pull <profile>` — download a profile from cloud.
 * `cue logout` — clear credentials.
 *
 * API base: CUE_API_URL env var or https://api.getcue.dev
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { repoRoot } from "../lib/repo-root";

const PROFILES_DIR = process.env.CUE_PROFILES_DIR ?? join(repoRoot(), "profiles");
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cue");
const CREDS_FILE = join(CONFIG_DIR, "credentials.json");
const API_BASE = process.env.CUE_API_URL ?? "https://api.getcue.dev";

interface Credentials {
  token: string;
  user: string;
  team?: string;
  expires?: string;
}

function loadCreds(): Credentials | null {
  if (!existsSync(CREDS_FILE)) return null;
  try { return JSON.parse(readFileSync(CREDS_FILE, "utf8")); } catch { return null; }
}

function saveCreds(creds: Credentials): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}

function clearCreds(): void {
  try { const { unlinkSync } = require("node:fs"); unlinkSync(CREDS_FILE); } catch { /* ok */ }
}

// ---------------------------------------------------------------------------
// Login — GitHub OAuth device flow
// ---------------------------------------------------------------------------

async function cmdLogin(): Promise<number> {
  const creds = loadCreds();
  if (creds) {
    process.stdout.write(`Already logged in as ${creds.user}${creds.team ? ` (team: ${creds.team})` : ""}.\n`);
    process.stdout.write(`Run \`cue logout\` to switch accounts.\n`);
    return 0;
  }

  process.stdout.write(`Authenticating with cue cloud (${API_BASE})...\n\n`);

  // Use gh CLI for GitHub OAuth (simplest path)
  const { spawnSync } = await import("node:child_process");
  const ghCheck = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });

  if (ghCheck.status !== 0) {
    process.stderr.write("GitHub CLI not authenticated. Run `gh auth login` first.\n");
    return 1;
  }

  // Get GitHub username
  const whoami = spawnSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" });
  const username = whoami.stdout.trim();

  if (!username) {
    process.stderr.write("Could not determine GitHub username.\n");
    return 1;
  }

  // Get a token from gh (use as bearer for our API)
  const tokenRes = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  const token = tokenRes.stdout.trim();

  if (!token) {
    process.stderr.write("Could not get auth token from gh CLI.\n");
    return 1;
  }

  // Try to register/login with our API
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ provider: "github", username }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json() as { token: string; user: string; team?: string };
      saveCreds({ token: data.token, user: data.user, team: data.team });
      process.stdout.write(`✅ Logged in as ${data.user}\n`);
      if (data.team) process.stdout.write(`   Team: ${data.team}\n`);
      return 0;
    }

    // API not available yet — save local creds for future use
    process.stderr.write(`⚠️  Cloud API not available yet (${res.status}). Saving credentials locally.\n`);
  } catch {
    process.stderr.write(`⚠️  Cloud API not reachable (${API_BASE}). Saving credentials locally.\n`);
  }

  // Fallback: save local creds so push/pull know who you are
  saveCreds({ token, user: username });
  process.stdout.write(`✅ Logged in locally as ${username}\n`);
  process.stdout.write(`   Cloud sync will work once the API is live.\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Push — upload a profile to cloud
// ---------------------------------------------------------------------------

async function cmdPush(args: string[]): Promise<number> {
  const creds = loadCreds();
  if (!creds) {
    process.stderr.write("Not logged in. Run `cue login` first.\n");
    return 1;
  }

  const profileName = args[0];
  if (!profileName) {
    process.stderr.write("Usage: cue push <profile>\n");
    return 1;
  }

  const yamlPath = join(PROFILES_DIR, profileName, "profile.yaml");
  if (!existsSync(yamlPath)) {
    process.stderr.write(`Profile "${profileName}" not found.\n`);
    return 1;
  }

  const content = readFileSync(yamlPath, "utf8");
  const namespace = args.includes("--team") ? `${creds.team}/${profileName}` : `${creds.user}/${profileName}`;

  process.stdout.write(`Pushing "${profileName}" → ${namespace}...\n`);

  try {
    const res = await fetch(`${API_BASE}/profiles/${namespace}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/yaml",
        "Authorization": `Bearer ${creds.token}`,
      },
      body: content,
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      process.stdout.write(`✅ Pushed "${profileName}" to cloud as ${namespace}\n`);
      process.stdout.write(`   Others can pull with: cue pull ${namespace}\n`);
      return 0;
    }

    process.stderr.write(`⚠️  Push failed (${res.status}): ${await res.text()}\n`);
  } catch {
    process.stderr.write(`⚠️  Cloud API not reachable. Profile saved locally only.\n`);
    process.stderr.write(`   Will sync when API is live. Run \`cue push ${profileName}\` again later.\n`);
  }

  return 1;
}

// ---------------------------------------------------------------------------
// Pull — download a profile from cloud
// ---------------------------------------------------------------------------

async function cmdPull(args: string[]): Promise<number> {
  const creds = loadCreds();
  if (!creds) {
    process.stderr.write("Not logged in. Run `cue login` first.\n");
    return 1;
  }

  const ref = args[0]; // user/profile or team/profile
  if (!ref) {
    process.stderr.write("Usage: cue pull <user/profile> or cue pull <team/profile>\n");
    return 1;
  }

  process.stdout.write(`Pulling "${ref}" from cloud...\n`);

  try {
    const res = await fetch(`${API_BASE}/profiles/${ref}`, {
      headers: { "Authorization": `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      process.stderr.write(`⚠️  Pull failed (${res.status}): ${await res.text()}\n`);
      return 1;
    }

    const content = await res.text();
    const yaml = require("yaml");
    const parsed = yaml.parse(content);
    const name = parsed.name ?? ref.split("/").pop()!;

    // Write to profiles dir
    const profileDir = join(PROFILES_DIR, name);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"), content);

    process.stdout.write(`✅ Pulled "${ref}" → profiles/${name}/\n`);
    process.stdout.write(`   Activate with: cue use ${name}\n`);
    return 0;
  } catch {
    process.stderr.write(`⚠️  Cloud API not reachable (${API_BASE}).\n`);
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

function cmdLogout(): number {
  clearCreds();
  process.stdout.write("✅ Logged out. Credentials cleared.\n");
  return 0;
}

// ---------------------------------------------------------------------------
// Whoami
// ---------------------------------------------------------------------------

function cmdWhoami(): number {
  const creds = loadCreds();
  if (!creds) {
    process.stdout.write("Not logged in. Run `cue login`.\n");
    return 1;
  }
  process.stdout.write(`User: ${creds.user}\n`);
  if (creds.team) process.stdout.write(`Team: ${creds.team}\n`);
  process.stdout.write(`API:  ${API_BASE}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// Router — these are registered as separate commands in _index.ts
// ---------------------------------------------------------------------------

export async function run(args: string[]): Promise<number> {
  // Determine which command was invoked based on process.argv
  const cmd = process.argv[2]; // "login", "push", "pull", "logout", "whoami"

  switch (cmd) {
    case "login": return cmdLogin();
    case "push": return cmdPush(args);
    case "pull": return cmdPull(args);
    case "logout": return cmdLogout();
    case "whoami": return cmdWhoami();
    default:
      // If called directly with subcommand as first arg
      switch (args[0]) {
        case "login": return cmdLogin();
        case "push": return cmdPush(args.slice(1));
        case "pull": return cmdPull(args.slice(1));
        case "logout": return cmdLogout();
        case "whoami": return cmdWhoami();
        default:
          process.stderr.write("Usage: cue login | cue push <profile> | cue pull <user/profile> | cue logout | cue whoami\n");
          return 1;
      }
  }
}
