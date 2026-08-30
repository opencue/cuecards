/**
 * Embedded Claude-style sparkle logo for the launch loader.
 *
 * A small 64x64 PNG (a 4-point coral sparkle in Claude's clay/coral, #D97757)
 * is base64-embedded here so it travels inside the bundled JS — no `assets/`
 * path that would break when cue runs from `dist/` or an npm install.
 *
 * The Kitty graphics path needs a file path (`renderKittyImage` uses t=f), so
 * {@link ensureClaudeLogoPath} materializes the bytes to cacheDir once and
 * returns the path. Fully best-effort: any failure returns null and the loader
 * falls back to its universal ANSI animation.
 *
 * This mark is generated and owned by this repo (not Anthropic's trademarked
 * logo), so it ships cleanly under the repo's license.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cacheDir } from "./config-paths";

export const CLAUDE_LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABmJLR0QA/wD/AP+gvaeTAAAFP0lEQVR4nO2bW2xURRjH/9+cU24RudjWNDGEXncDiQ9igg8auZTokykma2kbfFCoPhliK12Il9VEoUACPiEo+gSIq4JEIEKxmPgCgT6YmLDddhuNEQsVKRpYSs/8fehuqaV0b+ecMaG/p9md2e/859s5M9/cgCmmMEZ8U6gk1tJQbFKDbfLhw9qqti2tAQyY0qBMPRgAFHW1I6wyqcFoC4BSARCOSQlGHUByiRDDJjUYcwAB6YYsgVCb0gAY7ANiraGFAB8CUNLbFlpgSocxB4itVqbTjlgrTOkwNwpQVqWTmlw1WVEvMeKAzsgyG2Bt+rOAtQyFLBNajDigLFlWC2D+nW+kNFZpP21CixEHCHXDXULIJiNa/H5gPNL0oL45/BuA2eOyBodn6kcWR6L/+KnH9xagk7fX4+7KA8Ac66Z62W89vjrgfHNzESmv3StfgA0jHaR/+OqA2XMHXxFgsqBnYVmydJ1vguBjH/BTuHHedDrdADLN/68OD+nqxTujV/3Q5VsLmE7djsyVB4D5VpH1vtd60vjSAmLhNatBfp3LbwjUBdsPfeOVpjSeO6AnHKpyqM7iP4FPVgyIWEtrth5IeKErjaevQKylodihOobcKw8AxaRzMrG54WG3dY3FMwf0tK4tpa2/A1BTgJnKIUcf72ldW+qWrvF48gp0hxsrSOcECqv8WBKOtp5dtP1A3CV7o7jeAmIbX6gj9Tm4V3kAqLCUcy4WXlPvok0ALraAkXFetwNc75bNiSCwZ0isTY9uPfCXG/YKdsD55uai2fOuNwN4N7XE5QcDBN6+NLP/4+WRMwUtqubtgJ8joQdSk5fXM4S3HsJLELV3WjK5q3zXkWv5WMjJAZ2RZXZZsqw2NZ9fjYlndSa4DpHDmvpgMMEOiUaz3mvI6IDucGMF4axIreGt9LGZ54n8CeA0iZPQzvfBHdG+SUunE/FNoRIAVdqRGigVEPIxQh7//1c4IwMCXKBIF7SOKYvdAHqqt0SvAOOHQUeRAoegJuEA2ui2lUs4ZKpOAgeO4tjMjK9Ab1togSPWCk2uErAWEM+iMpfoF0EHNU/Zws7K9uivkxXOqRNkJKK6b1xcTmGTAM8DmFOQVPcYFMhXWmR/YEbgjEQiWW+3FTQMFiWtRpItcDfqy4U+iuwpovNRZXt0MB8DBQdCI0Nj6TqhvAegpFB72cHLIuqt6l5nXy5D3kS4Fgr3baibe2vajC0ifNUtmxNACHbb1Jvz/cfH4/ps8OLGNc+JcB+yW/7KhSui8VLN9kPfumnUk+nwxdZQuVjqBICASyYTluhnqrZGe1yyN4onCyLBHdE+pfRTBLoKtSWQC0rpJ7yo/Ih9D4m1NBTD1j8i/5bQU2SpJys+ONjvpq6xeL4oGn+jvlIrOZtHSH2Fjl6aKZYvFM/3Baq3H+qF0i8CYMbCdyAp67yuPODTxkhgyxfHCezN+geC3cFtnx/1UNIo/u0M3boVRlYnQnnZpt7suaAUvjmgfNeRayDeyaLom24FOdng6+7w77P690LwyyRF+moS/NQ3QfDZASMLmPLhvfIF2FlobJ8rvp8Qob7xCYDrE2QN3p6pP/Nbj+8OCG47+jdEDk+Q9aXf54MAQ6fENPXB8d+R3G9CixEHBBPsSK3epukPzFr0gwktZs4JjnR0p0c/CzpyWcZyE3NnhYWn0knqO2m/MeYADuvRFmALO03pMEqsrf5yrK3+D5MajF6ZEaCL4P15ZQYAKNJFyv17aQpaxyD38a0xLSpu0+ylKaMOsJUT10N2LitFU0zhMv8CsbPfDInfwcoAAAAASUVORK5CYII=";

/**
 * Write the embedded logo to `<cacheDir>/claude-logo.png` (once) and return
 * its absolute path. Returns null on any I/O error — callers must treat a null
 * path as "no Kitty image, ANSI only".
 */
export function ensureClaudeLogoPath(): string | null {
  try {
    const dir = cacheDir();
    const logoPath = join(dir, "claude-logo.png");
    if (!existsSync(logoPath)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(logoPath, Buffer.from(CLAUDE_LOGO_PNG_BASE64, "base64"));
    }
    return logoPath;
  } catch {
    return null;
  }
}
