import catalog from "./skill-catalog.json";

export type ForkSkill = (typeof catalog)[number];

export function searchForkSkills(query = ""): ForkSkill[] {
  const words = query.trim().toLowerCase().split(/\s+/);
  return catalog.filter(({ id, description, repo }) => {
    const searchable = `${id} ${description} ${repo}`.toLowerCase();
    return words.every(word => searchable.includes(word));
  });
}

export function forkSkillUrl(skill: ForkSkill): string {
  return `https://github.com/${skill.repo}/tree/${skill.commit}/${skill.directory}`;
}
