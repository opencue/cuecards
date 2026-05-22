/**
 * `cue list` — show all available profiles with their icon, name, and description.
 */

import { listProfiles, loadProfile } from "../lib/profile-loader";

export async function run(_args: string[]): Promise<number> {
  const names = await listProfiles();
  if (names.length === 0) {
    process.stderr.write("No profiles found in profiles/\n");
    return 1;
  }

  // Compute padding so the names line up regardless of icon presence.
  const maxNameLen = Math.max(...names.map((n) => n.length));

  for (const name of names) {
    let icon = "  ";
    let description = "";
    try {
      const p = await loadProfile(name);
      icon = p.icon ?? "  ";
      description = p.description;
    } catch {
      // Best-effort: still print the name even if profile fails to load.
    }
    const namePadded = name.padEnd(maxNameLen);
    process.stdout.write(`${icon}  ${namePadded}  ${description}\n`);
  }
  return 0;
}
