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
import { existsSync } from "node:fs";
import { listFeaturedProfiles, listProfiles, loadProfile } from "../lib/profile-loader";
import { detectKittyTerminal, transmitKittyImage, kittyPlaceholderLabel } from "../lib/kitty-image";
import { countProfileSkills } from "../lib/profile-capabilities";
import type { ProfileKind } from "../../profiles/_types";

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
  kind: ProfileKind;
  iconImage?: string;
}

async function loadListedProfile(name: string, featured: boolean): Promise<ListedProfile> {
  let icon = "";
  let description = "";
  let skillCount = 0;
  let mcpCount = 0;
  let kind: ProfileKind = "primary";
  let iconImage: string | undefined;
  try {
    const p = await loadProfile(name);
    icon = p.icon ?? "";
    iconImage = p.iconImage;
    description = p.description;
    skillCount = countProfileSkills(p);
    mcpCount = p.mcps.length;
    kind = p.kind;
  } catch { /* best-effort — same tolerance as the human-readable render below */ }
  return { name, icon, description, skillCount, mcpCount, featured, kind, iconImage };
}

export async function run(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`Usage: cue list [--all] [--json]\n\n`);
    process.stdout.write(`Lists primary profiles by default. Use --all to include opt-in overlays.\n`);
    process.stdout.write(`--json keeps the complete machine-readable catalogue.\n`);
    return 0;
  }
  const json = args.includes("--json");
  const includeOverlays = args.includes("--all");
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
  const listed = await Promise.all([
    ...featured.map((name) => loadListedProfile(name, true)),
    ...rest.map((name) => loadListedProfile(name, false)),
  ]);

  if (json) {
    process.stdout.write(JSON.stringify(listed) + "\n");
    return 0;
  }

  const visible = listed.filter((profile) =>
    profile.kind === "primary" || (includeOverlays && profile.kind === "overlay"),
  );
  const hiddenOverlayCount = listed.filter((profile) => profile.kind === "overlay").length;
  if (visible.length === 0) {
    process.stderr.write("No visible profiles found\n");
    return 1;
  }

  const kitty = await detectKittyTerminal();
  const profilesRoot = resolve(new URL(import.meta.url).pathname, "..", "..", "..", "profiles");

  const maxNameLen = Math.max(...visible.map((profile) => profile.name.length));
  let nextImageId = 1;

  const renderRow = (profile: ListedProfile) => {
    let icon = "  ";
    if (kitty && profile.iconImage && nextImageId <= 255) {
      const imgPath = resolve(profilesRoot, profile.name, profile.iconImage);
      if (existsSync(imgPath)) {
        const id = nextImageId++;
        transmitKittyImage(imgPath, id, 2, 1);
        icon = kittyPlaceholderLabel(id, 2, 1);
      } else {
        icon = profile.icon || "  ";
      }
    } else {
      icon = profile.icon || "  ";
    }
    const namePadded = profile.name.padEnd(maxNameLen);
    process.stdout.write(`${icon}  ${namePadded}  ${profile.description}\n`);
  };

  const visibleFeatured = visible.filter((profile) => profile.featured);
  const visibleRest = visible.filter((profile) => !profile.featured);
  if (visibleFeatured.length > 0) {
    process.stdout.write("✨ Featured\n");
    for (const profile of visibleFeatured) renderRow(profile);
    process.stdout.write("\nAll profiles\n");
    for (const profile of visibleRest) renderRow(profile);
  } else {
    for (const profile of visible) renderRow(profile);
  }
  if (!includeOverlays && hiddenOverlayCount > 0) {
    process.stdout.write(
      `\n${hiddenOverlayCount} opt-in extensions hidden · run \`cue list --all\` to show them.\n`,
    );
  }
  return 0;
}
