import { readFile } from "node:fs/promises";
import { readBundledSkills } from "../src/bundled-skill-catalog.js";

export async function loadPublicSkillCatalog() {
  let text: string;
  try {
    text = await readFile(new URL("../../resources/skills/catalog/catalog.json", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Hosted builds may not have checked out the public skills submodule.
    const response = await fetch("https://raw.githubusercontent.com/opencue/skills/main/catalog/catalog.json", {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Could not load the public Cue skill catalog (HTTP ${response.status})`);
    text = await response.text();
  }
  return readBundledSkills(JSON.parse(text));
}
