/**
 * Profile-name constants shared between `commands/discover.ts` and
 * `commands/ai.ts`.  Keeping pure data here (no side-effects, no filesystem
 * reads) breaks the inverted lib → commands dependency that used to exist
 * when tests imported these directly from commands/.
 */

/**
 * Keyword map from profile name → indicative topic words.
 * `core` is intentionally absent — it is the fallback, not a keyword match.
 */
export const PROFILE_KEYWORDS: Record<string, string[]> = {
  backend: ["api", "server", "express", "fastapi", "django", "flask", "webhook", "database", "sql", "graphql", "deploy", "docker", "kubernetes", "microservice", "redis", "postgres", "mongo", "supabase", "prisma"],
  frontend: ["react", "vue", "svelte", "nextjs", "css", "tailwind", "component", "browser", "dom", "ui", "ux", "responsive", "animation", "spa"],
  nextjs: ["nextjs", "next.js", "vercel", "app-router", "server-component", "next-auth"],
  "python": ["python", "fastapi", "django", "flask", "sqlalchemy", "pytest", "pip", "uvicorn", "pydantic", "celery"],
  rust: ["rust", "cargo", "tokio", "crate", "wasm", "async-std"],
  "go-api": ["golang", "gin", "echo", "chi", "gorm", "goroutine"],
  cybersecurity: ["security", "pentest", "vulnerability", "exploit", "forensic", "dfir", "red-team", "blue-team", "malware", "audit", "cve", "owasp", "threat", "osint", "recon", "dork", "credential", "phishing"],
  "creative-media": ["image", "video", "media", "design", "brand", "visual", "photo", "illustration", "figma", "canvas"],
  "docs-writer": ["documentation", "markdown", "docs", "writing", "obsidian", "knowledge-base", "wiki", "readme", "technical-writing", "docusaurus"],
  research: ["research", "paper", "literature", "citation", "academic", "notebook", "arxiv", "scholar", "study", "analysis"],
  threejs: ["three.js", "threejs", "webgl", "shader", "3d", "scene", "geometry"],
  video: ["video", "ffmpeg", "transcription", "frame", "subtitle", "stream", "recording", "youtube"],
  marketing: ["seo", "marketing", "copywriting", "growth", "conversion", "analytics", "campaign", "funnel", "landing-page"],
  "medusa-dev": ["medusa", "ecommerce", "storefront", "shop", "cart", "checkout", "product-catalog", "amazon", "seller"],
  "fleet-control": ["multi-agent", "orchestrat", "coordinator", "dispatch", "parallel", "swarm", "colony"],
};

/**
 * Profiles that represent a technology stack (not a domain/function).
 * Stack profiles require a description-level keyword hit when a niche-subject
 * hint is present — see `suggestProfiles` in commands/discover.ts.
 */
export const STACK_PROFILES: ReadonlySet<string> = new Set([
  "frontend", "backend", "nextjs", "python", "rust", "go-api", "threejs",
]);
