import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, readlink, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { linkPluginCache, materializeRuntime } from "./runtime-materializer";

async function registerMarketplace(config: string, name: string, repo = `test/${name}`) {
  const installLocation = join(config, "plugins", "marketplaces", name);
  await mkdir(installLocation, { recursive: true });
  await writeFile(join(installLocation, "marketplace.json"), name);
  const entry = { source: { source: "github", repo }, installLocation };
  await writeFile(
    join(config, "plugins", "known_marketplaces.json"),
    JSON.stringify({ [name]: entry }),
  );
  return entry;
}

async function installPlugin(config: string, marketplace: string) {
  const installPath = join(config, "plugins", "cache", marketplace, "codex", "1.0.6");
  const registry = JSON.stringify({
    version: 2,
    plugins: { [`codex@${marketplace}`]: [{ installPath }] },
  });
  await mkdir(installPath, { recursive: true });
  await writeFile(join(installPath, "hooks.json"), "{}");
  await writeFile(join(config, "plugins", "installed_plugins.json"), registry);
  return { installPath, registry };
}

function runtimeInput(runtimeRoot: string, credentialsSource: string) {
  return {
    profile: {
      name: "plugin-cache",
      description: "Plugin cache fixture",
      agents: ["claude-code" as const],
      skills: { local: [], npx: [] },
      mcps: [],
      plugins: [{ id: "codex@openai-codex" }],
      env: {},
      inheritanceChain: ["plugin-cache"],
    },
    agent: "claude-code" as const,
    runtimeRoot,
    credentialsSource,
    contextModePath: join(runtimeRoot, "context-mode.json"),
    skillSourceLookup: async () => null,
    mcpRegistry: {},
    userClaudeMd: "",
  };
}

/**
 * Re-materializing a runtime happens while sessions are live, so replacing the
 * plugin-cache symlink has to be atomic. The rm-then-symlink it used to do left
 * the path absent for a moment, and a hook firing in that window failed with
 * "Plugin directory does not exist … run /plugin to reinstall" — the very error
 * linkPluginCache exists to prevent.
 */
describe("linkPluginCache — atomic swap", () => {
  let src: string;
  let tgt: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), "cue-plugsrc-"));
    tgt = await mkdtemp(join(tmpdir(), "cue-plugtgt-"));
    const verDir = join(src, "plugins", "cache", "thedotmack", "claude-mem", "13.13.1");
    await mkdir(verDir, { recursive: true });
    await writeFile(join(verDir, "hooks.json"), "{}");
    await mkdir(join(src, "plugins", "marketplaces"), { recursive: true });
    await writeFile(join(src, "plugins", "known_marketplaces.json"), "{}");
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(tgt, { recursive: true, force: true });
  });

  test("re-linking over an existing symlink keeps the version dir resolvable", async () => {
    await linkPluginCache(tgt, src);
    // Second pass is the one that used to open the window: the target is
    // already a symlink, so rm would unlink it before symlink recreated it.
    await linkPluginCache(tgt, src);

    const cacheLink = join(tgt, "plugins", "cache");
    expect((await lstat(cacheLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(cacheLink)).toBe(join(src, "plugins", "cache"));
    const hooks = join(cacheLink, "thedotmack", "claude-mem", "13.13.1", "hooks.json");
    expect((await stat(hooks)).isFile()).toBe(true);
  });

  test("leaves no staging entries behind", async () => {
    await linkPluginCache(tgt, src);
    await linkPluginCache(tgt, src);

    const entries = await readdir(join(tgt, "plugins"));
    expect(entries.filter((e) => e.includes(".cue-tmp-"))).toEqual([]);
    expect(entries.sort()).toEqual(["cache", "known_marketplaces.json", "marketplaces"]);
    for (const name of ["known_marketplaces.json", "marketplaces"]) {
      expect(await readlink(join(tgt, "plugins", name))).toBe(join(src, "plugins", name));
    }
  });

  test("preserves a runtime marketplace and install on the second and third passes", async () => {
    const marketplaceDir = join(tgt, "plugins", "marketplaces");
    const registryPath = join(tgt, "plugins", "known_marketplaces.json");
    await rm(join(src, "plugins", "cache"), { recursive: true });
    await linkPluginCache(tgt, src);

    // Claude registered the marketplace in a runtime-local clone and registry.
    await rm(marketplaceDir);
    await rm(registryPath);
    const local = await registerMarketplace(tgt, "openai-codex");
    const official = await registerMarketplace(src, "claude-plugins-official");
    const { installPath, registry } = await installPlugin(tgt, "openai-codex");
    const clone = await stat(local.installLocation);

    for (let pass = 2; pass <= 3; pass++) {
      await linkPluginCache(tgt, src);

      expect(JSON.parse(await readFile(registryPath, "utf8"))).toEqual({
        "openai-codex": local,
        "claude-plugins-official": official,
      });
      expect((await stat(local.installLocation)).ino).toBe(clone.ino);
      expect(await readlink(join(marketplaceDir, "claude-plugins-official"))).toBe(official.installLocation);
      expect(await readFile(join(installPath, "hooks.json"), "utf8")).toBe("{}");
      expect(await readFile(join(tgt, "plugins", "installed_plugins.json"), "utf8")).toBe(registry);
    }
  });

  test("preserves marketplace entries read through links to a previous source", async () => {
    const previous = join(src, "previous");
    const local = await registerMarketplace(previous, "openai-codex");
    const { registry: installed } = await installPlugin(previous, "openai-codex");
    const official = await registerMarketplace(src, "claude-plugins-official");
    const upstreamPath = join(src, "plugins", "known_marketplaces.json");
    const upstreamText = JSON.stringify({
      "claude-plugins-official": { ...official, installLocation: join(src, "missing") },
    });
    await writeFile(upstreamPath, upstreamText);
    await linkPluginCache(tgt, previous);
    await writeFile(join(tgt, "plugins", "installed_plugins.json"), installed);
    const registryPath = join(tgt, "plugins", "known_marketplaces.json");
    const marketplaceDir = join(tgt, "plugins", "marketplaces");

    for (let pass = 2; pass <= 3; pass++) {
      await linkPluginCache(tgt, src);

      const registry = JSON.parse(await readFile(registryPath, "utf8"));
      expect(registry["openai-codex"].source).toEqual(local.source);
      expect(registry["claude-plugins-official"].source).toEqual(official.source);
      for (const name of ["openai-codex", "claude-plugins-official"]) {
        expect(await readFile(join(registry[name].installLocation, "marketplace.json"), "utf8")).toBe(name);
        expect(await readFile(join(marketplaceDir, name, "marketplace.json"), "utf8")).toBe(name);
      }
      const oldHooks = join(tgt, "plugins", "cache", "openai-codex", "codex", "1.0.6", "hooks.json");
      expect(await readFile(oldHooks, "utf8")).toBe("{}");
    }
    expect(JSON.parse(await readFile(join(previous, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({ "openai-codex": local });
    expect(await readFile(upstreamPath, "utf8")).toBe(upstreamText);
  });

  test("retargets plugin trees and the registry on an account switch with no runtime installs", async () => {
    const previous = join(src, "previous");
    const old = await registerMarketplace(previous, "old");
    await installPlugin(previous, "old");
    const current = await registerMarketplace(src, "current");
    await linkPluginCache(tgt, previous);
    await linkPluginCache(tgt, src);

    const plugins = join(tgt, "plugins");
    expect(JSON.parse(await readFile(join(plugins, "known_marketplaces.json"), "utf8")))
      .toEqual({ current });
    expect(await readdir(join(plugins, "marketplaces"))).toEqual(["current"]);
    await expect(lstat(join(plugins, "cache", "old"))).rejects.toHaveProperty("code", "ENOENT");
    expect(await readFile(join(old.installLocation, "marketplace.json"), "utf8")).toBe("old");
  });

  test("keeps upstream metadata tied to its own clone when the registry is linked", async () => {
    const upstream = await registerMarketplace(src, "shared", "upstream/shared");
    await linkPluginCache(tgt, src);
    const marketplaces = join(tgt, "plugins", "marketplaces");
    await rm(marketplaces);
    const localClone = join(marketplaces, "shared");
    await mkdir(localClone, { recursive: true });
    await writeFile(join(localClone, "marketplace.json"), "runtime");

    await linkPluginCache(tgt, src);
    expect(JSON.parse(await readFile(join(tgt, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({ shared: upstream });
    expect(await readFile(join(localClone, "marketplace.json"), "utf8")).toBe("runtime");
  });

  test("keeps a registration Claude writes while cue stages a registry update", async () => {
    const local = await registerMarketplace(tgt, "local");
    const concurrent = await registerMarketplace(tgt, "concurrent");
    const upstream = await registerMarketplace(src, "upstream");
    const registry = join(tgt, "plugins", "known_marketplaces.json");
    await writeFile(registry, JSON.stringify({ local }));
    const write = fs.writeFile;
    let wrote = false;
    const stagedWrite = spyOn(fs, "writeFile").mockImplementation(async (path, ...args) => {
      await write(path, ...args);
      if (!wrote && typeof path === "string" && path.startsWith(`${registry}.cue-tmp-`)) {
        wrote = true;
        await write(registry, JSON.stringify({ local, concurrent }));
      }
    });
    try {
      await linkPluginCache(tgt, src);
    } finally {
      stagedWrite.mockRestore();
    }
    expect(wrote).toBe(true);
    expect(JSON.parse(await readFile(registry, "utf8"))).toMatchObject({ local, concurrent });
    await linkPluginCache(tgt, src);
    expect(JSON.parse(await readFile(registry, "utf8"))).toEqual({ local, concurrent, upstream });
  });

  test("preserves a working clone link when the source points back into the runtime", async () => {
    await registerMarketplace(tgt, "local");
    const upstream = await registerMarketplace(src, "shared");
    const savedClone = join(src, "shared-clone");
    await fs.rename(upstream.installLocation, savedClone);
    await fs.symlink(savedClone, upstream.installLocation);
    await linkPluginCache(tgt, src);
    const marketplaces = join(tgt, "plugins", "marketplaces");
    const runtimeClone = join(marketplaces, "shared", "marketplace.json");
    await rm(join(src, "plugins", "marketplaces"), { recursive: true });
    // Keep the existing runtime link independently resolvable before creating
    // the source alias back into the runtime.
    await rm(join(marketplaces, "shared"));
    await fs.symlink(savedClone, join(marketplaces, "shared"));
    await fs.symlink(marketplaces, join(src, "plugins", "marketplaces"));

    await linkPluginCache(tgt, src);
    expect(await readFile(runtimeClone, "utf8")).toBe("shared");
  });

  test("removes a dead imported clone link from a merged marketplace tree", async () => {
    const local = await registerMarketplace(tgt, "local");
    const upstream = await registerMarketplace(src, "upstream");
    await linkPluginCache(tgt, src);
    const clone = join(tgt, "plugins", "marketplaces", "upstream");
    expect((await lstat(clone)).isSymbolicLink()).toBe(true);
    // A runtime created before import tracking only has the registry and link.
    await rm(join(tgt, "plugins", ".cue-marketplace-imports.json"), { force: true });
    await rm(upstream.installLocation, { recursive: true });
    await writeFile(join(src, "plugins", "known_marketplaces.json"), "{}");

    await linkPluginCache(tgt, src);
    await expect(lstat(clone)).rejects.toHaveProperty("code", "ENOENT");
    expect(JSON.parse(await readFile(join(tgt, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({ local });
    expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("local");
  });

  test("keeps the registration for the runtime clone when the source uses the same name", async () => {
    const local = await registerMarketplace(tgt, "shared", "runtime/shared");
    const upstream = await registerMarketplace(src, "shared", "upstream/shared");
    await writeFile(join(upstream.installLocation, "marketplace.json"), "upstream");
    const registryPath = join(tgt, "plugins", "known_marketplaces.json");

    for (let pass = 0; pass < 2; pass++) {
      await linkPluginCache(tgt, src);

      const registry = JSON.parse(await readFile(registryPath, "utf8"));
      expect(registry).toEqual({ shared: local });
      expect(await readFile(join(registry.shared.installLocation, "marketplace.json"), "utf8")).toBe("shared");
      expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("shared");
    }
  });

  test("drops removed imports from a merged registry and preserves runtime registrations", async () => {
    const local = await registerMarketplace(tgt, "local");
    const removed = await registerMarketplace(src, "removed");
    const externalClone = join(src, "custom-marketplace");
    await fs.rename(removed.installLocation, externalClone);
    removed.installLocation = externalClone;
    const replaced = await registerMarketplace(src, "replaced");
    const sourceRegistry = join(src, "plugins", "known_marketplaces.json");
    await writeFile(sourceRegistry, JSON.stringify({ removed, replaced }));
    const registryPath = join(tgt, "plugins", "known_marketplaces.json");

    await linkPluginCache(tgt, src);
    expect(JSON.parse(await readFile(registryPath, "utf8"))).toEqual({ local, removed, replaced });

    const runtimeClone = join(tgt, "plugins", "marketplaces", "replaced");
    await rm(runtimeClone);
    const replacement = await registerMarketplace(tgt, "replaced", "runtime/replaced");
    await writeFile(registryPath, JSON.stringify({ local, removed, replaced: replacement }));
    await rm(sourceRegistry);
    await rm(join(src, "plugins", "marketplaces"), { recursive: true });
    await rm(externalClone, { recursive: true });

    for (let pass = 0; pass < 2; pass++) {
      await linkPluginCache(tgt, src);

      expect(JSON.parse(await readFile(registryPath, "utf8"))).toEqual({ local, replaced: replacement });
      expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("local");
      expect(await readFile(join(replacement.installLocation, "marketplace.json"), "utf8")).toBe("replaced");
    }
  });

  test("drops a removed custom-path import after Claude edits its metadata", async () => {
    const local = await registerMarketplace(tgt, "local");
    const imported = await registerMarketplace(src, "imported");
    const customClone = join(src, "custom");
    await fs.rename(imported.installLocation, customClone);
    imported.installLocation = customClone;
    const sourceRegistry = join(src, "plugins", "known_marketplaces.json");
    const registry = join(tgt, "plugins", "known_marketplaces.json");
    await writeFile(sourceRegistry, JSON.stringify({ imported }));
    await linkPluginCache(tgt, src);
    expect(JSON.parse(await readFile(registry, "utf8"))).toEqual({ local, imported });
    await writeFile(registry, JSON.stringify({ local, imported: { ...imported, lastUpdated: "today" } }));
    await rm(customClone, { recursive: true });
    await rm(sourceRegistry);

    await linkPluginCache(tgt, src);
    expect(JSON.parse(await readFile(registry, "utf8"))).toEqual({ local });
  });

  test("carries the installed marketplace, registry, and cache through a hash-changing rebuild", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const plugins = join(runtimeDir, "plugins");
    await rm(join(plugins, "marketplaces"));
    await rm(join(plugins, "known_marketplaces.json"));
    await rm(join(plugins, "cache"));
    const local = await registerMarketplace(runtimeDir, "openai-codex");
    const official = await registerMarketplace(src, "claude-plugins-official");
    const { installPath, registry } = await installPlugin(runtimeDir, "openai-codex");
    const clone = await stat(local.installLocation);
    // Both sides have this plugin directory, but each has its own version.
    const sourceVersion = join(src, "plugins", "cache", "openai-codex", "codex", "1.1.0");
    await mkdir(sourceVersion, { recursive: true });
    await writeFile(join(sourceVersion, "hooks.json"), "new version");

    for (const description of ["Changed profile", "Another change"]) {
      const rebuilt = await materializeRuntime({
        ...input,
        profile: { ...input.profile, description },
      });

      expect(rebuilt.rebuilt).toBe(true);
      expect(JSON.parse(await readFile(join(plugins, "known_marketplaces.json"), "utf8"))).toEqual({
        "openai-codex": local,
        "claude-plugins-official": official,
      });
      expect((await stat(local.installLocation)).ino).toBe(clone.ino);
      expect(await readFile(join(plugins, "installed_plugins.json"), "utf8")).toBe(registry);
      expect(await readFile(join(installPath, "hooks.json"), "utf8")).toBe("{}");
      expect(await readFile(join(installPath, "..", "1.1.0", "hooks.json"), "utf8")).toBe("new version");
      expect(await readFile(join(plugins, "cache", "thedotmack", "claude-mem", "13.13.1", "hooks.json"), "utf8")).toBe("{}");
    }
  });

  test("rebuilds with recreated plugins while keeping the old archive and live transcripts", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const rebuild = (description: string) => materializeRuntime({
      ...input,
      profile: { ...input.profile, description },
    });
    const plugins = join(runtimeDir, "plugins");
    await rm(plugins, { recursive: true });
    await registerMarketplace(runtimeDir, "original");
    await rebuild("First migration");
    const originalArchive = await readlink(plugins);

    await rm(plugins);
    const local = await registerMarketplace(runtimeDir, "recreated");
    const transcript = join(runtimeDir, "projects", "session.jsonl");
    await mkdir(join(runtimeDir, "projects"));
    await writeFile(transcript, "transcript");

    for (const description of ["Migrate recreated plugins", "Reuse the new archive"]) {
      expect((await rebuild(description)).rebuilt).toBe(true);
      expect(await readFile(transcript, "utf8")).toBe("transcript");
      expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("recreated");
      expect(await readFile(join(originalArchive, "marketplaces", "original", "marketplace.json"), "utf8")).toBe("original");
    }
  });

  test("restores live durable files when either swap rename fails", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const projects = join(runtimeDir, "projects");
    const transcript = join(projects, "session.jsonl");
    const config = join(runtimeDir, ".claude.json");
    await mkdir(projects);
    await writeFile(transcript, "transcript");
    await writeFile(config, '{"local":true}');

    const rename = fs.rename;
    for (const step of ["archive", "activate"]) {
      const failure = new Error(`failed to ${step} runtime`);
      const mockedRename = spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (
          (step === "archive" && from === runtimeDir) ||
          (step === "activate" && to === runtimeDir &&
            typeof from === "string" && from.startsWith(`${runtimeDir}.tmp.`))
        ) throw failure;
        await rename(from, to);
      });
      try {
        await expect(materializeRuntime({
          ...input,
          profile: { ...input.profile, description: "Changed profile" },
        })).rejects.toThrow(failure.message);
      } finally {
        mockedRename.mockRestore();
      }
      expect(await readFile(transcript, "utf8")).toBe("transcript");
      expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject({ local: true });
      expect((await lstat(join(runtimeDir, "plugins"))).isDirectory()).toBe(true);
    }
  });

  test("carries transcripts written immediately before archiving the live runtime", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const projects = join(runtimeDir, "projects");
    await mkdir(projects);
    await writeFile(join(projects, "old.jsonl"), "old");
    const rename = fs.rename;
    const swap = spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === runtimeDir) {
        await mkdir(projects, { recursive: true });
        await writeFile(join(projects, "new.jsonl"), "new");
      }
      await rename(from, to);
    });
    try {
      expect((await materializeRuntime({
        ...input, profile: { ...input.profile, description: "Changed profile" },
      })).rebuilt).toBe(true);
    } finally {
      swap.mockRestore();
    }
    expect(await readFile(join(projects, "old.jsonl"), "utf8")).toBe("old");
    expect(await readFile(join(projects, "new.jsonl"), "utf8")).toBe("new");
  });

  test("merges live projects and plugins when Claude recreates the runtime between renames", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const projects = join(runtimeDir, "projects");
    await mkdir(projects);
    await writeFile(join(projects, "old.jsonl"), "old");
    await rm(join(runtimeDir, "plugins"), { recursive: true });
    const old = await registerMarketplace(runtimeDir, "old");
    let archivedRuntime: string | undefined;
    const rename = fs.rename;
    const swap = spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === runtimeDir && typeof to === "string") archivedRuntime = to;
      if (to === runtimeDir && typeof from === "string" && from.startsWith(`${runtimeDir}.tmp.`)) {
        await mkdir(projects, { recursive: true });
        await writeFile(join(projects, "new.jsonl"), "new");
        await registerMarketplace(runtimeDir, "new");
      }
      if (archivedRuntime && to === join(runtimeDir, ".cue-hash")) {
        await writeFile(join(archivedRuntime, "projects", "after-merge.jsonl"), "after merge");
      }
      await rename(from, to);
    });
    try {
      expect((await materializeRuntime({
        ...input, profile: { ...input.profile, description: "Changed profile" },
      })).rebuilt).toBe(true);
    } finally {
      swap.mockRestore();
    }
    expect(await readFile(join(projects, "old.jsonl"), "utf8")).toBe("old");
    expect(await readFile(join(projects, "new.jsonl"), "utf8")).toBe("new");
    const recovered = join(runtimeDir, ".cue-recovered");
    const recoveredProjects = (await readdir(recovered)).find((name) => name.startsWith("projects-"));
    expect(await readFile(join(recovered, recoveredProjects!, "after-merge.jsonl"), "utf8")).toBe("after merge");
    const registry = JSON.parse(await readFile(join(runtimeDir, "plugins", "known_marketplaces.json"), "utf8"));
    expect(Object.keys(registry).sort()).toEqual(["new", "old"]);
    expect(await readFile(join(old.installLocation, "marketplace.json"), "utf8")).toBe("old");
    expect(await readFile(join(registry.new.installLocation, "marketplace.json"), "utf8")).toBe("new");
  });

  test("recovers the suffixed plugin archive and staged transcripts from an interrupted rebuild", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const base = `${runtimeDir}.plugin-state`;
    await registerMarketplace(base, "obsolete");
    await rm(join(runtimeDir, "plugins"), { recursive: true });
    const newest = await registerMarketplace(runtimeDir, "newest");
    const stage = `${runtimeDir}.tmp.interrupted`;
    const archive = `${base}-interrupted`;
    const transcript = join(stage, "projects", "session.jsonl");
    await mkdir(dirname(transcript), { recursive: true });
    await writeFile(transcript, "transcript");
    await fs.symlink(join(archive, "plugins"), join(stage, "plugins"));
    await fs.rename(runtimeDir, archive);

    await materializeRuntime(input);
    const registry = JSON.parse(await readFile(join(runtimeDir, "plugins", "known_marketplaces.json"), "utf8"));
    expect(registry).toEqual({ newest });
    expect(await readFile(join(newest.installLocation, "marketplace.json"), "utf8")).toBe("newest");
    expect(await readFile(join(runtimeDir, "projects", "session.jsonl"), "utf8")).toBe("transcript");
  });

  test("recovers live writes in a legacy .old archive even on a hash hit", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const archive = `${runtimeDir}.old-99999-deadbeef`;
    const transcript = join(archive, "projects", "late.jsonl");
    await mkdir(dirname(transcript), { recursive: true });
    await writeFile(transcript, "late runtime write");

    expect((await materializeRuntime(input)).rebuilt).toBe(false);
    expect(await readFile(join(runtimeDir, "projects", "late.jsonl"), "utf8")).toBe("late runtime write");
    await expect(lstat(archive)).rejects.toHaveProperty("code", "ENOENT");
  });

  test("recovers after cue is killed between archiving and activating the runtime", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const projects = join(runtimeDir, "projects");
    await mkdir(projects);
    await writeFile(join(projects, "old.jsonl"), "old");
    await rm(join(runtimeDir, "plugins"), { recursive: true });
    const old = await registerMarketplace(runtimeDir, "old");

    const child = Bun.spawn([process.execPath, "-e", `
      import { spyOn } from "bun:test";
      import * as fs from "node:fs/promises";
      import { materializeRuntime } from "./src/lib/runtime-materializer.ts";
      const input = ${JSON.stringify(input)};
      input.skillSourceLookup = async () => null;
      input.profile.description = "Interrupted rebuild";
      const rename = fs.rename;
      spyOn(fs, "rename").mockImplementation(async (from, to) => {
        await rename(from, to);
        if (from === ${JSON.stringify(runtimeDir)}) process.kill(process.pid, "SIGKILL");
      });
      await materializeRuntime(input);
    `], { stdout: "ignore", stderr: "inherit" });
    await child.exited;
    expect(child.signalCode).toBe("SIGKILL");

    await mkdir(projects, { recursive: true });
    await writeFile(join(projects, "new.jsonl"), "new");
    const recent = await registerMarketplace(runtimeDir, "new");
    await materializeRuntime(input);
    expect(await readFile(join(projects, "old.jsonl"), "utf8")).toBe("old");
    expect(await readFile(join(projects, "new.jsonl"), "utf8")).toBe("new");
    expect(JSON.parse(await readFile(join(runtimeDir, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({ old, new: recent });
    await expect(lstat(`${runtimeDir}.cue-pending`)).rejects.toHaveProperty("code", "ENOENT");
  });

  test("still replaces Claude's lazy empty directory", async () => {
    // rename() refuses to clobber a real directory, so this exercises the
    // fallback path — first materialization, before any session reads it.
    await mkdir(join(tgt, "plugins", "cache"), { recursive: true });

    await linkPluginCache(tgt, src);

    const cacheLink = join(tgt, "plugins", "cache");
    expect((await lstat(cacheLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(cacheLink)).toBe(join(src, "plugins", "cache"));
  });

  test("the target path is never absent while it is being replaced", async () => {
    // The actual invariant, and the only assertion here that fails against a
    // rm-then-symlink implementation: a reader polling the path across many
    // swaps must never see ENOENT. Cannot false-fail — an atomic rename has no
    // window in which the entry is missing.
    await linkPluginCache(tgt, src);
    const cacheLink = join(tgt, "plugins", "cache");

    let polling = true;
    let misses = 0;
    let polls = 0;
    const reader = (async () => {
      while (polling) {
        polls++;
        try {
          await lstat(cacheLink);
        } catch {
          misses++;
        }
      }
    })();

    for (let i = 0; i < 300; i++) await linkPluginCache(tgt, src);
    polling = false;
    await reader;

    expect(polls).toBeGreaterThan(0);
    expect(misses).toBe(0);
  });

  test("a source entry that disappears mid-run leaves the old link in place", async () => {
    const previous = join(src, "previous");
    const old = await registerMarketplace(previous, "shared");
    await registerMarketplace(src, "shared");
    await linkPluginCache(tgt, previous);
    const marketplaces = join(tgt, "plugins", "marketplaces");
    const before = await readlink(marketplaces);
    const replacement = join(src, "plugins", "marketplaces");
    const canonicalReplacement = await fs.realpath(replacement);
    const symlink = fs.symlink;
    let disappeared = false;
    const stageLink = spyOn(fs, "symlink").mockImplementation(async (target, path, type) => {
      if ((target === replacement || target === canonicalReplacement) &&
        typeof path === "string" && path.startsWith(`${marketplaces}.cue-tmp-`)) {
        await rm(replacement, { recursive: true });
        disappeared = true;
      }
      await symlink(target, path, type);
    });
    try {
      await linkPluginCache(tgt, src);
    } finally {
      stageLink.mockRestore();
    }
    expect(disappeared).toBe(true);
    expect(await readlink(marketplaces)).toBe(before);
    expect(await readFile(join(marketplaces, "shared", "marketplace.json"), "utf8"))
      .toBe(await readFile(join(old.installLocation, "marketplace.json"), "utf8"));
  });
});
