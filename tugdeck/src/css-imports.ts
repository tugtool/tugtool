/**
 * CSS import module — isolates CSS from the main entry point.
 *
 * All CSS side-effect imports live here. This module explicitly accepts
 * HMR updates so CSS changes never propagate to main.tsx (which would
 * trigger a full page reload since main.tsx has no HMR accept handler).
 */
import "./globals.css";
import "../styles/chrome.css";
import "@xterm/xterm/css/xterm.css";

if (import.meta.hot) {
  import.meta.hot.accept();

  // Reload continuity overlay — Spec S01, Phase 7d.
  //
  // Vite dispatches 'vite:beforeFullReload' via the HMR client immediately
  // before calling location.reload(). Painting a dark overlay synchronously
  // here ensures the old page turns dark before the browser reloads, so the
  // visual sequence is:
  //   dark overlay (old page) → dark body + startup overlay (new page) → content fade-in
  //
  // This handles Vite-initiated reloads (CSS edits, JS edits that cross an
  // HMR boundary). Browser-initiated reloads (Cmd+R) are handled by Phase 7c's
  // inline body styles and startup overlay in index.html.
  //
  // Dev-only: import.meta.hot is only defined in dev mode; this callback is
  // never registered in production builds.
  import.meta.hot.on("vite:beforeFullReload", () => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:#16171a;z-index:99998";
    document.body.appendChild(overlay);
  });
}
