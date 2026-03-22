/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: stylesheet injection (not body classes).
 *
 * Built-in themes:
 *   - brio    (default dark)  — palette defined as body {} defaults in tug-base.css.
 *                               No override stylesheet needed.
 *   - harmony (built-in light) — full 373-token override file at /styles/themes/harmony.css.
 *                               Pre-fetched in main.tsx before React mounts via
 *                               registerThemeCSS(). [D07]
 *
 * With ThemeName widened to `string`, dynamically-loaded themes are handled identically
 * to built-in non-brio themes: their CSS is fetched via GET /__themes/<name>.css and
 * injected via injectThemeCSS(). The built-in vs. dynamic distinction is removed. [D07][D11]
 *
 * Spec S02 (#s02-injection-contract), Spec S03 (#s03-theme-provider),
 * [D03] Brio is the base theme, [D07] Dynamic theme loading through middleware,
 * [D11] Remove Bluenote
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from "react";
import { putTheme } from "../settings-api";
import { registerThemeSetter } from "../action-dispatch";
import { canvasColorHex } from "../canvas-color";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Theme name — widened to string to support dynamically-loaded themes. [D07] */
export type ThemeName = string;

interface ThemeContextValue {
  theme: string;
  setTheme: (theme: string) => void;
}

// ---------------------------------------------------------------------------
// Theme CSS map
// ---------------------------------------------------------------------------

/**
 * Cache of pre-fetched or previously-fetched CSS strings keyed by theme name.
 * - brio:    null — uses tug-base.css body {} defaults; no override needed.
 * - harmony: null until populated by registerThemeCSS() in main.tsx before mount. [D07]
 * - dynamic: null until fetched on first setTheme() call for that name.
 */
const themeCSSMap = new Map<string, string | null>();
themeCSSMap.set("brio", null);

/**
 * Populate a theme's CSS before applyInitialTheme() is called.
 *
 * Called from main.tsx's async IIFE after a theme CSS fetch resolves.
 * Must be called before applyInitialTheme() and before React mounts so that
 * the initial theme injection is synchronous. [D07]
 */
export function registerThemeCSS(name: string, css: string): void {
  themeCSSMap.set(name, css);
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

// ---------------------------------------------------------------------------
// Swift bridge helpers
// ---------------------------------------------------------------------------

/**
 * Post the canvas background hex to the Swift bridge.
 *
 * Computes the hex from the palette engine's TugColor constants — same source
 * of truth as PostCSS and tug-palette.css. No getComputedStyle, no browser
 * color format parsing, no drift.
 *
 * If the theme name is not present in CANVAS_COLORS (e.g. a dynamically-loaded
 * theme), logs a warning and skips the bridge call rather than crashing.
 * Step 10 replaces this entire function with runtime derivation. [D07]
 */
export function sendCanvasColor(theme: string): void {
  const hex = canvasColorHex(theme);
  if (hex === null) {
    console.warn(`sendCanvasColor: no canvas color for theme "${theme}", skipping bridge call`);
    return;
  }
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
 * For harmony and other pre-fetched themes, injects the CSS from themeCSSMap when non-null. [D07]
 */
export function applyInitialTheme(themeName: string): void {
  const cssText = themeCSSMap.get(themeName);
  if (cssText) {
    injectThemeCSS(themeName, cssText);
  }
}

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
const BUILT_IN_THEME_NAMES: ReadonlySet<string> = new Set<string>(["brio", "harmony"]);

/**
 * Fetch the list of saved dynamic themes from the Vite dev middleware.
 * Returns an empty array if the endpoint is unavailable (e.g. in production).
 * Filters out built-in theme names so harmony.css does not appear as both
 * a built-in preset and a user-saved theme.
 *
 * Parses the new middleware response format: { themes: [{ name, recipe, source }] }
 * [D07][D08]
 */
export async function loadSavedThemes(): Promise<string[]> {
  try {
    const res = await fetch("/__themes/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { themes?: unknown[] };
    if (!Array.isArray(data.themes)) return [];
    const names: string[] = [];
    for (const entry of data.themes) {
      if (typeof entry === "string") {
        // Legacy format: string[] — still accept for backward compat
        if (!BUILT_IN_THEME_NAMES.has(entry)) names.push(entry);
      } else if (entry !== null && typeof entry === "object") {
        // New format: { name, recipe, source }
        const name = (entry as Record<string, unknown>).name;
        if (typeof name === "string" && !BUILT_IN_THEME_NAMES.has(name)) {
          names.push(name);
        }
      }
    }
    return names;
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
 *
 * The `setTheme` implementation:
 *   - brio: removes the override stylesheet so tug-base.css defaults take over.
 *   - all others: fetches CSS via GET /__themes/<name>.css and injects it.
 *     On 404, logs a warning and does not change the active theme. [D07]
 */
export function TugThemeProvider({
  children,
  initialTheme = "brio",
}: {
  children?: React.ReactNode;
  initialTheme?: string;
}): React.JSX.Element {
  const [theme, setThemeState] = useState<string>(initialTheme);

  // Stable ref always pointing at the latest setTheme function.
  // The action-dispatch handler captures this ref once on mount and reads
  // the current value on every call, preventing stale closures.
  const setThemeRef = useRef<(t: string) => void>(() => {});

  const setTheme = (newTheme: string): void => {
    if (newTheme === "brio") {
      // brio: remove override so tug-base.css defaults take over
      removeThemeCSS();
      setThemeState(newTheme);
      try { localStorage.setItem("td-theme", newTheme); } catch { /* unavailable */ }
      putTheme(newTheme);
      sendCanvasColor(newTheme);
    } else {
      const cached = themeCSSMap.get(newTheme);
      if (cached !== undefined) {
        // CSS already fetched (or null sentinel for brio — handled above)
        if (cached !== null) {
          injectThemeCSS(newTheme, cached);
        }
        setThemeState(newTheme);
        try { localStorage.setItem("td-theme", newTheme); } catch { /* unavailable */ }
        putTheme(newTheme);
        sendCanvasColor(newTheme);
      } else {
        // Fetch CSS from middleware, then inject
        void fetch(`/__themes/${encodeURIComponent(newTheme)}.css`)
          .then((res) => {
            if (!res.ok) {
              console.warn(`setTheme: theme "${newTheme}" not found (${res.status}), not changing theme`);
              return;
            }
            return res.text().then((css) => {
              themeCSSMap.set(newTheme, css);
              injectThemeCSS(newTheme, css);
              setThemeState(newTheme);
              try { localStorage.setItem("td-theme", newTheme); } catch { /* unavailable */ }
              putTheme(newTheme);
              sendCanvasColor(newTheme);
            });
          })
          .catch((err: unknown) => {
            console.warn(`setTheme: failed to fetch CSS for theme "${newTheme}"`, err);
          });
      }
    }
  };

  // Keep ref current on every render so the stable wrapper always calls the latest setter.
  useEffect(() => {
    setThemeRef.current = setTheme;
  });

  // On mount: apply the initial theme's CSS if it is already in the map.
  // Sync canvas color to Swift bridge on mount.
  useEffect(() => {
    // Apply initial theme on mount. Brio is always active via tug-base.css defaults.
    // Sync canvas color to Swift bridge on mount.
    sendCanvasColor(initialTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register a stable wrapper with the action-dispatch system once on mount.
  // The wrapper reads from setThemeRef so it always calls the latest setter.
  useEffect(() => {
    registerThemeSetter((themeName: string) => {
      setThemeRef.current(themeName);
    });
  }, []);

  return React.createElement(
    ThemeContext.Provider,
    { value: { theme, setTheme } },
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
