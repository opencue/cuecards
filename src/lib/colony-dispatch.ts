/**
 * Colony dispatch — resolve profile from task description keywords.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo-root";

const RULES_PATH = join(repoRoot(), "resources", "colony-profiles.yaml");

interface Rule {
  match: string[];
  profile: string;
}

interface DispatchConfig {
  rules: Rule[];
  default: string;
}

function loadRules(): DispatchConfig {
  if (!existsSync(RULES_PATH)) {
    return { rules: [], default: "full" };
  }
  const yaml = require("yaml");
  return yaml.parse(readFileSync(RULES_PATH, "utf8"));
}

export function resolveProfileForTask(taskDescription: string): { profile: string; matchedKeywords: string[] } {
  const config = loadRules();
  const words = taskDescription.toLowerCase();

  for (const rule of config.rules) {
    const matched = rule.match.filter(kw => words.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      return { profile: rule.profile, matchedKeywords: matched };
    }
  }

  return { profile: config.default, matchedKeywords: [] };
}
