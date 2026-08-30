/**
 * Profile inspector ("inspect · profiles") — pick a profile from the rail and
 * inspect its full composition read-only: skills (grouped by namespace), MCPs,
 * plugins, workflows, and commands, plus a stat row (skills/mcps/plugins/
 * workflows/commands/overhead/max-ctx). Ported from studio-profiles.jsx.
 *
 * The rail is live from /profiles/full; the selected profile's contents are
 * live from /profile-detail. Overhead + max-ctx are derived (cue has no stored
 * number): max-ctx = Σ skill body sizes, overhead ≈ a per-skill estimate.
 * Clicking any skill/mcp/plugin switches the explorer to that profile and opens
 * it there.
 */

import { useEffect, useMemo, useState } from "react";

import { useProfilesFull, useProfileDetail, useRepos, type ProfileDetail, type StudioSkill, type SubagentRef, type RepoKind } from "../api";
import { nsColor, nsLabel, mcpInfo, partEmoji, WORKFLOWS } from "../curated";
import type { OpenTarget } from "../StudioApp";

/** Per-kind tag colour for repo cards (matches the design). */
const KIND_COLOR: Record<RepoKind, string> = {
  profile: "#8b7bf0", workflow: "#e0913a", skill: "#3ecf8e", cli: "#56b6c2", mcp: "#5b9cf0", plugin: "#c264c2",
};
/** "18400" → "18.4k"; counts under 1000 stay literal; null → "—". */
function fmtStars(n: number | null): string {
  if (n === null) return "—";
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function MiniStat({ n, l, accent }: { n: React.ReactNode; l: string; accent?: string }) {
  return <div className="pi-stat"><div className={"pi-n" + (accent ? " " + accent : "")}>{n}</div><div className="pi-l">{l}</div></div>;
}

interface SkillGroup { ns: string; color: string; label: string; items: StudioSkill[] }
function groupSkills(skills: StudioSkill[]): SkillGroup[] {
  const order: string[] = [];
  const map = new Map<string, StudioSkill[]>();
  for (const s of skills) {
    if (!map.has(s.ns)) { map.set(s.ns, []); order.push(s.ns); }
    map.get(s.ns)!.push(s);
  }
  return order.map((ns) => ({ ns, color: nsColor(ns), label: nsLabel(ns), items: map.get(ns)! }));
}

/** Group subagents by their division (first path segment), preserving order. */
function groupSubagents(subs: SubagentRef[]): { division: string; items: SubagentRef[] }[] {
  const order: string[] = [];
  const map = new Map<string, SubagentRef[]>();
  for (const s of subs) {
    if (!map.has(s.division)) { map.set(s.division, []); order.push(s.division); }
    map.get(s.division)!.push(s);
  }
  return order.map((division) => ({ division, items: map.get(division)! }));
}

/** Derived composition stats for a loaded profile detail. */
function inspect(d: ProfileDetail) {
  const groups = groupSkills(d.skills);
  const skillNames = new Set(d.skills.map((s) => s.name));
  const wfs = WORKFLOWS.map((w) => {
    const have = w.steps.filter((st) => st.kind === "command" || skillNames.has(st.name)).length;
    return { ...w, have, total: w.steps.length, ready: have === w.steps.length };
  });
  const overhead = +(6.3 + d.skills.length * 0.06).toFixed(1);
  const maxCtx = Math.round(d.skills.reduce((a, s) => a + s.sizeK, 0));
  return { groups, wfs, overhead, maxCtx };
}

type Tab = "skills" | "mcps" | "plugins" | "subagents" | "workflows" | "commands" | "clis" | "repos";

export function ProfilesView({ active, setProfile, onOpen }: {
  active: string | null;
  setProfile: (p: string) => void;
  onOpen: (kind: OpenTarget["kind"], key: string, highlightCli?: string) => void;
}) {
  const profiles = useProfilesFull();
  const rows = profiles.data ?? [];
  const [sel, setSel] = useState<string | null>(active);
  const [tab, setTab] = useState<Tab>("skills");

  // Default selection: the active profile if present, else the first profile.
  useEffect(() => {
    if (!sel && rows.length) setSel(active && rows.some((r) => r.name === active) ? active : rows[0]!.name);
  }, [rows, active, sel]);

  const detail = useProfileDetail(sel ?? undefined);
  const d = detail.data;
  const ins = useMemo(() => (d ? inspect(d) : null), [d]);
  const selRow = rows.find((r) => r.name === sel);
  const reposQ = useRepos(sel ?? undefined);
  const repos = reposQ.data?.repos ?? [];

  const openItem = (kind: OpenTarget["kind"], key: string, highlightCli?: string) => {
    if (sel) setProfile(sel);
    onOpen(kind, key, highlightCli);
  };

  const readyCount = ins ? ins.wfs.filter((w) => w.ready).length : 0;
  const tabs: [Tab, string, number][] = [
    ["skills", "Skills", d?.counts.skills ?? 0],
    ["mcps", "MCPs", d?.counts.mcps ?? 0],
    ["plugins", "Plugins", d?.counts.plugins ?? 0],
    ["subagents", "Subagents", d?.counts.subagents ?? 0],
    ["workflows", "Workflows", readyCount],
    ["commands", "Commands", d?.counts.commands ?? 0],
    ["clis", "CLIs", d?.counts.clis ?? 0],
    ["repos", "Repos", repos.length],
  ];

  return (
    <div className="profpage">
      {/* profile rail */}
      <aside className="prof-rail">
        <div className="pr-head">PROFILES <span className="pr-count">{rows.length}</span></div>
        {rows.map((p) => {
          const on = p.name === sel;
          return (
            <div key={p.name} className={"pr-item" + (on ? " on" : "")} onClick={() => setSel(p.name)}>
              {p.iconImage
                ? <img className="pr-img" src={`/api/v1/profile-icon?profile=${encodeURIComponent(p.name)}`} alt="" width={22} height={22}
                    onError={(e) => { e.currentTarget.style.display = "none"; const sib = e.currentTarget.nextElementSibling as HTMLElement | null; if (sib) sib.style.display = ""; }} />
                : null}
              <span className="pr-branch" style={p.iconImage ? { display: "none" } : undefined}>⎇</span>
              <div className="pr-mid">
                <div className="pr-name">{p.name}</div>
                <div className="pr-meta">{p.skills + p.npx} skills · {p.mcps} mcps{p.subagents ? ` · ${p.subagents} agents` : ""}</div>
              </div>
              {on && <span className="pr-live"></span>}
            </div>
          );
        })}
        {!rows.length && <div className="pr-meta" style={{ padding: 8 }}>loading profiles…</div>}
        <div className="pr-hint">Inspect a profile's full composition — read-only.</div>
      </aside>

      {/* detail */}
      <section className="prof-detail">
        {!d || !ins ? (
          <div className="pd-head"><div className="pd-titlerow"><span className="pd-branch">⎇</span><span className="pd-name">{detail.isError ? "couldn't load profile" : "loading…"}</span></div>
            {detail.isError && <div className="pd-desc">{(detail.error as Error).message}</div>}</div>
        ) : (
          <>
            <div className="pd-head">
              <div className="pd-titlerow">
                {selRow?.iconImage
                  ? <img className="pd-img" src={`/api/v1/profile-icon?profile=${encodeURIComponent(sel ?? "")}`} alt="" width={28} height={28}
                      onError={(e) => { e.currentTarget.style.display = "none"; const sib = e.currentTarget.nextElementSibling as HTMLElement | null; if (sib) sib.style.display = ""; }} />
                  : null}
                <span className="pd-branch" style={selRow?.iconImage ? { display: "none" } : undefined}>⎇</span>
                <span className="pd-name">{d.parts.join(" + ")}</span>
                {sel === "global-default" && <span className="pd-tag">default</span>}
              </div>
              <div className="pd-desc">{selRow?.description ?? ""}</div>
              <div className="pd-parts">
                {d.parts.map((p) => <span key={p} className="pd-chip"><span className="pdc-e">{partEmoji(p)}</span>{p}</span>)}
              </div>
              {d.recommends.length > 0 && (
                <div className="pd-recommends">
                  <span className="pd-rec-label">Pair with</span>
                  {d.recommends.map((r) => (
                    <button key={r} className="pd-rec-chip" onClick={() => setSel(r)} title={`Switch to ${r} profile`}>
                      <span className="pdc-e">{partEmoji(r)}</span>{r}
                    </button>
                  ))}
                </div>
              )}
              <div className="pd-stats">
                <MiniStat n={d.counts.skills} l="SKILLS" accent="violet" />
                <MiniStat n={d.counts.mcps} l="MCPS" />
                <MiniStat n={d.counts.plugins} l="PLUGINS" />
                <MiniStat n={readyCount} l="WORKFLOWS" />
                <MiniStat n={d.counts.commands} l="COMMANDS" />
                <MiniStat n={"~" + ins.overhead.toFixed(1) + "K"} l="OVERHEAD" accent="warn" />
                <MiniStat n={"~" + ins.maxCtx + "K"} l="MAX CTX" />
              </div>
            </div>

            <div className="pd-tabs">
              {tabs.map(([k, l, n]) => (
                <button key={k} className={"pd-tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}<span className="pdt-n">{n}</span></button>
              ))}
            </div>

            <div className="pd-body">
              {tab === "skills" && (
                <div className="pd-skills">
                  {ins.groups.map((g) => (
                    <div key={g.ns} className="pds-group">
                      <div className="pds-ghead"><span className="pds-dot" style={{ background: g.color }}></span>{g.label}<span className="pds-gn">{g.items.length}</span></div>
                      <div className="pds-grid">
                        {g.items.map((s) => (
                          <div key={s.id} className="pds-skill" onClick={() => openItem("skill", s.id)}>
                            <span className="pds-sdot" style={{ background: g.color }}></span>
                            <span className="pds-sname">{s.name}</span>
                            <span className="pds-ssize">{s.sizeK}K</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {tab === "mcps" && (
                <div className="pd-list">
                  {d.mcps.map((m) => {
                    const info = mcpInfo(m.id);
                    return (
                      <div key={m.id} className="pd-row" onClick={() => openItem("mcp", "mcp/" + m.id)}>
                        <span className="pd-emoji">{info.emoji}</span>
                        <div className="pd-rmid"><div className="pd-rname">{m.id}<span className="pd-ok">● {m.status}</span></div><div className="pd-rdesc">{info.desc}</div></div>
                        <div className="pd-rtools">{info.tools.map((t) => <span key={t} className="pd-tool">{t}</span>)}</div>
                      </div>
                    );
                  })}
                  {!d.mcps.length && <div className="pr-hint" style={{ padding: 4 }}>No MCP servers in this profile.</div>}
                </div>
              )}
              {tab === "plugins" && (
                <div className="pd-list">
                  {d.plugins.map((p) => (
                    <div key={p.id} className="pd-row" onClick={() => openItem("plugin", "plugin/" + p.name)}>
                      <span className="pd-emoji">🧩</span>
                      <div className="pd-rmid"><div className="pd-rname">{p.name}<span className="pd-ok">● {p.status}</span></div><div className="pd-rdesc">{p.marketplace ? "from " + p.marketplace : "plugin"}</div></div>
                      <span className="pd-rbadge">{p.marketplace || "—"}</span>
                    </div>
                  ))}
                  {!d.plugins.length && <div className="pr-hint" style={{ padding: 4 }}>No plugins in this profile.</div>}
                </div>
              )}
              {tab === "subagents" && (
                <div className="pd-skills">
                  {groupSubagents(d.subagents).map((g) => (
                    <div key={g.division} className="pds-group">
                      <div className="pds-ghead"><span className="pds-dot" style={{ background: nsColor(g.division) }}></span>{g.division}<span className="pds-gn">{g.items.length}</span></div>
                      <div className="pds-grid">
                        {g.items.map((s) => (
                          <div key={s.id} className="pds-skill">
                            <span className="pds-sdot" style={{ background: nsColor(g.division) }}></span>
                            <span className="pds-sname">{s.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!d.subagents.length && <div className="pr-hint" style={{ padding: 4 }}>No subagents in this profile.</div>}
                </div>
              )}
              {tab === "workflows" && (
                <div className="pd-wfs">
                  {ins.wfs.map((w) => (
                    <div key={w.id} className={"pd-wf" + (w.ready ? "" : " partial")}>
                      <span className="pd-wemoji">{w.emoji}</span>
                      <div className="pd-wmid">
                        <div className="pd-wname">{w.name}<span className="pd-wtrig">{w.trigger}</span></div>
                        <div className="pd-wsteps">{w.steps.map((s, i) => {
                          const present = s.kind === "command" || d.skills.some((x) => x.name === s.name);
                          return (
                            <span key={i} style={{ display: "contents" }}>
                              <span className={"pd-wstep" + (present ? "" : " miss")}>{s.name}</span>
                              {i < w.steps.length - 1 && <span className="pd-warr">→</span>}
                            </span>
                          );
                        })}</div>
                      </div>
                      <span className={"pd-wstat" + (w.ready ? " ok" : "")}>{w.ready ? "✓ ready" : w.have + "/" + w.total}</span>
                    </div>
                  ))}
                </div>
              )}
              {tab === "commands" && (
                <div className="pd-cmds">{d.commands.map((c) => <span key={c.ref} className="pd-cmd" onClick={() => openItem("command", "cmd/" + c.ref)} title={c.desc || `open ${c.name}`}>{c.name}</span>)}</div>
              )}
              {tab === "clis" && (
                <div className="pd-list">
                  {d.clis.map((c) => (
                    <div key={c.name} className="pd-row" onClick={() => c.usedBy[0] && openItem("skill", c.usedBy[0], c.name)} title={c.usedBy[0] ? `open ${c.usedBy[0]} and jump to where ${c.name} is used` : undefined}>
                      <span className="pd-emoji">⌘</span>
                      <div className="pd-rmid">
                        <div className="pd-rname">{c.name}{c.known && <span className="pd-ok">● recipe</span>}</div>
                        <div className="pd-rdesc">{c.install || "no install recipe on file"}</div>
                      </div>
                      <span className="pd-rbadge">{c.usedBy.length} skill{c.usedBy.length === 1 ? "" : "s"}</span>
                    </div>
                  ))}
                  {!d.clis.length && <div className="pr-hint" style={{ padding: 4 }}>No skills in this profile declare a CLI dependency (frontmatter <code>allowed-tools: Bash(…)</code>).</div>}
                </div>
              )}
              {tab === "repos" && (
                <div className="pd-repos">
                  <div className="pd-repos-note">GitHub repositories these skills, MCPs, plugins and workflows originate from. Stars are live and refresh hourly.</div>
                  {repos.map((r) => (
                    <a key={r.repo} className="repo-row" href={r.url} target="_blank" rel="noopener noreferrer">
                      <span className="repo-gh"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg></span>
                      <div className="repo-mid">
                        <div className="repo-name">{r.repo}<span className="repo-ext">↗</span></div>
                        <div className="repo-desc">{r.desc}</div>
                        <div className="repo-kinds">{r.kinds.map((k) => <span key={k} className="repo-kind" style={{ color: KIND_COLOR[k], borderColor: KIND_COLOR[k] + "44" }}>{k}</span>)}</div>
                      </div>
                      <span className="repo-stars" title={r.stars === null ? "star count unavailable (GitHub unreachable)" : `${r.stars.toLocaleString()} stars`}><span className="repo-star-ic">★</span>{fmtStars(r.stars)}</span>
                    </a>
                  ))}
                  {reposQ.isLoading && <div className="pm-empty">Loading source repos…</div>}
                  {reposQ.isError && <div className="pm-empty">Couldn't load repos: {(reposQ.error as Error).message}</div>}
                  {!reposQ.isLoading && !reposQ.isError && repos.length === 0 && <div className="pm-empty">No source repos detected for this profile.</div>}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
