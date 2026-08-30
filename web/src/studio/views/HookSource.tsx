/**
 * HookSourceModal — a read-only code viewer for a single hook's script. Opens
 * when you click a hook's command line; shows filename + path + a language
 * badge, line-numbered + lightly syntax-highlighted source, and a copy button.
 * Source is live from /api/v1/hook-source (allowlisted to real hook scripts).
 */

import { useEffect, useState, type ReactNode } from "react";

import { useHookSource, type HookEntry } from "../api";

// Per-language keyword sets for the highlighter. Bash covers the overwhelming
// majority of cue hooks; the others degrade gracefully to plain text + strings.
const KEYWORDS: Record<string, Set<string>> = {
  bash: new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "return", "exit", "set", "local", "export", "readonly", "declare", "shift", "break", "continue", "source", "trap", "eval"]),
  javascript: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "new", "class", "import", "export", "from", "default", "await", "async", "try", "catch", "finally", "throw", "typeof", "this"]),
  typescript: new Set(["const", "let", "var", "function", "return", "if", "else", "for", "while", "switch", "case", "break", "new", "class", "interface", "type", "import", "export", "from", "await", "async", "try", "catch", "throw", "typeof", "as", "extends", "implements", "public", "private", "readonly"]),
  python: new Set(["def", "return", "if", "elif", "else", "for", "while", "in", "import", "from", "as", "with", "try", "except", "finally", "raise", "class", "lambda", "pass", "break", "continue", "None", "True", "False", "and", "or", "not", "is"]),
};

/** Tokenize one source line into classed spans (comments, strings, vars, keywords, numbers). */
function highlight(line: string, lang: string): ReactNode[] {
  const kw = KEYWORDS[lang] ?? KEYWORDS.bash!;
  const lineComment = lang === "javascript" || lang === "typescript" ? "//" : "#";
  const out: ReactNode[] = [];
  let i = 0, key = 0;
  const push = (text: string, cls?: string) => out.push(cls ? <span key={key++} className={cls}>{text}</span> : text);
  while (i < line.length) {
    const ch = line[i]!;
    // line comment — for `#`, only when at start or after whitespace (so `$#` / `a#b` aren't comments)
    if (line.startsWith(lineComment, i) && (lineComment === "//" || i === 0 || /\s/.test(line[i - 1]!))) {
      push(line.slice(i), "hsrc-cmt"); break;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) { if (line[j] === "\\") j++; j++; }
      push(line.slice(i, Math.min(j + 1, line.length)), "hsrc-str"); i = j + 1; continue;
    }
    if (ch === "$") {
      let j = i + 1;
      if (line[j] === "{") { while (j < line.length && line[j] !== "}") j++; j++; }
      else if (line[j] === "(") { push(line.slice(i, i + 2), "hsrc-var"); i += 2; continue; }
      else while (j < line.length && /[A-Za-z0-9_#@?*!-]/.test(line[j]!)) j++;
      push(line.slice(i, j), "hsrc-var"); i = j; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i; while (j < line.length && /[A-Za-z0-9_]/.test(line[j]!)) j++;
      const w = line.slice(i, j);
      push(w, kw.has(w) ? "hsrc-kw" : undefined); i = j; continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i; while (j < line.length && /[0-9.]/.test(line[j]!)) j++;
      push(line.slice(i, j), "hsrc-num"); i = j; continue;
    }
    // run of plain/operator chars
    let j = i; while (j < line.length && !/["'`$A-Za-z0-9_]/.test(line[j]!) && !line.startsWith(lineComment, j)) j++;
    push(line.slice(i, Math.max(j, i + 1))); i = Math.max(j, i + 1);
  }
  return out.length ? out : ["​"];
}

export function HookSourceModal({ hook, profile, onClose }: { hook: HookEntry; profile: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error } = useHookSource(hook.scriptPath, profile ?? undefined);
  const [copied, setCopied] = useState(false);

  // Esc closes; lock the trigger to a single Escape listener for this modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = () => {
    if (!data?.content) return;
    try { navigator.clipboard.writeText(data.content); } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1200);
  };

  const lines = data ? data.content.replace(/\n$/, "").split("\n") : [];
  const lang = data?.language ?? "bash";

  return (
    <>
      <div className="tb-update-scrim" onClick={onClose}></div>
      <div className="hsrc-modal" role="dialog" aria-label="hook source">
        <div className="hsrc-head">
          <span className="hsrc-dot"></span>
          <span className="hsrc-name">{data?.filename ?? hook.scriptPath?.split("/").pop() ?? "hook"}</span>
          <span className="hsrc-path">{data?.dir ?? ""}</span>
          <span className="hsrc-spacer"></span>
          {data && <span className="hsrc-badge">{lang}</span>}
          <button className="hsrc-copy" onClick={copy} disabled={!data}>{copied ? "copied ✓" : "copy"}</button>
          <button className="hsrc-close" onClick={onClose} title="close (Esc)">×</button>
        </div>
        <div className="hsrc-body">
          {isLoading && <div className="hsrc-msg">Loading source…</div>}
          {isError && <div className="hsrc-msg">Couldn't read source: {(error as Error).message}</div>}
          {data && (
            <div className="hsrc-code">
              <div className="hsrc-gutter">{lines.map((_, i) => <div key={i}>{i + 1}</div>)}</div>
              <pre className="hsrc-pre">{lines.map((ln, i) => <div className="hsrc-line" key={i}>{highlight(ln, lang)}</div>)}</pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
