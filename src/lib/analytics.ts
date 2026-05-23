/**
 * Analytics — append-only JSONL log of profile usage.
 * Storage: ~/.config/cue/analytics.jsonl
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const ANALYTICS_PATH = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "cue",
  "analytics.jsonl",
);

export interface SessionEvent {
  ts: string;
  event: "start" | "end" | "skill_hit";
  profile: string;
  agent: "claude-code" | "codex";
  cwd: string;
  duration_s?: number;
  skill?: string;
}

export function recordEvent(event: SessionEvent): void {
  mkdirSync(dirname(ANALYTICS_PATH), { recursive: true });
  appendFileSync(ANALYTICS_PATH, JSON.stringify(event) + "\n");
}

/**
 * Record skill usage from session transcripts.
 * Scans the most recent session for skill references and logs them.
 */
export function recordSkillUsage(profile: string, agent: "claude-code" | "codex"): void {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return;

  try {
    const { readdirSync, statSync, openSync, readSync, closeSync } = require("node:fs");
    const dirs = readdirSync(projectsDir).filter((d: string) => {
      try { return statSync(join(projectsDir, d)).isDirectory(); } catch { return false; }
    });

    // Find most recent session (only check last 5 dirs)
    let latestFile = "";
    let latestMtime = 0;
    for (const dir of dirs.slice(-5)) {
      const files = readdirSync(join(projectsDir, dir)).filter((f: string) => f.endsWith(".jsonl"));
      for (const f of files.slice(-3)) {
        const p = join(projectsDir, dir, f);
        const mt = statSync(p).mtimeMs;
        if (mt > latestMtime) { latestMtime = mt; latestFile = p; }
      }
    }

    if (!latestFile || Date.now() - latestMtime > 300_000) return; // only last 5 min

    // Read only first 50KB
    const fd = openSync(latestFile, "r");
    const buf = Buffer.alloc(50_000);
    const bytesRead = readSync(fd, buf, 0, 50_000, 0);
    closeSync(fd);
    const content = buf.toString("utf8", 0, bytesRead);
    const skillRefs = content.match(/skills\/([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)\/SKILL\.md/g);
    if (!skillRefs) return;

    const seen = new Set<string>();
    const ts = new Date().toISOString();
    for (const ref of skillRefs) {
      const skill = ref.replace("skills/", "").replace("/SKILL.md", "");
      if (seen.has(skill)) continue;
      seen.add(skill);
      recordEvent({ ts, event: "skill_hit", profile, agent, cwd: process.cwd(), skill });
    }
  } catch { /* non-fatal */ }
}

export function readEvents(since?: Date): SessionEvent[] {
  if (!existsSync(ANALYTICS_PATH)) return [];
  const lines = readFileSync(ANALYTICS_PATH, "utf8").split("\n").filter(Boolean);
  const events: SessionEvent[] = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as SessionEvent;
      if (since && new Date(e.ts) < since) continue;
      events.push(e);
    } catch { /* skip malformed */ }
  }
  return events;
}

export interface ProfileStats {
  profile: string;
  sessions: number;
  total_duration_s: number;
  avg_duration_s: number;
  last_used: string | null;
}

export function computeStats(since?: Date): ProfileStats[] {
  const events = readEvents(since);
  const map = new Map<string, { sessions: number; total_s: number; last: string }>();

  for (const e of events) {
    if (e.event !== "start") continue;
    const entry = map.get(e.profile) ?? { sessions: 0, total_s: 0, last: "" };
    entry.sessions++;
    if (e.ts > entry.last) entry.last = e.ts;
    map.set(e.profile, entry);
  }

  for (const e of events) {
    if (e.event !== "end" || !e.duration_s) continue;
    const entry = map.get(e.profile);
    if (entry) entry.total_s += e.duration_s;
  }

  return [...map.entries()]
    .map(([profile, d]) => ({
      profile,
      sessions: d.sessions,
      total_duration_s: d.total_s,
      avg_duration_s: d.sessions > 0 ? Math.round(d.total_s / d.sessions) : 0,
      last_used: d.last || null,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

export interface SkillUsageStats {
  skill: string;
  hits: number;
  lastUsed: string | null;
}

export function skillStats(profile?: string, since?: Date): SkillUsageStats[] {
  const events = readEvents(since).filter(e => e.event === "skill_hit" && e.skill);
  const filtered = profile ? events.filter(e => e.profile === profile) : events;

  const map = new Map<string, { hits: number; last: string }>();
  for (const e of filtered) {
    const entry = map.get(e.skill!) ?? { hits: 0, last: "" };
    entry.hits++;
    if (e.ts > entry.last) entry.last = e.ts;
    map.set(e.skill!, entry);
  }

  return [...map.entries()]
    .map(([skill, d]) => ({ skill, hits: d.hits, lastUsed: d.last || null }))
    .sort((a, b) => b.hits - a.hits);
}
