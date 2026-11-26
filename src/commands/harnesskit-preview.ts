import { closeSync, constants, existsSync, fstatSync, openSync, readSync } from "node:fs";
import { dirname } from "node:path";
import { MAX_PORTABLE_BYTES, portableResourcePath } from "../lib/portable-skills";
import { validateProfileName } from "../lib/profile-generator";
import { profileYamlPath } from "../lib/profile-loader";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifest(source: string): unknown {
  const invalidSource = "Provide a local HarnessKit manifest JSON file within the 16 MiB limit";
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|[\\/]{2})/i.test(source)) throw new Error(invalidSource);

  let fd: number;
  try { fd = openSync(source, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch { throw new Error(invalidSource); }
  let content: Buffer;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_PORTABLE_BYTES) throw new Error(invalidSource);
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, null);
      if (read === 0) break;
      size += read;
    }
    if (size !== stat.size) throw new Error("HarnessKit manifest changed while reading; retry with a stable file");
    content = buffer.subarray(0, size);
  } finally {
    closeSync(fd);
  }
  try { return JSON.parse(content.toString("utf8")); }
  catch { throw new Error("Invalid HarnessKit manifest JSON; provide manifest.json, not a kit archive"); }
}

type PreviewAsset = {
  entry: string;
  name: string;
  kind: string;
  path: string;
  agent?: string;
  target?: string;
};

function parseAsset(value: unknown, index: number, config: boolean): PreviewAsset {
  const entry = `${config ? "config" : "extension"} #${index + 1}`;
  const invalid = () => new Error(`Invalid HarnessKit manifest ${entry}`);
  if (!isRecord(value) || typeof value.asset_path !== "string" || !Number.isSafeInteger(value.position)) throw invalid();
  if (config) {
    if (typeof value.filename !== "string" || typeof value.category !== "string" || typeof value.agent !== "string") throw invalid();
    return {
      entry, path: value.asset_path, name: value.filename, kind: value.category, agent: value.agent,
      target: value.category === "rules" ? "rules" : undefined,
    };
  }
  if (typeof value.name !== "string" || typeof value.kind !== "string"
    || typeof value.source_extension_id !== "string" || typeof value.content_hash !== "string"
    || !/^sha256:[a-f0-9]{64}$/i.test(value.content_hash)) throw invalid();
  return {
    entry, path: value.asset_path, name: value.name, kind: value.kind,
    target: value.kind === "skill" ? "skills.local" : value.kind === "mcp" ? "mcps" : undefined,
  };
}

export function previewHarnessKit(source: string): number {
  const manifest = readManifest(source);
  if (!isRecord(manifest) || manifest.kit_format_version !== 1) {
    throw new Error("Unsupported HarnessKit manifest format; expected kit_format_version 1");
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0 || manifest.name.length > 160
    || typeof manifest.kit_id !== "string" || !Array.isArray(manifest.extensions)
    || !Array.isArray(manifest.config_files)) throw new Error("Invalid HarnessKit manifest");

  const assets = [
    ...manifest.extensions.map((item, index) => parseAsset(item, index, false)),
    ...manifest.config_files.map((item, index) => parseAsset(item, index, true)),
  ];
  const paths = new Set<string>();
  const targets = new Set<string>();
  const lines = [`HarnessKit import preview: ${JSON.stringify(manifest.name.replace(/[\p{Cc}\p{Cf}]/gu, "�"))}`];

  if (validateProfileName(manifest.name) && existsSync(dirname(profileYamlPath(manifest.name)))) {
    lines.push(`Collision existing profile: ${JSON.stringify(manifest.name)}`);
  }
  for (const { entry, path, name, kind, agent, target } of assets) {
    // HarnessKit uses a trailing slash for directory assets (skills and CLI bundles).
    const archivePath = path.replace(/\/$/, "");
    if (!archivePath.startsWith("assets/") || !portableResourcePath(archivePath)
      || !portableResourcePath(name) || name.includes("/")
      || !/^[a-z0-9-]{1,64}$/i.test(kind)
      || (agent !== undefined && (!portableResourcePath(agent) || agent.includes("/")))) {
      lines.push(`Unsafe asset at ${entry}`);
      continue;
    }
    const pathKey = archivePath.toLowerCase();
    if (paths.has(pathKey)) lines.push(`Collision archive path at ${entry}`);
    paths.add(pathKey);
    const label = JSON.stringify(name);
    if (target === undefined) {
      lines.push(`Unmapped ${kind}: ${label}`);
      continue;
    }
    const targetKey = `${target}:${name.toLowerCase()}`;
    lines.push(targets.has(targetKey) ? `Collision ${target}: ${label}` : `Candidate ${target}: ${label}`);
    targets.add(targetKey);
  }
  lines.push("Nothing written. Candidate mappings are informational; no kit assets were loaded.");
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
