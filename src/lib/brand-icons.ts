/**
 * Brand icons — map skill/MCP names to image paths for Kitty terminal rendering.
 *
 * Resolution order:
 *   1. Skill's own assets/ dir (e.g. skills/research/openai-docs/assets/openai.png)
 *   2. Profile logo (e.g. profiles/nvidia/logo.png)
 *   3. resources/icons/<name>.png (shared icon library)
 *   4. null (no icon available — use emoji fallback)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");
const ICONS_DIR = join(repoRoot(), "resources", "icons");

// Known brand → asset file mappings (skill slug or MCP id → relative icon path)
const BRAND_ICONS: Record<string, string> = {
  // Skills with bundled icons
  "openai-docs": "research/openai-docs/assets/openai.png",
  "playwright": "content/playwright/assets/playwright.png",
  "screenshot": "design/screenshot/assets/screenshot.png",
  "pdf": "content/pdf/assets/pdf.png",
  "doc": "content/doc/assets/doc.png",
  // Polymarket skills
  "polymarket-research": "research/polymarket-research/assets/polymarket.png",
  "polymarket-predictions-audit": "research/polymarket-predictions-audit/assets/polymarket.png",
  // Stripe
  "stripe-best-practices": "_icons/stripe.png",
  "stripe-webhooks": "_icons/stripe.png",
  // GitHub
  "github": "_icons/github.png",
  "gh-fix-ci": "_icons/github.png",
  // Obsidian
  "obsidian-markdown": "_icons/obsidian.png",
  "obsidian-cli": "_icons/obsidian.png",
  "obsidian-bases": "_icons/obsidian.png",
  "json-canvas": "_icons/obsidian.png",
  // Medusa
  "building-with-medusa": "_icons/medusa.png",
  "building-storefronts": "_icons/medusa.png",
  "storefront-best-practices": "_icons/medusa.png",
  "medusa-reference": "_icons/medusa.png",
  "medusa-shop-setup": "_icons/medusa.png",
  "db-generate": "_icons/medusa.png",
  "db-migrate": "_icons/medusa.png",
  // Higgsfield
  "higgsfield-generate": "_icons/higgsfield.png",
  "higgsfield-product-photoshoot": "_icons/higgsfield.png",
  "higgsfield-marketplace-cards": "_icons/higgsfield.png",
  "higgsfield-soul-id": "_icons/higgsfield.png",
  "higgsfield-to-medusa-products": "_icons/higgsfield.png",
  // Coolify
  "coolify": "_icons/coolify-brand.png",
};

// MCP → profile logo or known icon
const MCP_ICONS: Record<string, string> = {
  "coolify": "resources/icons/coolify-brand.png",
  "hostinger-api": "profiles/hostinger/logo.png",
  "polymarket-live": "resources/icons/polymarket.png",
  "medusadocs": "resources/icons/medusa.png",
  "Higgsfield": "resources/icons/higgsfield.png",
  "colony": "resources/icons/colony.png",
  "gbrain": "resources/icons/obsidian.png",
  "obsidian-vault": "resources/icons/obsidian.png",
  "soul-skills": "resources/icons/colony.png",
};

/**
 * Resolve an icon path for a skill slug.
 * Returns absolute path or null.
 */
export function getSkillIcon(skillSlug: string): string | null {
  // 1. Check BRAND_ICONS map
  if (BRAND_ICONS[skillSlug]) {
    const ref = BRAND_ICONS[skillSlug]!;
    // _icons/ prefix means shared icons dir
    if (ref.startsWith("_icons/")) {
      const p = join(ICONS_DIR, ref.slice(7));
      if (existsSync(p)) return p;
    } else {
      const p = join(SKILLS_ROOT, ref);
      if (existsSync(p)) return p;
    }
  }

  // 2. Check skill's own assets/ directory for any .png
  const categories = ["research", "content", "design", "meta", "review", "deployment",
    "medusa", "nvidia", "stripe", "github", "caveman", "obsidian", "higgsfield",
    "orchestration", "colony", "hostinger", "polymarket", "browser", "secrets"];

  for (const cat of categories) {
    const assetsDir = join(SKILLS_ROOT, cat, skillSlug, "assets");
    if (existsSync(assetsDir)) {
      // Look for any .png file
      try {
        const { readdirSync } = require("node:fs");
        const files = readdirSync(assetsDir) as string[];
        const png = files.find((f: string) => f.endsWith(".png"));
        if (png) return join(assetsDir, png);
      } catch { /* skip */ }
    }
  }

  // 3. Check shared icons dir
  const sharedIcon = join(ICONS_DIR, `${skillSlug}.png`);
  if (existsSync(sharedIcon)) return sharedIcon;

  return null;
}

/**
 * Resolve an icon path for an MCP server.
 */
export function getMcpIcon(mcpId: string): string | null {
  // 1. Check MCP_ICONS map
  if (MCP_ICONS[mcpId]) {
    const p = join(repoRoot(), MCP_ICONS[mcpId]!);
    if (existsSync(p)) return p;
  }

  // 2. Check resources/mcps/mcps/<id>/ for any icon
  const mcpDir = join(repoRoot(), "resources", "mcps", "mcps", mcpId);
  if (existsSync(mcpDir)) {
    try {
      const { readdirSync } = require("node:fs");
      const files = readdirSync(mcpDir) as string[];
      const icon = files.find((f: string) => /\.(png|jpg|svg)$/.test(f));
      if (icon) return join(mcpDir, icon);
    } catch { /* skip */ }
  }

  // 3. Shared icons
  const sharedIcon = join(ICONS_DIR, `${mcpId}.png`);
  if (existsSync(sharedIcon)) return sharedIcon;

  return null;
}

/**
 * Resolve an icon for a GitHub repo source.
 */
export function getRepoIcon(repo: string): string | null {
  // org/repo → check for org.png in icons dir
  const org = repo.split("/")[0]!;
  const sharedIcon = join(ICONS_DIR, `${org}.png`);
  if (existsSync(sharedIcon)) return sharedIcon;
  return null;
}

/**
 * Resolve an icon for a CLI tool.
 */
export function getCliIcon(cli: string): string | null {
  const CLI_ICON_MAP: Record<string, string> = {
    python: "python.png", pip: "python.png", uv: "python.png", uvx: "python.png",
    node: "nodejs.png", npm: "nodejs.png", npx: "nodejs.png", bun: "nodejs.png", pnpm: "nodejs.png", yarn: "nodejs.png", deno: "nodejs.png",
    docker: "docker.png",
    kubectl: "kubernetes.png", helm: "kubernetes.png",
    terraform: "hashicorp.png",
    ansible: "ansible.png",
    aws: "aws.png",
    gcloud: "gcloud.png",
    az: "azure.png",
    git: "github.png", gh: "github.png",
    go: "golang.png",
    cargo: "rust.png", rustc: "rust.png",
    splunk: "splunk.png",
    elastic: "elastic.png", kibana: "elastic.png",
    wireshark: "wireshark.png", tcpdump: "wireshark.png",
    nmap: "nmap.png",
    frida: "frida.png", objection: "frida.png",
    ghidra: "ghidra.png",
    zap: "owasp.png", nikto: "owasp.png",
    higgsfield: "higgsfield.png",
    coolify: "coolify-brand.png",
  };

  const file = CLI_ICON_MAP[cli];
  if (!file) return null;
  const p = join(ICONS_DIR, file);
  return existsSync(p) ? p : null;
}
