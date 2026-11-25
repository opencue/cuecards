export interface PublicProfile {
  id: string;
  description: string;
  icon: string;
  extends: string[];
}

export const cueRepository = "https://github.com/opencue/cuecards";

export const profileTasks = {
  architect: { label: "Design a system", profiles: ["aas-architecture", "aas-cloud-architecture", "aas-security-threat-modeling"] },
  build: { label: "Build a feature", profiles: ["builder", "aas-backend-api-design", "aas-frontend-react-ecosystem"] },
  design: { label: "Design an interface", profiles: ["designer", "aas-design-systems-quality", "aas-frontend-design-systems"] },
  ship: { label: "Ship and operate", profiles: ["ops", "aas-cloud-delivery", "aas-cloud-reliability"] },
} as const;
export type ProfileTask = keyof typeof profileTasks;

const bundledSkills = "https://github.com/opencue/skills/tree/main/skills";
const architectureSkills = "https://github.com/sickn33/agentic-awesome-skills/tree/50a74ca3ddea4a91a45bdc625f0e354b6e54f1b4/skills";
export const characterDetails = {
  "aas-architecture": {
    when: "You need to agree on service boundaries or explain a system before changing it.",
    example: "Draw a C4 context diagram for our checkout and propose boundaries for payment and fulfillment.",
    skills: [[ "C4 system context", `${architectureSkills}/c4-context` ], [ "Domain modeling", `${architectureSkills}/domain-modeling` ]],
  },
  builder: {
    when: "You have a feature to deliver across an API and an interface, with tests to prove it works.",
    example: "Add pagination to the orders API and wire it into the React table. Test empty and last pages.",
    skills: [[ "API testing", `${bundledSkills}/review/api-tester` ], [ "Image to code", `${bundledSkills}/design/image-to-code` ]],
  },
  designer: {
    when: "A screen needs a clearer visual hierarchy, a design system, or a design translated to code.",
    example: "Redesign this onboarding screen for mobile and desktop without changing the flow.",
    skills: [[ "Minimalist UI", `${bundledSkills}/design/minimalist-ui` ], [ "Image to code", `${bundledSkills}/design/image-to-code` ]],
  },
  ops: {
    when: "A service needs a deployment plan, a CI fix, or clearer operating instructions.",
    example: "Prepare a staging deployment with health checks and a rollback plan. Do not deploy it.",
    skills: [[ "Coolify", `${bundledSkills}/deployment/coolify` ], [ "GitHub CI diagnosis", `${bundledSkills}/github/gh-fix-ci` ]],
  },
} as const;

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

export function filterPublicProfiles(profiles: PublicProfile[], query: string, filter: ProfileFilter, task?: ProfileTask): PublicProfile[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  const taskProfiles: readonly string[] | undefined = task ? profileTasks[task].profiles : undefined;
  return profiles.filter(profile => {
    if (taskProfiles && !taskProfiles.includes(profile.id)) return false;
    const feature = featuredCharacter(profile.id);
    const extension = profile.id.startsWith("aas-");
    if (filter === "featured" && !feature || filter === "bundled" && extension || filter === "extensions" && !extension) return false;
    const text = [profile.id, profile.id.replaceAll("-", " "), profile.description, ...profile.extends, feature?.name, feature?.role, ...feature?.specialties ?? []].join(" ").toLowerCase();
    return words.every(word => text.includes(word));
  });
}
