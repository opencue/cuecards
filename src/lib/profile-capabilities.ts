import type { ResolvedProfile } from "../../profiles/_types";

type ProfileWithSkills = Pick<ResolvedProfile, "skills">;

/**
 * Stable identifiers for every resolved skill a profile exposes.
 *
 * Npx entries are repositories that can contain several skills, so counting
 * the repository rows under-reports the user-visible capability total.
 */
export function profileSkillIds(profile: ProfileWithSkills): string[] {
  return [
    ...profile.skills.local.map((skill) => `local:${skill.id}`),
    ...profile.skills.npx.flatMap((source) =>
      source.skills.map((skill) => `npx:${source.repo}:${skill}`),
    ),
  ];
}

export function countProfileSkills(profile: ProfileWithSkills): number {
  return profileSkillIds(profile).length;
}
