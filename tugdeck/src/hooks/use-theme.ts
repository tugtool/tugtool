/**
 * useTheme — React hook that reads and sets the current Tuglook theme.
 *
 * Reads the active theme from document.body class list. The two non-default
 * themes are activated via body classes "td-theme-bluenote" and
 * "td-theme-harmony"; Brio is the default and carries no body class.
 *
 * The setter updates localStorage ("td-theme"), toggles the appropriate body
 * class, and dispatches CustomEvent("td-theme-change") on document — matching
 * the vanilla TS applyTheme behavior used by dock.ts and settings-card.ts.
 */

import { useState, useEffect } from "react";

export type ThemeName = "brio" | "bluenote" | "harmony";

/** localStorage key — must match dock.ts and settings-card.ts */
const THEME_STORAGE_KEY = "td-theme";

/** Body class prefix for non-default themes — must match tokens.css */
const THEME_CLASS_PREFIX = "td-theme-";

const DEFAULT_THEME: ThemeName = "brio";

/** Read the active theme from the current body class list. */
function readCurrentTheme(): ThemeName {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const classes = Array.from(document.body.classList);
  for (const cls of classes) {
    if (cls.startsWith(THEME_CLASS_PREFIX)) {
      return cls.slice(THEME_CLASS_PREFIX.length) as ThemeName;
    }
  }
  // No td-theme-* class present → Brio (default)
  return DEFAULT_THEME;
}

/** Convert a CSS color value (hex or rgb()) to a 6-digit hex string. */
function normalizeToHex(css: string): string | null {
  const trimmed = css.trim();
  // Already hex
  if (trimmed.startsWith("#")) {
    return trimmed.length === 7 ? trimmed : null;
  }
  // rgb(r, g, b)
  const match = trimmed.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (!match) return null;
  const [, r, g, b] = match;
  const hex = (c: string) => Number(c).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Read the resolved body background-color and post the hex string to the Swift bridge. */
function sendCanvasColor(): void {
  const raw = getComputedStyle(document.body).getPropertyValue("background-color");
  const hex = normalizeToHex(raw);
  if (hex) {
    (window as any).webkit?.messageHandlers?.setTheme?.postMessage({ color: hex });
  }
}

export function useTheme(): [ThemeName, (theme: ThemeName) => void] {
  const [theme, setThemeState] = useState<ThemeName>(readCurrentTheme);

  // Sync with external theme changes (e.g. from dock.ts or other React components).
  // Vanilla code dispatches "td-theme-change" on document.
  useEffect(() => {
    const handleThemeChange = () => {
      setThemeState(readCurrentTheme());
      // Theme may have been changed by vanilla TS code (dock.ts) which doesn't
      // call sendCanvasColor itself, so always sync to the Swift bridge here.
      requestAnimationFrame(sendCanvasColor);
    };
    document.addEventListener("td-theme-change", handleThemeChange);
    return () => {
      document.removeEventListener("td-theme-change", handleThemeChange);
    };
  }, []);

  // Post initial canvas color to the bridge on first render so UserDefaults is
  // updated even if the user never changes themes. Use rAF so styles are fully
  // resolved after page load.
  useEffect(() => {
    requestAnimationFrame(sendCanvasColor);
  }, []);

  const setTheme = (newTheme: ThemeName) => {
    // Remove all existing td-theme-* classes (brio has no class)
    const classes = Array.from(document.body.classList);
    for (const cls of classes) {
      if (cls.startsWith(THEME_CLASS_PREFIX)) {
        document.body.classList.remove(cls);
      }
    }
    // Apply new theme class (brio → no class)
    if (newTheme !== "brio") {
      document.body.classList.add(`${THEME_CLASS_PREFIX}${newTheme}`);
    }
    // Persist to localStorage
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // localStorage may be unavailable in some contexts
    }
    // Sync canvas color to Swift bridge so the window background and UserDefaults update.
    // Called synchronously — the body class change above is already applied, and
    // getComputedStyle forces style recalculation, so the new color is available now.
    sendCanvasColor();
    // Dispatch event on document so dock.ts, terminal-card, and other
    // vanilla TS listeners (which all use document) stay in sync.
    document.dispatchEvent(new CustomEvent("td-theme-change", { detail: { theme: newTheme } }));
    setThemeState(newTheme);
  };

  return [theme, setTheme];
}
