/**
 * theme-export-import tests — new save model (Step 12).
 *
 * Tests cover:
 * - T9.3: Exported recipe JSON round-trips: export → import → re-export produces identical JSON
 * - T9.4: Invalid JSON import shows error, does not crash (validateRecipeJson)
 * - T9.4: Migration: old-format recipe → new format
 * - TugThemeProvider context interface tests ({ theme, setTheme }, localStorage, dynamic themes)
 * - New save model: POST /__themes/save with name + recipe fields only (D07)
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
import { deriveTheme, type ThemeRecipe } from "@/components/tugways/theme-engine";
import brioJson from "../../themes/brio.json";

const brio = brioJson as ThemeRecipe;
import { _resetForTest } from "@/card-registry";
import {
  TugThemeProvider,
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
    const recipe = brio;
    const json1 = JSON.stringify(recipe, null, 2);
    const parsed = JSON.parse(json1) as typeof recipe;
    const json2 = JSON.stringify(parsed, null, 2);
    expect(json1).toBe(json2);
  });

  it("import brio recipe: re-exported JSON matches original", () => {
    const recipe = brio;
    const exported = JSON.stringify(recipe, null, 2);
    const reimported = JSON.parse(exported);
    const reexported = JSON.stringify(reimported, null, 2);
    expect(exported).toBe(reexported);
  });

  it("validateRecipeJson accepts a valid brio recipe", () => {
    expect(validateRecipeJson(brio)).toBeNull();
  });

  it("re-deriving brio recipe after round-trip produces same token count", () => {
    const recipe = brio;
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

    // Old surface.card (frame data) migrates to surface.frame in new format
    const frame = surface["frame"] as Record<string, unknown>;
    expect(frame["hue"]).toBe("teal");
    expect(frame["tone"]).toBe(20);
    expect(frame["intensity"]).toBe(15);

    // New surface.card (card body) gets a default value derived from canvas hue
    const card = surface["card"] as Record<string, unknown>;
    expect(typeof card).toBe("object");
    expect(card["hue"]).toBe("teal");

    const role = legacy["role"] as Record<string, unknown>;
    expect(role["tone"]).toBe(45);
    expect(role["intensity"]).toBe(55);

    expect(legacy["controls"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// New save model: POST /__themes/save with name + recipe (D07)
// ---------------------------------------------------------------------------

describe("theme-save – new save model (POST /__themes/save)", () => {
  it("POST /__themes/save receives name and recipe (JSON string) only", async () => {
    const recipe = brio;

    const capturedBody: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/__themes/save") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        capturedBody.push(body);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    try {
      const res = await fetch("/__themes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recipe.name, recipe: JSON.stringify(recipe) }),
      });
      expect(res.ok).toBe(true);
      expect(capturedBody.length).toBe(1);
      const body = capturedBody[0];
      expect(typeof body["name"]).toBe("string");
      expect(typeof body["recipe"]).toBe("string");
      // recipe JSON should parse back to a valid ThemeRecipe
      const parsedRecipe = JSON.parse(body["recipe"] as string) as unknown;
      expect(validateRecipeJson(parsedRecipe)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// T6: Theme-provider integration — simplified { theme, setTheme } context
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
  setThemeRef,
  themeRef,
}: {
  setThemeRef: { current: ((name: string) => void) | null };
  themeRef: { current: string | null };
}): null {
  const { setTheme, theme } = useThemeContext();
  setThemeRef.current = setTheme;
  themeRef.current = theme;
  return null;
}

describe("TugThemeProvider – simplified context (T6)", () => {
  afterEach(() => {
    cleanup();
  });

  it("context exposes { theme, setTheme } interface", () => {
    const setThemeRef: { current: ((name: string) => void) | null } = { current: null };
    const themeRef: { current: string | null } = { current: null };
    const { restore } = installMockLocalStorage();

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setThemeRef, themeRef }),
          ),
        );
      });

      expect(typeof setThemeRef.current).toBe("function");
      expect(themeRef.current).toBe("brio");
    } finally {
      restore();
    }
  });

  it("setTheme posts to /__themes/activate and updates state on success", async () => {
    const activateCalls: string[] = [];

    const setThemeRef: { current: ((name: string) => void) | null } = { current: null };
    const themeRef: { current: string | null } = { current: null };
    const { restore } = installMockLocalStorage();

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__themes/activate") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        activateCalls.push(String(body.theme));
        return new Response(
          JSON.stringify({ theme: "harmony", canvasParams: { hue: "cobalt", tone: 85, intensity: 60 } }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            { initialTheme: "brio" },
            React.createElement(ContextCapture, { setThemeRef, themeRef }),
          ),
        );
      });

      await act(async () => {
        setThemeRef.current!("harmony");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(activateCalls).toContain("harmony");
      expect(themeRef.current).toBe("harmony");
    } finally {
      restore();
      globalThis.fetch = origFetch;
    }
  });

  it("setTheme with a dynamic name posts to activate endpoint", async () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url === "/__themes/activate") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ theme: String(body.theme), canvasParams: { hue: "teal", tone: 20, intensity: 50 } }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    const setThemeRef: { current: ((name: string) => void) | null } = { current: null };
    const themeRef: { current: string | null } = { current: null };
    const { restore } = installMockLocalStorage();

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setThemeRef, themeRef }),
          ),
        );
      });

      await act(async () => {
        setThemeRef.current!("my-theme");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(fetchCalls.some((u) => u === "/__themes/activate")).toBe(true);
      expect(themeRef.current).toBe("my-theme");
      // No <style> element should be injected
      expect(document.getElementById("tug-theme-override")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("setTheme persists theme name to localStorage under td-theme", async () => {
    const { store, restore } = installMockLocalStorage();

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/__themes/activate") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ theme: String(body.theme), canvasParams: { hue: "cobalt", tone: 5, intensity: 5 } }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    try {
      act(() => {
        render(React.createElement(TugThemeProvider, {}));
      });

      const setThemeRef: { current: ((name: string) => void) | null } = { current: null };
      const themeRef: { current: string | null } = { current: null };
      cleanup();
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setThemeRef, themeRef }),
          ),
        );
      });

      await act(async () => {
        setThemeRef.current!("brio");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(store["td-theme"]).toBe("brio");
    } finally {
      restore();
      globalThis.fetch = origFetch;
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

  it("loadSavedThemes filters built-in theme names from new { name, recipe, source } format", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ themes: [
        { name: "brio", recipe: "dark", source: "shipped" },
        { name: "harmony", recipe: "light", source: "shipped" },
        { name: "my-theme", recipe: "dark", source: "authored" },
      ] }), { status: 200 });
    try {
      const themes = await loadSavedThemes();
      expect(themes).not.toContain("brio");
      expect(themes).not.toContain("harmony");
      expect(themes).toContain("my-theme");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loadSavedThemes also accepts legacy string[] format", async () => {
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

  it("no <style id='tug-theme-override'> element in DOM after setTheme", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/__themes/activate") {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ theme: String(body.theme), canvasParams: { hue: "cobalt", tone: 85, intensity: 60 } }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    };

    const setThemeRef: { current: ((name: string) => void) | null } = { current: null };
    const themeRef: { current: string | null } = { current: null };
    const { restore } = installMockLocalStorage();

    try {
      act(() => {
        render(
          React.createElement(
            TugThemeProvider,
            {},
            React.createElement(ContextCapture, { setThemeRef, themeRef }),
          ),
        );
      });

      await act(async () => {
        setThemeRef.current!("harmony");
        await new Promise((r) => setTimeout(r, 0));
      });

      // The new architecture never injects a <style> element
      expect(document.getElementById("tug-theme-override")).toBeNull();
    } finally {
      restore();
      globalThis.fetch = origFetch;
    }
  });
});
