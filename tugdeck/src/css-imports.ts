/**
 * CSS import module — isolates CSS from the main entry point.
 *
 * All CSS side-effect imports live here. This module explicitly accepts
 * HMR updates so CSS changes never propagate to main.tsx (which would
 * trigger a full page reload since main.tsx has no HMR accept handler).
 */
// The active theme's complete token declarations, served from the dev
// server's in-memory active-theme state by the Vite `active-theme-virtual`
// plugin (vite.config.ts). Imported here on the JS side — not via CSS
// `@import` in tug.css — because PostCSS's `@import` resolver reads the
// filesystem and cannot resolve a virtual module. Loaded first so its
// `:root`/`body` token declarations are in scope before any component CSS.
import "virtual:tug-active-theme.css";
import "./globals.css";
import "../styles/chrome.css";
import "@xterm/xterm/css/xterm.css";

if (import.meta.hot) {
  import.meta.hot.accept();
}
