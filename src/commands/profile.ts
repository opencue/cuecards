/**
 * `cue profile <subcommand>` — profile-scoped operations.
 *
 * Subcommands:
 *   suggest    Audit profiles/ and propose regroupings
 */

export async function run(args: string[]): Promise<number> {
  const sub = args[0];

  if (!sub || sub === "-h" || sub === "--help") {
    process.stdout.write(`cue profile — profile-scoped operations

Subcommands:
  suggest         Audit profiles/ and propose regroupings (promote-to-core, merges, new clusters)
  match           Show why a directory matches the profiles it does (--explain, --deep)
  evolve          Surface skill-usage signals from analytics logs (drop / stale / group candidates)
  draft-skill     Draft new SKILL.md files from recurring session prompts

Run \`cue profile <subcommand> --help\` for details.
`);
    return sub ? 0 : 1;
  }

  if (sub === "match") {
    const { run: matchRun } = await import("./profile-match");
    return matchRun(args.slice(1));
  }

  if (sub === "suggest") {
    const { run: suggestRun } = await import("./profile-suggest");
    return suggestRun(args.slice(1));
  }

  if (sub === "evolve") {
    const { run: evolveRun } = await import("./profile-evolve");
    return evolveRun(args.slice(1));
  }

  if (sub === "draft-skill") {
    const { run: draftRun } = await import("./profile-draft-skill");
    return draftRun(args.slice(1));
  }

  process.stderr.write(`Unknown subcommand: cue profile ${sub}\nRun \`cue profile --help\`.\n`);
  return 1;
}
