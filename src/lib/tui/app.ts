/**
 * Main TUI loop. Composes screen + data + render + input into one runnable.
 *
 * runTui() blocks until the user presses q / esc / ctrl-c. Exit codes:
 *   0  clean quit
 *   1  cannot run (no TTY, missing profiles dir)
 */

import { enterTui, leaveTui, paint, getSize, onResize, isTty } from "./screen";
import { onKey, type KeyEvent } from "./input";
import { renderFrame } from "./render";
import { loadInitialState, loadPreview, itemsFor } from "./data";
import type { Pane, TuiMode, TuiState } from "./types";
import { detectKittyTerminal, transmitKittyImage, clearKittyImages } from "../kitty-image";

const PANE_ORDER: Pane[] = ["profiles", "skills", "preview"];

function nextPane(p: Pane): Pane {
  const idx = PANE_ORDER.indexOf(p);
  return PANE_ORDER[(idx + 1) % PANE_ORDER.length]!;
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, n));
}

interface AppHandle {
  state: TuiState;
  dirty: boolean;
  busy: boolean;
}

async function refreshSkills(app: AppHandle): Promise<void> {
  const row = app.state.profiles[app.state.profileCursor];
  if (!row) {
    app.state.skills = [];
    app.state.skillCursor = 0;
    app.state.preview = null;
    return;
  }
  app.state.skills = await itemsFor(row.name, app.state.mode ?? "skills");
  app.state.skillCursor = 0;
  app.state.previewScroll = 0;
  app.state.preview = app.state.skills[0] ? await loadPreview(app.state.skills[0]) : null;
}

async function refreshPreview(app: AppHandle): Promise<void> {
  const s = app.state.skills[app.state.skillCursor];
  if (!s) { app.state.preview = null; return; }
  app.state.preview = await loadPreview(s);
  app.state.previewScroll = 0;
}

async function handleKey(app: AppHandle, key: KeyEvent): Promise<boolean> {
  if (key.type === "q" || key.type === "ctrl-c" || key.type === "esc") return true;

  if (key.type === "tab") {
    app.state.focus = nextPane(app.state.focus);
    app.dirty = true;
    return false;
  }

  if (key.type === "up" || key.type === "down") {
    const dir = key.type === "up" ? -1 : 1;
    if (app.state.focus === "profiles") {
      const prev = app.state.profileCursor;
      app.state.profileCursor = clamp(prev + dir, 0, Math.max(0, app.state.profiles.length - 1));
      if (app.state.profileCursor !== prev) {
        app.busy = true;
        try { await refreshSkills(app); } catch (e) { app.state.error = (e as Error).message; }
        app.busy = false;
      }
    } else if (app.state.focus === "skills") {
      const prev = app.state.skillCursor;
      app.state.skillCursor = clamp(prev + dir, 0, Math.max(0, app.state.skills.length - 1));
      if (app.state.skillCursor !== prev) {
        app.busy = true;
        try { await refreshPreview(app); } catch (e) { app.state.error = (e as Error).message; }
        app.busy = false;
      }
    } else {
      app.state.previewScroll = clamp(app.state.previewScroll + dir, 0, 1_000_000);
    }
    app.dirty = true;
    return false;
  }

  if (key.type === "page-up" || key.type === "page-down") {
    const step = key.type === "page-up" ? -10 : 10;
    if (app.state.focus === "preview") {
      app.state.previewScroll = clamp(app.state.previewScroll + step, 0, 1_000_000);
      app.dirty = true;
    }
    return false;
  }

  if (key.type === "home") {
    if (app.state.focus === "preview") { app.state.previewScroll = 0; app.dirty = true; }
    return false;
  }

  // < / > resize the focused column. The delta accumulates; paneRects clamps so
  // panes can't collapse. Growing the preview shrinks the skills pane.
  if (key.type === "char" && (key.value === "<" || key.value === ">")) {
    const step = (key.value === ">" ? 2 : -2);
    if (app.state.focus === "profiles") {
      app.state.profileWidthDelta = (app.state.profileWidthDelta ?? 0) + step;
    } else if (app.state.focus === "skills") {
      app.state.skillWidthDelta = (app.state.skillWidthDelta ?? 0) + step;
    } else {
      // preview is the remainder: grow it by shrinking skills, and vice versa.
      app.state.skillWidthDelta = (app.state.skillWidthDelta ?? 0) - step;
    }
    app.dirty = true;
    return false;
  }

  return false;
}

export async function runTui(cwd: string = process.cwd(), mode: TuiMode = "skills"): Promise<number> {
  if (!isTty()) {
    process.stderr.write("cue tui: stdin/stdout are not a TTY; cannot run interactive UI.\n");
    return 1;
  }

  let initial: TuiState;
  try {
    initial = await loadInitialState(cwd, mode);
  } catch (e) {
    process.stderr.write(`cue tui: failed to load initial state: ${(e as Error).message}\n`);
    return 1;
  }

  if (initial.profiles.length === 0) {
    process.stderr.write("cue tui: no profiles found under profiles/. Run `cue new <name>` first.\n");
    return 1;
  }

  // Detect kitty graphics support before entering the alt screen (the probe
  // toggles raw mode + reads a response on the normal buffer). When supported,
  // profile rows paint real logos instead of emoji.
  const kitty = await detectKittyTerminal();
  initial.kitty = kitty;

  const app: AppHandle = { state: initial, dirty: true, busy: false };

  enterTui();
  // Transmit each profile logo once with a stable id; the renderer references
  // these via kitty Unicode placeholders, which scroll with the text cells.
  if (kitty) {
    for (const row of initial.profiles) {
      if (row.iconImagePath && row.imageId) {
        transmitKittyImage(row.iconImagePath, row.imageId, 2, 1);
      }
    }
  }
  const cleanup = () => {
    if (kitty) clearKittyImages();
    leaveTui();
  };
  process.on("exit", cleanup);
  process.on("uncaughtException", (e) => {
    cleanup();
    process.stderr.write(`cue tui: crashed: ${(e as Error).message}\n`);
    process.exit(2);
  });

  // Event-driven render: zero CPU between keystrokes. `_pendingDirty` handles
  // the case where markDirty() fires while the loop is painting (no Promise
  // pending) — the next waitDirty() call sees it and returns immediately.
  let _pendingDirty = true; // initial: draw first frame without waiting
  let _dirtyResolve: (() => void) | null = null;
  const markDirty = (): void => {
    _pendingDirty = true;
    const r = _dirtyResolve;
    if (r) { _dirtyResolve = null; r(); }
  };
  const waitDirty = (): Promise<void> => {
    if (_pendingDirty) { _pendingDirty = false; return Promise.resolve(); }
    return new Promise<void>((resolve) => { _dirtyResolve = resolve; });
  };

  const offResize = onResize(markDirty);

  let quit = false;
  const offKey = onKey((key) => {
    void (async () => {
      try {
        if (await handleKey(app, key)) {
          quit = true;
          markDirty();
          return;
        }
      } catch (e) {
        app.state.error = (e as Error).message;
      }
      markDirty();
    })();
  });

  while (!quit) {
    await waitDirty();
    if (quit) break;
    const size = getSize();
    paint(renderFrame(app.state, { cols: size.cols, rows: size.rows }));
  }

  offKey();
  offResize();
  cleanup();
  process.off("exit", cleanup);
  return 0;
}
