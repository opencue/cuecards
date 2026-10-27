/**
 * Shared skill-grouping utilities used by Explorer and Profiles.
 */
import type { StudioSkill } from "./api";
import { nsColor, nsLabel } from "./curated";

export interface SkillGroup { ns: string; color: string; label: string; items: StudioSkill[] }

export function groupSkills(skills: StudioSkill[]): SkillGroup[] {
  const order: string[] = [];
  const map = new Map<string, StudioSkill[]>();
  for (const s of skills) {
    if (!map.has(s.ns)) { map.set(s.ns, []); order.push(s.ns); }
    map.get(s.ns)!.push(s);
  }
  return order.map((ns) => ({ ns, color: nsColor(ns), label: nsLabel(ns), items: map.get(ns)! }));
}
