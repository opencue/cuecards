/**
 * Kitty graphics protocol helpers.
 *
 * Kitty's graphics protocol lets us render real images inline in the terminal.
 * Spec: https://sw.kovidgoyal.net/kitty/graphics-protocol/
 *
 * For our use case (small icons in a picker), we use:
 *  - a=T (transmit + display immediately)
 *  - f=100 (PNG format)
 *  - t=f (data is a base64-encoded file path)
 *  - c=N,r=M (display at N columns x M rows)
 *  - q=2 (silent — suppress protocol responses)
 *
 * tmux: if we're running inside tmux, tmux strips terminal-specific escapes
 * by default. We wrap the sequence with tmux's passthrough envelope and the
 * user must have `set -g allow-passthrough on` in ~/.tmux.conf
 * (default in tmux 3.3+, opt-in earlier).
 *
 * Detection: tmux also strips KITTY_* env vars and sets TERM_PROGRAM=tmux,
 * so we additionally walk the process-parent chain to find a `kitty` process.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let kittyAncestorCache: boolean | null = null;
let _ancestorOverride: (() => boolean) | null = null;

/**
 * Walk /proc/<pid>/stat up the parent chain looking for a Kitty process.
 * Linux-only; on macOS / other OSes returns false (we rely on env vars).
 */
export function hasKittyAncestor(): boolean {
  if (_ancestorOverride) return _ancestorOverride();
  if (kittyAncestorCache !== null) return kittyAncestorCache;
  if (process.platform !== "linux") return (kittyAncestorCache = false);

  let pid: number | null = process.pid;
  for (let depth = 0; depth < 32 && pid && pid > 1; depth++) {
    let comm: string | null = null;
    let ppid: number | null = null;
    try {
      // /proc/<pid>/comm is the truncated process name
      comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    } catch {
      break;
    }
    try {
      // /proc/<pid>/stat: pid (comm) state ppid …
      // comm can contain spaces and parens, so split on the last `)`
      const stat: string = readFileSync(`/proc/${pid}/stat`, "utf8");
      const lastParen = stat.lastIndexOf(")");
      const after = stat.slice(lastParen + 1).trim().split(/\s+/);
      ppid = Number(after[1]);
    } catch {
      break;
    }

    if (comm && /kitty/i.test(comm)) return (kittyAncestorCache = true);
    pid = ppid && ppid > 0 ? ppid : null;
  }
  return (kittyAncestorCache = false);
}

/**
 * Detect whether the current terminal can render Kitty graphics protocol.
 *
 * Detection order (most → least reliable):
 *   1. CUE_KITTY=1 — explicit opt-in (set this in your shell rc when you
 *      always run inside Kitty; bypasses all other detection).
 *   2. CUE_DISABLE_KITTY_IMAGES=1 — explicit opt-out (highest priority).
 *   3. TERM=xterm-kitty (running directly in Kitty, no multiplexer)
 *   4. KITTY_WINDOW_ID set (Kitty exports this for child processes)
 *   5. KITTY_PID, TERM_PROGRAM=kitty, LC_TERMINAL=kitty
 *   6. Inside tmux/screen: walk /proc/<pid>/comm parent chain looking for
 *      a kitty process. Note: tmux server runs detached, so this only works
 *      when the picker is launched as a direct descendant of Kitty (rare
 *      inside tmux). Use CUE_KITTY=1 instead for tmux-inside-Kitty setups.
 */
export function isKittyTerminal(): boolean {
  if (process.env.CUE_DISABLE_KITTY_IMAGES === "1") return false;
  if (process.env.CUE_KITTY === "1") return true;

  // Direct Kitty
  if (process.env.TERM === "xterm-kitty") return true;
  if (process.env.KITTY_WINDOW_ID) return true;
  if (process.env.KITTY_PID) return true;
  if (process.env.TERM_PROGRAM === "kitty") return true;
  if (process.env.LC_TERMINAL === "kitty") return true;

  // tmux/screen typically strips those — fall back to ancestor walk.
  if (process.env.TMUX || /screen/.test(process.env.TERM ?? "")) {
    return hasKittyAncestor();
  }
  return false;
}

/** True iff we're inside a tmux session (need passthrough wrapping). */
function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * Wrap a single ESC-prefixed sequence with tmux's passthrough envelope so
 * tmux forwards it to the underlying terminal instead of consuming it.
 * Format: ESC P tmux ; <inner with each ESC doubled> ESC \
 * Requires `set -g allow-passthrough on` in tmux config.
 */
function tmuxPassthrough(inner: string): string {
  const escaped = inner.replace(/\x1b/g, "\x1b\x1b");
  return `\x1bPtmux;${escaped}\x1b\\`;
}

/**
 * Build a Kitty graphics-protocol escape sequence that renders `imagePath`
 * inline at `cols` columns wide and `rows` rows tall.
 *
 * The path is base64-encoded per the spec when t=f (file mode).
 * If we're inside tmux, the sequence is wrapped with the passthrough envelope.
 */
export function renderKittyImage(
  imagePath: string,
  cols = 2,
  rows = 1,
  imageId?: number,
): string {
  const abs = resolve(imagePath);
  const b64Path = Buffer.from(abs, "utf8").toString("base64");
  const id = imageId ?? Math.floor(Math.random() * 1_000_000);
  const seq = `\x1b_Ga=T,f=100,t=f,c=${cols},r=${rows},i=${id},q=2;${b64Path}\x1b\\`;
  return isInsideTmux() ? tmuxPassthrough(seq) : seq;
}

// ---------------------------------------------------------------------------
// Unicode placeholder mode (kitty graphics protocol §"Unicode placeholders")
// ---------------------------------------------------------------------------
//
// Direct rendering (a=T without U=1) places the image at the cursor position
// on Kitty's graphics layer. The escape sequence sits inside the label string,
// where `fast-string-width` (used by @clack/prompts) counts every byte of the
// base64-encoded file path as printable text — so the layout engine thinks
// each label is ~110 chars wide and hard-wraps it. The visible result is the
// image rendered on a separate row from the profile name.
//
// Placeholder mode fixes this: we transmit the image once with `a=T,U=1`
// (transmit + create *virtual* placement, don't paint anything yet), then put
// `U+10EEEE` chars in the label to reserve cells. Each placeholder counts as
// one display cell to width-calculators, so layout is correct. Kitty fills
// those cells with image data when it renders. Bonus: the image is tied to
// the text cells, so it scrolls naturally with the picker output instead of
// floating on the graphics layer.
//
// Image ID encoding: low byte of the image ID is set via a 256-color FG escape
// (`\x1b[38;5;Nm`), which is recognized and stripped by ansi-regex/wrap-ansi
// (so it adds 0 to the visible width). High byte would need a third diacritic;
// we cap at 255 since we only have a handful of profiles with iconImage.

const KITTY_PLACEHOLDER_CHAR = "\u{10EEEE}";

/**
 * Combining diacritics from Kitty's row/column table. Index = 0-based row or
 * column number. First 32 entries — far more than we need for 2x1 icons.
 *
 * Full table:
 *   https://sw.kovidgoyal.net/kitty/_downloads/f0a0ab9bbf8df5c1c1dd0f14d1c1ad32/rowcolumn-diacritics.txt
 */
const ROW_COL_DIACRITICS = [
  "\u{0305}", "\u{030D}", "\u{030E}", "\u{0310}",
  "\u{0312}", "\u{033D}", "\u{033E}", "\u{033F}",
  "\u{0346}", "\u{034A}", "\u{034B}", "\u{034C}",
  "\u{0350}", "\u{0351}", "\u{0352}", "\u{0357}",
  "\u{035B}", "\u{0363}", "\u{0364}", "\u{0365}",
  "\u{0366}", "\u{0367}", "\u{0368}", "\u{0369}",
  "\u{036A}", "\u{036B}", "\u{036C}", "\u{036D}",
  "\u{036E}", "\u{036F}", "\u{0483}", "\u{0484}",
];

/**
 * Transmit `imagePath` to Kitty and create a virtual placement (U=1) so the
 * image is held until placeholder text references it. Stable image IDs let
 * Kitty dedupe retransmits across picker re-renders.
 *
 * Writes the sequence to stdout immediately; tmux-wraps when needed. No-op
 * outside a TTY. Errors during transmission are silent (q=2) — the worst
 * case is the placeholder cells render as tofu boxes, which is no worse than
 * the missing-icon case.
 */
export function transmitKittyImage(
  imagePath: string,
  imageId: number,
  cols = 2,
  rows = 1,
): void {
  if (!process.stdout.isTTY) return;
  const abs = resolve(imagePath);
  const b64Path = Buffer.from(abs, "utf8").toString("base64");
  // a=T (transmit + place) + U=1 (placement is virtual; image isn't displayed
  // until placeholders appear in text)
  const seq = `\x1b_Ga=T,U=1,f=100,t=f,i=${imageId},c=${cols},r=${rows},q=2;${b64Path}\x1b\\`;
  process.stdout.write(isInsideTmux() ? tmuxPassthrough(seq) : seq);
}

/**
 * Build a label fragment that renders the previously-transmitted image at
 * `cols × rows` cells using Kitty's Unicode-placeholder protocol.
 *
 * Output shape:
 *   ESC[38;5;<id>m  <U+10EEEE><row><col><U+10EEEE>...  ESC[39m
 *
 * Each `U+10EEEE` carries two combining diacritics: row index + column index
 * within the image. Width calculators see the placeholder chars as 1 cell
 * each (combining marks are 0-width), so a 2x1 icon contributes 2 visible
 * cells to the label — the same as a single emoji.
 *
 * Throws on imageId out of range; the caller is responsible for assigning
 * IDs in 1..255.
 */
export function kittyPlaceholderLabel(imageId: number, cols = 2, rows = 1): string {
  if (!Number.isInteger(imageId) || imageId < 1 || imageId > 255) {
    throw new Error(`kittyPlaceholderLabel: imageId must be integer in 1..255 (got ${imageId})`);
  }
  if (rows < 1 || cols < 1) {
    throw new Error(`kittyPlaceholderLabel: rows/cols must be >= 1 (got ${rows}x${cols})`);
  }
  if (rows > ROW_COL_DIACRITICS.length || cols > ROW_COL_DIACRITICS.length) {
    throw new Error(
      `kittyPlaceholderLabel: rows/cols too large for diacritic table (max ${ROW_COL_DIACRITICS.length}, got ${rows}x${cols})`,
    );
  }
  const fgSet = `\x1b[38;5;${imageId}m`;
  const fgReset = "\x1b[39m";
  let placeholders = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      placeholders += KITTY_PLACEHOLDER_CHAR + ROW_COL_DIACRITICS[r]! + ROW_COL_DIACRITICS[c]!;
    }
  }
  return fgSet + placeholders + fgReset;
}

/**
 * Build the escape sequence to delete all visible Kitty graphics.
 * Use this after the picker exits to clean up orphaned images that
 * the text-grid clear doesn't reach (Kitty images live on a separate
 * graphics layer).
 *
 * `a=d, d=A` = delete all visible placements without freeing image data.
 * Wrapped with tmux passthrough when needed.
 */
export function clearKittyImagesSequence(): string {
  const seq = "\x1b_Ga=d,d=A,q=2\x1b\\";
  return isInsideTmux() ? tmuxPassthrough(seq) : seq;
}

/**
 * Build the escape sequence to delete a SINGLE Kitty image by its id, leaving
 * every other placement on screen untouched. Used by the launch loader to tear
 * down only its own logo (id assigned by the caller) without nuking images the
 * picker may have left on the graphics layer.
 *
 * `a=d, d=i, i=<id>` = delete placements for image <id>. tmux-wrapped when needed.
 */
export function clearKittyImageByIdSequence(imageId: number): string {
  const seq = `\x1b_Ga=d,d=i,i=${imageId},q=2\x1b\\`;
  return isInsideTmux() ? tmuxPassthrough(seq) : seq;
}

/**
 * Write the clear-images sequence to stdout. Safe to call unconditionally —
 * non-Kitty terminals ignore unknown APC sequences.
 */
export function clearKittyImages(): void {
  if (process.stdout.isTTY) {
    process.stdout.write(clearKittyImagesSequence());
  }
}

/** Test-only: clear the kitty-ancestor cache. */
export function _resetCache(ancestorOverride?: (() => boolean) | null): void {
  kittyAncestorCache = null;
  probeCache = null;
  _ancestorOverride = ancestorOverride ?? null;
}

let probeCache: boolean | null = null;

/**
 * Runtime probe: send a Kitty graphics-protocol query and wait briefly for
 * a Kitty-format response. Works regardless of env vars or process tree —
 * the only signal that's actually 100% reliable in a tmux+terminal mix.
 *
 * Sends `\x1b_Gi=999,a=q,t=d,f=32,q=1;AAAA\x1b\\` — a query for a
 * non-existent image. Kitty replies with a status line containing "OK" or
 * "ENOENT" inside an APC graphics response. Other terminals silently drop
 * unknown APC sequences.
 *
 * If we're inside tmux, the query is wrapped with the tmux passthrough
 * envelope (requires `set -g allow-passthrough on`).
 *
 * Returns false (no images) on stdin/stdout not being a TTY, or on timeout.
 */
export function probeKittyTerminal(timeoutMs = 100): Promise<boolean> {
  if (probeCache !== null) return Promise.resolve(probeCache);
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return Promise.resolve((probeCache = false));
  }

  return new Promise((resolve) => {
    let buf = "";
    let resolved = false;

    const cleanup = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { process.stdin.setRawMode?.(false); } catch { /* not a tty */ }
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      probeCache = result;
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString("binary");
      // Kitty graphics response lives inside ESC _G ... ESC \ and ends with
      // either ;OK or ;EINVAL/ENOENT/etc. status text. Any one of those
      // confirms Kitty is at the other end.
      if (/\x1b_G[^\x1b]*?;(?:OK|E[A-Z]+)[^\x1b]*?\x1b\\/.test(buf)) {
        cleanup(true);
      }
    };

    const timer = setTimeout(() => cleanup(false), timeoutMs);

    try { process.stdin.setRawMode?.(true); } catch { /* may not be a TTY */ }
    process.stdin.resume();
    process.stdin.on("data", onData);

    // Query for a non-existent image. Kitty answers; others ignore.
    let query = "\x1b_Gi=999,a=q,t=d,f=32,q=1;AAAA\x1b\\";
    if (process.env.TMUX) {
      // Wrap with tmux passthrough envelope (each ESC inside doubled).
      const escaped = query.replace(/\x1b/g, "\x1b\x1b");
      query = `\x1bPtmux;${escaped}\x1b\\`;
    }
    process.stdout.write(query);
  });
}

/**
 * Convenience: call `probeKittyTerminal()` once and combine with env signals.
 * Use this from the launch hot path; `isKittyTerminal()` is the env-only
 * sync version kept around for callers that can't await.
 *
 * Trust strong env signals (KITTY_WINDOW_ID, TERM=xterm-kitty) directly —
 * these are set by Kitty itself and reliable. Only probe when signals are
 * ambiguous (e.g. inside tmux with no Kitty env vars).
 */
export async function detectKittyTerminal(timeoutMs = 100): Promise<boolean> {
  if (process.env.CUE_DISABLE_KITTY_IMAGES === "1") return false;
  if (process.env.CUE_KITTY === "1") return true;

  // Strong signals — trust directly (Kitty sets these for child processes)
  if (process.env.TERM === "xterm-kitty") return true;
  if (process.env.KITTY_WINDOW_ID) return true;
  if (process.env.KITTY_PID) return true;

  // Weak/ambiguous — probe the terminal
  if (process.stdout.isTTY && process.stdin.isTTY) {
    return probeKittyTerminal(timeoutMs);
  }

  // Non-TTY fallback
  if (process.env.TERM_PROGRAM === "kitty") return true;
  return false;
}
