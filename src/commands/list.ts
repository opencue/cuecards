/**
 * `cue list` — show all available profiles with their icon, name, and description.
 *
 * Renders a "✨ Featured" section first (curated in `profiles/_featured.yaml`)
 * followed by "All profiles" with the rest. If no `_featured.yaml` exists,
 * falls back to a single flat list.
 *
 * `--json` emits a plain JSON array instead — no ANSI, no Kitty images, no
 * section headers. Plugin commands (`plugins/cue/commands/cue.md`,
 * `cue-switch.md`, `cue-setup.md`) parse this to enumerate and validate
 * profile names; the human-readable render above is coloured text they can't
 * safely parse.
 */

import { resolve } from "node:path";
import { listFeaturedProfiles, listProfiles, loadProfile } from "../lib/profile-loader";
import { detectKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";

/** One profile's JSON-listing shape. Field names match existing conventions
 * elsewhere in the codebase (`icon`/`description` from the profile schema;
 * `skillCount`/`mcpCount` as already used by `token-budget.ts`'s
 * `byProfile[]` and `marketplace.ts`). */
export interface ListedProfile {
  name: string;
  icon: string;
  description: string;
  skillCount: number;
  mcpCount: number;
  featured: boolean;
}

async function loadListedProfile(name: string, featured: boolean): Promise<ListedProfile> {
  let icon = "";
  let description = "";
  let skillCount = 0;
  let mcpCount = 0;
  try {
    const p = await loadProfile(name);
    icon = p.icon ?? "";
    description = p.description;
    skillCount = p.skills.local.length + p.skills.npx.length;
    mcpCount = p.mcps.length;
  } catch { /* best-effort — same tolerance as the human-readable render below */ }
  return { name, icon, description, skillCount, mcpCount, featured };
}

export async function run(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const names = await listProfiles();
  if (names.length === 0) {
    process.stderr.write("No profiles found in profiles/\n");
    return 1;
  }

  const featuredRaw = await listFeaturedProfiles();
  const known = new Set(names);
  const featured = featuredRaw.filter((n) => known.has(n));
  const featuredSet = new Set(featured);
  const rest = names.filter((n) => !featuredSet.has(n));

  if (json) {
    const out: ListedProfile[] = [];
    for (const name of featured) out.push(await loadListedProfile(name, true));
    for (const name of rest) out.push(await loadListedProfile(name, false));
    process.stdout.write(JSON.stringify(out) + "\n");
    return 0;
  }

  const kitty = await detectKittyTerminal();
  const profilesRoot = resolve(new URL(import.meta.url).pathname, "..", "..", "..", "profiles");

  const maxNameLen = Math.max(...names.map((n) => n.length));
  let nextImageId = 1;

  const renderRow = async (name: string) => {
    let icon = "  ";
    let description = "";
    try {
      const p = await loadProfile(name);
      if (kitty && p.iconImage && nextImageId <= 255) {
        const imgPath = resolve(profilesRoot, name, p.iconImage);
        const id = nextImageId++;
        transmitKittyImage(imgPath, id, 2, 1);
        icon = kittyPlaceholderLabel(id, 2, 1);
      } else {
        icon = p.icon ?? "  ";
      }
      description = p.description;
    } catch { /* best-effort */ }
    const namePadded = name.padEnd(maxNameLen);
    process.stdout.write(`${icon}  ${namePadded}  ${description}\n`);
  };

  if (featured.length > 0) {
    process.stdout.write("✨ Featured\n");
    for (const name of featured) await renderRow(name);
    process.stdout.write("\nAll profiles\n");
    for (const name of rest) await renderRow(name);
  } else {
    for (const name of names) await renderRow(name);
  }
  return 0;
}
