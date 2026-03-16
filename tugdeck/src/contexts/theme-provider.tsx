/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: stylesheet injection (not body classes).
 *
 * Brio is the sole theme; its palette is defined as body {} defaults in
 * tug-base.css. The theme provider maintains context for future extensibility.
 *
 * Spec S02 (#s02-injection-contract), Spec S03 (#s03-theme-provider),
 * [D03] Stylesheet injection, [D08] TugThemeProvider
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { putTheme } from "../settings-api";
import { registerThemeSetter } from "../action-dispatch";
import { canvasColorHex } from "../canvas-color";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeName = "brio";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  dynamicThemeName: string | null;
  setDynamicTheme: (name: string) => void;
  revertToBuiltIn: () => void;
}

// ---------------------------------------------------------------------------
// Theme CSS map
// ---------------------------------------------------------------------------

/** CSS string for each non-Brio theme. Brio uses tug-base.css defaults. */
const themeCSSMap: Record<ThemeName, string | null> = {
  brio: null,
};

// ---------------------------------------------------------------------------
// Stylesheet injection helpers
// ---------------------------------------------------------------------------

const OVERRIDE_ELEMENT_ID = "tug-theme-override";

/**
 * Inject or replace the theme override stylesheet.
 *
 * Creates (or reuses) a <style id="tug-theme-override" data-theme="...">
 * element appended as the last child of <head>. This position guarantees
 * the injected styles win in CSS cascade order over tug-base.css.
 */
export function injectThemeCSS(themeName: string, cssText: string): void {
  let el = document.getElementById(OVERRIDE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = OVERRIDE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.setAttribute("data-theme", themeName);
  el.textContent = cssText;
}

/**
 * Remove the theme override stylesheet.
 *
 * After removal, tug-base.css body {} defaults (Brio) take over automatically
 * via CSS cascade — no additional style recalculation is needed.
 */
export function removeThemeCSS(): void {
  const el = document.getElementById(OVERRIDE_ELEMENT_ID);
  if (el) {
    el.remove();
  }
}

// ---------------------------------------------------------------------------
// Swift bridge helpers (copied verbatim from use-theme.ts)
// ---------------------------------------------------------------------------

/**
 * Post the canvas background hex to the Swift bridge.
 *
 * Computes the hex from the palette engine's TugColor constants — same source
 * of truth as PostCSS and tug-palette.css. No getComputedStyle, no browser
 * color format parsing, no drift.
 */
export function sendCanvasColor(theme: ThemeName): void {
  const hex = canvasColorHex(theme);
  (window as unknown as { webkit?: { messageHandlers?: { setTheme?: { postMessage: (v: unknown) => void } } } })
    .webkit?.messageHandlers?.setTheme?.postMessage({ color: hex });
}

// ---------------------------------------------------------------------------
// applyInitialTheme — called by main.tsx before React mounts
// ---------------------------------------------------------------------------

/**
 * Apply the initial theme via stylesheet injection before React mounts.
 *
 * For Brio (the only theme), this is a no-op (tug-base.css defaults are
 * already active).
 */
export function applyInitialTheme(themeName: ThemeName): void {
  const cssText = themeCSSMap[themeName];
  if (cssText) {
    injectThemeCSS(themeName, cssText);
  }
}

// ---------------------------------------------------------------------------
// Dynamic theme persistence key
// ---------------------------------------------------------------------------

const DYNAMIC_THEME_KEY = "td-dynamic-theme";

// ---------------------------------------------------------------------------
// loadSavedThemes — query middleware for available saved themes
// ---------------------------------------------------------------------------

/**
 * Fetch the list of saved dynamic themes from the Vite dev middleware.
 * Returns an empty array if the endpoint is unavailable (e.g. in production).
 */
export async function loadSavedThemes(): Promise<string[]> {
  try {
    const res = await fetch("/__themes/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { themes?: string[] };
    return Array.isArray(data.themes) ? data.themes : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ThemeContext
// ---------------------------------------------------------------------------

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ---------------------------------------------------------------------------
// TugThemeProvider
// ---------------------------------------------------------------------------

/**
 * React context provider for theme state and stylesheet injection.
 *
 * On mount, applies `initialTheme` if it is non-Brio. Exposes `theme` and
 * `setTheme` via React context. Registers a stable setter wrapper with
 * the action-dispatch system so the set-theme control frame can update the
 * theme from the Mac menu.
 */
export function TugThemeProvider({
  children,
  initialTheme = "brio",
}: {
  children?: React.ReactNode;
  initialTheme?: ThemeName;
}): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemeName>(initialTheme);

  // Dynamic theme state — tracks the active saved theme name without widening ThemeName.
  // null means no dynamic theme is active (built-in theme is used). [D07]
  const [dynamicThemeName, setDynamicThemeName] = useState<string | null>(null);

  // Stable ref always pointing at the latest setTheme function.
  // The action-dispatch handler captures this ref once on mount and reads
  // the current value on every call, preventing stale closures.
  const setThemeRef = useRef<(t: ThemeName) => void>(() => {});

  const setTheme = (newTheme: ThemeName): void => {
    const cssText = themeCSSMap[newTheme];
    if (cssText) {
      injectThemeCSS(newTheme, cssText);
    } else {
      // Brio: remove override so tug-base.css defaults take over
      removeThemeCSS();
    }
    setThemeState(newTheme);
    try {
      localStorage.setItem("td-theme", newTheme);
    } catch {
      // localStorage may be unavailable in some contexts
    }
    putTheme(newTheme);
    // Sync canvas color to Swift bridge after injection
    sendCanvasColor(newTheme);
  };

  /**
   * Activate a saved dynamic theme by name.
   * Fetches resolved CSS from /styles/themes/<name>.css, injects it via DOM
   * (not React state — Rules of Tugways [D08, D09]), persists to localStorage.
   * Does not touch themeCSSMap, sendCanvasColor(), or putTheme().
   */
  const setDynamicTheme = useCallback(async (name: string): Promise<void> => {
    try {
      const res = await fetch(`/styles/themes/${encodeURIComponent(name)}.css`);
      if (!res.ok) return;
      const css = await res.text();
      injectThemeCSS(name, css);
      setDynamicThemeName(name);
      try {
        localStorage.setItem(DYNAMIC_THEME_KEY, name);
      } catch {
        // localStorage may be unavailable
      }
    } catch {
      // Network error — silently ignore
    }
  }, []);

  /**
   * Revert to the built-in theme by removing the dynamic theme override.
   * Removes the injected stylesheet and clears the localStorage entry.
   */
  const revertToBuiltIn = useCallback((): void => {
    removeThemeCSS();
    setDynamicThemeName(null);
    try {
      localStorage.removeItem(DYNAMIC_THEME_KEY);
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  // Keep ref current on every render so the stable wrapper always calls the latest setter.
  useEffect(() => {
    setThemeRef.current = setTheme;
  });

  // On mount: check localStorage for a saved dynamic theme and re-apply it.
  // Dynamic theme check runs before built-in theme check (td-theme). [D04]
  useEffect(() => {
    try {
      const savedDynamic = localStorage.getItem(DYNAMIC_THEME_KEY);
      if (savedDynamic) {
        void setDynamicTheme(savedDynamic);
        return;
      }
    } catch {
      // localStorage may be unavailable
    }
    // Apply initial theme on mount. Brio is always active via tug-base.css defaults.
    // Sync canvas color to Swift bridge on mount.
    sendCanvasColor(initialTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register a stable wrapper with the action-dispatch system once on mount.
  // The wrapper reads from setThemeRef so it always calls the latest setter.
  useEffect(() => {
    registerThemeSetter((themeName: string) => {
      setThemeRef.current(themeName as ThemeName);
    });
  }, []);

  return React.createElement(
    ThemeContext.Provider,
    { value: { theme, setTheme, dynamicThemeName, setDynamicTheme, revertToBuiltIn } },
    children
  );
}

// ---------------------------------------------------------------------------
// useThemeContext hook
// ---------------------------------------------------------------------------

/**
 * Hook to access the current theme name and setter from TugThemeProvider.
 * Must be used within a TugThemeProvider tree.
 */
export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within a TugThemeProvider");
  }
  return ctx;
}
