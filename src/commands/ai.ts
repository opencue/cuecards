/**
 * `cue ai <description>` — create a profile from natural language.
 *
 * Matches the description against known profiles and skills in the registry,
 * then generates a profile.yaml. No external API needed — uses local matching.
 *
 * Examples:
 *   cue ai "fastapi app with postgres and redis"
 *   cue ai "react frontend with tailwind"
 *   cue ai "rust cli tool"
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { listProfiles } from "../lib/profile-loader";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILES_DIR = join(REPO_ROOT, "profiles");
const REGISTRY_PATH = join(REPO_ROOT, "docs", "registry", "index.json");

interface MatchedProfile {
  name: string;
  score: number;
  description: string;
}

// Keywords → profile mapping
const PROFILE_KEYWORDS: Record<string, string[]> = {
  "nextjs": ["next", "nextjs", "next.js", "vercel", "app router", "server components", "react ssr"],
  "frontend": ["react", "vue", "svelte", "frontend", "ui", "tailwind", "vite", "css", "component"],
  "backend": ["api", "express", "fastify", "hono", "webhook", "rest", "graphql", "node server", "prisma", "drizzle"],
  "python-api": ["python", "fastapi", "django", "flask", "sqlalchemy", "alembic", "uvicorn", "pytest", "pip"],
  "rust": ["rust", "cargo", "tokio", "async rust", "cli tool", "systems", "wasm"],
  "go-api": ["go", "golang", "gin", "echo", "chi", "gorm", "goroutine"],
  "medusa-dev": ["medusa", "ecommerce", "storefront", "shop", "cart", "checkout"],
  "cybersecurity": ["security", "pentest", "forensics", "dfir", "red team", "blue team", "vulnerability"],
  "creative-media": ["image", "video", "design", "brand", "visual", "photoshoot", "asset"],
  "video": ["video", "ffmpeg", "gif", "frames", "transcription", "whisper"],
  "docs-writer": ["docs", "documentation", "markdown", "obsidian", "writing", "blog"],
  "readme-writer": ["readme", "svg", "badge", "github profile"],
  "research": ["research", "paper", "literature", "citation", "academic"],
  "threejs": ["three.js", "threejs", "3d", "webgl", "shader", "scene"],
  "coolify": ["coolify", "deploy", "self-host", "vps"],
  "hostinger": ["hostinger", "dns", "domain", "hosting"],
  "marketing": ["marketing", "seo", "copywriting", "growth", "conversion", "brand"],
  "fleet-control": ["multi-agent", "colony", "parallel", "orchestration"],
  "nvidia": ["nvidia", "gpu", "cuda", "cuopt", "routing", "optimization"],
  "affiliate": ["affiliate", "link", "commission", "tracking"],
};

function matchProfiles(description: string): MatchedProfile[] {
  const desc = description.toLowerCase();
  const results: MatchedProfile[] = [];

  for (const [profile, keywords] of Object.entries(PROFILE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (desc.includes(kw)) score += kw.split(" ").length; // multi-word matches score higher
    }
    if (score > 0) {
      // Load profile description
      let profileDesc = "";
      try {
        const yaml = readFileSync(join(PROFILES_DIR, profile, "profile.yaml"), "utf8");
        const parsed = parseYaml(yaml);
        profileDesc = parsed.description ?? "";
      } catch {}
      results.push({ name: profile, score, description: profileDesc });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help") || args.length === 0) {
    process.stdout.write(`cue ai — create a profile from natural language description

Usage:
  cue ai "fastapi app with postgres and redis"
  cue ai "react frontend with tailwind and testing"
  cue ai "rust cli tool with async"

Options:
  --name <name>    Profile name (auto-generated if not set)
  --apply          Create the profile and pin it immediately
`);
    return 0;
  }

  const apply = args.includes("--apply");
  const nameIdx = args.indexOf("--name");
  const customName = nameIdx >= 0 ? args[nameIdx + 1] : null;
  const description = args.filter(a => !a.startsWith("-") && a !== customName).join(" ");

  if (!description) {
    process.stderr.write("Provide a description: cue ai \"your stack description\"\n");
    return 1;
  }

  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

  // Match against known profiles
  const matches = matchProfiles(description);

  if (matches.length === 0) {
    process.stdout.write(`No matching profiles for: "${description}"\n`);
    process.stdout.write(`Try: cue list  to see available profiles\n`);
    return 0;
  }

  const best = matches[0]!;

  // If exact match with high confidence, suggest using it directly
  if (matches.length === 1 || best.score >= 3) {
    process.stdout.write(`\n  ${green("✓")} Best match: ${bold(best.name)}\n`);
    process.stdout.write(`    ${dim(best.description)}\n\n`);

    if (matches.length > 1) {
      process.stdout.write(`  Also considered:\n`);
      for (const m of matches.slice(1, 4)) {
        process.stdout.write(`    ${m.name} ${dim(`(${m.description.slice(0, 60)}...)`)}\n`);
      }
      process.stdout.write("\n");
    }

    if (apply) {
      writeFileSync(join(process.cwd(), ".cue-profile"), best.name + "\n");
      process.stdout.write(`  ${green("✓")} Pinned ${bold(best.name)} to this directory.\n\n`);
    } else {
      process.stdout.write(`  Use it:  ${bold(`cue use ${best.name}`)}\n`);
      process.stdout.write(`  Or:      ${bold(`cue ai "${description}" --apply`)}\n\n`);
    }
    return 0;
  }

  // Multiple weak matches — generate a composite profile
  const profileName = customName ?? description.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 30);

  process.stdout.write(`\n  Generating profile ${bold(profileName)} from:\n`);
  for (const m of matches.slice(0, 3)) {
    process.stdout.write(`    • ${m.name} ${dim(`(score: ${m.score})`)}\n`);
  }

  // Use the highest-scoring match as the base (inherits from it)
  const inheritsFrom = best.name;

  const profileYaml = {
    name: profileName,
    icon: "🤖",
    description: description,
    inherits: inheritsFrom,
    skills: { local: [] as string[] },
    mcps: [] as string[],
  };

  const output = stringifyYaml(profileYaml);

  if (apply) {
    const profileDir = join(PROFILES_DIR, profileName);
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "profile.yaml"), output);
    writeFileSync(join(process.cwd(), ".cue-profile"), profileName + "\n");
    process.stdout.write(`\n  ${green("✓")} Created ${bold(profileName)} (inherits from ${inheritsFrom})\n`);
    process.stdout.write(`  ${green("✓")} Pinned to this directory.\n`);
    process.stdout.write(`  Edit: profiles/${profileName}/profile.yaml\n\n`);
  } else {
    process.stdout.write(`\n  Generated profile.yaml:\n\n`);
    process.stdout.write(output.split("\n").map(l => `    ${l}`).join("\n") + "\n\n");
    process.stdout.write(`  Create it: ${bold(`cue ai "${description}" --apply`)}\n\n`);
  }

  return 0;
}
