export interface RunnableCommand {
  load: () => Promise<{ run: (args: string[]) => Promise<number> }>;
}

/** Load and run one command with the CLI's uniform internal-error contract. */
export async function runCommand(
  name: string,
  args: string[],
  command: RunnableCommand,
): Promise<number> {
  try {
    const mod = await command.load();
    return await mod.run(args);
  } catch (err) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`cue: internal error in "${name}": ${msg}\n`);
    return 2;
  }
}
