/**
 * Hooks — the active profile's real Claude Code hooks, grouped by lifecycle
 * event. Ported from studio-hooks.jsx, but every hook is live from
 * /api/v1/hooks (the cue-materialized runtime settings.json + global
 * ~/.claude/settings.json), not mock data.
 *
 * The design's per-hook "runs / ms" don't exist in cue (hook executions aren't
 * counted), so those are dropped; instead each card shows its real matcher,
 * command, description, and a source badge (profile vs global). The enable
 * toggle is a local-only view preference (persisted to localStorage) — cue's
 * settings.json is generated, so flipping a toggle here filters the view rather
 * than rewriting that file.
 */

import { useEffect, useState } from "react";

import { useHooks, type HookEntry } from "../api";
import { HookSourceModal } from "./HookSource";

// Per-event colour + one-line blurb (presentation only).
const EVENTS: Record<string, { color: string; blurb: string }> = {
  PreToolUse: { color: "#8b7bf0", blurb: "before a tool runs" },
  PostToolUse: { color: "#3ecf8e", blurb: "after a tool completes" },
  UserPromptSubmit: { color: "#56b6c2", blurb: "when you send a prompt" },
  SessionStart: { color: "#e0913a", blurb: "when a session begins" },
  SessionEnd: { color: "#d4944a", blurb: "when a session ends" },
  Stop: { color: "#e3596a", blurb: "when the agent stops" },
  SubagentStop: { color: "#e3787a", blurb: "when a subagent stops" },
  PreCompact: { color: "#c264c2", blurb: "before context compaction" },
  Notification: { color: "#5b9cf0", blurb: "on a notification" },
};
const evMeta = (ev: string) => EVENTS[ev] ?? { color: "#878d9a", blurb: "lifecycle event" };

function StatB({ n, l, accent }: { n: React.ReactNode; l: string; accent?: string }) {
  return <div className="statbig"><div className={"sb-n" + (accent ? " " + accent : "")}>{n}</div><div className="sb-l">{l}</div></div>;
}

export function HooksView({ profile }: { profile: string | null }) {
  const { data, isLoading, isError, error } = useHooks(profile ?? undefined);

  // Local-only enable state, keyed by hook id (view filter, not a settings write).
  const [off, setOff] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("cue-hooks-off") || "{}"); } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem("cue-hooks-off", JSON.stringify(off)); } catch { /* ignore */ } }, [off]);
  const toggle = (id: string) => setOff((o) => ({ ...o, [id]: !o[id] }));

  // The hook whose script is open in the source viewer (null = closed).
  const [viewing, setViewing] = useState<HookEntry | null>(null);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const enabled = events.reduce((a, g) => a + g.hooks.filter((h) => !off[h.id]).length, 0);

  return (
    <div className="mcpage">
      <div className="page-head">
        <div>
          <div className="page-title">🪝 Hooks</div>
          <div className="page-sub">Claude Code hooks — shell commands cue runs automatically around tool calls and lifecycle events. Live from your settings.json.</div>
        </div>
        <div className="mcp-summary">
          <StatB n={total} l="hooks" />
          <StatB n={enabled} l="enabled" accent="green" />
          <StatB n={events.length} l="events" accent="violet" />
        </div>
      </div>

      {isLoading && <div className="hk-group"><div className="pm-empty">Loading hooks…</div></div>}
      {isError && <div className="hk-group"><div className="pm-empty">Couldn't load hooks: {(error as Error).message}</div></div>}
      {!isLoading && !isError && events.length === 0 && (
        <div className="hk-group"><div className="pm-empty">No hooks configured for this profile. cue materializes hooks into <code>~/.config/cue/runtime/&lt;profile&gt;/claude/settings.json</code>.</div></div>
      )}

      {events.map((g) => {
        const e = evMeta(g.event);
        return (
          <div className="hk-group" key={g.event}>
            <div className="hk-ghead">
              <span className="hk-evdot" style={{ background: e.color }}></span>
              <span className="hk-evname" style={{ color: e.color }}>{g.event}</span>
              <span className="hk-evblurb">runs {e.blurb}</span>
              <span className="hk-evn">{g.hooks.length}</span>
            </div>
            {g.hooks.map((h: HookEntry) => {
              const isOff = !!off[h.id];
              return (
                <div className={"hk-card" + (isOff ? " off" : "")} key={h.id}>
                  <button className={"hk-toggle" + (isOff ? "" : " on")} onClick={() => toggle(h.id)} title={isOff ? "show as disabled (local view only)" : "active"}><span className="hk-knob"></span></button>
                  <div className="hk-body">
                    <div className="hk-top">
                      <span className="hk-matcher" style={{ borderColor: e.color + "55", color: e.color }}>{h.matcher}</span>
                      <span className="hk-desc">{h.description || h.id}</span>
                    </div>
                    {h.scriptPath ? (
                      <button className="hk-cmd hk-cmd-btn" onClick={() => setViewing(h)} title="view script source">
                        <span className="hk-cmd-prompt">$</span>{h.command}
                        <span className="hk-view">view ↗</span>
                      </button>
                    ) : (
                      <div className="hk-cmd"><span className="hk-cmd-prompt">$</span>{h.command}</div>
                    )}
                  </div>
                  <div className="hk-meta">
                    <span className={"hk-src" + (h.source === "global" ? " global" : "")}>{h.source}</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {viewing && <HookSourceModal hook={viewing} profile={profile} onClose={() => setViewing(null)} />}
    </div>
  );
}
