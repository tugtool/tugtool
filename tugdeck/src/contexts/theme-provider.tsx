/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: stylesheet injection (not body classes).
 *
 * Brio is the default theme; its palette is defined as body {} defaults in
 * tug-tokens.css. Bluenote and Harmony are applied by injecting a
 * <style id="tug-theme-override" data-theme="..."> element as the last child
 * of <head>, ensuring it cascades over tug-tokens.css. Reverting to Brio removes
 * the element entirely so tug-tokens.css defaults take over.
 *
 * Cascade ordering invariant: the injected <style> is always appended as the
 * last child of <head>. Never insert it elsewhere — earlier position could
 * lose to tug-tokens.css in the cascade.
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
import { putTheme } from "../settings-api";
import { registerThemeSetter } from "../action-dispatch";
import { canvasColorHex } from "../canvas-color";
import bluenoteCSS from "../../styles/bluenote.css?inline";
import harmonyCSS from "../../styles/harmony.css?inline";

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

/** CSS string for each non-Brio theme. Brio uses tug-tokens.css defaults. */
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
 * the injected styles win in CSS cascade order over tug-tokens.css.
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
 * After removal, tug-tokens.css body {} defaults (Brio) take over automatically
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
 * Computes the hex from the palette engine's CITA constants — same source
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
 * For Brio, this is a no-op (tug-tokens.css defaults are already active).
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
      // Brio: remove override so tug-tokens.css defaults take over
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
