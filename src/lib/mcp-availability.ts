import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

interface McpLaunchConfig {
  command?: unknown;
  enabled?: unknown;
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
  const expanded = value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key: string) =>
      envValue(env, key, platform) ?? match,
    )
    .replace(/%([^%]+)%/g, (match, key: string) =>
      envValue(env, key, platform) ?? match,
    );
  if (!/^~[\\/]/.test(expanded)) return expanded;
  const home =
    envValue(env, "HOME", platform) ??
    envValue(env, "USERPROFILE", platform);
  return home === undefined ? expanded : `${home}${expanded.slice(1)}`;
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

  if (/[\\/]/.test(expanded)) {
    const path = pathApi.isAbsolute(expanded)
      ? expanded
      : pathApi.resolve(cwd, expanded);
    return isExecutable(path);
  }

  const pathValue = envValue(env, "PATH", platform) ?? "";
  const pathSeparator = platform === "win32" ? ";" : ":";
  const extensions =
    platform === "win32"
      ? (envValue(env, "PATHEXT", platform) ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  const hasKnownExtension =
    platform === "win32" &&
    extensions.some((extension) =>
      expanded.toLowerCase().endsWith(extension.toLowerCase()),
    );
  const names = hasKnownExtension
    ? [expanded]
    : platform === "win32"
      ? extensions.map((extension) => `${expanded}${extension}`)
      : [expanded];

  for (const rawDir of pathValue.split(pathSeparator)) {
    const unquoted = rawDir.replace(/^"|"$/g, "");
    const dir = expandEnvironmentPath(unquoted || cwd, env, platform);
    if (names.some((name) => isExecutable(pathApi.join(dir, name)))) return true;
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
    if (
      isRemote ||
      isDisabled ||
      (typeof launch.command === "string" &&
        launch.command.length > 0 &&
        isCommandAvailable(launch.command, options))
    ) {
      available[id] = config;
    }
  }
  return available;
}
