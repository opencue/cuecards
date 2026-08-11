/**
 * launch-loader.ts — a terminal loading animation shown during the cue→agent
 * handoff: after the picker exits, while cue does its real work (smart-subset
 * classification, runtime materialization), and before it exec's the real
 * claude/codex binary. It masks that wait with a branded animation, then FULLY
 * restores the terminal so the child inherits a clean screen.
 *
 * Load-bearing rules (each one traces to a concrete failure mode — see the
 * design review that produced this module):
 *
 *   1. Writes ONLY to its own stream (default process.stderr). Never stdout —
 *      stdout carries the tmux title OSC and the picker's Kitty placements.
 *   2. No-op in any non-interactive context (no TTY, --dry-run, CUE_BYPASS,
 *      CUE_NO_LOADER). startLoader() returns a do-nothing handle, so callers
 *      need zero guard logic at the call site.
 *   3. WARM-UP DELAY: the loader touches the terminal only after START_DELAY_MS.
 *      A fast (warm-cache) launch finishes before that and the loader is a true
 *      no-op — no spinner flash, no cursor blink. Only genuinely slow launches
 *      (cold smart-subset ~2s) ever animate.
 *   4. Single-line, in-place redraw with `\r`/CHA + `\x1b[K`. No DEC save/restore
 *      cursor (ESC[s/ESC[u) — unreliable through tmux, and @clack already owns
 *      cursor restore after the picker.
 *   5. stop() is idempotent and MUST run before exec. It erases the animated
 *      line, deletes the Kitty logo BY ID (never delete-all → the picker's
 *      images survive), and shows the cursor.
 *   6. Uses the SYNC isKittyTerminal() (env-only). Never the async probe — it
 *      grabs stdin.setRawMode and would fight both the animation and the child.
 *   7. A SIGINT during the wait tears the loader down (try/finally) before
 *      exiting 130, so Ctrl-C never strands a hidden cursor or a stray image.
 */
import { existsSync } from "node:fs";

import { clearKittyImageByIdSequence, isKittyTerminal, renderKittyImage } from "./kitty-image";

/** Sparkle frames — a rotating/pulsing 4-point star, the "Claude" feel. */
const FRAMES = ["✦", "✧", "✶", "✷", "✸", "✹", "✺", "✻"];
const TICK_MS = 90;
/** Wait this long before drawing anything; warm launches finish first → no-op. */
const START_DELAY_MS = 64;
/**
 * Fixed image id for the loader's logo so we can delete exactly it on stop.
 * Chosen above renderKittyImage's random range (0..999_999) so it can never
 * collide with a picker placement and get deleted out from under it.
 */
const LOGO_IMAGE_ID = 1_000_001;

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const ERASE_LINE = "\r\x1b[K";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
/** Claude clay/coral, as a 24-bit FG so the spinner reads as "Claude". */
const CORAL = "\x1b[38;2;217;119;87m";

export interface LoaderOptions {
  /** Trailing message after the spinner. Default "Launching Claude…". */
  message?: string;
  /** Stream to draw on. Default process.stderr. Must be a TTY to animate. */
  stream?: NodeJS.WriteStream;
  /** Absolute path to a PNG logo for the Kitty path. Skipped if missing. */
  logoPath?: string;
  /** Columns the logo occupies (text starts after it). Default 2. */
  logoCols?: number;
  /** Override the warm-up delay (tests). */
  startDelayMs?: number;
}

export interface LoaderHandle {
  setMessage(msg: string): void;
  /** Idempotent. Restores the terminal. Call before exec. */
  stop(): void;
}

/** Dependencies the pure core needs — injected so tests drive it without a TTY. */
interface CoreDeps {
  write(s: string): void;
  /** Kitty image escape string to render once at line start, or null for ANSI-only. */
  renderLogo(): string | null;
  /** Escape string to delete the logo, or "" when there is none. */
  clearLogo(): string;
  /** Columns the logo occupies, for the text offset. */
  logoCols: number;
}

interface LoaderCore {
  start(): void;
  tick(): void;
  setMessage(msg: string): void;
  stop(): void;
  readonly started: boolean;
}

/**
 * The pure animation state machine. No timers, no env, no real streams — every
 * side effect goes through `deps`. `startLoader` wraps this with a real
 * setInterval + SIGINT handling; tests drive start/tick/stop by hand.
 */
function createLoaderCore(deps: CoreDeps, message: string): LoaderCore {
  let frame = 0;
  let started = false;
  let stopped = false;
  let msg = message;
  let logo: string | null = null;

  const drawFrame = (): void => {
    // 1-based column where the text begins: after the logo (if any) + 1 gap cell.
    const textCol = logo ? deps.logoCols + 2 : 1;
    const spinner = `${CORAL}${FRAMES[frame % FRAMES.length]}${RESET}`;
    // Strip control chars (CR/LF/ESC/tab) from the message — it can carry the
    // classifier's REASON line, and an embedded \r/\n would break the single-line
    // redraw (cursor leaves the line; stop() then erases the wrong one).
    const safeMsg = msg.replace(/[\u0000-\u001f\u007f]/g, " ");
    // CHA to textCol, erase to EOL (leaves the logo cells intact), draw.
    deps.write(`\x1b[${textCol}G\x1b[K${spinner} ${DIM}${safeMsg}${RESET}`);
  };

  return {
    start(): void {
      if (started || stopped) return;
      started = true;
      logo = deps.renderLogo();
      deps.write(HIDE_CURSOR);
      deps.write("\r");
      if (logo) deps.write(logo);
      drawFrame(); // first frame immediately, so there is always something to clear
    },
    tick(): void {
      if (!started || stopped) return;
      frame++;
      drawFrame();
    },
    setMessage(next: string): void {
      msg = next;
      if (started && !stopped) drawFrame();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      if (!started) return; // never touched the terminal → nothing to undo
      deps.write(ERASE_LINE);
      const clear = deps.clearLogo();
      if (clear) deps.write(clear);
      deps.write(SHOW_CURSOR);
    },
    get started() {
      return started;
    },
  };
}

/**
 * Start the launch loader. Returns a handle whose stop() must be called before
 * exec'ing the agent, or `null` in any non-interactive context (no TTY,
 * CUE_BYPASS, CUE_NO_LOADER). A null return lets callers route progress text to
 * stderr instead of the (absent) animated line.
 *
 * The CUE_BYPASS check is belt-and-braces now that `cue launch` short-circuits
 * to exec before it ever reaches a loader; it keeps this module honest for any
 * other caller.
 */
export function startLoader(opts: LoaderOptions = {}): LoaderHandle | null {
  const stream = opts.stream ?? process.stderr;
  if (!stream.isTTY) return null;
  if (process.env.CUE_BYPASS === "1") return null;
  if (process.env.CUE_NO_LOADER === "1") return null;

  const logoCols = opts.logoCols ?? 2;
  const useKitty = !!opts.logoPath && existsSync(opts.logoPath) && isKittyTerminal();

  const deps: CoreDeps = {
    write: (s) => {
      try {
        stream.write(s);
      } catch {
        /* terminal went away mid-write — give up silently */
      }
    },
    renderLogo: () => (useKitty ? renderKittyImage(opts.logoPath!, logoCols, 1, LOGO_IMAGE_ID) : null),
    clearLogo: () => (useKitty ? clearKittyImageByIdSequence(LOGO_IMAGE_ID) : ""),
    logoCols,
  };

  const core = createLoaderCore(deps, opts.message ?? "Launching Claude…");
  const delayMs = opts.startDelayMs ?? START_DELAY_MS;

  let interval: ReturnType<typeof setInterval> | null = null;
  const armTimer = setTimeout(() => {
    core.start();
    interval = setInterval(() => core.tick(), TICK_MS);
    interval.unref?.();
  }, delayMs);
  armTimer.unref?.();

  let stopped = false;
  let sigint: (() => void) | null = () => {
    try {
      teardown();
    } finally {
      process.exit(130);
    }
  };

  function teardown(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(armTimer);
    if (interval) clearInterval(interval);
    if (sigint) {
      process.removeListener("SIGINT", sigint);
      sigint = null;
    }
    core.stop();
  }

  process.once("SIGINT", sigint);

  return {
    setMessage: (m) => core.setMessage(m),
    stop: teardown,
  };
}

/** Test-only surface. */
export const __test = {
  createLoaderCore,
  FRAMES,
  TICK_MS,
  START_DELAY_MS,
  ESC: { HIDE_CURSOR, SHOW_CURSOR, ERASE_LINE },
};
