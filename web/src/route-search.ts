import { z } from "zod";
import { profileTasks, type ProfileFilter, type ProfileTask } from "./lib/public-profiles";
import type { View } from "./studio/StudioApp";

const views: View[] = ["inventory", "welcome", "explorer", "dashboard", "profiles", "search", "merge", "workflows", "mcps", "plugins", "market", "hooks", "permissions", "env", "api", "settings"];
export function parseStudioView(value: unknown): View | undefined {
  return typeof value === "string" && views.includes(value as View) ? value as View : undefined;
}

export const maxProfileSearchLength = 120;
export interface HomeSearch {
  view?: View;
  task?: ProfileTask;
  q?: string;
  type?: ProfileFilter;
}

export function parseHomeSearch(raw: Record<string, unknown>): HomeSearch {
  const view = parseStudioView(raw.view);
  if (view !== "market") return view ? { view } : {};
  const result: HomeSearch = { view };
  if (typeof raw.task === "string" && Object.hasOwn(profileTasks, raw.task)) result.task = raw.task as ProfileTask;
  if (typeof raw.q === "string" && raw.q.length > 0 && raw.q.length <= maxProfileSearchLength) result.q = raw.q;
  if (raw.type === "featured" || raw.type === "bundled" || raw.type === "extensions") result.type = raw.type;
  return result;
}

export function parseProfileId(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) ? value : undefined;
}
export function parseWorkspaceSearch(raw: Record<string, unknown>): { workspace?: string } {
  const parsed = z.uuid().safeParse(raw.workspace);
  return { workspace: parsed.success ? parsed.data : undefined };
}
