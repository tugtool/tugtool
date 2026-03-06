/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: stylesheet injection (not body classes).
 *
 * Brio is the default theme; its palette is defined as body {} defaults in
 * tokens.css. Bluenote and Harmony are applied by injecting a
 * <style id="tug-theme-override" data-theme="..."> element as the last child
 * of <head>, ensuring it cascades over tokens.css. Reverting to Brio removes
 * the element entirely so tokens.css defaults take over.
 *
 * Cascade ordering invariant: the injected <style> is always appended as the
 * last child of <head>. Never insert it elsewhere — earlier position could
 * lose to tokens.css in the cascade.
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
} from "react";
import { postSettings } from "../settings-api";
import { registerThemeSetter } from "../action-dispatch";
import { injectPaletteCSS } from "../components/tugways/palette-engine";
import bluenoteCSS from "../../styles/bluenote.css?raw";
import harmonyCSS from "../../styles/harmony.css?raw";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeName = "brio" | "bluenote" | "harmony";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

// ---------------------------------------------------------------------------
// Theme CSS map
// ---------------------------------------------------------------------------

/** CSS string for each non-Brio theme. Brio uses tokens.css defaults. */
const themeCSSMap: Record<ThemeName, string | null> = {
  brio: null,
  bluenote: bluenoteCSS,
  harmony: harmonyCSS,
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
 * the injected styles win in CSS cascade order over tokens.css.
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
 * After removal, tokens.css body {} defaults (Brio) take over automatically
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

/** Convert a CSS color value (hex or rgb()) to a 6-digit hex string. */
export function normalizeToHex(css: string): string | null {
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
export function sendCanvasColor(): void {
  const raw = getComputedStyle(document.body).getPropertyValue("background-color");
  const hex = normalizeToHex(raw);
  if (hex) {
    (window as unknown as { webkit?: { messageHandlers?: { setTheme?: { postMessage: (v: unknown) => void } } } })
      .webkit?.messageHandlers?.setTheme?.postMessage({ color: hex });
  }
}

// ---------------------------------------------------------------------------
// applyInitialTheme — called by main.tsx before React mounts
// ---------------------------------------------------------------------------

/**
 * Apply the initial theme via stylesheet injection before React mounts.
 *
 * For Brio, this is a no-op (tokens.css defaults are already active).
 * For Bluenote or Harmony, injects the theme's CSS string as the override
 * element so the correct colors are visible before the first React render.
 */
export function applyInitialTheme(themeName: ThemeName): void {
  const cssText = themeCSSMap[themeName];
  if (cssText) {
    injectThemeCSS(themeName, cssText);
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

  // Stable ref always pointing at the latest setTheme function.
  // The action-dispatch handler captures this ref once on mount and reads
  // the current value on every call, preventing stale closures.
  const setThemeRef = useRef<(t: ThemeName) => void>(() => {});

  const setTheme = (newTheme: ThemeName): void => {
    const cssText = themeCSSMap[newTheme];
    if (cssText) {
      injectThemeCSS(newTheme, cssText);
    } else {
      // Brio: remove override so tokens.css defaults take over
      removeThemeCSS();
    }
    // Re-inject palette CSS after theme injection so any theme parameter
    // overrides (--tug-theme-lc-*, --tug-theme-hue-*) are in the DOM when
    // getComputedStyle reads them. [D04]
    injectPaletteCSS(newTheme);
    setThemeState(newTheme);
    try {
      localStorage.setItem("td-theme", newTheme);
    } catch {
      // localStorage may be unavailable in some contexts
    }
    postSettings({ theme: newTheme });
    // Sync canvas color to Swift bridge after injection (styles are resolved synchronously)
    sendCanvasColor();
  };

  // Keep ref current on every render so the stable wrapper always calls the latest setter.
  useEffect(() => {
    setThemeRef.current = setTheme;
  });

  // Apply initial theme on mount (main.tsx may have already injected it before
  // React mounted; this is idempotent — injectThemeCSS replaces in-place).
  useEffect(() => {
    if (initialTheme !== "brio") {
      const cssText = themeCSSMap[initialTheme];
      if (cssText) {
        injectThemeCSS(initialTheme, cssText);
      }
    }
    // Sync canvas color to Swift bridge after initial injection.
    sendCanvasColor();
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
