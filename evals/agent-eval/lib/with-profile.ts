import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExperimentConfig, Sandbox } from '@vercel/agent-eval';

/**
 * Make a cue PROFILE the measured variable.
 *
 * `setup` runs on the HOST (where `cue` lives). It self-primes the profile's
 * runtime with:
 *
 *     cue launch <profile> --rematerialize
 *
 * which materializes the full runtime — persona + rules + skill-routing +
 * `_always` fragments, rendered into CLAUDE.md — WITHOUT exec'ing claude, and
 * prints `{ runtimeDir }` as JSON (see src/commands/launch.ts: materializeRuntime
 * runs before the --rematerialize gate). We read that CLAUDE.md and write it into
 * the sandbox so the in-sandbox Claude Code runs under the profile's instructions.
 *
 * Deliberately NOT injected: MCP servers, hooks, and the headroom proxy env.
 * Those need keys / network and would fail to start in the throwaway sandbox.
 * The measured variable here is the profile's INSTRUCTIONS, not its infra — which
 * is exactly what differs most between core / gstack / improver.
 *
 * Skill BODIES are not injected yet (the CLAUDE.md already carries each profile's
 * skill list + routing). Injecting the materialized SKILL.md files is the obvious
 * next extension — see the note at the bottom of this file.
 */
export function withProfile(profile: string): Pick<ExperimentConfig, 'setup'> {
  return {
    setup: async (sandbox: Sandbox) => {
      const claudeMd = renderProfileClaudeMd(profile);
      await sandbox.writeFiles({ 'CLAUDE.md': claudeMd });
    },
  };
}

/** Materialize a cue profile on the host and return its rendered CLAUDE.md. */
export function renderProfileClaudeMd(profile: string): string {
  let out: string;
  try {
    // The agent positional MUST be "claude" (selects agentKind claude-code);
    // the profile is forced regardless of cwd via `--cue-profile <name>`.
    // A bare `cue launch <profile>` leaves agent null → "missing agent" exit 1.
    // stderr is piped (not inherited) so cue's rebuild diagnostics don't bleed
    // into the eval harness output; it surfaces in the error on failure.
    out = execFileSync(
      'cue',
      ['launch', 'claude', '--cue-profile', profile, '--rematerialize'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    throw new Error(
      `withProfile("${profile}"): \`cue launch claude --cue-profile ${profile} --rematerialize\` failed. ` +
        `Is the \`cue\` CLI on PATH and "${profile}" a valid profile? ` +
        `Run from a PLAIN shell — inside a cue session CUE_LAUNCHING=1 trips the recursion guard. ` +
        `${stderr.trim() ? `cue stderr: ${stderr.trim()} — ` : ''}` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --rematerialize prints pretty JSON to stdout FOLLOWED BY a status line
  // (e.g. "✅ Rematerialized."), so JSON.parse(out) would throw. Slice out the
  // object. The payload (profile/agent/runtimeDir/rebuilt/hash) is all scalars,
  // so first "{" .. last "}" is the whole object.
  const start = out.indexOf('{');
  const end = out.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(
      `withProfile("${profile}"): no JSON in \`cue --rematerialize\` output:\n${out}`,
    );
  }
  let runtimeDir: string;
  try {
    runtimeDir = (JSON.parse(out.slice(start, end + 1)) as { runtimeDir?: string })
      .runtimeDir as string;
  } catch (err) {
    throw new Error(
      `withProfile("${profile}"): could not parse runtimeDir from cue output. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!runtimeDir) {
    throw new Error(`withProfile("${profile}"): cue did not report a runtimeDir.`);
  }

  // CLAUDE.md sits at runtimeDir/CLAUDE.md or runtimeDir/claude/CLAUDE.md
  // depending on how runtimeDir is reported. Check both.
  const claudeMdPath = [
    join(runtimeDir, 'CLAUDE.md'),
    join(runtimeDir, 'claude', 'CLAUDE.md'),
  ].find(existsSync);

  if (!claudeMdPath) {
    throw new Error(
      `withProfile("${profile}"): no CLAUDE.md found under ${runtimeDir}.`,
    );
  }
  return readFileSync(claudeMdPath, 'utf8');
}

// Extension point — inject skill bodies as well as the CLAUDE.md routing:
//   1. From the same runtimeDir, read `skills/**/SKILL.md` (materialize symlinks
//      them; deref with realpathSync before reading).
//   2. Write each to `.claude/skills/<id>/SKILL.md` in the sandbox alongside
//      CLAUDE.md so Claude Code auto-discovers them.
// Left out of the first cut to keep the measured variable clean and the scaffold
// small; the CLAUDE.md already differs sharply across profiles.
