/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: stylesheet injection (not body classes).
 *
 * Built-in themes:
 *   - brio    (default dark)  — palette defined as body {} defaults in tug-base.css.
 *                               themeCSSMap entry is null; no override stylesheet needed.
 *   - harmony (built-in light) — full 373-token override file at /styles/themes/harmony.css.
 *                               Pre-fetched in main.tsx before React mounts via
 *                               registerThemeCSS(). [D07]
 *
 * Spec S02 (#s02-injection-contract), Spec S03 (#s03-theme-provider),
 * [D02] First-class static ThemeName, [D03] Stylesheet injection,
 * [D07] Pre-fetch harmony CSS, [D08] TugThemeProvider
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
import { themeColorSpecToOklch, EXAMPLE_RECIPES } from "../components/tugways/theme-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Built-in theme names. Widened as new permanent themes are added. [D02] */
export type ThemeName = "brio" | "harmony";

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

/**
 * Pre-fetched CSS string for each built-in theme.
 * - brio:    null — uses tug-base.css body {} defaults; no override needed.
 * - harmony: null until populated by registerThemeCSS() in main.tsx before mount. [D07]
 */
const themeCSSMap: Record<ThemeName, string | null> = {
  brio: null,
  harmony: null,
};

/**
 * Populate a built-in theme's CSS before applyInitialTheme() is called.
 *
 * Called from main.tsx's async IIFE after the harmony CSS fetch resolves.
 * Must be called before applyInitialTheme() and before React mounts so that
 * the initial theme injection is synchronous. [D07]
 */
export function registerThemeCSS(name: ThemeName, css: string): void {
  themeCSSMap[name] = css;
}

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

/**
 * Set --tug-canvas-grid-line on document.body for a built-in theme. [D06]
 *
 * Computes the oklch() value from the theme's EXAMPLE_RECIPES.surface.grid spec
 * and sets it imperatively via style.setProperty. This overrides the static
 * fallback in tug-dock.css without touching the token/rule pipeline.
 */
export function setGridLineColor(themeName: ThemeName): void {
  const recipe = EXAMPLE_RECIPES[themeName];
  if (!recipe) return;
  const value = themeColorSpecToOklch(recipe.surface.grid);
  document.body.style.setProperty("--tug-canvas-grid-line", value);
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
 * For brio (the default), this is a no-op — tug-base.css defaults are already active.
 * For harmony, injects the pre-fetched CSS from themeCSSMap when non-null. [D07]
 * Sets --tug-canvas-grid-line on document.body from the theme's grid spec. [D06]
 */
export function applyInitialTheme(themeName: ThemeName): void {
  const cssText = themeCSSMap[themeName];
  if (cssText) {
    injectThemeCSS(themeName, cssText);
  }
  setGridLineColor(themeName);
}

// ---------------------------------------------------------------------------
// Dynamic theme persistence key
// ---------------------------------------------------------------------------

const DYNAMIC_THEME_KEY = "td-dynamic-theme";

// ---------------------------------------------------------------------------
// loadSavedThemes — query middleware for available saved themes
// ---------------------------------------------------------------------------

/**
 * Built-in theme names to exclude from the saved-themes list. [D08]
 * generate-tug-tokens.ts writes harmony.css to styles/themes/, the same
 * directory that handleThemesList reads for user-saved themes. Filtering
 * these names prevents harmony from appearing as both a built-in preset
 * and a user-saved theme in the Theme Generator dropdown.
 */
const BUILT_IN_THEME_NAMES: ReadonlySet<string> = new Set<ThemeName>(["brio", "harmony"]);

/**
 * Fetch the list of saved dynamic themes from the Vite dev middleware.
 * Returns an empty array if the endpoint is unavailable (e.g. in production).
 * Filters out built-in theme names so harmony.css does not appear as both
 * a built-in preset and a user-saved theme. [D08]
 */
export async function loadSavedThemes(): Promise<string[]> {
  try {
    const res = await fetch("/__themes/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { themes?: string[] };
    const themes = Array.isArray(data.themes) ? data.themes : [];
    return themes.filter((name) => !BUILT_IN_THEME_NAMES.has(name));
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
    // Inject or remove the override stylesheet synchronously. [D07]
    const cssText = themeCSSMap[newTheme];
    if (cssText) {
      injectThemeCSS(newTheme, cssText);
    } else {
      // brio: remove override so tug-base.css defaults take over
      removeThemeCSS();
    }
    // Clear any stale dynamic theme so it cannot override the user's built-in
    // selection on next page load (mount-time check reads td-dynamic-theme first).
    // React 19 batches these state updates automatically. [D02]
    setDynamicThemeName(null);
    try {
      localStorage.removeItem(DYNAMIC_THEME_KEY);
    } catch {
      // localStorage may be unavailable
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
    // Set grid line color from the theme's surface.grid spec [D06]
    setGridLineColor(newTheme);
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
   * Revert to the active built-in theme by removing the dynamic theme override.
   *
   * - For brio: remove the override stylesheet so tug-base.css defaults take over.
   * - For harmony: remove the dynamic override and re-inject harmony's CSS from
   *   themeCSSMap so the built-in light theme is restored correctly. [D02]
   *
   * React 19 batches the setDynamicThemeName(null) state update with any parent
   * re-renders, so no intermediate flash occurs.
   */
  const revertToBuiltIn = useCallback((): void => {
    const cssText = themeCSSMap[theme];
    if (cssText) {
      // Non-brio built-in (e.g. harmony): re-inject its CSS after clearing dynamic override.
      injectThemeCSS(theme, cssText);
    } else {
      // Brio: removing the override lets tug-base.css defaults take over.
      removeThemeCSS();
    }
    // Restore grid line color for the reverted built-in theme [D06]
    setGridLineColor(theme);
    setDynamicThemeName(null);
    try {
      localStorage.removeItem(DYNAMIC_THEME_KEY);
    } catch {
      // localStorage may be unavailable
    }
  }, [theme]);

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

/**
 * Hook that returns the theme context value when inside a TugThemeProvider,
 * or null when used outside one. Safe to call in components that may render
 * both inside and outside a TugThemeProvider (e.g. gallery cards in tests).
 */
export function useOptionalThemeContext(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
