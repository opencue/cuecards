/**
 * Profile categories, shared by every grouped picker surface (the combine
 * multiselect and the v2 palette's "all profiles" section): turn the flat
 * 90-item wall into scannable groups. Names not listed fall into "other",
 * which sorts last so the catalogue still shows everything.
 *
 * Extracted from `lib/picker`; re-exported there for back-compat.
 */

export const COMBINE_CATEGORY_ORDER = [
  "orchestrators",
  "content & research",
  "frontend & design",
  "backend & infra",
  "commerce",
  "integrations",
  "other",
] as const;

const COMBINE_CATEGORY_OF: Record<string, string> = {
  growth: "orchestrators", builder: "orchestrators", studio: "orchestrators",
  maker: "orchestrators", improver: "orchestrators", agency: "orchestrators", full: "orchestrators",
  "blog-writer": "content & research", "docs-writer": "content & research",
  marketing: "content & research", research: "content & research", "readme-writer": "content & research",
  frontend: "frontend & design", nextjs: "frontend & design", vite: "frontend & design",
  "react-native": "frontend & design", designer: "frontend & design",
  "designer-medusa-next": "frontend & design", "designer-medusa-vite": "frontend & design",
  threejs: "frontend & design", browser: "frontend & design", wordpress: "frontend & design",
  "web-frontend-base": "frontend & design", "creative-media": "frontend & design", "event-design": "frontend & design",
  backend: "backend & infra", postgres: "backend & infra", supabase: "backend & infra",
  strapi: "backend & infra", aws: "backend & infra", vercel: "backend & infra",
  resend: "backend & infra", secops: "backend & infra", ops: "backend & infra",
  coolify: "backend & infra", hostinger: "backend & infra", "backend-base": "backend & infra",
  python: "backend & infra", "go-api": "backend & infra", rust: "backend & infra", "rust-core": "backend & infra",
  cybersecurity: "backend & infra",
  commerce: "commerce", webshop: "commerce", "webshop-google": "commerce", stripe: "commerce",
  finance: "commerce", "medusa-stack": "commerce", "medusa-dev": "commerce",
  "medusa-next": "commerce", "medusa-vite": "commerce",
  slack: "integrations", linear: "integrations", "claude-api": "integrations", ssh: "integrations",
  video: "integrations", postizz: "integrations", higgsfield: "integrations",
  "google-ads": "integrations", "google-analytics": "integrations", "google-drive": "integrations",
  instagram: "integrations", nvidia: "integrations",
};

/** Bucket a profile into a combine category. Unknown names → "other" (sorts last). */
export function combineCategoryOf(name: string): string {
  return COMBINE_CATEGORY_OF[name] ?? "other";
}
