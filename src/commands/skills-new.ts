/**
 * `cue skills new <category/name>` — scaffold a new skill.
 *
 * The emitted SKILL.md is guaranteed to pass `cue lint-skill` on R001-R011.
 * Optional flags expand the template: --triggers seeds the frontmatter
 * triggers array, --clis seeds allowed-tools + Prerequisites, --tags
 * overrides the default tag derived from category.
 */

import { mkdirSync, writeFileSync, existsSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { lint } from "../lib/skill-linter";
import { repoRoot } from "../lib/repo-root";

const SKILLS_ROOT = join(repoRoot(), "resources", "skills", "skills");

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function titleCase(s: string): string {
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TemplateInput {
  name: string;
  category: string;
  description: string;
  tags: string[];
  triggers: string[];
  clis: string[];
}

function buildTemplate(input: TemplateInput): string {
  const { name, category, description, tags, triggers, clis } = input;
  const title = titleCase(name);
  const humanName = name.replace(/-/g, " ");

  const allowedToolsLine = clis.length > 0
    ? `allowed-tools: ${clis.map((c) => `Bash(${c}:*)`).join(", ")}\n`
    : "";

  const triggersBlock = triggers.length > 0
    ? "triggers:\n" + triggers.map((t) => `  - "${t}"`).join("\n") + "\n"
    : "";

  const prereqSection = clis.length > 0
    ? `\n## Prerequisites\n\n` +
      clis.map((c) => `- \`${c}\`: install via your package manager`).join("\n") + "\n"
    : "";

  return `---
name: ${name}
description: ${description}
tags: [${tags.join(", ")}]
category: ${category}
version: 1.0.0
${allowedToolsLine}${triggersBlock}---

# ${title}

One-line summary of what this skill does and when it fires.
${prereqSection}
## When to use

Use when the user asks for ${humanName}. Lead with the verb; name the
artifact or outcome the user cares about.

## Steps

1. State the first action.
2. State the verification step.
3. State the outcome the user sees.

## Example

<example>
User: Show me how this skill triggers.

Skill: Run the steps above and produce the named outcome.
</example>
`;
}

export async function run(args: string[]): Promise<number> {
  let id = args.find((a) => !a.startsWith("-"));
  const description = getArg(args, "--description") ?? "";
  const categoryIdx = args.indexOf("--category");
  const nameIdx = args.indexOf("--name");
  const fromId = getArg(args, "--from") ?? "";
  const triggers = parseList(getArg(args, "--triggers"));
  const clis = parseList(getArg(args, "--clis"));
  const userTags = parseList(getArg(args, "--tags"));
  const dryRun = args.includes("--dry-run");

  if (!id && categoryIdx >= 0 && nameIdx >= 0) {
    id = `${args[categoryIdx + 1]}/${args[nameIdx + 1]}`;
  }

  if (!id || !id.includes("/")) {
    process.stderr.write("Usage: cue skills new <category>/<name> [--description ...] [--triggers a,b] [--clis nmap,curl] [--tags x,y] [--from <source-id>] [--dry-run]\n");
    process.stderr.write("       cue skills new --category review --name my-checker\n");
    return 1;
  }

  const [category, name] = id.split("/");
  const skillDir = join(SKILLS_ROOT, category!, name!);

  if (existsSync(skillDir) && !dryRun) {
    process.stderr.write(`Skill "${id}" already exists at ${skillDir}\n`);
    return 1;
  }

  // --from: copy from existing skill (unchanged behaviour)
  if (fromId) {
    const sourceDir = join(SKILLS_ROOT, fromId);
    if (!existsSync(sourceDir)) {
      process.stderr.write(`Source skill "${fromId}" not found at ${sourceDir}\n`);
      return 1;
    }
    cpSync(sourceDir, skillDir, { recursive: true });
    const skillMd = join(skillDir, "SKILL.md");
    if (existsSync(skillMd)) {
      let content = readFileSync(skillMd, "utf8");
      content = content.replace(/^(name:\s*).+$/m, `$1${name}`);
      writeFileSync(skillMd, content);
    }
    process.stdout.write(`Created skill: ${id} (from ${fromId})\n`);
    process.stdout.write(`   ${skillDir}/\n`);
    return 0;
  }

  const humanName = name!.replace(/-/g, " ");
  const defaultDescription = description ||
    `Use when the user asks for ${humanName}, mentions ${humanName}, or needs ${humanName} help. Triggers on ${name}.`;
  const defaultTags = userTags.length > 0 ? userTags : [category!];
  const defaultTriggers = triggers.length > 0 ? triggers : [humanName, name!];

  const content = buildTemplate({
    name: name!,
    category: category!,
    description: defaultDescription,
    tags: defaultTags,
    triggers: defaultTriggers,
    clis,
  });

  // Self-lint the scaffold before writing. The contract is: every fresh
  // scaffold passes lint with score 100. Any regression here means the
  // template drifted from the rule set, which we want to catch loudly.
  const lintResult = lint(content);
  const errors = lintResult.diagnostics.filter((d) => d.severity === "error");

  if (dryRun) {
    process.stdout.write(content);
    process.stdout.write(`\n--- lint: ${lintResult.score}/100, ${errors.length} error(s), ${lintResult.diagnostics.length - errors.length} other ---\n`);
    return errors.length > 0 ? 1 : 0;
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content);

  mkdirSync(join(skillDir, "test"), { recursive: true });
  writeFileSync(join(skillDir, "test", "case-1.md"), `---
input: "${humanName}"
expect_contains: ["${name!.split("-")[0]}"]
expect_not_contains: []
---
`);

  process.stdout.write(`Created skill: ${id}\n`);
  process.stdout.write(`   ${skillDir}/SKILL.md  (lint: ${lintResult.score}/100)\n`);
  process.stdout.write(`   ${skillDir}/test/case-1.md\n`);
  if (lintResult.diagnostics.length > 0) {
    process.stdout.write(`\nScaffold lint diagnostics:\n`);
    for (const d of lintResult.diagnostics) {
      process.stdout.write(`  ${d.severity.toUpperCase().padEnd(7)} ${d.rule}  ${d.message}\n`);
    }
  }
  process.stdout.write(`\nNext steps:\n`);
  process.stdout.write(`  1. Edit SKILL.md with your real instructions\n`);
  process.stdout.write(`  2. Add to a profile: cue skills add-to-profile ${id}\n`);
  process.stdout.write(`  3. Test: cue skills test ${id}\n`);
  return errors.length > 0 ? 1 : 0;
}
