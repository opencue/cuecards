export interface PublicProfile {
  id: string;
  description: string;
  icon: string;
  extends: string[];
}

export const cueRepository = "https://github.com/opencue/cuecards";

export const crew = [
  { name: "The Architect", profile: "aas-architecture", role: "System design", summary: "See the whole map. Plan the boundaries, model the domain, and make distributed systems easier to reason about.", specialties: ["C4 diagrams", "Domain modeling", "Architecture decisions"], portrait: "architect" },
  { name: "The Builder", profile: "builder", role: "Full-stack engineering", summary: "Turn a plan into a working product. Build APIs and interfaces, move across languages, and take features from first commit to release.", specialties: ["Backend APIs", "React", "Python, Go & Rust"], portrait: "builder" },
  { name: "The Designer", profile: "designer", role: "UI / UX", summary: "Give the product a point of view. Build a visual system, refine the interface, and carry the design through to code.", specialties: ["Visual identity", "Design systems", "Interface polish"], portrait: "designer" },
  { name: "The Operator", profile: "ops", role: "Infrastructure", summary: "Keep the lights on. Work across hosting, deployments, DNS, and the services your team uses to ship.", specialties: ["AWS & Vercel", "Coolify", "DNS & hosting"], portrait: "operator" },
] as const;

export function featuredCharacter(id: string) {
  return crew.find(member => member.profile === id);
}

export function projectPublicProfile(id: string, value: unknown): PublicProfile {
  const row = value as Record<string, unknown> | null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || row?.name !== id) throw new Error(`Invalid bundled profile: ${id}`);
  const base = Array.isArray(row.inherits) ? row.inherits : [row.inherits];
  return {
    id,
    description: typeof row.description === "string" ? row.description.replace(/\s+/g, " ").trim() : "",
    icon: typeof row.icon === "string" ? row.icon : "◇",
    extends: base.filter((part): part is string => typeof part === "string"),
  };
}

export type ProfileFilter = "all" | "featured" | "bundled" | "extensions";

export function filterPublicProfiles(profiles: PublicProfile[], query: string, filter: ProfileFilter): PublicProfile[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return profiles.filter(profile => {
    const feature = featuredCharacter(profile.id);
    const extension = profile.id.startsWith("aas-");
    if (filter === "featured" && !feature || filter === "bundled" && extension || filter === "extensions" && !extension) return false;
    const text = [profile.id, profile.id.replaceAll("-", " "), profile.description, ...profile.extends, feature?.name, feature?.role, ...feature?.specialties ?? []].join(" ").toLowerCase();
    return words.every(word => text.includes(word));
  });
}
