import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

interface McpLaunchConfig {
  command?: unknown;
  cwd?: unknown;
  enabled?: unknown;
  env?: unknown;
  url?: unknown;
}

export interface CommandAvailabilityOptions {
  platform?: NodeJS.Platform;
  cwd?: string;
  env?: Record<string, string | undefined>;
  isExecutable?: (path: string) => boolean;
}

function envValue(
  env: Record<string, string | undefined>,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return env[key];
  const match = Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return match === undefined ? undefined : env[match];
}

function expandEnvironmentPath(
  value: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string {
  let expanded = value.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (
      match,
      bracedKey: string | undefined,
      bareKey: string | undefined,
    ) => envValue(env, bracedKey ?? bareKey ?? "", platform) ?? match,
  );
  if (platform === "win32") {
    expanded = expanded.replace(/%([^%]+)%/g, (match, key: string) =>
      envValue(env, key, platform) ?? match,
    );
  }
  if (!/^~[\\/]/.test(expanded)) return expanded;
  const home =
    envValue(env, "HOME", platform) ??
    envValue(env, "USERPROFILE", platform);
  return home === undefined ? expanded : `${home}${expanded.slice(1)}`;
}

function environmentForServer(
  serverEnv: unknown,
  options: CommandAvailabilityOptions,
): Record<string, string | undefined> {
  const platform = options.platform ?? process.platform;
  const merged = { ...(options.env ?? process.env) };
  if (
    serverEnv === null ||
    typeof serverEnv !== "object" ||
    Array.isArray(serverEnv)
  ) {
    return merged;
  }
  const overrides = Object.entries(serverEnv).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  for (const [key, value] of overrides) {
    if (platform === "win32") {
      for (const existing of Object.keys(merged)) {
        if (existing.toLowerCase() === key.toLowerCase()) delete merged[existing];
      }
    }
    merged[key] = value;
  }
  for (const [key, value] of overrides) {
    merged[key] = expandEnvironmentPath(value, merged, platform);
  }
  return merged;
}

function workingDirectoryForServer(
  serverCwd: unknown,
  env: Record<string, string | undefined>,
  options: CommandAvailabilityOptions,
): string {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? win32 : posix;
  const base = options.cwd ?? process.cwd();
  if (typeof serverCwd !== "string" || serverCwd.length === 0) return base;
  const expanded = expandEnvironmentPath(serverCwd, env, platform);
  return pathApi.isAbsolute(expanded)
    ? expanded
    : pathApi.resolve(base, expanded);
}

function defaultExecutableProbe(
  path: string,
  platform: NodeJS.Platform,
): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandCandidates(
  command: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== "win32") return [command];
  const configuredExtensions = (
    envValue(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD"
  )
    .split(";")
    .map((extension) => extension.trim().toUpperCase())
    .filter(Boolean);
  const extensions = Array.from(new Set([".EXE", ...configuredExtensions]));
  const explicitExtension = command
    .match(/(\.[^.\\/]+)$/)?.[1]
    ?.toLowerCase();
  if (explicitExtension !== undefined) {
    const executableExtensions = new Set([
      ".com",
      ".exe",
      ".bat",
      ".cmd",
      ...extensions.map((extension) => extension.toLowerCase()),
    ]);
    return executableExtensions.has(explicitExtension) ? [command] : [];
  }
  return extensions.map((extension) => `${command}${extension}`);
}

export function isCommandAvailable(
  command: string,
  options: CommandAvailabilityOptions = {},
): boolean {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? win32 : posix;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const isExecutable =
    options.isExecutable ?? ((path: string) => defaultExecutableProbe(path, platform));
  const expanded = expandEnvironmentPath(command, env, platform);
  const candidates = commandCandidates(expanded, env, platform);

  if (/[\\/]/.test(expanded)) {
    return candidates.some((candidate) => {
      const path = pathApi.isAbsolute(candidate)
        ? candidate
        : pathApi.resolve(cwd, candidate);
      return isExecutable(path);
    });
  }

  if (
    platform === "win32" &&
    candidates.some((name) => isExecutable(pathApi.join(cwd, name)))
  ) {
    return true;
  }

  const pathValue = envValue(env, "PATH", platform) ?? "";
  const pathSeparator = platform === "win32" ? ";" : ":";

  for (const rawDir of pathValue.split(pathSeparator)) {
    const unquoted = rawDir.replace(/^"|"$/g, "");
    const expandedDir = expandEnvironmentPath(unquoted || cwd, env, platform);
    const dir = pathApi.isAbsolute(expandedDir)
      ? expandedDir
      : pathApi.resolve(cwd, expandedDir);
    if (candidates.some((name) => isExecutable(pathApi.join(dir, name)))) {
      return true;
    }
  }
  return false;
}

export function filterUnavailableMcpServers<T extends object>(
  servers: Record<string, T>,
  options: CommandAvailabilityOptions = {},
): Record<string, T> {
  const available: Record<string, T> = {};
  for (const [id, config] of Object.entries(servers)) {
    const launch = config as McpLaunchConfig;
    const isRemote = typeof launch.url === "string" && launch.url.length > 0;
    const isDisabled = launch.enabled === false;
    const env = environmentForServer(launch.env, options);
    const commandAvailable =
      !isRemote &&
      !isDisabled &&
      typeof launch.command === "string" &&
      launch.command.length > 0 &&
      isCommandAvailable(launch.command, {
        ...options,
        env,
        cwd: workingDirectoryForServer(launch.cwd, env, options),
      });
    if (isRemote || isDisabled || commandAvailable) {
      available[id] = config;
    }
  }
  return available;
}
