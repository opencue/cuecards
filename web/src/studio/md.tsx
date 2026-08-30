/**
 * Markdown rendering for the explorer editor — ported from the design's
 * studio-data.jsx (MdEditor preview) and studio-explorer.jsx (EditArea
 * highlighted-source overlay + Minimap). Same VS Code-ish look: line-number
 * gutter, frontmatter keys/values, headings, bullets, code spans, blockquotes.
 */

import { useRef, useState, type ReactNode } from "react";

// ── shared parsing helpers ───────────────────────────────────────────────
export function parseFrontmatter(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split("\n");
  if (lines[0] !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const c = lines[i]!.indexOf(":");
    if (c > 0) out[lines[i]!.slice(0, c).trim()] = lines[i]!.slice(c + 1).trim();
  }
  return out;
}

export interface OutlineEntry { lvl: number; t: string; i: number }
export function outlineOf(body: string): OutlineEntry[] {
  return body.split("\n").flatMap((l, i): OutlineEntry[] => {
    if (l.startsWith("### ")) return [{ lvl: 3, t: l.slice(4), i }];
    if (l.startsWith("## ")) return [{ lvl: 2, t: l.slice(3), i }];
    if (l.startsWith("# ")) return [{ lvl: 1, t: l.slice(2), i }];
    return [];
  });
}

// ── preview renderer (MdEditor) ──────────────────────────────────────────
function inlineMd(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, key = 0;
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<span key={key++} className="md-b">{m[2]}</span>);
    else if (m[3] !== undefined) out.push(<span key={key++} className="md-code">{m[3]}</span>);
    else if (m[4] !== undefined) out.push(<em key={key++} className="md-em">{m[4]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MdEditor({ text, highlightLine }: { text: string; highlightLine?: number | null }) {
  const lines = text.split("\n");
  let inFm = false, fmCount = 0, inCode = false;
  return (
    <div className="editor-body">
      {lines.map((ln, idx) => {
        let cls = "md-p";
        let rowCls = "";
        let content: ReactNode = ln;
        if (ln === "---") { fmCount++; inFm = fmCount === 1; cls = "md-fm"; content = ln; }
        else if (inFm && fmCount < 2) {
          const c = ln.indexOf(":");
          if (c > 0) { content = <><span className="md-key">{ln.slice(0, c)}</span><span className="md-fm">:</span><span className="md-val">{ln.slice(c + 1)}</span></>; cls = "md-fmline"; }
          else { content = ln; cls = "md-val"; }
        }
        else if (ln.startsWith("```")) {
          const opening = !inCode; inCode = !inCode;
          rowCls = opening ? " cb cb-open" : " cb cb-close";
          cls = "md-fence";
          const lang = ln.slice(3).trim();
          // Hide the literal fence markers; show the language as a chip on the
          // opening fence so the block reads like a GitHub code block.
          content = opening && lang ? <span className="md-lang">{lang}</span> : "​";
        }
        else if (inCode) { cls = "md-codeblock"; content = ln || " "; rowCls = " cb"; }
        else if (ln.startsWith("# ")) { cls = "md-h1"; content = ln.slice(2); }
        else if (ln.startsWith("## ")) { cls = "md-h2"; content = ln.slice(3); }
        else if (ln.startsWith("### ")) { cls = "md-h3"; content = ln.slice(4); }
        else if (ln.startsWith("> ")) { cls = "md-quote"; content = inlineMd(ln.slice(2)); }
        else if (/^- \[[ x]\] /.test(ln)) { const done = ln[3] === "x"; cls = "md-task"; content = <><span className={done ? "md-check on" : "md-check"}>{done ? "☑" : "☐"}</span> {inlineMd(ln.slice(6))}</>; }
        else if (/^[-*] /.test(ln)) { cls = "md-li"; content = <><span className="md-bullet">•</span> {inlineMd(ln.slice(2))}</>; }
        else if (/^\d+\. /.test(ln)) { const dot = ln.indexOf(". "); cls = "md-ol"; content = <><span className="md-num">{ln.slice(0, dot + 1)}</span> {inlineMd(ln.slice(dot + 2))}</>; }
        else if (ln === "") { cls = "md-blank"; content = " "; }
        else { content = inlineMd(ln); }
        return (
          <div className={"ed-row" + rowCls + (idx === highlightLine ? " hl" : "")} key={idx}>
            <span className="ed-gutter">{idx + 1}</span>
            <span className={"ed-line " + cls}>{content}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── editable highlighted source overlay (EditArea) ───────────────────────
function inlineSrc(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, key = 0;
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(<span key={key++} className={tok[0] === "`" ? "s-code" : "s-b"}>{tok}</span>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderSource(text: string): ReactNode[] {
  const lines = text.split("\n");
  let fm = 0, inCode = false;
  return lines.map((ln, i) => {
    let content: ReactNode, cls = "s-p";
    if (ln === "---") { fm++; cls = "s-fm"; content = ln; }
    else if (fm === 1) { const c = ln.indexOf(":"); if (c > 0) { cls = "s-fmline"; content = <><span className="s-key">{ln.slice(0, c)}</span><span className="s-fm">:</span><span className="s-val">{ln.slice(c + 1)}</span></>; } else { cls = "s-val"; content = ln; } }
    else if (ln.startsWith("```")) { inCode = !inCode; cls = "s-fence"; content = ln; }
    else if (inCode) { cls = "s-codeblock"; content = ln; }
    else if (/^#{1,3} /.test(ln)) { const lvl = (ln.match(/^#+/) || [""])[0].length; cls = "s-h" + lvl; content = <><span className="s-hmark">{ln.slice(0, lvl + 1)}</span>{ln.slice(lvl + 1)}</>; }
    else if (/^> /.test(ln)) { cls = "s-quote"; content = <><span className="s-mark">{"> "}</span>{inlineSrc(ln.slice(2))}</>; }
    else if (/^[-*] \[[ x]\] /.test(ln)) { cls = "s-li"; content = <><span className="s-mark">{ln.slice(0, 5)}</span>{" "}{inlineSrc(ln.slice(6))}</>; }
    else if (/^[-*] /.test(ln)) { cls = "s-li"; content = <><span className="s-bullet">{ln.slice(0, 1)}</span>{" "}{inlineSrc(ln.slice(2))}</>; }
    else if (/^\d+\. /.test(ln)) { const d = ln.indexOf(". "); cls = "s-ol"; content = <><span className="s-num">{ln.slice(0, d + 2)}</span>{inlineSrc(ln.slice(d + 2))}</>; }
    else content = inlineSrc(ln);
    const isEmpty = content === "" || (Array.isArray(content) && content.length === 0);
    return <div key={i} className={"ce-ln " + cls}>{isEmpty ? "​" : content}</div>;
  });
}

export function EditArea({ text, onChange }: { text: string; onChange: (v: string) => void }) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [top, setTop] = useState(0);
  const LH = 22, PAD = 10;
  const lines = text.split("\n");
  const sync = () => {
    const ta = taRef.current; if (!ta) return;
    if (preRef.current) { preRef.current.scrollTop = ta.scrollTop; preRef.current.scrollLeft = ta.scrollLeft; }
    if (gutRef.current) gutRef.current.scrollTop = ta.scrollTop;
    setTop(ta.scrollTop);
  };
  const caretUpd = () => {
    const ta = taRef.current; if (!ta) return;
    setCaret(ta.value.slice(0, ta.selectionStart).split("\n").length - 1);
  };
  return (
    <div className="code-edit">
      <div className="ce-gutter" ref={gutRef}>{lines.map((_, i) => <div key={i} className={i === caret ? "on" : ""}>{i + 1}</div>)}</div>
      <div className="ce-wrap">
        <div className="ce-activeline" style={{ transform: `translateY(${PAD + caret * LH - top}px)` }}></div>
        <pre className="ce-hl" ref={preRef} aria-hidden="true">{renderSource(text)}</pre>
        <textarea className="ce-ta" ref={taRef} value={text} spellCheck={false} wrap="off"
          onChange={(e) => onChange(e.target.value)} onScroll={sync}
          onKeyUp={caretUpd} onClick={caretUpd} onSelect={caretUpd} />
      </div>
    </div>
  );
}

// ── minimap ──────────────────────────────────────────────────────────────
export function Minimap({ body, onJump }: { body: string; onJump: (frac: number) => void }) {
  const lines = body.split("\n");
  return (
    <div className="minimap" onClick={(e) => {
      const r = e.currentTarget.getBoundingClientRect();
      onJump((e.clientY - r.top) / r.height);
    }}>
      {lines.map((l, i) => {
        let c = "rgba(150,156,168,.22)";
        if (l.startsWith("# ")) c = "rgba(224,145,58,.9)";
        else if (l.startsWith("## ")) c = "rgba(139,123,240,.85)";
        else if (l.startsWith("### ")) c = "rgba(86,182,194,.8)";
        else if (/^[-*\d]/.test(l)) c = "rgba(150,156,168,.4)";
        else if (l === "---") c = "rgba(110,116,128,.5)";
        const w = Math.min(100, (l.length / 56) * 100);
        return <div key={i} className="mm-line" style={{ width: w + "%", background: c }}></div>;
      })}
    </div>
  );
}
