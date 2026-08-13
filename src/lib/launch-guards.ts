/** True iff `CUE_ALWAYS_PICK` is set to an enabling value. */
export function isAlwaysPickEnabled(envVal: string | undefined): boolean {
  if (!envVal) return false;
  return ["1", "true", "on"].includes(envVal.trim().toLowerCase());
}

/** How many cue launches deep this process already is. */
export function launchDepth(envVal: string | undefined = process.env.CUE_LAUNCHING): number {
  if (!envVal) return 0;
  const n = Number.parseInt(envVal.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Depth at which nesting is no longer plausible and must be a shim loop. */
export const MAX_LAUNCH_DEPTH = 3;

export function shouldForcePicker(opts: {
  forcePick: boolean;
  alwaysPickEnv: string | undefined;
  hasOverride: boolean;
  isAccountAlias: boolean;
  isTTY: boolean;
  /** True when the shim was invoked as bare `claude` or `codex`. */
  isBareLaunch: boolean;
}): boolean {
  if (opts.forcePick) return true;
  if (!opts.isTTY) return false;
  if (opts.hasOverride) return false;
  return opts.isBareLaunch || isAlwaysPickEnabled(opts.alwaysPickEnv) || opts.isAccountAlias;
}

export function shouldInheritSessionProfile(opts: {
  resolvedNone: boolean;
  forcePick: boolean;
  isTTY: boolean;
}): boolean {
  return opts.resolvedNone && !opts.forcePick && !opts.isTTY;
}
