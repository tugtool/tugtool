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

/** Post the current theme name to the Swift bridge so UserDefaults stays in sync. */
function postThemeToBridge(themeName: ThemeName): void {
  (window as any).webkit?.messageHandlers?.setTheme?.postMessage({ theme: themeName });
}

export function useTheme(): [ThemeName, (theme: ThemeName) => void] {
  const [theme, setThemeState] = useState<ThemeName>(readCurrentTheme);

  // Sync with external theme changes (e.g. from dock.ts or other React components).
  // Vanilla code dispatches "td-theme-change" on document.
  useEffect(() => {
    const handleThemeChange = () => {
      setThemeState(readCurrentTheme());
    };
    document.addEventListener("td-theme-change", handleThemeChange);
    return () => {
      document.removeEventListener("td-theme-change", handleThemeChange);
    };
  }, []);

  // Post initial theme to the bridge on first render so UserDefaults is updated
  // even if the user never changes themes (covers the case where localStorage has
  // a theme but UserDefaults does not, e.g. after first upgrade).
  useEffect(() => {
    postThemeToBridge(readCurrentTheme());
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
    // Sync theme to Swift bridge so the window background and UserDefaults update.
    postThemeToBridge(newTheme);
    // Dispatch event on document so dock.ts, terminal-card, and other
    // vanilla TS listeners (which all use document) stay in sync.
    document.dispatchEvent(new CustomEvent("td-theme-change", { detail: { theme: newTheme } }));
    setThemeState(newTheme);
  };

  return [theme, setTheme];
}
