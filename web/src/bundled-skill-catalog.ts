export interface PublicSkill {
  id: string;
  name: string;
  category: string;
  description: string;
  source?: string;
}

// The source index currently leaves these YAML descriptions blank.
const missingSummaries: Record<string, string> = {
  "vercel/react-native-skills": "Best practices for React Native and Expo apps, including lists, animations, and native modules.",
  "vercel/composition-patterns": "Build reusable React components with compound components, render props, and composition.",
};

export function readBundledSkills(value: unknown): PublicSkill[] {
  const installed = (value as { installed?: unknown } | null)?.installed;
  if (!Array.isArray(installed)) throw new Error("Invalid bundled skill catalog");

  const skills = new Map<string, PublicSkill>();
  for (const row of installed) {
    const { id, name, category, description } = row ?? {};
    if (typeof id !== "string" || !/^[\w-]+\/[\w.-]+$/.test(id)
      || typeof name !== "string" || typeof category !== "string") {
      throw new Error("Invalid bundled skill catalog entry");
    }
    if (category === "private" || id.startsWith("private/")) continue;
    const summary = typeof description === "string" ? description.replace(/\s+/g, " ").trim() : "";
    skills.set(id, {
      id, name, category,
      description: summary || missingSummaries[id] || "The source has not published a summary for this skill yet.",
    });
  }
  if (skills.size === 0) throw new Error("No public bundled skills");
  return [...skills.values()].sort((a, b) => a.id.localeCompare(b.id, "en"));
}

export function filterPublicSkills<T extends PublicSkill>(skills: T[], query: string, category: string): T[] {
  const words = query.toLowerCase().trim().split(/\s+/);
  return skills.filter(skill => {
    if (category && skill.category !== category) return false;
    const text = `${skill.id} ${skill.name} ${skill.description} ${skill.category} ${skill.source ?? ""}`.toLowerCase();
    return words.every(word => text.includes(word));
  });
}

export function shufflePublicSkills<T extends PublicSkill>(skills: readonly T[], random = Math.random): T[] {
  function shuffle<U>(items: U[]) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  const groups = new Map<string, T[]>();
  for (const skill of skills) {
    const key = skill.source ? `source:${skill.source}` : `category:${skill.category}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(skill);
    groups.set(key, bucket);
  }

  const result: T[] = [];
  let buckets = [...groups.values()];
  for (const bucket of buckets) shuffle(bucket);
  while (buckets.length) {
    shuffle(buckets);
    for (const bucket of buckets) {
      const skill = bucket.pop();
      if (skill) result.push(skill);
    }
    buckets = buckets.filter(bucket => bucket.length > 0);
  }
  return result;
}
