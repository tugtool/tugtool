/**
 * theme-export-import tests.
 *
 * Tests cover:
 * - T9.3: Exported recipe JSON round-trips: export -> import -> re-export produces identical JSON
 * - T9.4: Invalid JSON import shows error, does not crash (validateRecipeJson)
 * - T9.4: Migration: old-format recipe → new format
 * - TugThemeProvider dynamic theme tests (setDynamicTheme, localStorage, revert)
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import {
  GalleryThemeGeneratorContent,
  validateRecipeJson,
} from "@/components/tugways/cards/gallery-theme-generator-content";
import { deriveTheme, EXAMPLE_RECIPES } from "@/components/tugways/theme-engine";
import { _resetForTest } from "@/card-registry";
import {
  TugThemeProvider,
  injectThemeCSS,
  removeThemeCSS,
  loadSavedThemes,
  useThemeContext,
} from "@/contexts/theme-provider";

// ---------------------------------------------------------------------------
// T9.3: Exported recipe JSON round-trips
// ---------------------------------------------------------------------------

describe("theme-import – T9.3: recipe JSON round-trips", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("JSON.stringify(recipe) -> JSON.parse -> JSON.stringify produces identical JSON", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const json1 = JSON.stringify(recipe, null, 2);
    const parsed = JSON.parse(json1) as typeof recipe;
    const json2 = JSON.stringify(parsed, null, 2);
    expect(json1).toBe(json2);
  });

  it("import brio recipe: re-exported JSON matches original", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const exported = JSON.stringify(recipe, null, 2);
    const reimported = JSON.parse(exported);
    const reexported = JSON.stringify(reimported, null, 2);
    expect(exported).toBe(reexported);
  });

  it("validateRecipeJson accepts a valid brio recipe", () => {
    expect(validateRecipeJson(EXAMPLE_RECIPES.brio)).toBeNull();
  });

  it("re-deriving brio recipe after round-trip produces same token count", () => {
    const recipe = EXAMPLE_RECIPES.brio;
    const json = JSON.stringify(recipe, null, 2);
    const roundTripped = JSON.parse(json);
    const output1 = deriveTheme(recipe);
    const output2 = deriveTheme(roundTripped);
    expect(Object.keys(output1.tokens).length).toBe(Object.keys(output2.tokens).length);
  });
});

// ---------------------------------------------------------------------------
// T9.4: Invalid JSON import shows error, does not crash
// ---------------------------------------------------------------------------

describe("theme-import – T9.4: invalid JSON import shows error, does not crash", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("validateRecipeJson returns error for null", () => {
    expect(validateRecipeJson(null)).not.toBeNull();
  });

  it("validateRecipeJson returns error for a string (not object)", () => {
    expect(validateRecipeJson("not an object")).not.toBeNull();
  });

  it("validateRecipeJson returns error for an array", () => {
    expect(validateRecipeJson([])).not.toBeNull();
  });

  it("validateRecipeJson returns error for empty object", () => {
    expect(validateRecipeJson({})).not.toBeNull();
  });

  it("validateRecipeJson returns error for wrong recipe ('sepia')", () => {
    const bad = { name: "X", description: "Test.", recipe: "sepia", surface: { canvas: "red", card: "red" }, element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for missing name", () => {
    const bad = { recipe: "dark", surface: { canvas: "red", card: "red" }, element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson returns error for missing surface group", () => {
    const bad = { name: "X", description: "Test.", recipe: "dark", element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } };
    expect(validateRecipeJson(bad)).not.toBeNull();
  });

  it("validateRecipeJson migrates old-format recipe without element group", () => {
    const recipe: Record<string, unknown> = { name: "X", description: "Test.", recipe: "dark", surface: { canvas: "red", card: "red" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } };
    expect(validateRecipeJson(recipe)).toBeNull();
    expect(typeof (recipe["surface"] as Record<string, unknown>)["canvas"]).toBe("object");
  });

  it("validateRecipeJson ignores legacy surfaceContrast field", () => {
    const legacy = { name: "X", description: "Test.", recipe: "dark", surface: { canvas: "red", card: "red" }, element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" }, surfaceContrast: "high" };
    expect(validateRecipeJson(legacy)).toBeNull();
  });

  it("validateRecipeJson ignores legacy roleIntensity field", () => {
    const legacy = { name: "X", description: "Test.", recipe: "dark", surface: { canvas: "red", card: "red" }, element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" }, roleIntensity: "vivid" };
    expect(validateRecipeJson(legacy)).toBeNull();
  });

  it("validateRecipeJson accepts both 'dark' and 'light' modes", () => {
    const dark = { name: "X", description: "Dark test theme.", recipe: "dark", surface: { canvas: "red", card: "red" }, element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } };
    const light = { name: "X", description: "Light test theme.", recipe: "light", surface: { canvas: "red", card: "red" }, element: { content: "blue", control: "blue", display: "indigo", informational: "red", border: "red", decorative: "gray" }, role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" } };
    expect(validateRecipeJson(dark)).toBeNull();
    expect(validateRecipeJson(light)).toBeNull();
  });

  it("validateRecipeJson migrates old-format recipe with controls object into new surface/role structure", () => {
    const legacy: Record<string, unknown> = {
      name: "ControlsMigrationTheme",
      description: "Old-format theme with controls object for migration testing.",
      recipe: "dark",
      surface: { canvas: "teal", card: "teal" },
      element: { content: "cobalt", control: "cobalt", display: "indigo", informational: "teal", border: "teal", decorative: "gray" },
      role: { accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
      controls: {
        canvasTone: 8,
        canvasIntensity: 7,
        frameTone: 20,
        frameIntensity: 15,
        roleTone: 45,
        roleIntensity: 55,
      },
    };

    const result = validateRecipeJson(legacy);
    expect(result).toBeNull();

    const surface = legacy["surface"] as Record<string, unknown>;
    const canvas = surface["canvas"] as Record<string, unknown>;
    expect(typeof canvas).toBe("object");
    expect(canvas["hue"]).toBe("teal");
    expect(canvas["tone"]).toBe(8);
    expect(canvas["intensity"]).toBe(7);

    const card = surface["card"] as Record<string, unknown>;
    expect(card["hue"]).toBe("teal");
    expect(card["tone"]).toBe(20);
    expect(card["intensity"]).toBe(15);

    const role = legacy["role"] as Record<string, unknown>;
    expect(role["tone"]).toBe(45);
    expect(role["intensity"]).toBe(55);

    expect(legacy["controls"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T6: Theme-provider integration — setDynamicTheme, revertToBuiltIn, init
// ---------------------------------------------------------------------------

function installMockLocalStorage(initial: Record<string, string> = {}): {
  store: Record<string, string>;
  restore: () => void;
} {
  const store: Record<string, string> = { ...initial };
  const orig = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    writable: true,
    configurable: true,
  });
  return {
    store,
    restore: () => {
      if (orig) {
        Object.defineProperty(globalThis, "localStorage", orig);
      } else {
        delete (globalThis as Record<string, unknown>)["localStorage"];
      }
    },
  };
}

function ContextCapture({
  setDynamicRef,
  revertRef,
}: {
  setDynamicRef: { current: ((name: string) => void) | null };
  revertRef: { current: (() => void) | null };
}): null {
  const { setDynamicTheme, revertToBuiltIn } = useThemeContext();
  setDynamicRef.current = setDynamicTheme;
  revertRef.current = revertToBuiltIn;
  return null;
}

describe("TugThemeProvider – dynamic theme (T6)", () => {
  afterEach(() => {
    cleanup();
    removeThemeCSS();
  });

  it("setDynamicTheme (via context) fetches CSS and injects it into the DOM", async () => {
    const fakeCss = "body { --tug-base-surface-global-primary-normal-app-rest: oklch(0.2 0 0); }";
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(fakeCss, { status: 200 });
    };

    const { restore } = installMockLocalStorage();
    const setDynamicRef: { current: ((name: string) => void) | null } = { current: null };
    const revertRef: { current: (() => void) | null } = { current: null };

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setDynamicRef, revertRef }),
          ),
        );
      });

      await act(async () => {
        await setDynamicRef.current!("my-theme");
      });

      expect(fetchCalls.some((u) => u.includes("my-theme"))).toBe(true);
      const el = document.getElementById("tug-theme-override");
      expect(el).not.toBeNull();
      expect(el!.textContent).toBe(fakeCss);
      expect(el!.getAttribute("data-theme")).toBe("my-theme");
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("setDynamicTheme (via context) persists dynamic theme name to localStorage under td-dynamic-theme", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("body {}", { status: 200 });

    const { store, restore } = installMockLocalStorage();
    const setDynamicRef: { current: ((name: string) => void) | null } = { current: null };
    const revertRef: { current: (() => void) | null } = { current: null };

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setDynamicRef, revertRef }),
          ),
        );
      });

      await act(async () => {
        await setDynamicRef.current!("brio-dark");
      });

      expect(store["td-dynamic-theme"]).toBe("brio-dark");
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("revertToBuiltIn (via context) removes theme override and clears td-dynamic-theme from localStorage", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("body { --tug-base-surface-global-primary-normal-app-rest: oklch(0.2 0 0); }", { status: 200 });

    const { store, restore } = installMockLocalStorage();
    const setDynamicRef: { current: ((name: string) => void) | null } = { current: null };
    const revertRef: { current: (() => void) | null } = { current: null };

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setDynamicRef, revertRef }),
          ),
        );
      });

      await act(async () => {
        await setDynamicRef.current!("my-theme");
      });

      expect(document.getElementById("tug-theme-override")).not.toBeNull();
      expect(store["td-dynamic-theme"]).toBe("my-theme");

      act(() => {
        revertRef.current!();
      });

      expect(document.getElementById("tug-theme-override")).toBeNull();
      expect(store["td-dynamic-theme"]).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("on init, TugThemeProvider reads td-dynamic-theme from localStorage and calls setDynamicTheme", async () => {
    const { restore } = installMockLocalStorage({ "td-dynamic-theme": "saved-theme" });
    const fakeCss = "body { --tug-base-surface-global-primary-normal-app-rest: oklch(0.15 0 0); }";
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(fakeCss, { status: 200 });
    };

    try {
      await act(async () => {
        render(React.createElement(TugThemeProvider, {}));
      });

      expect(fetchCalls.some((u) => u.includes("saved-theme"))).toBe(true);
      const el = document.getElementById("tug-theme-override");
      expect(el).not.toBeNull();
      expect(el!.textContent).toBe(fakeCss);
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("loadSavedThemes returns empty array when fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network error"); };
    try {
      const themes = await loadSavedThemes();
      expect(themes).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loadSavedThemes filters built-in theme names and returns only user-saved themes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ themes: ["brio", "harmony", "my-theme"] }), { status: 200 });
    try {
      const themes = await loadSavedThemes();
      expect(themes).not.toContain("brio");
      expect(themes).not.toContain("harmony");
      expect(themes).toContain("my-theme");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("injectThemeCSS + removeThemeCSS DOM contract: injected CSS is accessible and removal is clean", () => {
    const fakeCss = "body { --tug-base-surface-global-primary-normal-app-rest: oklch(0.15 0 0); }";
    injectThemeCSS("saved-theme", fakeCss);

    const el = document.getElementById("tug-theme-override");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-theme")).toBe("saved-theme");
    expect(el!.textContent).toBe(fakeCss);

    removeThemeCSS();
    expect(document.getElementById("tug-theme-override")).toBeNull();
  });
});
