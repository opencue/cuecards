# .design-sync NOTES — cue studio

## Repo shape

- This is a Vite **application** repo, not a published component library.
- The design system lives in `src/studio/components/index.tsx` (created for this sync).
  The original `src/studio/views/*.tsx` are full-page application views that call live
  API hooks (`useStatus()`, `useTimeline()`, etc.) — they CANNOT be synced as-is.
- No library build configured. Converter runs in synth-entry mode, scanning
  `src/studio/components/` for PascalCase exports.

## Fonts

- IBM Plex Sans and JetBrains Mono are loaded via Google Fonts `<link>` in `index.html`.
  They are NOT shipped with the bundle. `runtimeFontPrefixes` suppresses `[FONT_MISSING]`.
  If the design project needs previews that render these fonts, the preview HTML must
  load them via a `<link>` or the fonts will fall back to system fonts.

## CSS

- `src/studio/styles.css` is the canonical token/style file (~1183 lines).
  It includes app-global resets (`html,body,#root{height:100%}`) — these don't affect
  the DS pane but are present in the uploaded `styles.css`.

## Build notes

- No separate `build:components` script. Converter synthesizes entry from source.
  If re-sync needs it, run: `node .ds-sync/package-build.mjs --config .design-sync/config.json ...`
- Node modules path: `/home/deadpool/Documents/cue/web/node_modules`

## Re-sync risks

- **Component file hand-edited**: `src/studio/components/index.tsx` is hand-authored.
  If views in `src/studio/views/` are refactored significantly, component CSS class
  names may drift. Re-verify that classes like `.card`, `.band`, `.stat`, `.mc-card`
  still exist in `styles.css`.
- **Google Fonts availability**: previews depend on browser font loading. If previews
  render with system fonts instead of IBM Plex Sans, add a `<link>` to the preview HTML.
