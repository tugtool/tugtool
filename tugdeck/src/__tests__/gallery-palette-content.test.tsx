/**
 * GalleryPaletteContent tests — HueVibVal editor.
 *
 * Tests cover:
 * - GalleryPaletteContent renders without errors
 * - Canonical strip: 24 swatches with oklch colors
 * - L curve editor: 24 draggable points
 * - VibVal grid: appears on selection, correct cell count
 * - hvvColor: pure computation tests
 * - JSON export/import helpers (unit tests)
 * - Export/import UI elements
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import {
  GalleryPaletteContent,
  buildExportPayload,
  parseImportPayload,
} from "@/components/tugways/cards/gallery-palette-content";
import { hvvColor, MAX_CHROMA_FOR_HUE } from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – renders without errors", () => {
  afterEach(() => { cleanup(); });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryPaletteContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-palette-content']")).not.toBeNull();
  });

  it("renders the canonical strip", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-canonical-strip']")).not.toBeNull();
  });

  it("renders the L curve editor", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-curve-editor']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Canonical strip
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – canonical strip", () => {
  afterEach(() => { cleanup(); });

  it("renders exactly 24 canonical swatches", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const strip = container.querySelector("[data-testid='gp-canonical-strip']")!;
    expect(strip).not.toBeNull();
    const swatches = strip.querySelectorAll("[data-testid='gp-canonical-swatch']");
    expect(swatches.length).toBe(24);
  });

  it("each canonical swatch has a data-color with oklch value", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const swatches = container.querySelectorAll("[data-testid='gp-canonical-swatch']");
    swatches.forEach((s) => {
      const color = s.getAttribute("data-color") ?? "";
      expect(color).toMatch(/^oklch\(/);
    });
  });
});

// ---------------------------------------------------------------------------
// L curve editor
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – L curve editor", () => {
  afterEach(() => { cleanup(); });

  it("renders 24 draggable curve points", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const points = container.querySelectorAll("[data-testid^='gp-curve-point-']");
    expect(points.length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// VibVal grid
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – VibVal grid", () => {
  afterEach(() => { cleanup(); });

  it("does not render VibVal grid when no hue is selected", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-vibval-grid']")).toBeNull();
  });

  it("renders VibVal grid when a canonical swatch is clicked", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const swatches = container.querySelectorAll("[data-testid='gp-canonical-swatch']");
    act(() => {
      fireEvent.click(swatches[0] as HTMLElement);
    });
    expect(container.querySelector("[data-testid='gp-vibval-grid']")).not.toBeNull();
  });

  it("VibVal grid has 11 val rows", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const swatches = container.querySelectorAll("[data-testid='gp-canonical-swatch']");
    act(() => {
      fireEvent.click(swatches[0] as HTMLElement);
    });
    const grid = container.querySelector("[data-testid='gp-vibval-grid']")!;
    const rows = grid.querySelectorAll("[data-testid='gp-vvgrid-val-row']");
    expect(rows.length).toBe(11);
  });

  it("VibVal grid has 121 color cells (11 vib x 11 val)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const swatches = container.querySelectorAll("[data-testid='gp-canonical-swatch']");
    act(() => {
      fireEvent.click(swatches[0] as HTMLElement);
    });
    const grid = container.querySelector("[data-testid='gp-vibval-grid']")!;
    const cells = grid.querySelectorAll("[data-testid='gp-vvgrid-cell']");
    expect(cells.length).toBe(121);
  });

  it("canonical cell (vib=50, val=50) is highlighted", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const swatches = container.querySelectorAll("[data-testid='gp-canonical-swatch']");
    act(() => {
      fireEvent.click(swatches[0] as HTMLElement);
    });
    const grid = container.querySelector("[data-testid='gp-vibval-grid']")!;
    const canonicalCell = grid.querySelector(".gp-vvgrid-cell--canonical");
    expect(canonicalCell).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hvvColor – pure computation tests
// ---------------------------------------------------------------------------

describe("hvvColor – pure unit tests", () => {
  it("returns a valid oklch string", () => {
    const result = hvvColor("red", 50, 50, 0.79);
    expect(result).toMatch(/^oklch\(/);
  });

  it("vib=0 produces zero chroma (gray)", () => {
    const result = hvvColor("red", 0, 50, 0.79);
    expect(result).toMatch(/oklch\([\d.]+ 0 /);
  });

  it("val=0 produces dark color (L = L_DARK = 0.15)", () => {
    const result = hvvColor("red", 50, 0, 0.79);
    expect(result).toMatch(/oklch\(0\.15 /);
  });

  it("val=100 produces light color (L = L_LIGHT = 0.96)", () => {
    const result = hvvColor("red", 50, 100, 0.79);
    expect(result).toMatch(/oklch\(0\.96 /);
  });

  it("val=50 produces canonical L", () => {
    const result = hvvColor("red", 50, 50, 0.79);
    expect(result).toMatch(/oklch\(0\.79 /);
  });

  it("vib=50 produces sRGB-safe chroma (MAX_CHROMA_FOR_HUE * PEAK_C_SCALE / 2 = MAX_CHROMA_FOR_HUE)", () => {
    // vib=50 → C = (50/100) * (MAX_CHROMA * 2) = MAX_CHROMA
    const maxC = MAX_CHROMA_FOR_HUE["red"];
    const expectedC = parseFloat(maxC.toFixed(4)).toString();
    const result = hvvColor("red", 50, 50, 0.79);
    expect(result).toContain(expectedC);
  });

  it("vib=100 produces 2x sRGB max chroma (P3 territory)", () => {
    // vib=100 → C = MAX_CHROMA * 2
    const maxC = MAX_CHROMA_FOR_HUE["red"];
    const peakC = maxC * 2;
    const expectedC = parseFloat(peakC.toFixed(4)).toString();
    const result = hvvColor("red", 100, 50, 0.79);
    expect(result).toContain(expectedC);
  });

  it("produces valid oklch for all 24 hue names", () => {
    const hueNames = [
      "cherry", "red", "tomato", "flame", "orange", "amber",
      "gold", "yellow", "lime", "green", "mint", "teal",
      "cyan", "sky", "blue", "indigo", "violet", "purple",
      "plum", "pink", "rose", "magenta", "crimson", "coral",
    ];
    for (const name of hueNames) {
      const result = hvvColor(name, 50, 50, 0.8);
      expect(result).toMatch(/^oklch\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// JSON export/import – pure helpers (unit tests, no DOM)
// ---------------------------------------------------------------------------

describe("buildExportPayload – pure unit tests", () => {
  it("returns a string with version 2, global, and hues", () => {
    const canonical = { red: 0.79, blue: 0.86 };
    const json = buildExportPayload(canonical);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(parsed.global).toBeDefined();
    expect(parsed.global.l_dark).toBe(0.15);
    expect(parsed.global.l_light).toBe(0.96);
    expect(parsed.hues).toBeDefined();
    expect(parsed.hues.red.canonical_l).toBe(0.79);
    expect(parsed.hues.blue.canonical_l).toBe(0.86);
  });

  it("exports all 24 hues when given full canonical L data", () => {
    const canonical: Record<string, number> = {};
    const names = [
      "cherry", "red", "tomato", "flame", "orange", "amber",
      "gold", "yellow", "lime", "green", "mint", "teal",
      "cyan", "sky", "blue", "indigo", "violet", "purple",
      "plum", "pink", "rose", "magenta", "crimson", "coral",
    ];
    for (const n of names) canonical[n] = 0.8;
    const json = buildExportPayload(canonical);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed.hues).length).toBe(24);
  });
});

describe("parseImportPayload – validation and parsing", () => {
  it("parses valid payload and returns canonical L values", () => {
    const json = JSON.stringify({
      version: 2,
      global: { l_dark: 0.15, l_light: 0.96 },
      hues: { red: { canonical_l: 0.79 }, blue: { canonical_l: 0.86 } },
    });
    const result = parseImportPayload(json);
    expect(result.red).toBe(0.79);
    expect(result.blue).toBe(0.86);
  });

  it("throws on invalid JSON string", () => {
    expect(() => parseImportPayload("not json at all {{{")).toThrow();
  });

  it("throws when version field is missing", () => {
    const bad = JSON.stringify({ hues: { red: { canonical_l: 0.79 } } });
    expect(() => parseImportPayload(bad)).toThrow(/version/);
  });

  it("throws when hues object is missing", () => {
    const bad = JSON.stringify({ version: 2 });
    expect(() => parseImportPayload(bad)).toThrow(/hues/);
  });

  it("throws when canonical_l is not a number", () => {
    const bad = JSON.stringify({
      version: 2,
      global: { l_dark: 0.15, l_light: 0.96 },
      hues: { red: { canonical_l: "bogus" } },
    });
    expect(() => parseImportPayload(bad)).toThrow(/canonical_l/);
  });
});

describe("round-trip: buildExportPayload -> parseImportPayload", () => {
  it("produces identical canonical L values after export and re-import", () => {
    const original = { red: 0.79, blue: 0.86, yellow: 0.94, cherry: 0.77 };
    const json = buildExportPayload(original);
    const result = parseImportPayload(json);
    expect(result.red).toBe(0.79);
    expect(result.blue).toBe(0.86);
    expect(result.yellow).toBe(0.94);
    expect(result.cherry).toBe(0.77);
  });
});

// ---------------------------------------------------------------------------
// Export/import UI elements
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – export/import UI", () => {
  afterEach(() => { cleanup(); });

  it("renders the Export JSON button", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-export-btn']")).not.toBeNull();
  });

  it("renders the Import JSON button and hidden file input", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-import-btn']")).not.toBeNull();
    const fileInput = container.querySelector("[data-testid='gp-import-file-input']") as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(fileInput.type).toBe("file");
    expect(fileInput.style.display).toBe("none");
  });

  it("renders the Reset button", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-reset-btn']")).not.toBeNull();
  });
});
