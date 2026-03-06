/**
 * GalleryPaletteContent tests — Step 4 (Phase 5d5a).
 *
 * Tests cover:
 * - GalleryPaletteContent renders without errors
 * - All 24 x 11 = 264 swatch elements are present in the rendered output
 * - Changing a slider value updates the displayed swatches (local state)
 * - Curve type selector switches between three curve implementations
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { GalleryPaletteContent } from "@/components/tugways/cards/gallery-palette-content";
import { MAX_CHROMA_FOR_HUE } from "@/components/tugways/palette-engine";

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

  it("renders the live and locked panels", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-live-panel']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-locked-panel']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Swatch count: 24 hues x 11 stops = 264 swatches per grid, two grids = 528
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – swatch grid completeness", () => {
  afterEach(() => { cleanup(); });

  it("renders exactly 264 swatches in the live panel grid", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // The live panel contains one SwatchGrid with 24 rows x 11 stops = 264 swatches.
    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    expect(livePanel).not.toBeNull();
    const swatches = livePanel.querySelectorAll("[data-testid='gp-swatch']");
    expect(swatches.length).toBe(24 * 11); // 264
  });

  it("renders exactly 264 swatches in the locked panel grid", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const lockedPanel = container.querySelector("[data-testid='gp-locked-panel']")!;
    expect(lockedPanel).not.toBeNull();
    const swatches = lockedPanel.querySelectorAll("[data-testid='gp-swatch']");
    expect(swatches.length).toBe(24 * 11); // 264
  });

  it("renders 24 hue rows in the live panel grid", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const rows = livePanel.querySelectorAll("[data-testid='gp-hue-row']");
    expect(rows.length).toBe(24);
  });

  it("each swatch has a data-color attribute set to an oklch value", () => {
    // happy-dom does not preserve complex CSS values like oklch() through
    // el.style.backgroundColor, so we verify color values via the data-color
    // attribute that the component sets alongside the inline style.
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const swatches = livePanel.querySelectorAll("[data-testid='gp-swatch']");
    let withColor = 0;
    swatches.forEach((s) => {
      const color = s.getAttribute("data-color") ?? "";
      if (color.startsWith("oklch(")) {
        withColor++;
      }
    });
    expect(withColor).toBe(264);
  });

  it("each swatch has a title attribute containing the CSS variable name", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const swatches = livePanel.querySelectorAll("[data-testid='gp-swatch']");
    // Every swatch should have a title starting with "--tug-palette-hue-"
    swatches.forEach((s) => {
      const title = s.getAttribute("title") ?? "";
      expect(title).toMatch(/^--tug-palette-hue-/);
    });
  });
});

// ---------------------------------------------------------------------------
// Interactive controls: slider updates re-render swatches
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – slider controls update swatches", () => {
  afterEach(() => { cleanup(); });

  it("renders the Reset to defaults button", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const resetBtn = container.querySelector("[data-testid='gp-reset-btn']");
    expect(resetBtn).not.toBeNull();
  });

  it("renders the Lock current button", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const lockBtn = container.querySelector("[data-testid='gp-lock-btn']");
    expect(lockBtn).not.toBeNull();
  });

  it("changing curve type to piecewise with non-default breakpoint changes swatch data-color", () => {
    // happy-dom does not flow fireEvent.change on range inputs through React's
    // controlled-component state (a known happy-dom limitation, same as noted in
    // gallery-observable-props tests). We test state-driven re-rendering via the
    // curve type selector (a <select> whose change events do propagate correctly).
    // Switching to piecewise with adjusted breakpoint exercises the same
    // "local state triggers re-render, appearance via data-color" code path.
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Capture initial data-color of a mid-intensity swatch under smoothstep
    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const midSwatch = livePanel.querySelectorAll("[data-testid='gp-swatch']")[0 * 11 + 5] as HTMLElement;
    const initialColor = midSwatch.getAttribute("data-color");
    expect(initialColor).toMatch(/^oklch\(/);

    // Switch curve type — the select onChange flows through React's state correctly
    const curveSelect = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(curveSelect, { target: { value: "piecewise" } });
    });

    // After switching to piecewise (default breakpoints differ from smoothstep at many stops)
    const updatedColor = midSwatch.getAttribute("data-color");
    expect(updatedColor).toMatch(/^oklch\(/);
    // Piecewise curve with default breakpoints produces different output than smoothstep
    expect(updatedColor).not.toBe(initialColor);
  });

  it("Reset to defaults restores the smoothstep swatch data-color after curve type change", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    // Use intensity stop 30 (index 3) — at t=0.3 piecewise and smoothstep diverge clearly.
    const swatch = livePanel.querySelectorAll("[data-testid='gp-swatch']")[0 * 11 + 3] as HTMLElement;
    const initialColor = swatch.getAttribute("data-color");

    // Switch curve type to piecewise (diverges from smoothstep at t=0.3 with default breakpoints)
    const curveSelect = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(curveSelect, { target: { value: "piecewise" } });
    });
    const changedColor = swatch.getAttribute("data-color");
    expect(changedColor).not.toBe(initialColor);

    // Reset to defaults — should restore smoothstep and original colors
    const resetBtn = container.querySelector("[data-testid='gp-reset-btn']") as HTMLElement;
    act(() => {
      fireEvent.click(resetBtn);
    });

    const restoredColor = swatch.getAttribute("data-color");
    expect(restoredColor).toBe(initialColor);
  });
});

// ---------------------------------------------------------------------------
// Curve type selector
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – curve type selector", () => {
  afterEach(() => { cleanup(); });

  it("renders the curve type select with three options", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(3);
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain("smoothstep");
    expect(values).toContain("bezier");
    expect(values).toContain("piecewise");
  });

  it("switching curve type to bezier shows bezier-specific controls", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Initially no bezier controls
    expect(container.querySelector("[data-testid='gp-live-bezier-p1']")).toBeNull();

    // Switch to bezier
    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "bezier" } });
    });

    expect(container.querySelector("[data-testid='gp-live-bezier-p1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-live-bezier-p2']")).not.toBeNull();
  });

  it("switching curve type to piecewise shows all four piecewise-specific controls", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    expect(container.querySelector("[data-testid='gp-live-piece-break-t']")).toBeNull();
    expect(container.querySelector("[data-testid='gp-live-piece-break-t2']")).toBeNull();

    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "piecewise" } });
    });

    expect(container.querySelector("[data-testid='gp-live-piece-break-t']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-live-piece-break-s']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-live-piece-break-t2']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-live-piece-break-s2']")).not.toBeNull();
  });

  it("switching curve type changes swatch data-color values relative to smoothstep baseline", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Capture a mid-range swatch data-color under smoothstep (default)
    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const midSwatch = livePanel.querySelectorAll("[data-testid='gp-swatch']")[5 * 11 + 5] as HTMLElement;
    const smoothstepColor = midSwatch.getAttribute("data-color");
    expect(smoothstepColor).toMatch(/^oklch\(/);

    // Switch to piecewise
    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "piecewise" } });
    });

    // Adjust first breakpoint to ensure different output from smoothstep
    const breakTSlider = container.querySelector("[data-testid='gp-live-piece-break-t']") as HTMLInputElement;
    act(() => {
      fireEvent.change(breakTSlider, { target: { value: "0.2" } });
    });

    const piecewiseColor = midSwatch.getAttribute("data-color");
    expect(piecewiseColor).toMatch(/^oklch\(/);
    // Piecewise with breakT=0.2 produces a different curve than smoothstep
    expect(piecewiseColor).not.toBe(smoothstepColor);
  });

  it("renders Break T2 and Break S2 sliders when curve type is piecewise", () => {
    // Verify the two new second-breakpoint sliders are present in the DOM when
    // piecewise mode is active. (happy-dom does not propagate fireEvent.change
    // on range inputs through React controlled-component state, so color-change
    // assertions for slider moves are not reliable here — see piecewiseLinear
    // unit tests for 4-segment behavioural coverage.)
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "piecewise" } });
    });

    const t2Slider = container.querySelector("[data-testid='gp-live-piece-break-t2']") as HTMLInputElement;
    const s2Slider = container.querySelector("[data-testid='gp-live-piece-break-s2']") as HTMLInputElement;
    expect(t2Slider).not.toBeNull();
    expect(s2Slider).not.toBeNull();
    // Default values from DEFAULT_CURVE_CONFIG
    expect(t2Slider.value).toBe("0.7");
    expect(s2Slider.value).toBe("0.85");
  });
});

// ---------------------------------------------------------------------------
// Piecewise 4-segment behaviour: boundary and segment verification
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – piecewise 4-segment behaviour", () => {
  afterEach(() => { cleanup(); });

  it("piecewise swatches at intensity 0 and 100 produce valid oklch colors", () => {
    // Intensity 0 (t=0) and 100 (t=1) are the anchor ends of the transfer
    // function — should always produce an oklch value regardless of breakpoints.
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "piecewise" } });
    });

    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const swatches = livePanel.querySelectorAll("[data-testid='gp-swatch']");

    // STANDARD_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    // Index 0 → stop 0, index 10 → stop 100 (for hue row 0)
    const swatchAt0 = swatches[0] as HTMLElement;
    const swatchAt100 = swatches[10] as HTMLElement;
    expect(swatchAt0.getAttribute("data-color")).toMatch(/^oklch\(/);
    expect(swatchAt100.getAttribute("data-color")).toMatch(/^oklch\(/);
  });

  it("piecewise mode produces different colors at each of the four segment midpoints", () => {
    // With default breakpoints (breakT=0.3, breakT2=0.7), the four segments
    // cover t-ranges: [0,0.3], [0.3,0.7], [0.7,1].
    // Intensity stops 10 (t=0.1), 50 (t=0.5), 80 (t=0.8) sample three distinct
    // segments (the first, second, and third). They should all differ.
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    const select = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: "piecewise" } });
    });

    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const swatches = livePanel.querySelectorAll("[data-testid='gp-swatch']");

    // STANDARD_STOPS indices: 0→stop0, 1→stop10, 2→stop20, 3→stop30,
    //   4→stop40, 5→stop50, 6→stop60, 7→stop70, 8→stop80, 9→stop90, 10→stop100
    // Hue row 0: indices 0-10
    const color10 = (swatches[1] as HTMLElement).getAttribute("data-color")!;  // t=0.1
    const color50 = (swatches[5] as HTMLElement).getAttribute("data-color")!;  // t=0.5
    const color80 = (swatches[8] as HTMLElement).getAttribute("data-color")!;  // t=0.8

    expect(color10).toMatch(/^oklch\(/);
    expect(color50).toMatch(/^oklch\(/);
    expect(color80).toMatch(/^oklch\(/);
    // All three should be different colors (different segments, different slopes)
    expect(color10).not.toBe(color50);
    expect(color50).not.toBe(color80);
    expect(color10).not.toBe(color80);
  });
});

// ---------------------------------------------------------------------------
// Lock current button
// ---------------------------------------------------------------------------

describe("GalleryPaletteContent – lock current", () => {
  beforeEach(() => { cleanup(); });
  afterEach(() => { cleanup(); });

  it("Lock current copies live config to locked panel", () => {
    // Change live config via curve type selector (reliable in happy-dom),
    // then lock and verify the locked panel's data-color matches the live panel.
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Switch live curve to piecewise so it differs from locked (smoothstep default)
    const curveSelect = container.querySelector("[data-testid='gp-live-curve-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(curveSelect, { target: { value: "piecewise" } });
    });

    // Capture live and locked panel mid swatches before lock
    const livePanel = container.querySelector("[data-testid='gp-live-panel']")!;
    const lockedPanel = container.querySelector("[data-testid='gp-locked-panel']")!;
    const liveSwatch = livePanel.querySelectorAll("[data-testid='gp-swatch']")[0 * 11 + 5] as HTMLElement;
    const lockedSwatch = lockedPanel.querySelectorAll("[data-testid='gp-swatch']")[0 * 11 + 5] as HTMLElement;

    const liveColorBeforeLock = liveSwatch.getAttribute("data-color");
    const lockedColorBeforeLock = lockedSwatch.getAttribute("data-color");
    // They differ: live is piecewise, locked is still smoothstep
    expect(liveColorBeforeLock).toMatch(/^oklch\(/);
    expect(lockedColorBeforeLock).toMatch(/^oklch\(/);
    expect(liveColorBeforeLock).not.toBe(lockedColorBeforeLock);

    // Lock current
    const lockBtn = container.querySelector("[data-testid='gp-lock-btn']") as HTMLElement;
    act(() => {
      fireEvent.click(lockBtn);
    });

    // After locking, locked panel's swatch should match live panel's swatch
    const lockedColorAfterLock = lockedSwatch.getAttribute("data-color");
    expect(lockedColorAfterLock).toBe(liveColorBeforeLock);
  });
});

// ---------------------------------------------------------------------------
// Anchors mode (Step 5)
// ---------------------------------------------------------------------------

/**
 * Helper: switch to Curves mode so we can also verify the mode toggle works
 * in the opposite direction.
 */
function switchToAnchorsMode(container: HTMLElement) {
  const btn = container.querySelector("[data-testid='gp-mode-anchors-btn']") as HTMLElement;
  act(() => { fireEvent.click(btn); });
}

function switchToCurvesMode(container: HTMLElement) {
  const btn = container.querySelector("[data-testid='gp-mode-curves-btn']") as HTMLElement;
  act(() => { fireEvent.click(btn); });
}

describe("GalleryPaletteContent – mode toggle", () => {
  afterEach(() => { cleanup(); });

  it("renders the mode toggle with Anchors and Curves buttons", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-mode-toggle']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-mode-anchors-btn']")).not.toBeNull();
    expect(container.querySelector("[data-testid='gp-mode-curves-btn']")).not.toBeNull();
  });

  it("Anchors mode is active by default (Anchors button has active class)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const anchorsBtn = container.querySelector("[data-testid='gp-mode-anchors-btn']")!;
    expect(anchorsBtn.className).toContain("gp-mode-btn--active");
  });

  it("clicking Curves button switches to Curves mode", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    switchToCurvesMode(container);
    const curvesBtn = container.querySelector("[data-testid='gp-mode-curves-btn']")!;
    expect(curvesBtn.className).toContain("gp-mode-btn--active");
  });
});

describe("GalleryPaletteContent – Anchors mode renders all 24x11 swatches", () => {
  afterEach(() => { cleanup(); });

  it("renders the anchors panel in anchors mode (default)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    expect(container.querySelector("[data-testid='gp-anchors-panel']")).not.toBeNull();
  });

  it("renders the anchor swatch grid with 264 swatches (24 hues x 11 stops)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    expect(grid).not.toBeNull();
    const swatches = grid.querySelectorAll("[data-testid='gp-swatch']");
    expect(swatches.length).toBe(24 * 11); // 264
  });

  it("renders 24 hue rows in the anchor swatch grid", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const rows = grid.querySelectorAll("[data-testid='gp-hue-row']");
    expect(rows.length).toBe(24);
  });

  it("each anchor swatch has a data-color attribute set to an oklch value", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const swatches = grid.querySelectorAll("[data-testid='gp-swatch']");
    let withColor = 0;
    swatches.forEach((s) => {
      const color = s.getAttribute("data-color") ?? "";
      if (color.startsWith("oklch(")) withColor++;
    });
    expect(withColor).toBe(264);
  });

  it("renders the theme selector with brio, bluenote, and harmony options", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });
    const select = container.querySelector("[data-testid='gp-anchor-theme-select']") as HTMLSelectElement;
    expect(select).not.toBeNull();
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(values).toContain("brio");
    expect(values).toContain("bluenote");
    expect(values).toContain("harmony");
  });
});

describe("GalleryPaletteContent – Anchors mode: click-to-edit", () => {
  afterEach(() => { cleanup(); });

  it("clicking a swatch opens the inline anchor editor", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // No editor initially
    expect(container.querySelector("[data-testid='gp-anchor-editor']")).toBeNull();

    // Click the first swatch in the anchor grid
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const firstSwatch = grid.querySelectorAll("[data-testid='gp-swatch']")[0] as HTMLElement;
    act(() => {
      fireEvent.click(firstSwatch);
    });

    // Editor should now be visible
    expect(container.querySelector("[data-testid='gp-anchor-editor']")).not.toBeNull();
  });

  it("the inline editor shows the hue name and stop number", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Click the swatch at hue row 1 (red), stop index 5 (stop=50)
    // Row 0 is cherry, row 1 is red; within each row index 5 = stop 50
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const rows = grid.querySelectorAll("[data-testid='gp-hue-row']");
    const redRowSwatches = rows[1].querySelectorAll("[data-testid='gp-swatch']");
    act(() => {
      fireEvent.click(redRowSwatches[5] as HTMLElement); // stop 50
    });

    const hueLabel = container.querySelector("[data-testid='gp-anchor-editor-hue']");
    const stopLabel = container.querySelector("[data-testid='gp-anchor-editor-stop']");
    expect(hueLabel?.textContent).toBe("red");
    expect(stopLabel?.textContent).toContain("50");
  });

  it("clicking an anchor stop opens the editor with the L input enabled for editing", () => {
    // happy-dom does not propagate fireEvent.change / fireEvent.input on
    // type="number" inputs through React controlled-component state (same
    // known limitation as range inputs — see existing test comments).
    // This test verifies the editor is correctly wired: the L input is
    // enabled for anchor stops and disabled for interpolated stops, confirming
    // the editing interface is ready to accept user input.
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Click red stop-50 swatch (stop 50 is an anchor in BRIO_ANCHORS.red)
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const rows = grid.querySelectorAll("[data-testid='gp-hue-row']");
    const redSwatch50 = rows[1].querySelectorAll("[data-testid='gp-swatch']")[5] as HTMLElement;

    // stop-50 should be marked as an anchor
    expect(redSwatch50.getAttribute("data-anchor")).toBe("true");

    act(() => {
      fireEvent.click(redSwatch50);
    });

    // Editor is open; L input is enabled for anchor stops
    const lInput = container.querySelector("[data-testid='gp-anchor-l-input']") as HTMLInputElement;
    expect(lInput).not.toBeNull();
    expect(lInput.disabled).toBe(false);

    // Click an interpolated stop (e.g., stop-10, index 1) — should disable the L input
    const redSwatch10 = rows[1].querySelectorAll("[data-testid='gp-swatch']")[1] as HTMLElement;
    expect(redSwatch10.getAttribute("data-anchor")).toBe("false");

    act(() => {
      fireEvent.click(redSwatch10);
    });

    const lInputForInterpolated = container.querySelector("[data-testid='gp-anchor-l-input']") as HTMLInputElement;
    expect(lInputForInterpolated).not.toBeNull();
    expect(lInputForInterpolated.disabled).toBe(true);
    // Interpolated note should be shown
    expect(container.querySelector("[data-testid='gp-anchor-interpolated-note']")).not.toBeNull();
  });

  it("gamut warning is absent for in-gamut anchor values and editor renders C input", () => {
    // happy-dom does not propagate fireEvent.change / fireEvent.input on
    // type="number" inputs through React controlled state, so we cannot
    // directly simulate a user typing an over-cap C value.
    // This test verifies:
    //   (a) The gamut warning is absent when the anchor C is within the cap
    //       (confirming the conditional renders correctly for safe values).
    //   (b) The C input exists and is enabled for anchor stops.
    // The gamut warning logic is: isOverGamut = currentC > chromaCap + 0.0001.
    // For red stop-50 in BRIO_ANCHORS, C is 75% of cap (always within cap).
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Click red stop-50 (anchor)
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const rows = grid.querySelectorAll("[data-testid='gp-hue-row']");
    const redSwatch50 = rows[1].querySelectorAll("[data-testid='gp-swatch']")[5] as HTMLElement;
    act(() => {
      fireEvent.click(redSwatch50);
    });

    // Gamut warning should NOT appear for in-cap values
    expect(container.querySelector("[data-testid='gp-anchor-gamut-warning']")).toBeNull();

    // C input is present and enabled
    const cInput = container.querySelector("[data-testid='gp-anchor-c-input']") as HTMLInputElement;
    expect(cInput).not.toBeNull();
    expect(cInput.disabled).toBe(false);

    // The displayed C value is within the cap for red
    const displayedC = parseFloat(cInput.value);
    expect(displayedC).toBeLessThanOrEqual(MAX_CHROMA_FOR_HUE["red"] + 0.001);
  });
});

describe("GalleryPaletteContent – Anchors mode: theme selector", () => {
  afterEach(() => { cleanup(); });

  it("switching the theme selector changes the displayed anchor data (different swatch colors)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryPaletteContent />));
    });

    // Capture brio colors for a mid-intensity stop on red (row 1, stop 50)
    const grid = container.querySelector("[data-testid='gp-anchor-swatch-grid']")!;
    const rows = grid.querySelectorAll("[data-testid='gp-hue-row']");
    const redSwatch50 = rows[1].querySelectorAll("[data-testid='gp-swatch']")[5] as HTMLElement;
    const brioColor = redSwatch50.getAttribute("data-color");
    expect(brioColor).toMatch(/^oklch\(/);

    // Switch to bluenote
    const themeSelect = container.querySelector("[data-testid='gp-anchor-theme-select']") as HTMLSelectElement;
    act(() => {
      fireEvent.change(themeSelect, { target: { value: "bluenote" } });
    });

    const bluenoteColor = redSwatch50.getAttribute("data-color");
    expect(bluenoteColor).toMatch(/^oklch\(/);
    // Bluenote has higher L at stop 50 for red, so the color differs from brio
    expect(bluenoteColor).not.toBe(brioColor);
  });
});
