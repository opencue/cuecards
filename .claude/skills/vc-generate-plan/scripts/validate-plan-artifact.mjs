#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const planPaths = args.filter((arg) => !arg.startsWith("--"));
const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  if (strict) failures.push(message);
  else warnings.push(message);
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function isActivePlanPath(relPath) {
  return (
    relPath.startsWith("process/general-plans/active/") ||
    /^process\/features\/[^/]+\/active\//.test(relPath)
  );
}

function hasDateStamp(name) {
  return /(\d{2}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/.test(name);
}

function isDirectPlanArtifact(name) {
  return /_PLAN_/.test(name);
}

function isLegacyPlanShape(name) {
  return name === "PLAN.md" || name === "plan.md" || /^phase-.*\.md$/.test(name);
}

function hasSection(text, name) {
  return new RegExp(`^##\\s+${name}\\b`, "im").test(text);
}

function validatePlan(relPath) {
  if (!exists(relPath)) {
    fail(`${relPath} missing`);
    return null;
  }
  if (!relPath.endsWith(".md")) fail(`${relPath} is not a markdown plan`);
  if (!isActivePlanPath(relPath)) {
    fail(`${relPath} is not under process/general-plans/active/ or process/features/*/active/`);
  }

  const name = path.basename(relPath);
  const text = read(relPath);
  const localFailuresBefore = failures.length;
  const localWarningsBefore = warnings.length;

  if (!hasDateStamp(name)) fail(`${relPath} filename is missing a date stamp`);
  if (!/_PLAN_/.test(name)) fail(`${relPath} filename is missing _PLAN_`);
  if (!/^#\s+/.test(text)) fail(`${relPath} missing top-level title`);
  if (!/\*\*Date\*\*|^Date:/m.test(text)) fail(`${relPath} missing Date metadata`);
  if (!/\*\*Complexity\*\*|^Complexity:/m.test(text)) fail(`${relPath} missing Complexity metadata`);
  if (!/\*\*Status\*\*|^Status:/m.test(text)) fail(`${relPath} missing Status metadata`);
  if (!/##\s+Overview|##\s+1\.\s+Context and Goals|##\s+Context/i.test(text)) {
    fail(`${relPath} missing overview/context section`);
  }
  if (!/Phase Completion Rules/i.test(text)) fail(`${relPath} missing Phase Completion Rules`);
  if (!/Acceptance Criteria/i.test(text)) fail(`${relPath} missing Acceptance Criteria`);
  if (!/Implementation Checklist|RFC-|Phased Delivery Plan/i.test(text)) {
    fail(`${relPath} missing implementation checklist, RFCs, or phased delivery plan`);
  }
  if (!/Test Procedure|Post-Phase Testing|Verification|Manual Test|Data Verification|Discovery Test/i.test(text)) {
    fail(`${relPath} missing explicit test or verification language`);
  }
  if (!/process\/context\/all-context\.md/.test(text)) {
    warn(`${relPath} does not mention process/context/all-context.md`);
  }
  if (!/process\/context\/tests\.md|tests\.md|Post-Phase Testing|Test Procedure/i.test(text)) {
    warn(`${relPath} does not mention testing context or post-phase testing`);
  }
  if (/✅ VERIFIED/.test(text) && !/User Confirmation|user confirmed|user-confirmed|confirmed working|user says/i.test(text)) {
    warn(`${relPath} uses VERIFIED without explicit user-confirmation language`);
  }
  if (!/ENTER EXECUTE MODE|RIPER-5|Cursor Plan|Next Step/i.test(text)) {
    warn(`${relPath} does not end with a clear next instruction for execution`);
  }

  const directPlan = isDirectPlanArtifact(name);
  const legacyPlan = isLegacyPlanShape(name);
  if (directPlan) {
    if (!hasSection(text, "Touchpoints")) warn(`${relPath} is missing Touchpoints section`);
    if (!hasSection(text, "Public Contracts")) warn(`${relPath} is missing Public Contracts section`);
    if (!hasSection(text, "Blast Radius")) warn(`${relPath} is missing Blast Radius section`);
    if (!hasSection(text, "Verification Evidence")) warn(`${relPath} is missing Verification Evidence section`);
    if (!/Resume and Execution Handoff/i.test(text)) warn(`${relPath} is missing Resume and Execution Handoff section`);
  }
  if (legacyPlan) {
    if (!/primary execute anchor|execute anchor/i.test(text)) {
      warn(`${relPath} is a legacy plan shape without an explicit execute-anchor note`);
    }
    if (!/supporting phase files|supporting files|phase files/i.test(text)) {
      warn(`${relPath} is a legacy plan shape without supporting-phase-file notes`);
    }
  }

  return {
    path: relPath,
    failures: failures.length - localFailuresBefore,
    warnings: warnings.length - localWarningsBefore,
    lines: text.split("\n").length,
  };
}

if (planPaths.length === 0) {
  fail("Usage: node .claude/skills/vc-generate-plan/scripts/validate-plan-artifact.mjs [--strict] <plan.md>");
}

const checkedPlans = [];
for (const relPath of planPaths) {
  checkedPlans.push(validatePlan(relPath));
}

const result = {
  checkedPlans: checkedPlans.filter(Boolean),
  strict,
  warnings,
  failures,
};

console.log(JSON.stringify(result, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
