/**
 * gallery-theme-generator-content tests — Step 6.
 *
 * Tests cover:
 * - T6.1: GALLERY_DEFAULT_TABS has 15 entries
 * - T6.2: gallery-theme-generator componentId is registered
 * - T6.3: GalleryThemeGeneratorContent renders without errors
 * - T6.4: Mode toggle switches recipe mode between "dark" and "light"
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import {
  registerGalleryCards,
  GALLERY_DEFAULT_TABS,
} from "@/components/tugways/cards/gallery-card";
import { GalleryThemeGeneratorContent } from "@/components/tugways/cards/gallery-theme-generator-content";
import { getRegistration, _resetForTest } from "@/card-registry";

// ---------------------------------------------------------------------------
// T6.1: GALLERY_DEFAULT_TABS has 15 entries
// ---------------------------------------------------------------------------

describe("GALLERY_DEFAULT_TABS – fifteen entries (T6.1)", () => {
  it("has 15 entries", () => {
    expect(GALLERY_DEFAULT_TABS.length).toBe(15);
  });

  it("includes gallery-theme-generator as the 15th entry", () => {
    const componentIds = GALLERY_DEFAULT_TABS.map((t) => t.componentId);
    expect(componentIds).toContain("gallery-theme-generator");
    expect(componentIds[14]).toBe("gallery-theme-generator");
  });

  it("15th entry has title 'Theme Generator'", () => {
    const last = GALLERY_DEFAULT_TABS[14];
    expect(last.title).toBe("Theme Generator");
  });

  it("15th entry is closable", () => {
    const last = GALLERY_DEFAULT_TABS[14];
    expect(last.closable).toBe(true);
  });
});

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
    const reg = getRegistration("gallery-theme-generator");
    expect(reg!.family).toBe("developer");
  });

  it("gallery-theme-generator has acceptsFamilies: ['developer']", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-theme-generator");
    expect(reg!.acceptsFamilies).toEqual(["developer"]);
  });

  it("gallery-theme-generator does NOT have defaultTabs", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-theme-generator");
    expect(reg!.defaultTabs).toBeUndefined();
  });

  it("gallery-buttons defaultTabs has 15 entries after registration", () => {
    registerGalleryCards();
    const reg = getRegistration("gallery-buttons");
    expect(reg!.defaultTabs).toBeDefined();
    expect(reg!.defaultTabs!.length).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// T6.3: GalleryThemeGeneratorContent renders without errors
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – renders without errors (T6.3)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryThemeGeneratorContent />));
      });
    }).not.toThrow();
    expect(
      container.querySelector("[data-testid='gallery-theme-generator-content']"),
    ).not.toBeNull();
  });

  it("renders the mode toggle group", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    expect(container.querySelector("[data-testid='gtg-mode-group']")).not.toBeNull();
  });

  it("renders the atmosphere hue strip with 24 swatches", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const strip = container.querySelector("[data-testid='gtg-atmosphere-hue-strip']");
    expect(strip).not.toBeNull();
    const swatches = strip!.querySelectorAll(".gtg-hue-swatch");
    expect(swatches.length).toBe(24);
  });

  it("renders the text hue strip with 24 swatches", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const strip = container.querySelector("[data-testid='gtg-text-hue-strip']");
    expect(strip).not.toBeNull();
    const swatches = strip!.querySelectorAll(".gtg-hue-swatch");
    expect(swatches.length).toBe(24);
  });

  it("renders three mood sliders", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const sc = container.querySelector("[data-testid='gtg-slider-surface-contrast']");
    const sv = container.querySelector("[data-testid='gtg-slider-signal-vividity']");
    const w = container.querySelector("[data-testid='gtg-slider-warmth']");
    expect(sc).not.toBeNull();
    expect(sv).not.toBeNull();
    expect(w).not.toBeNull();
    expect((sc as HTMLInputElement).type).toBe("range");
    expect((sv as HTMLInputElement).type).toBe("range");
    expect((w as HTMLInputElement).type).toBe("range");
  });

  it("renders the token preview grid with tokens", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const grid = container.querySelector("[data-testid='gtg-token-grid']");
    expect(grid).not.toBeNull();
    const swatches = grid!.querySelectorAll(".gtg-token-swatch");
    // At least 200 token swatches (264 token set)
    expect(swatches.length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// T6.4: Mode toggle switches recipe mode between "dark" and "light"
// ---------------------------------------------------------------------------

describe("GalleryThemeGeneratorContent – mode toggle (T6.4)", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); cleanup(); });

  it("starts in dark mode (Brio default)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']");
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']");
    expect(darkBtn).not.toBeNull();
    expect(lightBtn).not.toBeNull();
    expect(darkBtn!.classList.contains("gtg-mode-btn--active")).toBe(true);
    expect(lightBtn!.classList.contains("gtg-mode-btn--active")).toBe(false);
  });

  it("switches to light mode when light button is clicked", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
    act(() => {
      fireEvent.click(lightBtn);
    });
    expect(lightBtn.classList.contains("gtg-mode-btn--active")).toBe(true);
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']");
    expect(darkBtn!.classList.contains("gtg-mode-btn--active")).toBe(false);
  });

  it("switches back to dark mode when dark button is clicked after switching to light", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryThemeGeneratorContent />));
    });
    const lightBtn = container.querySelector("[data-testid='gtg-mode-light']") as HTMLElement;
    const darkBtn = container.querySelector("[data-testid='gtg-mode-dark']") as HTMLElement;
    act(() => {
      fireEvent.click(lightBtn);
    });
    act(() => {
      fireEvent.click(darkBtn);
    });
    expect(darkBtn.classList.contains("gtg-mode-btn--active")).toBe(true);
    expect(lightBtn.classList.contains("gtg-mode-btn--active")).toBe(false);
  });
});
