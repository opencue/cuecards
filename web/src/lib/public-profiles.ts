export interface PublicProfile {
  id: string;
  description: string;
  icon: string;
  extends: string[];
  publicSkillIds: string[];
  aasSkillIds: string[];
}

export const cueRepository = "https://github.com/opencue/cuecards";

export const profileTasks = {
  architect: { label: "Design a system", profiles: ["aas-architecture", "aas-cloud-architecture", "aas-security-threat-modeling"] },
  build: { label: "Build a feature", profiles: ["builder", "aas-backend-api-design", "aas-frontend-react-ecosystem"] },
  design: { label: "Design an interface", profiles: ["designer", "aas-design-systems-quality", "aas-frontend-design-systems"] },
  ship: { label: "Ship and operate", profiles: ["ops", "aas-cloud-delivery", "aas-cloud-reliability"] },
} as const;
export type ProfileTask = keyof typeof profileTasks;

export const publicSkillSource = "https://github.com/opencue/skills/tree/main/skills";
export const publicAasRepo = "sickn33/agentic-awesome-skills";
export const publicAasCommit = "50a74ca3ddea4a91a45bdc625f0e354b6e54f1b4";
export const verifiedAasFallback = ["c4-context", "domain-modeling"] as const;
const aasSource = `https://github.com/${publicAasRepo}/tree/${publicAasCommit}/skills`;

export function readPublicAasSkillIds(index: unknown): Set<string> {
  if (!Array.isArray(index)) throw new Error("Invalid public AAS skill index");
  return new Set(index.flatMap(entry => {
    const { id, path } = entry ?? {};
    return typeof id === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(id) && path === `skills/${id}` ? [id] : [];
  }));
}
export const characterDetails = {
  "aas-architecture": {
    when: "You need to agree on service boundaries or explain a system before changing it.",
    example: "Draw a C4 context diagram for our checkout and propose boundaries for payment and fulfillment.",
  },
  builder: {
    when: "You have a feature to deliver across an API and an interface, with tests to prove it works.",
    example: "Add pagination to the orders API and wire it into the React table. Test empty and last pages.",
  },
  designer: {
    when: "A screen needs a clearer visual hierarchy, a design system, or a design translated to code.",
    example: "Redesign this onboarding screen for mobile and desktop without changing the flow.",
  },
  ops: {
    when: "A service needs a deployment plan, a CI fix, or clearer operating instructions.",
    example: "Prepare a staging deployment with health checks and a rollback plan. Do not deploy it.",
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

export function projectPublicProfile(id: string, value: unknown, publicSkillIds: ReadonlySet<string>, aasSkillIds: ReadonlySet<string> = new Set(verifiedAasFallback)): PublicProfile {
  const row = value as Record<string, unknown> | null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || row?.name !== id) throw new Error(`Invalid bundled profile: ${id}`);
  const base = Array.isArray(row.inherits) ? row.inherits : [row.inherits];
  const { local, npx } = (row.skills as { local?: unknown; npx?: unknown } | null) ?? {};
  const aas = Array.isArray(npx) ? npx.flatMap(source =>
    source?.repo === publicAasRepo && source.pin === `git@${publicAasCommit}` && Array.isArray(source.skills)
      ? source.skills.filter((skill: unknown): skill is string => typeof skill === "string" && aasSkillIds.has(skill))
      : [],
  ) : [];
  return {
    id,
    description: typeof row.description === "string" ? row.description.replace(/\s+/g, " ").trim() : "",
    icon: typeof row.icon === "string" ? row.icon : "◇",
    extends: base.filter((part): part is string => typeof part === "string"),
    publicSkillIds: Array.isArray(local)
      ? [...new Set(local.filter((skill): skill is string => typeof skill === "string" && publicSkillIds.has(skill)))]
      : [],
    aasSkillIds: [...new Set<string>(aas)],
  };
}

export function profilePublicSkills(profile: PublicProfile, roster: PublicProfile[]) {
  const byId = new Map(roster.map(entry => [entry.id, entry]));
  function links(entry: PublicProfile) {
    return [
      ...(entry.publicSkillIds ?? []).map(id => ({ label: id, href: `${publicSkillSource}/${id}` })),
      ...(entry.aasSkillIds ?? []).map(id => ({ label: id, href: `${aasSource}/${id}` })),
    ];
  }
  const direct = links(profile);
  const seenLinks = new Set(direct.map(skill => skill.href));
  const seenProfiles = new Set([profile.id]);
  const inherited: typeof direct = [];
  function visit(id: string) {
    if (seenProfiles.has(id)) return;
    seenProfiles.add(id);
    const parent = byId.get(id);
    if (!parent) return;
    for (const skill of links(parent)) {
      if (seenLinks.has(skill.href)) continue;
      seenLinks.add(skill.href);
      inherited.push(skill);
    }
    parent.extends.forEach(visit);
  }
  profile.extends.forEach(visit);
  return { direct, inherited };
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
