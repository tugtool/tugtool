/**
 * useTheme — React hook that reads and sets the current Tuglook theme.
 *
 * Reads the active theme from document.body class list (one of "theme-brio",
 * "theme-bluenote", "theme-harmony") and provides a setter that updates both
 * localStorage and the body class, matching the vanilla TS applyTheme behavior.
 */

import { useState, useEffect } from "react";

export type ThemeName = "brio" | "bluenote" | "harmony";

const THEME_CLASS_PREFIX = "theme-";
const THEME_STORAGE_KEY = "tugdeck-theme";
const DEFAULT_THEME: ThemeName = "brio";

function readCurrentTheme(): ThemeName {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const classes = Array.from(document.body.classList);
  for (const cls of classes) {
    if (cls.startsWith(THEME_CLASS_PREFIX)) {
      return cls.slice(THEME_CLASS_PREFIX.length) as ThemeName;
    }
  }
  return DEFAULT_THEME;
}

export function useTheme(): [ThemeName, (theme: ThemeName) => void] {
  const [theme, setThemeState] = useState<ThemeName>(readCurrentTheme);

  // Sync with external theme changes (e.g. from vanilla TS code or other React components)
  useEffect(() => {
    const handleThemeChange = () => {
      setThemeState(readCurrentTheme());
    };
    window.addEventListener("td-theme-change", handleThemeChange);
    return () => {
      window.removeEventListener("td-theme-change", handleThemeChange);
    };
  }, []);

  const setTheme = (newTheme: ThemeName) => {
    // Remove all existing theme classes
    const classes = Array.from(document.body.classList);
    for (const cls of classes) {
      if (cls.startsWith(THEME_CLASS_PREFIX)) {
        document.body.classList.remove(cls);
      }
    }
    // Apply new theme
    document.body.classList.add(`${THEME_CLASS_PREFIX}${newTheme}`);
    // Persist to localStorage
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // localStorage may be unavailable in some contexts
    }
    // Dispatch event so other listeners (vanilla TS, other hooks) stay in sync
    window.dispatchEvent(new CustomEvent("td-theme-change", { detail: { theme: newTheme } }));
    setThemeState(newTheme);
  };

  return [theme, setTheme];
}
