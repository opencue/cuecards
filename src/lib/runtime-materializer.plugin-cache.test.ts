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

async function traceFilesystem(
  run: () => Promise<unknown>,
  roots: Record<string, string>,
  beforeRename?: (from: string, to: string) => Promise<void>,
) {
  const trace: string[] = [];
  const calls = [
    "access", "appendFile", "chmod", "copyFile", "cp", "link", "lstat",
    "mkdir", "mkdtemp", "open", "readFile", "readdir", "readlink", "realpath",
    "rename", "rm", "rmdir", "stat", "symlink", "unlink", "writeFile",
  ] as const;
  const spies = calls.map((name) => {
    const original = fs[name];
    return spyOn(fs, name).mockImplementation((...args: unknown[]) => {
      const pathCount = ["copyFile", "cp", "link", "rename", "symlink"].includes(name) ? 2 : 1;
      const paths = args.slice(0, pathCount).map((value) => {
        let path = String(value);
        path = path.replace(/claude\.tmp\.[^/.]+/g, "stage")
          .replace(/claude\.old-\d+-[a-z0-9]+/, "old");
        for (const [label, root] of Object.entries(roots)) path = path.replace(root, label);
        return path.replace(/runtime\/(stage|old)(?=\/|$)/g, "$1")
          .replace(/\.cue-tmp-\d+/, ".cue-tmp");
      });
      trace.push([name, ...paths].join(" "));
      if (name === "rename" && beforeRename) {
        return beforeRename(String(args[0]), String(args[1])).then(() => Reflect.apply(original, fs, args));
      }
      return Reflect.apply(original, fs, args);
    });
  });
  try {
    await run();
    return trace;
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
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
    src = await fs.realpath(await mkdtemp(join(tmpdir(), "cue-plugsrc-")));
    tgt = await fs.realpath(await mkdtemp(join(tmpdir(), "cue-plugtgt-")));
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

  test("retains referenced cache versions across retargeting without importing old registrations", async () => {
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
      expect(registry["openai-codex"]).toBeUndefined();
      expect(registry["claude-plugins-official"].source).toEqual(official.source);
      expect(await readFile(join(registry["claude-plugins-official"].installLocation, "marketplace.json"), "utf8"))
        .toBe("claude-plugins-official");
      await expect(lstat(join(marketplaceDir, "openai-codex"))).rejects.toHaveProperty("code", "ENOENT");
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

  test("does not attach copied upstream metadata to an unrelated same-name local clone", async () => {
    const upstream = await registerMarketplace(src, "shared", "upstream/shared");
    const unrelated = await registerMarketplace(tgt, "shared", "runtime/shared");
    const local = await registerMarketplace(tgt, "local");
    const registry = join(tgt, "plugins", "known_marketplaces.json");
    await writeFile(registry, JSON.stringify({ local, shared: upstream }));

    await linkPluginCache(tgt, src);

    expect(JSON.parse(await readFile(registry, "utf8"))).toEqual({ local, shared: upstream });
    expect(await readFile(join(unrelated.installLocation, "marketplace.json"), "utf8")).toBe("shared");
  });

  test("keeps a registration changed as cue makes its final registry reread", async () => {
    const local = await registerMarketplace(tgt, "local");
    const concurrent = await registerMarketplace(tgt, "concurrent");
    const upstream = await registerMarketplace(src, "upstream");
    const registry = join(tgt, "plugins", "known_marketplaces.json");
    await writeFile(registry, JSON.stringify({ local }));
    const write = fs.writeFile;
    const read = fs.readFile;
    let prepared = false;
    let wrote = false;
    const stagedWrite = spyOn(fs, "writeFile").mockImplementation(async (path, ...args) => {
      await write(path, ...args);
      if (typeof path === "string" && path.startsWith(`${registry}.cue-tmp-`)) prepared = true;
    });
    const finalRead = spyOn(fs, "readFile").mockImplementation(async (path, ...args) => {
      if (prepared && !wrote && path === registry) {
        wrote = true;
        await write(registry, JSON.stringify({ local, concurrent }));
      }
      return Reflect.apply(read, fs, [path, ...args]);
    });
    try {
      await linkPluginCache(tgt, src);
    } finally {
      finalRead.mockRestore();
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

  test("removes canonicalized imports after an account switch or if their checkout disappears", async () => {
    await registerMarketplace(tgt, "local");
    const previous = join(src, "previous");
    const old = await registerMarketplace(previous, "old");
    const checkout = join(src, "checkout");
    await fs.rename(old.installLocation, checkout);
    await fs.symlink(checkout, old.installLocation);
    const alias = join(tgt, "plugins", "marketplaces", "old");

    for (const switchAccount of [true, false]) {
      await linkPluginCache(tgt, previous);
      expect(await readlink(alias)).toBe(checkout);
      if (!switchAccount) await rm(checkout, { recursive: true });
      await linkPluginCache(tgt, switchAccount ? src : previous);
      await expect(lstat(alias)).rejects.toHaveProperty("code", "ENOENT");
    }
  });

  test("rejects a clone backlink to an ancestor of the runtime link", async () => {
    const local = await registerMarketplace(tgt, "local");
    const upstream = await registerMarketplace(src, "backlink");
    await rm(upstream.installLocation, { recursive: true });
    await fs.symlink(dirname(local.installLocation), upstream.installLocation);

    await linkPluginCache(tgt, src);

    await expect(lstat(join(dirname(local.installLocation), "backlink"))).rejects.toHaveProperty("code", "ENOENT");
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
    // PR #243 stored full-entry digests. Claude's edit invalidates that digest.
    const digest = new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(["imported", imported], (_key, value: unknown) =>
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      )).digest("hex");
    await writeFile(join(tgt, "plugins", ".cue-marketplace-imports.json"), JSON.stringify({ [digest]: true }));
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
      expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("openai-codex");
      expect(await readFile(join(plugins, "installed_plugins.json"), "utf8")).toBe(registry);
      expect(await readFile(join(installPath, "hooks.json"), "utf8")).toBe("{}");
      expect(await readFile(join(installPath, "..", "1.1.0", "hooks.json"), "utf8")).toBe("new version");
      expect(await readFile(join(plugins, "cache", "thedotmack", "claude-mem", "13.13.1", "hooks.json"), "utf8")).toBe("{}");
    }
  });

  test("carries an installed-only runtime through a rebuild and a source switch", async () => {
    const previous = join(src, "previous");
    await installPlugin(previous, "old");
    const input = runtimeInput(tgt, previous);
    const { runtimeDir } = await materializeRuntime(input);
    const installPath = join(runtimeDir, "plugins", "cache", "old", "codex", "1.0.6");
    const registry = JSON.stringify({ version: 2, plugins: { "codex@old": [{ installPath }] } });
    const installed = join(runtimeDir, "plugins", "installed_plugins.json");
    await writeFile(installed, registry);

    expect((await materializeRuntime({
      ...input, credentialsSource: src,
      profile: { ...input.profile, description: "Changed profile" },
    })).rebuilt).toBe(true);
    expect(await readFile(installed, "utf8")).toBe(registry);
    expect(await readFile(join(installPath, "hooks.json"), "utf8")).toBe("{}");
    expect(JSON.parse(await readFile(join(runtimeDir, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({});
  });

  test("matches the d554c2c2 filesystem trace after zero-state detection", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const roots = { source: src, live: runtimeDir, runtime: dirname(runtimeDir) };
    // Capture every filesystem call after the detector's last read in this
    // fixture. The expected sequences were recorded from d554c2c2.
    const run = async (description: string) => {
      const trace = await traceFilesystem(
        () => materializeRuntime({ ...input, profile: { ...input.profile, description } }),
        roots,
      );
      const detected = trace.indexOf("readFile source/plugins/known_marketplaces.json");
      expect(detected).toBeGreaterThan(-1);
      return trace.slice(detected + 1);
    };
    const seedTrace = (dest: string) => [
      "lstat source/plugins",
      `mkdir ${dest}/plugins`,
      ...["cache", "marketplaces", "known_marketplaces.json"].flatMap((name) => [
        `lstat source/plugins/${name}`,
        `rm ${dest}/plugins/${name}.cue-tmp`,
        `symlink source/plugins/${name} ${dest}/plugins/${name}.cue-tmp`,
        `rename ${dest}/plugins/${name}.cue-tmp ${dest}/plugins/${name}`,
      ]),
    ];
    const finish = [
      "readFile live/.claude.json",
      "rm live/.claude.json",
      "writeFile live/.claude.json",
      "readFile live/.config.json",
      "stat live/.config.json",
      "readFile live.lock/owner.json",
      "rm live.lock",
    ];
    expect(await run(input.profile.description)).toEqual([
      "readFile live/.cue-hash",
      "readFile source/settings.json",
      "readFile live/settings.json",
      "writeFile live/settings.json",
      "readdir source",
      "readFile source/.config.json",
      "readFile source/.claude.json",
      "readFile live/.config.json",
      "readFile live/.claude.json",
      ...seedTrace("live"),
      ...finish,
    ]);
    expect(await run("Changed profile")).toEqual([
      "readFile live/.cue-hash",
      "mkdir runtime",
      "mkdtemp live.tmp.",
      "mkdir stage/skills",
      "writeFile stage/.cue-skills",
      "readFile source/settings.json",
      "readFile live/settings.json",
      "writeFile stage/settings.json",
      "writeFile stage/CLAUDE.md",
      "writeFile stage/.cue-hash",
      "readdir source",
      "readFile source/.config.json",
      "readFile source/.claude.json",
      "readFile stage/.config.json",
      "readFile stage/.claude.json",
      ...seedTrace("stage"),
      "readFile source/.config.json",
      "readFile source/.claude.json",
      "readFile live/.config.json",
      "readFile live/.claude.json",
      "lstat live/.claude.json",
      "rm stage/.claude.json",
      "rename live/.claude.json stage/.claude.json",
      "lstat live/.config.json",
      "lstat live/.credentials.json",
      "lstat live/backups",
      "lstat live/session-env",
      "lstat live/tasks",
      "lstat live/projects",
      "rename live old",
      "rename stage live",
      "rm old",
      "readdir runtime",
      ...finish,
    ]);
    expect(await readdir(dirname(runtimeDir))).toEqual(["claude"]);
  });

  test("stages local plugins before the two consecutive renames and leaves no archive", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const plugins = join(runtimeDir, "plugins");
    await rm(join(plugins, "marketplaces"));
    await rm(join(plugins, "known_marketplaces.json"));
    const local = await registerMarketplace(runtimeDir, "local");
    const cloneFile = join(local.installLocation, "marketplace.json");
    const relativeClone = join("plugins", "marketplaces", "local", "marketplace.json");
    const readClone = fs.readFile;
    const trace = await traceFilesystem(
      () => materializeRuntime({
        ...input, profile: { ...input.profile, description: "Changed profile" },
      }),
      { source: src, live: runtimeDir, runtime: dirname(runtimeDir) },
      async (from, to) => {
        if (from === runtimeDir) expect(await readClone(cloneFile, "utf8")).toBe("local");
        if (to === runtimeDir) {
          expect(await readClone(join(from, relativeClone), "utf8")).toBe("local");
        }
      },
    );
    const moved = trace.indexOf("rename live old");
    expect(moved).toBeGreaterThan(-1);
    expect(trace[moved + 1]).toBe("rename stage live");
    expect(await readFile(cloneFile, "utf8")).toBe("local");
    expect(await readdir(dirname(runtimeDir))).toEqual(["claude"]);
  });

  test("aborts a rebuild if a plugin file changes during staging", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir, hash } = await materializeRuntime(input);
    await rm(join(runtimeDir, "plugins", "marketplaces"));
    await rm(join(runtimeDir, "plugins", "known_marketplaces.json"));
    const local = await registerMarketplace(runtimeDir, "local");
    const cloneFile = join(local.installLocation, "marketplace.json");
    const write = fs.writeFile;
    let changed = false;
    const stageWrite = spyOn(fs, "writeFile").mockImplementation(async (path, ...args) => {
      await write(path, ...args);
      if (String(path).startsWith(`${runtimeDir}.tmp.`) && String(path).includes("known_marketplaces.json")) {
        changed = true;
        await write(cloneFile, "updated while staging");
      }
    });
    try {
      await expect(materializeRuntime({
        ...input, profile: { ...input.profile, description: "Changed profile" },
      })).rejects.toThrow("Plugin state changed");
    } finally {
      stageWrite.mockRestore();
    }
    expect(changed).toBe(true);
    expect(await readFile(cloneFile, "utf8")).toBe("updated while staging");
    expect(await readFile(join(runtimeDir, ".cue-hash"), "utf8")).toBe(hash);
    expect(await readdir(dirname(runtimeDir))).toEqual(["claude"]);
  });

  test("an account switch carries plugins with the new account identity", async () => {
    const previous = join(src, "previous");
    await mkdir(previous);
    const identity = (accountUuid: string) => JSON.stringify({ oauthAccount: { accountUuid } });
    await writeFile(join(previous, ".config.json"), identity("account-a"));
    await writeFile(join(src, ".config.json"), identity("account-b"));
    const input = runtimeInput(tgt, previous);
    const { runtimeDir } = await materializeRuntime(input);
    const config = join(runtimeDir, ".config.json");
    await rm(config);
    await writeFile(config, identity("account-a"));
    const local = await registerMarketplace(runtimeDir, "local");
    const rename = fs.rename;
    const swap = spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (from === runtimeDir) await writeFile(config, identity("account-a"));
      await rename(from, to);
    });
    try {
      expect((await materializeRuntime({
        ...input, credentialsSource: src,
        profile: { ...input.profile, description: "Change accounts" },
      })).rebuilt).toBe(true);
    } finally {
      swap.mockRestore();
    }
    expect(JSON.parse(await readFile(config, "utf8"))).toMatchObject(JSON.parse(identity("account-b")));
    expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("local");
    expect(await readdir(dirname(runtimeDir))).toEqual(["claude"]);
  });

  test("an account switch cannot publish the new hash over an identity recreated during the swap", async () => {
    const previous = join(src, "previous");
    await mkdir(previous);
    const oldIdentity = JSON.stringify({ oauthAccount: { accountUuid: "old" } });
    await writeFile(join(previous, ".config.json"), oldIdentity);
    await writeFile(join(src, ".config.json"), JSON.stringify({ oauthAccount: { accountUuid: "new" } }));
    const input = runtimeInput(tgt, previous);
    const { runtimeDir } = await materializeRuntime(input);
    const rename = fs.rename;
    const swap = spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (to === runtimeDir) {
        await mkdir(runtimeDir);
        await writeFile(join(runtimeDir, ".config.json"), oldIdentity);
      }
      await rename(from, to);
    });
    try {
      await expect(materializeRuntime({
        ...input, credentialsSource: src,
        profile: { ...input.profile, description: "Switch accounts" },
      })).rejects.toThrow();
    } finally {
      swap.mockRestore();
    }
    await expect(lstat(join(runtimeDir, ".cue-hash"))).rejects.toHaveProperty("code", "ENOENT");
  });

  test("copies active plugin entries from an existing archive-backed runtime without recovering siblings", async () => {
    const input = runtimeInput(tgt, src);
    const { runtimeDir } = await materializeRuntime(input);
    const archive = `${runtimeDir}.plugin-state-active`;
    await registerMarketplace(`${runtimeDir}.plugin-state`, "obsolete");
    await rm(join(runtimeDir, "plugins"), { recursive: true });
    const local = await registerMarketplace(runtimeDir, "active");
    await mkdir(archive);
    await fs.rename(join(runtimeDir, "plugins"), join(archive, "plugins"));
    await fs.symlink(join(archive, "plugins"), join(runtimeDir, "plugins"));
    await writeFile(join(archive, ".credentials.json"), "old credentials");

    expect((await materializeRuntime({
      ...input, profile: { ...input.profile, description: "Changed profile" },
    })).rebuilt).toBe(true);

    expect((await lstat(join(runtimeDir, "plugins"))).isDirectory()).toBe(true);
    expect(await readFile(join(local.installLocation, "marketplace.json"), "utf8")).toBe("active");
    expect(JSON.parse(await readFile(join(runtimeDir, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({ active: local });
    await expect(lstat(join(runtimeDir, ".credentials.json"))).rejects.toHaveProperty("code", "ENOENT");
    expect((await readdir(dirname(runtimeDir))).sort())
      .toEqual(["claude", "claude.plugin-state", "claude.plugin-state-active"]);
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
    const other = join(src, "other");
    await installPlugin(other, "other");

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

    try {
      for (let i = 0; i < 30; i++) {
        const source = i % 2 === 0 ? other : src;
        await linkPluginCache(tgt, source);
        expect(await readlink(cacheLink)).toBe(join(source, "plugins", "cache"));
      }
    } finally {
      polling = false;
      await reader;
    }

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
    expect(JSON.parse(await readFile(join(tgt, "plugins", "known_marketplaces.json"), "utf8")))
      .toEqual({ shared: old });
  });
});
