#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

import {
  AAS_PROFILE_MAX_SKILLS,
  parseAasCatalog,
  planAasCatalog,
  readAasProfileAssignments,
  writeAasProfiles,
} from "../src/lib/aas-profile-organizer";

interface CliOptions {
  apply: boolean;
  json: boolean;
  source: string;
  profilesDir: string;
  auditFile?: string;
}

function parseArgs(args: string[]): CliOptions {
  let apply = false;
  let json = false;
  let source = process.env.CUE_AAS_ROOT ?? "resources/agentic-awesome-skills";
  let profilesDir = process.env.CUE_PROFILES_DIR ?? "profiles";
  let auditFile: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--json") json = true;
    else if (arg === "--source" || arg === "--profiles-dir" || arg === "--audit-file") {
      const value = args[++index];
      if (!value) throw new Error(`${arg} requires a path.`);
      if (arg === "--source") source = value;
      else if (arg === "--profiles-dir") profilesDir = value;
      else auditFile = value;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(`Generate semantic Cue profiles for safe Agentic Awesome Skills.

Usage:
  bun scripts/generate-aas-profiles.ts [--json]
  bun scripts/generate-aas-profiles.ts --apply [--json]

Options:
  --apply                 Write profiles and remove stale generator-owned profiles.
  --source <path>         AAS checkout (default: resources/agentic-awesome-skills).
  --profiles-dir <path>   Cue profiles directory (default: profiles).
  --audit-file <path>     Write per-skill decisions and possible variants as JSON.
  --json                  Emit the audit result as JSON.
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    apply,
    json,
    source: resolve(source),
    profilesDir: resolve(profilesDir),
    auditFile: auditFile ? resolve(auditFile) : undefined,
  };
}

function sourceRevision(source: string): string | null {
  const result = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  const revision = result.status === 0 ? result.stdout.trim() : "";
  return /^[a-f0-9]{40}$/i.test(revision) ? revision : null;
}

function run(): number {
  const options = parseArgs(process.argv.slice(2));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(options.source, "skills_index.json"), "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read AAS skills_index.json: ${message}`);
  }

  const catalog = parseAasCatalog(raw);
  if (catalog.invalidEntries > 0) {
    throw new Error(`Refusing to organize a malformed catalog (${catalog.invalidEntries} invalid entries).`);
  }
  const revision = sourceRevision(options.source);
  if (!revision) throw new Error("AAS source must be a Git checkout with a full HEAD revision.");

  const preserved = readAasProfileAssignments(options.profilesDir, {
    includeGenerated: false,
  });
  const organization = planAasCatalog(catalog.skills, {
    maxSkillsPerProfile: AAS_PROFILE_MAX_SKILLS,
    reservedProfileNames: preserved.profileNames,
    reservedSkillIds: preserved.skillIds,
  });
  const plans = organization.profiles;
  const eligible = catalog.skills.filter((skill) => skill.risk === "safe" || skill.risk === "none");
  const plannedSkillIds = plans.flatMap((plan) => plan.skills.map((skill) => skill.id));
  const assignedIds = [...preserved.skillIds, ...plannedSkillIds];
  const shadowedIds = new Set(organization.shadowedSkillIds);
  const counts = new Map<string, number>();
  for (const id of assignedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const eligibleIds = new Set(eligible.map((skill) => skill.id));
  const unassignedSkillIds = [...eligibleIds]
    .filter((id) => !counts.has(id) && !shadowedIds.has(id))
    .sort((a, b) => a.localeCompare(b));
  const duplicateSkillIds = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));
  const unsafeSkillIds = [...counts.keys()]
    .filter((id) => {
      const skill = catalog.skills.find((entry) => entry.id === id);
      return !skill || (skill.risk !== "safe" && skill.risk !== "none");
    })
    .sort((a, b) => a.localeCompare(b));
  const writes = options.apply
    ? writeAasProfiles(plans, {
      profilesDir: options.profilesDir,
      sourceRevision: revision,
      pruneStaleGenerated: true,
    })
    : { created: [], updated: [], removed: [], skipped: [] };
  const complete = unassignedSkillIds.length === 0
    && duplicateSkillIds.length === 0
    && unsafeSkillIds.length === 0;
  const confidenceCounts = {
    high: organization.assignments.filter((entry) => entry.confidence === "high").length,
    medium: organization.assignments.filter((entry) => entry.confidence === "medium").length,
    low: organization.assignments.filter((entry) => entry.confidence === "low").length,
  };
  const reviewRequiredSkillIds = organization.assignments
    .filter((entry) => entry.reviewRequired)
    .map((entry) => entry.skillId);
  if (options.auditFile) {
    mkdirSync(dirname(options.auditFile), { recursive: true });
    writeFileSync(options.auditFile, `${JSON.stringify({
      source: options.source,
      revision,
      generatedAt: new Date().toISOString(),
      assignments: organization.assignments,
      shadowedSkillIds: organization.shadowedSkillIds,
      possibleVariantGroups: organization.possibleVariantGroups,
    }, null, 2)}\n`);
  }
  const result = {
    source: options.source,
    revision,
    applied: options.apply,
    catalogSkills: catalog.skills.length,
    eligibleSkills: eligible.length,
    excludedByRisk: catalog.skills.length - eligible.length,
    profiles: plans.length,
    maxSkillsPerProfile: AAS_PROFILE_MAX_SKILLS,
    preservedProfiles: preserved.profileNames,
    createdProfiles: writes.created,
    updatedProfiles: writes.updated,
    removedProfiles: writes.removed,
    skippedProfiles: writes.skipped,
    assignmentConfidence: confidenceCounts,
    reviewRequiredSkills: reviewRequiredSkillIds.length,
    reviewRequiredSkillIds,
    possibleVariantGroups: organization.possibleVariantGroups,
    shadowedSkills: organization.shadowedSkillIds.length,
    shadowedSkillIds: organization.shadowedSkillIds,
    auditFile: options.auditFile,
    assignedSkills: new Set(assignedIds).size,
    unassignedSkillIds,
    duplicateSkillIds,
    unsafeSkillIds,
    complete,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`AAS profile organization: ${complete ? "PASS" : "FAIL"}\n`);
    process.stdout.write(`  eligible skills: ${eligible.length}\n`);
    process.stdout.write(`  semantic profiles: ${plans.length}\n`);
    process.stdout.write(`  max skills/profile: ${AAS_PROFILE_MAX_SKILLS}\n`);
    process.stdout.write(
      `  assignment confidence: ${confidenceCounts.high} high, ${confidenceCounts.medium} medium, ${confidenceCounts.low} low\n`,
    );
    process.stdout.write(`  review queue: ${reviewRequiredSkillIds.length} skills\n`);
    process.stdout.write(`  shadowed by local skills: ${organization.shadowedSkillIds.length}\n`);
    process.stdout.write(`  possible variant groups: ${organization.possibleVariantGroups.length}\n`);
    if (options.auditFile) process.stdout.write(`  audit: ${options.auditFile}\n`);
    process.stdout.write(`  mode: ${options.apply ? "applied" : "dry-run (pass --apply to write)"}\n`);
    if (options.apply) {
      process.stdout.write(
        `  writes: ${writes.created.length} created, ${writes.updated.length} updated, ${writes.removed.length} removed, ${writes.skipped.length} skipped\n`,
      );
    }
    if (unassignedSkillIds.length > 0) {
      process.stdout.write(`  unassigned: ${unassignedSkillIds.join(", ")}\n`);
    }
    if (duplicateSkillIds.length > 0) {
      process.stdout.write(`  duplicates: ${duplicateSkillIds.join(", ")}\n`);
    }
    if (unsafeSkillIds.length > 0) {
      process.stdout.write(`  unsafe/stale assignments: ${unsafeSkillIds.join(", ")}\n`);
    }
  }
  return complete ? 0 : 1;
}

try {
  process.exitCode = run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`AAS profile organization failed: ${message}\n`);
  process.exitCode = 1;
}
