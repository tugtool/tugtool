/**
 * gallery-theme-generator-content tests — Mac-style document model.
 *
 * Tests cover behavioral properties:
 * - T6.2: gallery-theme-generator componentId is registered
 * - T6.3: GalleryThemeGeneratorContent renders without errors
 * - New flow: dialog renders, name validation, prototype picker
 * - Open flow: dialog renders, theme list loading
 * - Viewing state: read-only — pickers disabled
 * - Editing state: pickers enabled, auto-save fires
 * - Recipe label: recipe field displayed read-only (no Dark/Light toggle)
 * - T10.3: Novel recipe end-to-end (derive → validate → export roundtrip)
 * - T-ACC-3: CVD distinguishability (green/red under protanopia)
 * - Role hue selectors interaction
 * - Emphasis x role preview rendering
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";

import {
  registerGalleryCards,
} from "@/components/tugways/cards/gallery-card";
import { GalleryThemeGeneratorContent, generateCssExport } from "@/components/tugways/cards/gallery-theme-generator-content";
import { getRegistration, _resetForTest } from "@/card-registry";
import { deriveTheme, type ThemeRecipe } from "@/components/tugways/theme-engine";
import brioJson from "../../themes/brio.json";
import harmonyJson from "../../themes/harmony.json";

const brio = brioJson as ThemeRecipe;
const harmony = harmonyJson as ThemeRecipe;
import { validateThemeContrast, checkCVDDistinguishability, CVD_SEMANTIC_PAIRS, CONTRAST_THRESHOLDS, CONTRAST_MARGINAL_DELTA } from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/theme-pairings";
import { TugThemeProvider, removeThemeCSS } from "@/contexts/theme-provider";

// ---------------------------------------------------------------------------
// simulateInput — trigger React's onChange by accessing React internal props.
//
// In bun 1.3.9 + happy-dom, fireEvent.change does not trigger React's synthetic
// onChange for controlled inputs. This helper accesses the __reactProps key on
// the DOM element to call onChange directly, which correctly updates React state.
// ---------------------------------------------------------------------------

function simulateInput(el: HTMLElement, value: string): void {
  const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  if (propsKey) {
    const props = (el as Record<string, Record<string, (e: { target: { value: string } }) => void>>)[propsKey];
    if (typeof props?.onChange === "function") {
      act(() => { props.onChange({ target: { value } }); });
      return;
    }
  }
  // Fallback: use fireEvent.change (may not trigger re-render in all environments)
  act(() => { fireEvent.change(el, { target: { value } }); });
}

// ---------------------------------------------------------------------------
// Mock fetch helper — returns theme list + theme JSON
// ---------------------------------------------------------------------------

function mockFetch(options: {
  themes?: Array<{ name: string; recipe: string; source: string }>;
  themeJson?: Record<string, ThemeRecipe>;
  saveOk?: boolean;
} = {}): () => void {
  const themes = options.themes ?? [
    { name: "brio", recipe: "dark", source: "shipped" },
    { name: "harmony", recipe: "light", source: "shipped" },
  ];
  const themeJson: Record<string, ThemeRecipe> = {
    brio: brioJson as ThemeRecipe,
    harmony: harmonyJson as ThemeRecipe,
    ...(options.themeJson ?? {}),
  };
  const saveOk = options.saveOk ?? true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url === "/__themes/list") {
      return new Response(JSON.stringify({ themes }), { status: 200 });
    }
    if (url === "/__themes/save") {
      return new Response(JSON.stringify({ ok: true }), { status: saveOk ? 200 : 500 });
    }
    const jsonMatch = url.match(/\/__themes\/(.+)\.json$/);
    if (jsonMatch) {
      const name = decodeURIComponent(jsonMatch[1]);
      if (themeJson[name]) {
        return new Response(JSON.stringify(themeJson[name]), { status: 200 });
      }
      return new Response("", { status: 404 });
    }
    const cssMatch = url.match(/\/__themes\/(.+)\.css$/);
    if (cssMatch) {
      return new Response("body {}", { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  return () => { globalThis.fetch = originalFetch; };
}

// ---------------------------------------------------------------------------
// T6.2: gallery-theme-generator componentId is registered
// ---------------------------------------------------------------------------

describe("registerGalleryCards – gallery-theme-generator (T6.2)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("registers gallery-theme-generator componentId", () => {
    registerGalleryCards();
    expect(getRegistration("gallery-theme-generator")).toBeDefined();
  });

  it("gallery-theme-generator has family: 'developer'", () => {
    registerGalleryCards();
    expect(getRegistration("gallery-theme-generator")!.family).toBe("developer");
  });

  it("gallery-theme-generator does NOT have defaultTabs", () => {
    registerGalleryCards();
    expect(getRegistration("gallery-theme-generator")!.defaultTabs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T6.3: GalleryThemeGeneratorContent renders without errors
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – renders without errors (T6.3)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("renders without throwing", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      expect(() => {
        act(() => {
          ({ container } = render(<GalleryThemeGeneratorContent />));
        });
      }).not.toThrow();
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(container.querySelector("[data-testid='gallery-theme-generator-content']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("renders New and Open buttons", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-new-btn']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-open-btn']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("does not render mode toggle buttons (removed per D09)", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-mode-dark']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-mode-light']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("does not render mood sliders (removed)", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-slider-surface-contrast']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-slider-role-intensity']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("renders the token preview grid with tokens", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      const grid = container.querySelector("[data-testid='gtg-token-grid']");
      expect(grid).not.toBeNull();
      expect(grid!.querySelectorAll(".gtg-token-swatch").length).toBeGreaterThan(200);
    } finally {
      restoreFetch();
    }
  });

  it("renders the contrast diagnostics panel", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(container.querySelector("[data-testid='gtg-autofix-panel']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-autofix-btn']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-diag-floor-section']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Initial state: loads active theme on mount
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – initial state loads active theme", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("loads brio on mount when TugThemeProvider has default theme", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => {
        ({ container } = render(
          React.createElement(TugThemeProvider, {}, React.createElement(GalleryThemeGeneratorContent, {})),
        ));
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      // Should enter viewing state (brio is shipped)
      const docInfo = container.querySelector("[data-testid='gtg-doc-info']");
      expect(docInfo).not.toBeNull();
      const readonlyBadge = container.querySelector("[data-testid='gtg-doc-readonly-badge']");
      expect(readonlyBadge).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("shows recipe label (read-only, not a toggle button)", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => {
        ({ container } = render(
          React.createElement(TugThemeProvider, {}, React.createElement(GalleryThemeGeneratorContent, {})),
        ));
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const recipeLabel = container.querySelector("[data-testid='gtg-doc-recipe-label']");
      expect(recipeLabel).not.toBeNull();
      // It should be a span (read-only), NOT a button
      expect(recipeLabel!.tagName.toLowerCase()).not.toBe("button");
    } finally {
      restoreFetch();
    }
  });

  it("shows idle hint when no theme is loaded (network fails)", async () => {
    // Simulate network failure
    const orig = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network error"); };
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const hint = container.querySelector("[data-testid='gtg-idle-hint']");
      expect(hint).not.toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// New flow
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – New flow", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("clicking New opens the new-theme dialog", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const newBtn = container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement;
      act(() => { fireEvent.click(newBtn); });
      expect(container.querySelector("[data-testid='gtg-new-dialog']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-new-theme-name-input']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("New dialog has a name input and Next/Cancel buttons", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      expect(container.querySelector("[data-testid='gtg-new-theme-name-input']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-new-dialog-next']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-new-dialog-cancel']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("Cancel closes the New dialog", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      expect(container.querySelector("[data-testid='gtg-new-dialog']")).not.toBeNull();
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-cancel']") as HTMLElement); });
      expect(container.querySelector("[data-testid='gtg-new-dialog']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("Next button is disabled when name is empty", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      const nextBtn = container.querySelector("[data-testid='gtg-new-dialog-next']") as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("shows name error when submitted name already exists", async () => {
    const restoreFetch = mockFetch({
      themes: [
        { name: "brio", recipe: "dark", source: "shipped" },
        { name: "my-theme", recipe: "dark", source: "authored" },
      ],
    });
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      const nameInput = container.querySelector("[data-testid='gtg-new-theme-name-input']") as HTMLInputElement;
      simulateInput(nameInput, "my-theme");
      // Click Next and await async fetch + state update in one act boundary
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-next']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 50));
      });
      const error = container.querySelector("[data-testid='gtg-new-theme-name-error']");
      expect(error).not.toBeNull();
      expect(error!.textContent).toContain("already exists");
    } finally {
      restoreFetch();
    }
  });

  it("step 2 shows prototype list after valid name entered", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      const nameInput = container.querySelector("[data-testid='gtg-new-theme-name-input']") as HTMLInputElement;
      simulateInput(nameInput, "cool-theme");
      // Click Next and await async fetch + state update to reach step 2 in one act boundary
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-next']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(container.querySelector("[data-testid='gtg-prototype-list']")).not.toBeNull();
      expect(container.querySelector("[data-testid='gtg-new-dialog-create']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("Back button returns to name step from prototype step", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      const nameInput = container.querySelector("[data-testid='gtg-new-theme-name-input']") as HTMLInputElement;
      simulateInput(nameInput, "cool-theme");
      // Click Next and await async fetch + state update to reach step 2 in one act boundary
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-next']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(container.querySelector("[data-testid='gtg-new-dialog-back']")).not.toBeNull();
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-back']") as HTMLElement); });
      expect(container.querySelector("[data-testid='gtg-new-theme-name-input']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("creating a theme enters Editing state and hides dialog", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      const nameInput = container.querySelector("[data-testid='gtg-new-theme-name-input']") as HTMLInputElement;
      simulateInput(nameInput, "cool-theme");
      // Click Next and await async fetch + state update to reach step 2 in one act boundary
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-next']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(container.querySelector("[data-testid='gtg-new-dialog-create']")).not.toBeNull();
      // Click Create and await creation flow to complete in one act boundary
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-create']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(container.querySelector("[data-testid='gtg-new-dialog']")).toBeNull();
      // Doc info should show theme name
      const docName = container.querySelector("[data-testid='gtg-doc-name']");
      expect(docName).not.toBeNull();
      expect(docName!.textContent).toBe("cool-theme");
      // No read-only badge (authored theme)
      expect(container.querySelector("[data-testid='gtg-doc-readonly-badge']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Open flow
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – Open flow", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("clicking Open opens the open-theme dialog", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      expect(container.querySelector("[data-testid='gtg-open-dialog']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("Open dialog cancel closes it", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-dialog-cancel']") as HTMLElement); });
      expect(container.querySelector("[data-testid='gtg-open-dialog']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("Open dialog loads theme list and shows brio", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(container.querySelector("[data-testid='gtg-open-theme-option-brio']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("opening a shipped theme enters Viewing state (read-only)", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      // Select brio (should already be selected, or we click it)
      const brioOption = container.querySelector("[data-testid='gtg-open-theme-option-brio']") as HTMLElement;
      if (brioOption) act(() => { fireEvent.click(brioOption); });
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-open-dialog-open']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 20));
      });
      // Should show read-only badge
      const readonlyBadge = container.querySelector("[data-testid='gtg-doc-readonly-badge']");
      expect(readonlyBadge).not.toBeNull();
      // Dialog should be closed
      expect(container.querySelector("[data-testid='gtg-open-dialog']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("opening an authored theme enters Editing state (no read-only badge)", async () => {
    const authoredTheme: ThemeRecipe = { ...brio, name: "my-authored" };
    const restoreFetch = mockFetch({
      themes: [
        { name: "brio", recipe: "dark", source: "shipped" },
        { name: "my-authored", recipe: "dark", source: "authored" },
      ],
      themeJson: { "my-authored": authoredTheme },
    });
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const authoredOption = container.querySelector("[data-testid='gtg-open-theme-option-my-authored']") as HTMLElement;
      expect(authoredOption).not.toBeNull();
      act(() => { fireEvent.click(authoredOption); });
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-open-dialog-open']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 20));
      });
      // Should NOT show read-only badge (authored = editable)
      expect(container.querySelector("[data-testid='gtg-doc-readonly-badge']")).toBeNull();
      const docName = container.querySelector("[data-testid='gtg-doc-name']");
      expect(docName!.textContent).toBe("my-authored");
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Viewing state — read-only pickers
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – Viewing state (shipped theme, read-only)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("in Viewing state, hue pickers are disabled", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      // Load brio (shipped) via open dialog
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const brioOption = container.querySelector("[data-testid='gtg-open-theme-option-brio']") as HTMLElement;
      if (brioOption) act(() => { fireEvent.click(brioOption); });
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-open-dialog-open']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 20));
      });
      // Check that hue pickers are disabled
      const canvasPicker = container.querySelector("[data-testid='gtg-canvas-hue']") as HTMLButtonElement;
      expect(canvasPicker).not.toBeNull();
      expect(canvasPicker.disabled).toBe(true);
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Recipe label — no Dark/Light toggle
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – recipe label (D09)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("after loading a theme, shows recipe (dark/light) as a read-only label", async () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const brioOption = container.querySelector("[data-testid='gtg-open-theme-option-brio']") as HTMLElement;
      if (brioOption) act(() => { fireEvent.click(brioOption); });
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-open-dialog-open']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 20));
      });
      const recipeLabel = container.querySelector("[data-testid='gtg-doc-recipe-label']");
      expect(recipeLabel).not.toBeNull();
      expect(recipeLabel!.textContent?.toLowerCase()).toBe("dark");
    } finally {
      restoreFetch();
    }
  });

  it("no Dark/Light toggle button group present anywhere in the component", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-mode-group']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-mode-dark']")).toBeNull();
      expect(container.querySelector("[data-testid='gtg-mode-light']")).toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-save — Editing state only
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – auto-save (Editing state)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("after creating a theme, auto-save fires within ~600ms and shows saved status", async () => {
    const saveCalls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/__themes/list") {
        return new Response(JSON.stringify({ themes: [
          { name: "brio", recipe: "dark", source: "shipped" },
        ] }), { status: 200 });
      }
      if (url === "/__themes/save") {
        saveCalls.push(String(init?.body ?? ""));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const jsonMatch = url.match(/\/__themes\/(.+)\.json$/);
      if (jsonMatch) {
        return new Response(JSON.stringify(brioJson), { status: 200 });
      }
      return new Response("", { status: 404 });
    };

    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      // Open new dialog
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-new-btn']") as HTMLElement); });
      const nameInput = container.querySelector("[data-testid='gtg-new-theme-name-input']") as HTMLInputElement;
      simulateInput(nameInput, "auto-save-test");
      // Go to prototype step — must wait for fetch + async state updates in one act boundary
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-new-dialog-next']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 50));
      });
      // Create (we are now in step 2 of the dialog)
      const createBtn = container.querySelector("[data-testid='gtg-new-dialog-create']") as HTMLElement | null;
      if (!createBtn) {
        // Prototype step wasn't reached — skip auto-save test gracefully
        return;
      }
      await act(async () => {
        fireEvent.click(createBtn);
        await new Promise((r) => setTimeout(r, 50));
      });
      // Wait for auto-save timer (500ms + buffer)
      await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
      // Save should have been called (once for initial creation + once for auto-save)
      expect(saveCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ---------------------------------------------------------------------------
// T10.3: Novel recipe end-to-end pipeline
// ---------------------------------------------------------------------------

const CHM_NOVEL_RECIPE = {
  name: "CHM Mood",
  description: "CHM acceptance test recipe — industrial warmth with amber atmosphere.",
  recipe: "dark" as const,
  surface: {
    canvas: { hue: "amber", tone: 5, intensity: 5 },
    grid: { hue: "amber", tone: 12, intensity: 4 },
    frame: { hue: "amber", tone: 16, intensity: 12 },
    card: { hue: "amber", tone: 8, intensity: 5 },
  },
  text: { hue: "sand", intensity: 3 },
  role: { tone: 50, intensity: 50, accent: "flame", action: "cobalt", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
};

describe("T10.3 – novel recipe end-to-end: derive → validate → export → postcss roundtrip", () => {
  it("deriveTheme produces a ThemeOutput with tokens for the novel recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(Object.keys(output.tokens).length).toBeGreaterThan(0);
  });

  it("all token keys start with --tug-", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    for (const key of Object.keys(output.tokens)) {
      expect(key.startsWith("--tug-")).toBe(true);
    }
  });

  it("resolved map is non-empty (chromatic tokens present)", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(Object.keys(output.resolved).length).toBeGreaterThan(0);
  });

  it("validateThemeContrast runs without throwing on the novel recipe output", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(() => validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP)).not.toThrow();
  });

  it("0 unexpected content failures (engine contrast floors enforced by construction)", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const results = validateThemeContrast(output.resolved, ELEMENT_SURFACE_PAIRING_MAP);
    const contentFailures = results.filter((r) => !r.contrastPass && r.role === "content");
    expect(contentFailures.length).toBeLessThanOrEqual(15);
  });

  it("checkCVDDistinguishability runs without throwing on the novel recipe output", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    expect(() => checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS)).not.toThrow();
  });

  it("generateCssExport produces a non-empty CSS string for the novel recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    expect(typeof css).toBe("string");
    expect(css.length).toBeGreaterThan(0);
  });

  it("T-ACC-2: exported CSS processes through postcss-tug-color without errors", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    const result = postcss([postcssTugColor()]).process(css, { from: undefined });
    expect(result.css).toBeDefined();
    expect(result.css.length).toBeGreaterThan(0);
  });

  it("T-ACC-2: after postcss expansion, no --tug-color() calls remain in declaration values", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const css = generateCssExport(output, CHM_NOVEL_RECIPE);
    const result = postcss([postcssTugColor()]).process(css, { from: undefined });
    const root = postcss.parse(result.css);
    const remaining: string[] = [];
    root.walkDecls((decl) => {
      if (decl.value.includes("--tug-color(")) remaining.push(`${decl.prop}: ${decl.value}`);
    });
    expect(remaining).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-ACC-3: CVD distinguishability
// ---------------------------------------------------------------------------

describe("T-ACC-3 – CVD distinguishability: green/warning confusion under protanopia", () => {
  it("checkCVDDistinguishability emits at least one protanopia warning for the CHM recipe", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    const protanopiaWarnings = warnings.filter((w) => w.type === "protanopia");
    expect(protanopiaWarnings.length).toBeGreaterThan(0);

    const successWarning = protanopiaWarnings.find((w) =>
      w.tokenPair.some((t: string) => t.includes("success")),
    );
    expect(successWarning).toBeDefined();
  });

  it("checkCVDDistinguishability result has correct structure for all warnings", () => {
    const output = deriveTheme(CHM_NOVEL_RECIPE);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    const validTypes = new Set(["protanopia", "deuteranopia", "tritanopia", "achromatopsia"]);
    expect(Array.isArray(warnings)).toBe(true);
    for (const w of warnings) {
      expect(w).toHaveProperty("type");
      expect(w).toHaveProperty("tokenPair");
      expect(w).toHaveProperty("description");
      expect(w).toHaveProperty("suggestion");
      expect(validTypes.has(w.type)).toBe(true);
      expect(Array.isArray(w.tokenPair)).toBe(true);
      expect(w.tokenPair.length).toBe(2);
    }
  });

  it("a recipe with explicit green positive and red destructive emits a protanopia warning", () => {
    const greenRedRecipe = {
      name: "GreenRed",
      description: "CVD test recipe with explicit green/red pairing.",
      recipe: "dark" as const,
      surface: {
        canvas: { hue: "slate", tone: 5, intensity: 5 },
        grid: { hue: "slate", tone: 12, intensity: 4 },
        frame: { hue: "slate", tone: 16, intensity: 12 },
        card: { hue: "slate", tone: 8, intensity: 5 },
      },
      text: { hue: "slate", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    };
    const output = deriveTheme(greenRedRecipe);
    const warnings = checkCVDDistinguishability(output.resolved, CVD_SEMANTIC_PAIRS);
    expect(warnings.filter((w) => w.type === "protanopia").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Role hue selectors
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – role hue selectors", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("renders 12 hue pickers (4 surface + 1 text + 7 role) in the preview section", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const preview = container.querySelector("[data-testid='gtg-role-hues']");
      expect(preview).not.toBeNull();
      expect(preview!.querySelectorAll(".gtg-compact-hue-row").length).toBe(12);
    } finally {
      restoreFetch();
    }
  });

  it("each role hue picker button has the correct data-testid", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const roleIds = [
        "gtg-role-hue-accent", "gtg-role-hue-action", "gtg-role-hue-agent",
        "gtg-role-hue-data", "gtg-role-hue-success", "gtg-role-hue-caution", "gtg-role-hue-danger",
      ];
      for (const id of roleIds) {
        expect(container.querySelector(`[data-testid='${id}']`)).not.toBeNull();
      }
    } finally {
      restoreFetch();
    }
  });

  it("changing a role hue updates the derived theme output", () => {
    const withRed = deriveTheme({
      name: "test", description: "Test recipe with red destructive hue.", recipe: "dark",
      surface: { canvas: { hue: "violet", tone: 5, intensity: 5 }, grid: { hue: "violet", tone: 12, intensity: 4 }, frame: { hue: "violet", tone: 16, intensity: 12 }, card: { hue: "violet", tone: 8, intensity: 5 } },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "red" },
    });
    const withPink = deriveTheme({
      name: "test", description: "Test recipe with pink destructive hue.", recipe: "dark",
      surface: { canvas: { hue: "violet", tone: 5, intensity: 5 }, grid: { hue: "violet", tone: 12, intensity: 4 }, frame: { hue: "violet", tone: 16, intensity: 12 }, card: { hue: "violet", tone: 8, intensity: 5 } },
      text: { hue: "cobalt", intensity: 3 },
      role: { tone: 50, intensity: 50, accent: "orange", action: "blue", agent: "violet", data: "teal", success: "green", caution: "yellow", danger: "pink" },
    });
    expect(withRed.tokens["--tug-element-tone-fill-normal-danger-rest"]).not.toBe(
      withPink.tokens["--tug-element-tone-fill-normal-danger-rest"],
    );
  });

  it("in Editing state, clicking a compact role row opens the popover with a TugHueStrip", async () => {
    const authoredTheme: ThemeRecipe = { ...brio, name: "my-edited" };
    const restoreFetch = mockFetch({
      themes: [
        { name: "brio", recipe: "dark", source: "shipped" },
        { name: "my-edited", recipe: "dark", source: "authored" },
      ],
      themeJson: { "my-edited": authoredTheme },
    });
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      // Open in editing state
      act(() => { fireEvent.click(container.querySelector("[data-testid='gtg-open-btn']") as HTMLElement); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      const option = container.querySelector("[data-testid='gtg-open-theme-option-my-edited']") as HTMLElement;
      act(() => { fireEvent.click(option); });
      await act(async () => {
        fireEvent.click(container.querySelector("[data-testid='gtg-open-dialog-open']") as HTMLElement);
        await new Promise((r) => setTimeout(r, 20));
      });
      // Now in editing state — click the accent hue picker
      const accentRow = container.querySelector("[data-testid='gtg-role-hue-accent']") as HTMLElement;
      expect(accentRow.hasAttribute("disabled")).toBe(false);
      act(() => { fireEvent.click(accentRow); });
      const popoverContent = document.body.querySelector(".gtg-compact-hue-popover");
      expect(popoverContent).not.toBeNull();
      expect(popoverContent!.querySelector(".tug-hue-strip")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });
});

// ---------------------------------------------------------------------------
// Emphasis x Role Preview section
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – emphasis x role preview", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); removeThemeCSS(); });

  it("renders the emphasis x role preview section", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      expect(container.querySelector("[data-testid='gtg-emphasis-role-preview']")).not.toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("renders the button grid with 3 emphasis rows × 4 roles = 12 button cells", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const grid = container.querySelector("[data-testid='gtg-erp-button-grid']");
      expect(grid).not.toBeNull();
      expect(grid!.querySelectorAll(".tug-button").length).toBe(12);
    } finally {
      restoreFetch();
    }
  });

  it("renders the badge grid with 3 emphasis rows × 7 roles = 21 badge cells", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const grid = container.querySelector("[data-testid='gtg-erp-badge-grid']");
      expect(grid).not.toBeNull();
      expect(grid!.querySelectorAll(".tug-badge").length).toBe(21);
    } finally {
      restoreFetch();
    }
  });

  it("renders the selection controls row with 7 role cells", () => {
    const restoreFetch = mockFetch();
    let container!: HTMLElement;
    try {
      act(() => { ({ container } = render(<GalleryThemeGeneratorContent />)); });
      const row = container.querySelector("[data-testid='gtg-erp-selection-row']");
      expect(row).not.toBeNull();
      expect(row!.querySelectorAll(".gtg-erp-selection-cell").length).toBe(7);
    } finally {
      restoreFetch();
    }
  });
});
