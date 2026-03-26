/**
 * TugThemeProvider — React context provider for the Tugways theme system.
 *
 * Architecture: direct file load (not base+override cascade).
 *
 * Dev mode: Theme switching posts to POST /__themes/activate, which copies the
 * selected theme's complete CSS into tug-active-theme.css through Vite's CSS
 * pipeline so PostCSS expands all --tug-color() tokens correctly. Brio copies
 * tug-base-generated.css; all other themes copy their own CSS file. The active
 * theme file is always complete; it is never empty.
 *
 * Production mode: Theme switching swaps a <link id="tug-theme-override">
 * element pointing to the pre-built per-theme CSS asset. Host canvas color
 * is read from CSS metadata token --tugx-host-canvas-color after the override
 * stylesheet is applied. [D08]
 *
 * Spec S01 (#settheme-flow), [D03] Direct load, [D04] Dual persistence,
 * Spec S03 (#s03-theme-provider), [D08] Production link swap
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

function normalizeColorToHex(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const hex6 = value.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return `#${hex6[1]}`;
  const hex3 = value.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgb = value.match(/^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$/);
  if (!rgb) return null;
  const nums = [rgb[1], rgb[2], rgb[3]].map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return `#${nums.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function readHostCanvasColorFromAppliedCss(): string | null {
  const fromBody = getComputedStyle(document.body).getPropertyValue("--tugx-host-canvas-color");
  const normalizedBody = normalizeColorToHex(fromBody);
  if (normalizedBody) return normalizedBody;
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue("--tugx-host-canvas-color");
  return normalizeColorToHex(fromRoot);
}

/** Post a normalized canvas background hex string to the Swift bridge. */
export function sendCanvasColor(hex: string): void {
  const normalized = normalizeColorToHex(hex);
  if (!normalized) return;
  (window as unknown as { webkit?: { messageHandlers?: { setTheme?: { postMessage: (v: unknown) => void } } } })
    .webkit?.messageHandlers?.setTheme?.postMessage({ color: normalized });
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
export async function activateProductionTheme(themeName: string): Promise<string | null> {
  const LINK_ID = "tug-theme-override";
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;

  if (themeName === BASE_THEME_NAME) {
    // Base theme tokens take over — remove the override link if present.
    if (existing) {
      existing.remove();
    }
    return readHostCanvasColorFromAppliedCss();
  }

  const href = `/assets/themes/${themeName}.css`;
  const targetHref = new URL(href, window.location.href).href;
  const link = existing ?? document.createElement("link");
  if (!existing) {
    link.id = LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== targetHref) {
    await new Promise<void>((resolve, reject) => {
      const onLoad = () => {
        link.removeEventListener("load", onLoad);
        link.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        link.removeEventListener("load", onLoad);
        link.removeEventListener("error", onError);
        reject(new Error(`Failed to load production theme CSS: ${href}`));
      };
      link.addEventListener("load", onLoad);
      link.addEventListener("error", onError);
      link.href = href;
    }).catch((err: unknown) => {
      console.warn("activateProductionTheme failed", err);
    });
  }
  return readHostCanvasColorFromAppliedCss();
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
 * theme name. The server copies the theme's complete CSS into tug-active-theme.css
 * and returns { theme, hostCanvasColor }. On success: calls sendCanvasColor(hostCanvasColor),
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
      // Production: swap <link> element and read host color from applied CSS. [D08]
      void activateProductionTheme(newTheme).then((hostCanvasColor) => {
        if (hostCanvasColor) {
          sendCanvasColor(hostCanvasColor);
        }
        setThemeState(newTheme);
        try { localStorage.setItem("td-theme", newTheme); } catch { /* unavailable */ }
        putTheme(newTheme);
      });
      return;
    }

    // Dev: POST to activate endpoint — copies active theme into tug-active-theme.css via HMR. [D03]
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
          const result = data as { theme?: string; hostCanvasColor?: string };
          if (typeof result.hostCanvasColor === "string") {
            sendCanvasColor(result.hostCanvasColor);
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
