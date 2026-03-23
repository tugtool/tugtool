/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: file-based override (not DOM injection).
 *
 * Dev mode: Theme switching posts to POST /__themes/activate, which rewrites
 * tug-theme-override.css through Vite's CSS pipeline so PostCSS expands all
 * --tug-color() tokens correctly. Brio uses an empty override file; all other
 * themes write their full CSS into the override file.
 *
 * Production mode: Theme switching swaps a <link id="tug-theme-override">
 * element pointing to the pre-built per-theme CSS asset. Canvas params come
 * from the static THEME_CANVAS_PARAMS map generated at build time. [D08]
 *
 * Spec S01 (#settheme-flow), [D01] Single override file, [D03] Activate endpoint,
 * [D04] Dual persistence, Spec S03 (#s03-theme-provider), [D08] Production link swap
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
import { canvasColorHex, type CanvasColorParams } from "../canvas-color";
import { deriveTheme, type ThemeSpec } from "../components/tugways/theme-engine";
import { THEME_CANVAS_PARAMS } from "../generated/theme-canvas-params";
import { BASE_THEME_NAME } from "../theme-constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Theme name — widened to string to support dynamically-loaded themes. */
export type ThemeName = string;

interface ThemeContextValue {
  theme: string;
  setTheme: (theme: string) => void;
}

// ---------------------------------------------------------------------------
// Initial canvas params cache
// ---------------------------------------------------------------------------

/**
 * Pre-derived canvas params for the initial theme at startup.
 * Set by main.tsx (via registerInitialCanvasParams) after running deriveTheme()
 * on the initial theme's recipe. Read by TugThemeProvider's on-mount effect
 * to sync the Swift bridge with the correct canvas color. [D08]
 */
let initialCanvasParams: CanvasColorParams | null = null;

/**
 * Store pre-derived canvas params for the initial theme.
 *
 * Called from main.tsx before React mounts, after deriveTheme() has been run
 * on the initial theme's recipe. The params are consumed by the on-mount
 * useEffect in TugThemeProvider to send the initial canvas color to Swift. [D08]
 */
export function registerInitialCanvasParams(params: CanvasColorParams): void {
  initialCanvasParams = params;
}

// ---------------------------------------------------------------------------
// Swift bridge helpers
// ---------------------------------------------------------------------------

/**
 * Post the canvas background hex to the Swift bridge.
 *
 * Accepts pre-derived canvas params from ThemeOutput.formulas. The caller is
 * responsible for running deriveTheme() and extracting:
 *   - hue:       recipe.surface.canvas.hue (resolved via formulas.surfaceCanvasHueSlot)
 *   - tone:      themeOutput.formulas.surfaceCanvasTone
 *   - intensity: themeOutput.formulas.surfaceCanvasIntensity (DERIVED, not raw JSON)
 *
 * Uses the same TugColor → oklch → hex pipeline as PostCSS and tug-palette.css.
 * No getComputedStyle, no browser color format parsing, no drift. [D08]
 */
export function sendCanvasColor(params: CanvasColorParams): void {
  const hex = canvasColorHex(params);
  (window as unknown as { webkit?: { messageHandlers?: { setTheme?: { postMessage: (v: unknown) => void } } } })
    .webkit?.messageHandlers?.setTheme?.postMessage({ color: hex });
}

/**
 * Derive canvas color params from a ThemeSpec.
 *
 * Runs deriveTheme() and extracts:
 *   - hue:       recipe.surface.canvas.hue (the surfaceCanvasHueSlot is always "canvas")
 *   - tone:      themeOutput.formulas.surfaceCanvasTone
 *   - intensity: themeOutput.formulas.surfaceCanvasIntensity (DERIVED value)
 *
 * [D08] Canvas color derived from theme JSON at runtime, Spec S04.
 */
export function deriveCanvasParams(spec: ThemeSpec): CanvasColorParams {
  const themeOutput = deriveTheme(spec);
  return {
    hue: spec.surface.canvas.hue,
    tone: themeOutput.formulas.surfaceCanvasTone,
    intensity: themeOutput.formulas.surfaceCanvasIntensity,
  };
}

// ---------------------------------------------------------------------------
// activateProductionTheme — production <link> swap [D08]
// ---------------------------------------------------------------------------

/**
 * Swap a `<link id="tug-theme-override">` element to activate a theme in
 * production mode (no Vite dev server, no POST /__themes/activate).
 *
 * - For the base theme: removes the link element if present (base theme tokens are the CSS foundation).
 * - For non-base themes: sets href to `/assets/themes/<name>.css`, creating the
 *   element if it does not already exist.
 *
 * [D08] Production link swap, Spec S03 (#s03-production-link).
 */
export function activateProductionTheme(themeName: string): void {
  const LINK_ID = "tug-theme-override";
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;

  if (themeName === BASE_THEME_NAME) {
    // Base theme tokens take over — remove the override link if present.
    if (existing) {
      existing.remove();
    }
    return;
  }

  const href = `/assets/themes/${themeName}.css`;
  if (existing) {
    existing.href = href;
  } else {
    const link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}

// ---------------------------------------------------------------------------
// loadSavedThemes — query middleware for available saved themes
// ---------------------------------------------------------------------------

/**
 * Fetch the list of saved dynamic themes from the Vite dev middleware.
 * Returns an empty array if the endpoint is unavailable (e.g. in production).
 * Filters out shipped themes (source: "shipped") so they do not appear as
 * user-saved themes in the Theme Generator dropdown.
 *
 * Parses the middleware response format: { themes: [{ name, mode, source }] }
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
        // Legacy format: string[] — cannot determine source, skip (shipped themes only in legacy)
        // Nothing to push; legacy string entries are all shipped themes.
      } else if (entry !== null && typeof entry === "object") {
        // New format: { name, mode, source }
        const e = entry as Record<string, unknown>;
        const name = e.name;
        const source = e.source;
        if (typeof name === "string" && source === "authored") {
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
 * React context provider for theme state.
 *
 * Exposes `theme` and `setTheme` via React context. Registers a stable setter
 * wrapper with the action-dispatch system so the set-theme control frame can
 * update the theme from the Mac menu.
 *
 * The `setTheme` implementation posts to POST /__themes/activate with the new
 * theme name. The server rewrites tug-theme-override.css and returns
 * { theme, canvasParams }. On success: calls sendCanvasColor(canvasParams),
 * updates React state, persists to localStorage, and calls putTheme(). [D03]
 */
export function TugThemeProvider({
  children,
  initialTheme = BASE_THEME_NAME,
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
    if (import.meta.env.PROD) {
      // Production: swap <link> element and use static canvas params map. [D08]
      activateProductionTheme(newTheme);
      const canvasParams = THEME_CANVAS_PARAMS[newTheme];
      if (canvasParams) {
        sendCanvasColor(canvasParams);
      }
      setThemeState(newTheme);
      try { localStorage.setItem("td-theme", newTheme); } catch { /* unavailable */ }
      putTheme(newTheme);
      return;
    }

    // Dev: POST to activate endpoint — rewrites tug-theme-override.css via HMR. [D03]
    void fetch("/__themes/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: newTheme }),
    })
      .then((res) => {
        if (!res.ok) {
          console.warn(`setTheme: activate failed for "${newTheme}" (${res.status})`);
          return;
        }
        return res.json().then((data: unknown) => {
          const result = data as { theme?: string; canvasParams?: CanvasColorParams };
          if (result.canvasParams) {
            sendCanvasColor(result.canvasParams);
          }
          setThemeState(newTheme);
          try { localStorage.setItem("td-theme", newTheme); } catch { /* unavailable */ }
          putTheme(newTheme);
        });
      })
      .catch((err: unknown) => {
        console.warn(`setTheme: activate request failed for "${newTheme}"`, err);
      });
  };

  // Keep ref current on every render so the stable wrapper always calls the latest setter.
  useEffect(() => {
    setThemeRef.current = setTheme;
  });

  // On mount: sync canvas color to Swift bridge using pre-derived params registered
  // by main.tsx before React mounted. If params are unavailable (e.g. in tests),
  // skip the bridge call gracefully. [D08]
  useEffect(() => {
    if (initialCanvasParams !== null) {
      sendCanvasColor(initialCanvasParams);
    }
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
