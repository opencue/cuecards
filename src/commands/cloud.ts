/**
 * Compatibility aliases for the retired top-level cue cloud commands.
 *
 * The hosted service now lives under `cue marketplace`. Keep the old command
 * names as thin aliases so existing scripts get one credential contract and
 * one API implementation instead of the former parallel `api.getcue.dev`
 * client.
 */

import { clearCredentials } from "../lib/cue-credentials";
import { validateProfileName } from "../lib/profile-generator";

const CLOUD_COMMANDS = new Set(["login", "logout", "push", "pull", "whoami"]);

export interface CloudInvocation {
  command: "login" | "logout" | "push" | "pull" | "whoami";
  args: string[];
}

/** Resolve registry dispatch (`process.argv[2]`) or direct unit invocation. */
export function resolveCloudInvocation(
  args: string[],
  argv: string[] = process.argv,
): CloudInvocation | null {
  const argvCommand = argv[2];
  if (argvCommand && CLOUD_COMMANDS.has(argvCommand)) {
    return { command: argvCommand as CloudInvocation["command"], args };
  }
  const argCommand = args[0];
  if (argCommand && CLOUD_COMMANDS.has(argCommand)) {
    return {
      command: argCommand as CloudInvocation["command"],
      args: args.slice(1),
    };
  }
  return null;
}

export async function run(args: string[]): Promise<number> {
  const invocation = resolveCloudInvocation(args);
  if (!invocation) {
    process.stderr.write(
      "Usage: cue login | cue push <profile> | cue pull <profile> | cue logout | cue whoami\n",
    );
    return 1;
  }

  if (invocation.command === "logout") {
    clearCredentials();
    process.stdout.write("✓ Logged out. Marketplace credentials cleared.\n");
    return 0;
  }

  if (invocation.command === "pull") {
    const query = invocation.args[0] ? ` ${invocation.args[0]}` : " <profile>";
    process.stderr.write(
      "`cue pull` has been retired. " +
        `Use \`cue marketplace search${query}\` or \`cue import <source>\`.\n`,
    );
    return 1;
  }

  const marketplace = await import("./marketplace");
  if (invocation.command === "login" || invocation.command === "whoami") {
    return marketplace.run([invocation.command, ...invocation.args]);
  }

  const profileName = invocation.args.find((arg) => !arg.startsWith("-"));
  if (!profileName || !validateProfileName(profileName)) {
    process.stderr.write(
      "Usage: cue push <profile> (profile must use lowercase kebab-case)\n",
    );
    return 1;
  }
  const publishArgs = invocation.args.filter((arg) => arg !== "--team");
  return marketplace.run(["publish", "profile", ...publishArgs]);
}
