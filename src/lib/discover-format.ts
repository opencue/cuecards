export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
} as const;

export const colorize = (color: string, text: string): string => `${color}${text}${ANSI.reset}`;

export function wrapText(text: string, width: number, indent: string): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + 1 + word.length > width && line) {
      lines.push(line);
      line = indent + word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function colorStars(stars: number): string {
  if (stars >= 1000) return colorize(ANSI.magenta + ANSI.bold, `★ ${stars}`);
  if (stars >= 100) return colorize(ANSI.green, `★ ${stars}`);
  if (stars >= 10) return colorize(ANSI.yellow, `★ ${stars}`);
  return colorize(ANSI.gray, `★ ${stars}`);
}

export function freshnessLabel(pushedAt: string): string {
  if (!pushedAt) return "unknown";
  const timestamp = new Date(pushedAt).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days < 0) return "in future";
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}yr ago`;
}

export function freshnessColor(pushedAt: string): string {
  if (!pushedAt) return ANSI.gray;
  const timestamp = new Date(pushedAt).getTime();
  if (!Number.isFinite(timestamp)) return ANSI.gray;
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days < 14) return ANSI.green;
  if (days < 60) return ANSI.yellow;
  if (days < 365) return ANSI.gray;
  return ANSI.red;
}

export function tierName(score: number): "premium" | "strong" | "worth" | "tail" {
  if (score >= 12) return "premium";
  if (score >= 8) return "strong";
  if (score >= 5) return "worth";
  return "tail";
}

export function tierColorFor(score: number): string {
  if (score >= 12) return ANSI.magenta;
  if (score >= 8) return ANSI.cyan;
  if (score >= 5) return ANSI.yellow;
  return ANSI.gray;
}
