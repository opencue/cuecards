export interface NoticePayload {
  message?: string;
  command?: string;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  notice: NoticePayload | null;
}

/** True when semver `a` is strictly newer than `b` (major.minor.patch only). */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function computeVersionInfo(
  current: string,
  doc: { version?: string; cue?: { notice?: NoticePayload } } | null,
): VersionInfo {
  const latest = doc?.version ?? null;
  const n = doc?.cue?.notice;
  const notice = n && (n.message || n.command) ? { message: n.message, command: n.command } : null;
  return { current, latest, updateAvailable: !!latest && semverGt(latest, current), notice };
}
