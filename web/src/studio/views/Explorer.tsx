/**
 * Profile explorer — the VS Code-style centerpiece. Sidebar tree (skills by
 * namespace · mcps · plugins · commands) → tabbed editor (SKILL.md with line
 * numbers, markdown highlighting, minimap, Preview/Edit toggle) → details
 * panel. Ported from studio-explorer.jsx; all data is live from /profile-detail.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useProfileDetail, useProfilesFull, useSkillReport, useTimeline } from "../api";
import { nsColor, mcpInfo, mcpBody, bodyStats, fmtAge } from "../curated";
import { groupSkills } from "../skills";
import { MdEditor, EditArea, Minimap, outlineOf } from "../md";
import { Sparkline } from "../components/Sparkline";
import { findCliLine } from "./explorer-utils";
import type { OpenTarget } from "../StudioApp";

type TabKind = "skill" | "mcp" | "plugin" | "command";
interface Tab { kind: TabKind; key: string }

function settingsDefaults(): { mode: "preview" | "edit"; minimap: boolean } {
  try {
    const s = JSON.parse(localStorage.getItem("cue-studio-settings") || "{}");
    return { mode: s.defaultView === "edit" ? "edit" : "preview", minimap: s.minimap !== false };
  } catch { return { mode: "preview", minimap: true }; }
}

function pluginBody(p: { name: string; marketplace: string; status: string }): string {
  return `---
plugin: ${p.name}
marketplace: ${p.marketplace || "—"}
status: ${p.status}
---

# ${p.name}

Installed plugin contributing skills + workflows to this profile under the \`plugin/\` namespace.

## Install

\`\`\`
cue plugin add ${p.name}${p.marketplace ? "@" + p.marketplace : ""}
\`\`\`

> Status: ${p.status}${p.marketplace ? " · from " + p.marketplace : ""}.`;
}

function TreeRow({ depth, color, glyph, label, count, active, onClick, caret, status, muted }: {
  depth: number; color?: string; glyph?: string; label: ReactNode; count?: number;
  active?: boolean; onClick?: () => void; caret?: boolean; status?: string; muted?: boolean;
}) {
  return (
    <div className={"tree-row" + (active ? " active" : "")} style={{ paddingLeft: 8 + depth * 14 }} onClick={onClick}>
      {caret !== undefined ? <span className="tw-caret">{caret ? "▾" : "▸"}</span> : <span className="tw-caret"></span>}
      {color !== undefined && <span className="tw-dot" style={{ background: color }}></span>}
      {glyph && <span className="tw-glyph">{glyph}</span>}
      <span className={"tw-label" + (muted ? " muted" : "")}>{label}</span>
      {status && <span className={"tw-status " + status}></span>}
      {count !== undefined && <span className="tw-count">{count}</span>}
    </div>
  );
}


/** Tiny smooth area sparkline for the USAGE block. */
function Spark({ data }: { data: number[] }) {
  return <Sparkline data={data} slice={20} width={120} height={38} color="var(--amber)" gradientId="duSpark" />;
}

/** Doc-stats grid shared by the skill and command DOCUMENT panels. */
function DocStatGrid({ stats }: { stats: ReturnType<typeof bodyStats> }) {
  return (
    <div className="doc-grid">
      <div className="doc-tile"><div className="dt-n">{stats.lines.toLocaleString()}</div><div className="dt-l">lines</div></div>
      <div className="doc-tile"><div className="dt-n">{stats.words.toLocaleString()}</div><div className="dt-l">words</div></div>
      <div className="doc-tile"><div className="dt-n">{stats.headings}</div><div className="dt-l">sections</div></div>
      <div className="doc-tile"><div className="dt-n">{stats.codeBlocks}</div><div className="dt-l">code blocks</div></div>
      <div className="doc-tile"><div className="dt-n">{stats.listItems}</div><div className="dt-l">list items</div></div>
      <div className="doc-tile"><div className="dt-n">~{stats.readMin}m</div><div className="dt-l">read time</div></div>
    </div>
  );
}

export function Explorer({ profile, setProfile, pendingOpen }: {
  profile: string | null;
  setProfile: (p: string) => void;
  pendingOpen: OpenTarget | null;
}) {
  const { data, isLoading, isError, error } = useProfileDetail(profile ?? undefined);
  const profiles = useProfilesFull();
  const report = useSkillReport(profile ?? undefined);
  const timeline = useTimeline(30);

  const [profOpen, setProfOpen] = useState(false);
  const [q, setQ] = useState("");
  const [exp, setExp] = useState<Record<string, boolean>>({ SKILLS: true, MCPS: true, PLUGINS: true, COMMANDS: false, ns_meta: true });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">(() => settingsDefaults().mode);
  const [showMinimap] = useState(() => settingsDefaults().minimap);
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("cue-studio-edits") || "{}"); } catch { return {}; }
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const hlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hlLine, setHlLine] = useState<number | null>(null);

  useEffect(() => { try { localStorage.setItem("cue-studio-edits", JSON.stringify(edits)); } catch { /* ignore */ } }, [edits]);

  // Resolve tab → data + body from the loaded detail.
  const skillByKey = (key: string) => data?.skills.find((s) => s.id === key);
  const mcpByKey = (key: string) => data?.mcps.find((m) => "mcp/" + m.id === key);
  const pluginByKey = (key: string) => data?.plugins.find((p) => "plugin/" + p.name === key);
  const commandByKey = (key: string) => data?.commands.find((c) => "cmd/" + c.ref === key);

  const openTab = (kind: TabKind, key: string) => {
    setTabs((t) => (t.find((x) => x.key === key) ? t : [...t, { kind, key }]));
    setActive(key);
  };
  const closeTab = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((t) => {
      const n = t.filter((x) => x.key !== key);
      if (active === key && n.length) setActive(n[n.length - 1]!.key);
      else if (!n.length) setActive(null);
      return n;
    });
  };

  // Seed the first skill tab when a profile's detail first loads / changes.
  useEffect(() => {
    if (!data) return;
    setTabs([]);
    setActive(null);
    const first = data.skills[0];
    if (first) { setTabs([{ kind: "skill", key: first.id }]); setActive(first.id); }
  }, [data?.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // jumpLine and flashLine are declared here (before the pendingOpen effect)
  // so the effect can call flashLine directly instead of duplicating the logic.
  const jumpLine = (i: number) => { const el = scrollRef.current; if (!el) return; const rows = el.querySelectorAll(".ed-row"); const row = rows[i] as HTMLElement | undefined; if (row) el.scrollTop = row.offsetTop - 12; };
  // Scroll to a line and flash it for ~2.6s. Forces Preview (the highlight rows
  // only exist there); defers a tick when leaving Edit so they paint first.
  const flashLine = (i: number) => {
    if (i < 0) return;
    const wasEdit = mode === "edit";
    if (wasEdit) setMode("preview");
    setTimeout(() => {
      jumpLine(i);
      setHlLine(i);
      if (hlTimer.current) clearTimeout(hlTimer.current);
      hlTimer.current = setTimeout(() => setHlLine(null), 2600);
    }, wasEdit ? 90 : 0);
  };

  // Open a target requested from search / details cross-links. When it carries
  // a CLI (a click in the profile's CLIs tab), jump to + flash the line in the
  // freshly-opened skill where that CLI is used. The body is looked up straight
  // from `data` (not the derived `body`, which isn't in scope before the hook
  // ordering guard) and the scroll is deferred so the new tab paints first.
  useEffect(() => {
    if (!pendingOpen) return;
    openTab(pendingOpen.kind, pendingOpen.key);
    const cli = pendingOpen.highlightCli;
    if (!cli || pendingOpen.kind !== "skill") return;
    const sk = data?.skills.find((s) => s.id === pendingOpen.key);
    const b = sk ? (edits[sk.id] ?? sk.body) : "";
    const i = findCliLine(b, cli);
    if (i < 0) return;
    flashLine(i);
  }, [pendingOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset scroll + clear any stale CLI highlight when the active tab changes.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; setHlLine(null); }, [active]);

  if (isError) {
    return <div className="edit-blank" style={{ padding: 40 }}><div className="eb-logo">cue<span>studio</span></div><p>Couldn't load this profile: {(error as Error).message}</p></div>;
  }
  if (isLoading || !data) {
    return <div className="edit-blank"><div className="eb-logo">cue<span>studio</span></div><p>Loading profile…</p></div>;
  }

  const groups = groupSkills(data.skills);
  const ql = q.trim().toLowerCase();
  const match = (name: string) => !ql || name.toLowerCase().includes(ql);

  const cur = tabs.find((t) => t.key === active) ?? null;
  const curSkill = cur?.kind === "skill" ? skillByKey(cur.key) : undefined;
  const curMcp = cur?.kind === "mcp" ? mcpByKey(cur.key) : undefined;
  const curPlugin = cur?.kind === "plugin" ? pluginByKey(cur.key) : undefined;
  const curCommand = cur?.kind === "command" ? commandByKey(cur.key) : undefined;
  const curName = curSkill?.name ?? curMcp?.id ?? curPlugin?.name ?? curCommand?.name ?? "";

  const origBody = curSkill ? curSkill.body : curMcp ? mcpBody(curMcp.id, curMcp.status) : curPlugin ? pluginBody(curPlugin) : curCommand ? curCommand.body : "";
  const body = cur && edits[cur.key] !== undefined ? edits[cur.key]! : origBody;
  const edited = !!cur && edits[cur.key] !== undefined && edits[cur.key] !== origBody;
  const setBody = (key: string, val: string) => setEdits((e) => ({ ...e, [key]: val }));
  const revert = () => { if (!cur) return; setEdits((e) => { const n = { ...e }; delete n[cur.key]; return n; }); };
  // Plain call, not useMemo — this runs after the loading/error early returns,
  // so a hook here would change the hook count between renders (React #310).
  const outline = outlineOf(body);

  const jumpTo = (frac: number) => { const el = scrollRef.current; if (el) el.scrollTop = frac * (el.scrollHeight - el.clientHeight); };
  const onCliClick = (cli: string) => flashLine(findCliLine(body, cli));
  const skillClis = curSkill ? data.clis.filter((c) => c.usedBy.includes(curSkill.id)) : [];

  const tabColor = (t: Tab) => t.kind === "skill" ? nsColor(skillByKey(t.key)?.ns ?? "") : t.kind === "mcp" ? "#3ecf8e" : t.kind === "command" ? "#56b6c2" : "#c264c2";
  const tabLabel = (t: Tab) => t.kind === "skill" ? (skillByKey(t.key)?.name ?? t.key) : t.kind === "mcp" ? (mcpByKey(t.key)?.id ?? t.key) : t.kind === "command" ? (commandByKey(t.key)?.name ?? t.key) : (pluginByKey(t.key)?.name ?? t.key);

  const curProfileRow = profiles.data?.find((p) => p.name === data.profile);

  return (
    <div className="explorer">
      {/* ── sidebar tree ── */}
      <aside className="side">
        <div className="side-head">
          <span className="side-title">EXPLORER</span>
          <span className="side-actions">⤢</span>
        </div>
        <div className="prof-pick" onClick={() => setProfOpen((o) => !o)}>
          <span className="pp-caret">{profOpen ? "▾" : "▸"}</span>
          <span className="pp-glyph">⇄</span>
          <span className="pp-label" title={data.profile}>{data.profile}</span>
        </div>
        {profOpen && (
          <div className="prof-menu">
            {(profiles.data ?? []).map((p) => (
              <div key={p.name} className={"prof-item" + (p.name === data.profile ? " on" : "")} onClick={() => { setProfile(p.name); setProfOpen(false); }}>
                <span className="pi-dot" style={{ background: p.name === data.profile ? "#3ecf8e" : "#3a3f4a" }}></span>
                {p.name}<span className="pi-meta">{p.skills} sk</span>
              </div>
            ))}
            {!profiles.data && <div className="prof-item">loading profiles…</div>}
          </div>
        )}
        <div className="tree-filter">
          <span className="tf-ico">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter skills, mcps…" spellCheck={false} />
          {q && <span className="tf-clear" onClick={() => setQ("")}>×</span>}
        </div>

        <div className="tree">
          {/* SKILLS */}
          <TreeRow depth={0} caret={exp.SKILLS} label="SKILLS" count={data.counts.skills} onClick={() => setExp((e) => ({ ...e, SKILLS: !e.SKILLS }))} muted />
          {exp.SKILLS && groups.map((g) => {
            const items = g.items.filter((s) => match(s.name));
            if (ql && !items.length) return null;
            const open = ql ? true : exp["ns_" + g.ns] ?? false;
            return (
              <div key={g.ns}>
                <TreeRow depth={1} caret={open} color={g.color} label={g.label} count={g.items.length} onClick={() => setExp((e) => ({ ...e, ["ns_" + g.ns]: !e["ns_" + g.ns] }))} />
                {open && items.map((s) => (
                  <TreeRow key={s.id} depth={2} color={g.color} label={s.name} active={active === s.id} onClick={() => openTab("skill", s.id)} />
                ))}
              </div>
            );
          })}
          {/* MCPS */}
          <TreeRow depth={0} caret={exp.MCPS} label="MCPS" count={data.counts.mcps} onClick={() => setExp((e) => ({ ...e, MCPS: !e.MCPS }))} muted />
          {exp.MCPS && data.mcps.filter((m) => match(m.id)).map((m) => (
            <TreeRow key={"mcp/" + m.id} depth={1} glyph="🔌" label={m.id} status="ok" active={active === "mcp/" + m.id} onClick={() => openTab("mcp", "mcp/" + m.id)} />
          ))}
          {/* PLUGINS */}
          <TreeRow depth={0} caret={exp.PLUGINS} label="PLUGINS" count={data.counts.plugins} onClick={() => setExp((e) => ({ ...e, PLUGINS: !e.PLUGINS }))} muted />
          {exp.PLUGINS && data.plugins.filter((p) => match(p.name)).map((p) => (
            <TreeRow key={"plugin/" + p.name} depth={1} glyph="🧩" label={p.name} status="ok" active={active === "plugin/" + p.name} onClick={() => openTab("plugin", "plugin/" + p.name)} />
          ))}
          {/* COMMANDS */}
          <TreeRow depth={0} caret={exp.COMMANDS} label="COMMANDS" count={data.commands.length} onClick={() => setExp((e) => ({ ...e, COMMANDS: !e.COMMANDS }))} muted />
          {exp.COMMANDS && data.commands.filter((c) => match(c.name)).map((c) => (
            <TreeRow key={"cmd/" + c.ref} depth={1} glyph="›_" label={c.name} active={active === "cmd/" + c.ref} onClick={() => openTab("command", "cmd/" + c.ref)} />
          ))}
        </div>
      </aside>

      {/* ── editor column ── */}
      <section className="edit-col">
        <div className="tabbar">
          {tabs.map((t) => (
            <div key={t.key} className={"tab" + (active === t.key ? " on" : "")} onClick={() => setActive(t.key)}>
              <span className="tab-dot" style={{ background: tabColor(t) }}></span>
              <span className="tab-name">{tabLabel(t)}</span>
              <span className="tab-ext">.md</span>
              {edits[t.key] !== undefined
                ? <span className="tab-mod" onClick={(e) => closeTab(t.key, e)} title="unsaved edits">●</span>
                : <span className="tab-x" onClick={(e) => closeTab(t.key, e)}>×</span>}
            </div>
          ))}
          {!tabs.length && <div className="tab-empty">no file open — pick a skill from the tree</div>}
        </div>

        {cur ? (
          <>
            <div className="breadcrumb">
              <span className="bc-prof">{data.parts.join(" + ")}</span>
              <span className="bc-sep">›</span>
              <span>{cur.kind === "skill" ? "skills" : cur.kind + "s"}</span>
              <span className="bc-sep">›</span>
              {curSkill && <><span style={{ color: nsColor(curSkill.ns) }}>{curSkill.ns}</span><span className="bc-sep">›</span></>}
              <span className="bc-file">{curName}<span className="bc-ext">.md</span></span>
              <span style={{ flex: 1 }}></span>
              {edited && <span className="ed-edited">● edited</span>}
              {edited && <span className="ed-revert" onClick={revert}>revert</span>}
              <div className="ed-modes">
                <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>Preview</button>
                <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>Edit</button>
              </div>
            </div>
            <div className="edit-main">
              <div className={"edit-scroll" + (mode === "edit" ? " editing" : "")} ref={scrollRef}>
                {mode === "edit"
                  ? <EditArea text={body} onChange={(v) => setBody(cur.key, v)} />
                  : <MdEditor text={body} highlightLine={hlLine} />}
              </div>
              {showMinimap && <Minimap body={body} onJump={jumpTo} />}
            </div>
          </>
        ) : (
          <div className="edit-blank"><div className="eb-logo">cue<span>studio</span></div><p>Select a skill, MCP, plugin, or command to read its doc.</p></div>
        )}
      </section>

      {/* ── details panel ── */}
      {cur && (
        <aside className="details">
          <div className="det-sec">
            <div className="det-h">{cur.kind === "skill" ? "SKILL" : cur.kind.toUpperCase()}</div>
            <div className="det-name" style={{ color: curSkill ? nsColor(curSkill.ns) : curCommand ? "#56b6c2" : "#c9cdd6" }}>{curName}</div>
            <div className="det-desc">{curSkill?.desc || curCommand?.desc || mcpInfo(curMcp?.id ?? "").desc || ""}</div>
          </div>

          <div className="det-sec">
            <div className="det-h">METADATA</div>
            <div className="det-kv">
              {curSkill && <>
                <span className="dk-k">namespace</span><span className="dk-v" style={{ color: nsColor(curSkill.ns) }}>{curSkill.ns}</span>
                <span className="dk-k">size</span><span className="dk-v">{curSkill.sizeK}K</span>
                <span className="dk-k">load</span><span className="dk-v">on-demand</span>
              </>}
              {curMcp && <>
                <span className="dk-k">transport</span><span className="dk-v">{mcpInfo(curMcp.id).transport}</span>
                <span className="dk-k">status</span><span className="dk-v ok">● {curMcp.status}</span>
                <span className="dk-k">tools</span><span className="dk-v">{mcpInfo(curMcp.id).tools.length}</span>
              </>}
              {curPlugin && <>
                <span className="dk-k">status</span><span className="dk-v ok">● {curPlugin.status}</span>
                <span className="dk-k">marketplace</span><span className="dk-v">{curPlugin.marketplace || "—"}</span>
              </>}
              {curCommand && <>
                <span className="dk-k">source</span><span className="dk-v">{curCommand.missing ? "plugin / built-in" : "resources/commands"}</span>
                {curCommand.argHint && <><span className="dk-k">argument</span><span className="dk-v">{curCommand.argHint}</span></>}
                {!curCommand.missing && <><span className="dk-k">size</span><span className="dk-v">{curCommand.sizeK}K</span></>}
                <span className="dk-k">load</span><span className="dk-v">on-invoke</span>
              </>}
            </div>
          </div>

          {curCommand && (
            <div className="det-sec">
              <div className="det-h">INVOKE</div>
              <div className="det-invoke"><span className="di-slash">{curCommand.name}</span>{curCommand.argHint && <span className="di-arg"> {curCommand.argHint}</span>}</div>
              <div className="det-desc" style={{ marginTop: 6 }}>Type this in the prompt to run the command{curCommand.missing ? " — it's contributed by a plugin or built in to the agent" : ""}.</div>
            </div>
          )}

          {curSkill && (() => {
            const stats = bodyStats(body);
            const u = report.data?.rows.find((r) => r.id === curSkill.id);
            const telemetryOff = report.isError;
            const hits = u?.hits ?? 0;
            const windowDays = report.data?.windowDays ?? 30;
            const perWeek = Math.round(hits / (windowDays / 7));
            // Sparkline: the workspace's daily activity (real, /telemetry/timeline).
            // Per-skill daily series doesn't exist in cue, so this is ambient
            // context — tooltipped so it's not read as the skill's own curve.
            const spark = (timeline.data?.daily ?? []).map((day) => day.sessions);
            // Workspace trend: last 7d vs the prior 7d (real, from the same series).
            const tail = spark.slice(-7).reduce((a, v) => a + v, 0);
            const prev = spark.slice(-14, -7).reduce((a, v) => a + v, 0);
            const trendPct = prev > 0 ? Math.round(((tail - prev) / prev) * 100) : null;
            return (
              <>
                <div className="det-sec">
                  <div className="det-h">USAGE</div>
                  <div className="det-usage">
                    <div className="du-hero">
                      <div className={"du-n" + (telemetryOff ? " off" : "")}>{telemetryOff ? "—" : hits}</div>
                      <div className="du-hl">{telemetryOff ? "telemetry off" : "activations"}<br /><span className="du-dim">last {windowDays} days</span></div>
                    </div>
                    {!telemetryOff && spark.length > 1 && (
                      <div className="du-spark" title={`workspace activity, last ${spark.length}d (per-skill daily series isn't tracked)`}>
                        <Spark data={spark} />
                        {trendPct != null && (
                          <div className={"du-trend " + (trendPct >= 0 ? "up" : "down")}>{trendPct >= 0 ? "▲" : "▼"} {Math.abs(trendPct)}%</div>
                        )}
                      </div>
                    )}
                  </div>
                  {!telemetryOff && (
                    <div className="du-rows">
                      <div className="du-row"><span className="du-k">last used</span><span className="du-v">{u?.lastUsed ? fmtAge(u.lastUsed) + " ago" : "never"}</span></div>
                      <div className="du-row"><span className="du-k">avg / week</span><span className="du-v">{perWeek}</span></div>
                      {u?.zombie && <div className="du-row"><span className="du-k">flag</span><span className="du-v" style={{ color: "var(--amber)" }}>● zombie</span></div>}
                    </div>
                  )}
                </div>

                <div className="det-sec">
                  <div className="det-h">DOCUMENT</div>
                  <DocStatGrid stats={stats} />
                </div>
              </>
            );
          })()}

          {curCommand && (
            <div className="det-sec">
              <div className="det-h">DOCUMENT</div>
              <DocStatGrid stats={bodyStats(body)} />
            </div>
          )}

          {curSkill && curSkill.uses.length > 0 && (
            <div className="det-sec">
              <div className="det-h">CONNECTED MCPS</div>
              {curSkill.uses.map((u) => {
                const m = data.mcps.find((x) => x.id === u);
                return (
                  <div key={u} className="det-chip" onClick={() => m && openTab("mcp", "mcp/" + m.id)}>
                    <span className="dc-dot ok"></span>{u}<span className="dc-meta">{m ? mcpInfo(m.id).tools.length + " tools" : ""}</span>
                  </div>
                );
              })}
            </div>
          )}
          {curMcp && (
            <div className="det-sec">
              <div className="det-h">TOOLS</div>
              {mcpInfo(curMcp.id).tools.length
                ? mcpInfo(curMcp.id).tools.map((t) => <div key={t} className="det-tool">{t}<span className="dt-paren">()</span></div>)
                : <div className="det-desc">Tool inventory is resolved at runtime.</div>}
            </div>
          )}

          {curSkill && skillClis.length > 0 && (
            <div className="det-sec">
              <div className="det-h">CLIS</div>
              {skillClis.map((c) => (
                <div key={c.name} className="det-cli" onClick={() => onCliClick(c.name)} title={`jump to where ${c.name} is used in this skill`}>
                  <div className="dcli-top">
                    <span className="dcli-glyph">⌘</span>
                    <span className="dcli-name">{c.name}</span>
                    <span className={"dcli-badge" + (c.known ? "" : " off")}>{c.known ? "recipe" : "no recipe"}</span>
                  </div>
                  <div className="dcli-install">{c.install || "no install recipe on file"}</div>
                </div>
              ))}
            </div>
          )}
          {outline.length > 0 && (
            <div className="det-sec">
              <div className="det-h">OUTLINE</div>
              {outline.map((o, i) => (
                <div key={i} className={"det-out lvl" + o.lvl} onClick={() => jumpLine(o.i)}>{o.t}</div>
              ))}
            </div>
          )}
          {curProfileRow && (
            <div className="det-sec">
              <div className="det-h">PROFILE</div>
              <div className="det-desc">{curProfileRow.description}</div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
