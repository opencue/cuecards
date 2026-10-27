/**
 * Shared helpers for mutating profile YAML files in the discover / marketplace
 * commands.  Extracted to remove three diverging implementations of the same
 * MCP-injection logic (marketplace.ts, discover.ts cmdInstall, discover.ts
 * cmdDiscoverMcps) into one tested, edge-case-complete function.
 */

import { readFileSync, writeFileSync } from "node:fs";

/**
 * Add a single MCP server ID to a profile YAML file's `mcps:` list.
 *
 * Handles all edge cases:
 *  - `mcps:` section with existing items → appends after the last `  -` line
 *  - `mcps: []` inline-empty form → replaces with block form
 *  - No `mcps:` section at all → appends a new section at end of file
 *  - ID already present → no-op, returns false
 *
 * Returns true if the file was modified, false if the ID was already present.
 */
export function addMcpToProfileSync(yamlPath: string, id: string): boolean {
  const content = readFileSync(yamlPath, "utf8");
  if (content.includes(`- ${id}`)) return false;

  let updated: string;
  if (content.includes("mcps: []")) {
    updated = content.replace("mcps: []", `mcps:\n  - ${id}`);
  } else {
    // Match the mcps: header followed by any indented list items.
    // Group 1 = "mcps:\n", group 2 = existing "  - item\n" lines (may be empty).
    const mcpsMatch = content.match(/(mcps:\s*\n)((?:[ \t]+-[^\n]*\n?)*)/);
    if (mcpsMatch) {
      const existingBlock = mcpsMatch[2].endsWith("\n")
        ? mcpsMatch[2]
        : mcpsMatch[2] + (mcpsMatch[2].length ? "\n" : "");
      updated = content.replace(
        mcpsMatch[0],
        mcpsMatch[1] + existingBlock + `  - ${id}\n`,
      );
    } else {
      updated = content.trimEnd() + `\nmcps:\n  - ${id}\n`;
    }
  }

  writeFileSync(yamlPath, updated);
  return true;
}
