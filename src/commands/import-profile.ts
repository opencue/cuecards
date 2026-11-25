import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { parse, stringify } from "yaml";
import type { Profile } from "../../profiles/_types";
import { validateProfileName } from "../lib/profile-generator";
import { loadProfile, profileYamlPath, validateProfileData } from "../lib/profile-loader";
import {
  importedProfilesDir, installPortableSkill, isPinnedRemoteSkill, MAX_PORTABLE_BYTES,
  pinRemoteSkill, type PortableSkill, portableResourcePath, portableSkillRef, portableSkillState,
  snapshotPortableSkill, validatePortableSkill,
} from "../lib/portable-skills";
import { profilesDir } from "../lib/repo-root";
import { createLocalSkillResolver } from "../lib/resolver-local";
import { expandSkillWildcards } from "../lib/runtime-install";

const importUsage = "Usage: cue import <url|file|org/repo> [--name <name>] [--apply [--sha256 <digest>]]";
const exportUsage = "Usage: cue export <profile> [--output <path>] [--portable] [--name <name>]";
const resourceFields = ["rules", "commands", "subagents", "hooks", "persona_includes", "playbooks", "qualityGates", "evals"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function run(args: string[]): Promise<number> {
  const exporting = args[0] === "export" || args.includes("--output");
  try {
    if (exporting) return await cmdExport(args[0] === "export" ? args.slice(1) : args);
    return await cmdImport(args);
  } catch (error) {
    const message = (error as Error).message;
    // Avoid echoing YAML snippets or data (which may include credentials).
    process.stderr.write(`${message.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")}\n`);
    return 1;
  }
}

async function readSource(source: string): Promise<{ content: Buffer; label: string; remote: boolean }> {
  const shorthand = /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/;
  if (!/^https?:\/\//.test(source) && existsSync(source)) {
    const stat = statSync(source);
    if (!stat.isFile() || stat.size > MAX_PORTABLE_BYTES) throw new Error("Import source must be a regular file within the 16 MiB limit");
    return { content: readFileSync(source), label: source, remote: false };
  }
  const url = /^https?:\/\//.test(source) ? new URL(source)
    : shorthand.test(source) ? new URL(`https://raw.githubusercontent.com/${source}/main/profile.yaml`)
    : undefined;
  if (!url) throw new Error(`Cannot resolve source: ${JSON.stringify(source)}`);
  if (url.username || url.password) throw new Error("Import URLs must not contain credentials");
  const label = url.origin + url.pathname;
  const result = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!result.ok || !result.body) throw new Error(`Could not fetch profile from ${label} (HTTP ${result.status})`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = result.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PORTABLE_BYTES) throw new Error("Import source exceeds the 16 MiB limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { content: Buffer.concat(chunks), label, remote: true };
}

async function cmdImport(args: string[]): Promise<number> {
  if (args.length === 0) throw new Error(importUsage + "\n       " + exportUsage);
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { apply: { type: "boolean" }, name: { type: "string" }, sha256: { type: "string" } },
  });
  if (positionals.length !== 1) throw new Error(importUsage);
  const source = positionals[0]!;
  if (values.apply && !values.sha256 && /^https?:\/\//.test(source)) {
    throw new Error("Preview the URL first, then apply using --sha256 <digest> from the preview");
  }
  const { content, label, remote } = await readSource(source);
  const digest = createHash("sha256").update(content).digest("hex");
  if (content.length > MAX_PORTABLE_BYTES) throw new Error("Import source exceeds the 16 MiB limit");
  if (values.sha256 !== undefined && values.sha256 !== digest) throw new Error("Source SHA-256 does not match the preview");
  if (values.apply && remote && !values.sha256) throw new Error("Preview the remote source first, then apply using --sha256 <digest>");

  let parsed: unknown;
  try { parsed = parse(content.toString("utf8"), { maxAliasCount: 0 }); }
  catch { throw new Error("Invalid YAML in profile source"); }
  if (!isRecord(parsed) || typeof parsed.name !== "string") throw new Error("Profile YAML missing 'name' field");
  const { _portable: manifest, _skill_contents: oldContents, ...data } = parsed;
  const name = values.name ?? parsed.name;
  if (!validateProfileName(name)) throw new Error("Invalid profile name (use lowercase kebab-case)");
  if (oldContents !== undefined) throw new Error("Old inline skill exports were not pinned; re-export with the current cue export --portable");
  const format = isRecord(manifest) ? manifest.format : undefined;
  if (format !== undefined && format !== 1) throw new Error("Unsupported portable profile format");
  const profile = await validateProfileData(name, { ...data, name });
  const snapshots = format === 1 ? readPortable(profile, manifest) : [];
  const snapshotStates = snapshots.map(skill => ({ skill, state: portableSkillState(skill) }));
  const profileRoot = format === 1
    ? process.env.CUE_PROFILES_DIR ?? process.env.SOUL_PROFILES_DIR ?? importedProfilesDir()
    : profilesDir();
  const dir = join(profileRoot, name);
  const conflict = existsSync(profileYamlPath(name)) || existsSync(dir);
  const file = join(dir, "profile.yaml");

  process.stdout.write(`${values.apply ? "Import" : "Import preview"}: ${name}\nSource: ${JSON.stringify(label)}\nSHA-256: ${digest}\n`);
  process.stdout.write(`${conflict ? "Would not replace an existing profile" : "Add profile"}: ${JSON.stringify(file)}\n`);
  if (format === 1) {
    for (const { skill, state } of snapshotStates) {
      const label = { new: "Add snapshot", reuse: "Reuse snapshot", conflict: "Snapshot conflict" }[state];
      const files = skill.files.map(({ path, executable }) => executable ? `${path} [executable]` : path);
      process.stdout.write(`  ${label}: ${skill.id} sha256:${skill.sha256}\n    ${files.join(", ")}\n`);
    }
    for (const remote of profile.skills?.npx ?? []) {
      process.stdout.write(`  Pinned remote ${remote.repo}@${remote.pin!.slice(4)} (${remote.skills.join(", ")}; fetched on use)\n`);
    }
    process.stdout.write("  Environment values and custom Codex configuration are not included. Review skill files before use.\n");
  } else {
    for (const skill of profile.skills?.local ?? []) process.stdout.write(`  Existing local ref: ${JSON.stringify(typeof skill === "string" ? skill : skill.id)}\n`);
    for (const remote of profile.skills?.npx ?? []) process.stdout.write(`  Remote ref: ${JSON.stringify(remote.repo)}\n`);
  }
  if (format !== 1 && (profile.env || profile.codex || profile.codex_config || profile.inherits)) {
    process.stdout.write("  Includes unverified environment, inheritance or agent configuration; review the original YAML.\n");
  }
  for (const field of ["mcps", "plugins", ...resourceFields] as const) {
    const refs = (profile[field] ?? []).map(ref => typeof ref === "string" ? ref : ref.id);
    if (refs.length) process.stdout.write(`  ${field}: ${JSON.stringify(refs)}\n`);
  }
  if (!values.apply) {
    process.stdout.write(conflict ? "Nothing written. Use --name <new-name> to avoid the collision.\n"
      : `Nothing written. Review the source, then rerun with --apply${remote ? ` --sha256 ${digest}` : ""}.\n`);
    return 0;
  }
  if (conflict) throw new Error("Profile already exists; choose a different --name");
  if (snapshotStates.some(({ state }) => state === "conflict")) {
    throw new Error("Import blocked by a conflicting snapshot; no existing snapshot will be replaced");
  }
  for (const skill of snapshots) installPortableSkill(skill);
  mkdirSync(dirname(dir), { recursive: true });
  // Atomic leaf creation also rejects symlinks and concurrent profile creation.
  mkdirSync(dir);
  writeFileSync(file, stringify(profile), { flag: "wx", mode: 0o600 });
  process.stdout.write(`Imported ${name}. To activate: cue use ${name}\n`);
  return 0;
}

function readPortable(profile: Profile, manifest: unknown): PortableSkill[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.skills)) throw new Error("Portable manifest missing skills");
  if (profile.inherits !== undefined || profile.env !== undefined || profile.codex !== undefined
    || profile.codex_config !== undefined || profile.iconImage !== undefined
    || resourceFields.some(field => profile[field]?.some(path => !portableResourcePath(path)))) {
    throw new Error("Portable profiles must not include inheritance, private settings or unsafe resource paths");
  }
  const snapshots = manifest.skills.map(validatePortableSkill);
  const byId = new Map(snapshots.map(skill => [skill.id, skill]));
  const local = profile.skills?.local ?? [];
  if (byId.size !== snapshots.length || local.length !== snapshots.length) throw new Error("Portable snapshots must match declared local skill IDs");
  const matches = new Set<string>();
  if (profile.skills) {
    profile.skills.local = local.map(ref => {
      const id = typeof ref === "string" ? ref : ref.id;
      const snapshot = byId.get(id);
      if (!snapshot || matches.has(id)) throw new Error("Portable manifest has missing or duplicate skill IDs");
      matches.add(id);
      const pinnedRef = portableSkillRef(snapshot);
      return typeof ref === "string" ? pinnedRef : { ...ref, id: pinnedRef };
    });
    if (!profile.skills.npx?.every(isPinnedRemoteSkill) && profile.skills.npx !== undefined) {
      throw new Error("Portable remote skills require full Git commit pins");
    }
  }
  return snapshots;
}

async function cmdExport(args: string[]): Promise<number> {
  if (!args.some(arg => !arg.startsWith("-"))) throw new Error(exportUsage);
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { output: { type: "string" }, portable: { type: "boolean" }, name: { type: "string" } },
  });
  if (positionals.length !== 1) throw new Error(exportUsage);
  const selector = positionals[0]!;
  const profile = await loadProfile(selector);
  const name = values.name ?? profile.name;
  if (!validateProfileName(name)) throw new Error("Choose a valid export --name (required for composite profiles)");
  const data: Profile = {
    name, description: profile.description, icon: profile.icon, kind: profile.kind, model: profile.model,
    contextWindow: profile.contextWindow, mcpPrune: profile.mcpPrune, agents: profile.agents,
    skills: { local: profile.skills.local, npx: profile.skills.npx }, mcps: profile.mcps, plugins: profile.plugins,
    persona: profile.persona, persona_routing: profile.personaRouting, rules: profile.rules,
    commands: profile.commands, subagents: profile.subagents, hooks: profile.hooks,
    persona_includes: profile.personaIncludes, playbooks: profile.playbooks, qualityGates: profile.qualityGates, evals: profile.evals,
  };
  const snapshots: PortableSkill[] = [];
  if (values.portable) {
    for (const field of resourceFields) {
      if (data[field]?.some(path => !portableResourcePath(path))) {
        throw new Error(`Cannot export machine-specific or unsafe ${field} paths as portable`);
      }
    }
    await expandSkillWildcards(profile);
    const resolveSkill = createLocalSkillResolver();
    let bytes = 0;
    for (const { id } of profile.skills.local) {
      const snapshot = validatePortableSkill(snapshotPortableSkill(id, await resolveSkill(id)));
      bytes += snapshot.files.reduce((total, entry) => total + entry.data.length, 0);
      if (bytes > MAX_PORTABLE_BYTES) throw new Error("Export exceeds 16 MiB; export a smaller profile");
      snapshots.push(snapshot);
    }
    data.skills = { local: profile.skills.local, npx: await Promise.all(profile.skills.npx.map(pinRemoteSkill)) };
  }
  await validateProfileData(name, data);
  const serialized = stringify({
    ...data,
    _portable: values.portable ? { format: 1, skills: snapshots } : { inheritance_resolved: true },
  }, { aliasDuplicateObjects: false });
  if (Buffer.byteLength(serialized) > MAX_PORTABLE_BYTES) throw new Error("Export exceeds 16 MiB; export a smaller profile");
  if (values.output) {
    try { writeFileSync(values.output, serialized, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Export file already exists");
      throw error;
    }
    process.stdout.write(`Exported "${name}" to ${JSON.stringify(values.output)} (${(Buffer.byteLength(serialized) / 1024).toFixed(1)} KB)\n`);
  } else {
    process.stdout.write(serialized);
  }
  return 0;
}
