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
 *  - U=1 (use Unicode placeholders for layout-friendly placement)
 *
 * The escape sequence is: ESC _G<keys>;<base64 path>ESC\
 */

import { resolve } from "node:path";

/**
 * Detect whether the current terminal supports the Kitty graphics protocol.
 * Returns true for Kitty itself; conservative for everything else.
 */
export function isKittyTerminal(): boolean {
  return process.env.TERM === "xterm-kitty" || !!process.env.KITTY_WINDOW_ID;
}

/**
 * Build a Kitty graphics-protocol escape sequence that renders `imagePath`
 * inline at `cols` columns wide and `rows` rows tall.
 *
 * The path is base64-encoded per the spec when t=f (file mode).
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
  // ESC _G a=T,f=100,t=f,c=<cols>,r=<rows>,i=<id>,q=2 ; <b64-path> ESC \
  // q=2 = suppress responses (we don't read them)
  return `\x1b_Ga=T,f=100,t=f,c=${cols},r=${rows},i=${id},q=2;${b64Path}\x1b\\`;
}
