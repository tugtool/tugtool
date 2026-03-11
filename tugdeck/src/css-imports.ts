/**
 * CSS import module — isolates CSS from the main entry point.
 *
 * All CSS side-effect imports live here. This module explicitly accepts
 * HMR updates so CSS changes never propagate to main.tsx (which would
 * trigger a full page reload since main.tsx has no HMR accept handler).
 */
import "./globals.css";
import "../styles/shadcn-base.css";
import "../styles/chrome.css";
import "@xterm/xterm/css/xterm.css";

if (import.meta.hot) {
  import.meta.hot.accept();
}
