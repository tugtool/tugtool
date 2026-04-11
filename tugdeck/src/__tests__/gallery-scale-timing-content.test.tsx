/**
 * GalleryScaleTiming tests -- Scale & Timing demo tab.
 *
 * Tests cover:
 * - GalleryScaleTiming renders without errors (sliders, readout, preview, checkbox)
 * - Motion toggle sets data-tug-motion="off" on body when unchecked
 * - Cleanup on unmount restores all CSS custom properties
 *
 * Slider value-change tests are omitted: TugSlider dispatches through the
 * responder chain via Radix primitives, which do not support synthetic
 * fireEvent in happy-dom. The slider→responder→CSS-property pipeline is
 * covered by the real browser (HMR) and by the responder chain unit tests.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { GalleryScaleTiming } from "@/components/tugways/cards/gallery-scale-timing";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderScaleTiming() {
  let container!: HTMLElement;
  let unmount!: () => void;
  act(() => {
    ({ container, unmount } = render(
      <ResponderChainProvider><GalleryScaleTiming /></ResponderChainProvider>
    ));
  });
  return { container, unmount };
}

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe("GalleryScaleTiming – renders without errors", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-zoom");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.removeAttribute("data-tug-motion");
  });

  it("renders without throwing", () => {
    expect(() => { renderScaleTiming(); }).not.toThrow();
  });

  it("renders the JS helper readout section", () => {
    const { container } = renderScaleTiming();
    expect(container.querySelector("[data-testid='st-readout']")).not.toBeNull();
  });

  it("renders the live preview section", () => {
    const { container } = renderScaleTiming();
    expect(container.querySelector("[data-testid='st-preview']")).not.toBeNull();
  });

  it("preview section contains buttons", () => {
    const { container } = renderScaleTiming();
    const preview = container.querySelector("[data-testid='st-preview']")!;
    expect(preview.querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("renders scale and timing sliders with correct labels", () => {
    const { container } = renderScaleTiming();
    const labels = Array.from(container.querySelectorAll<HTMLElement>(".tug-slider-label")).map(l => l.textContent);
    expect(labels).toContain("--tug-zoom");
    expect(labels).toContain("--tug-timing");
  });

  it("renders slider thumbs", () => {
    const { container } = renderScaleTiming();
    expect(container.querySelectorAll("[role='slider']").length).toBeGreaterThanOrEqual(2);
  });

  it("renders the motion toggle checkbox checked by default", () => {
    const { container } = renderScaleTiming();
    const motionCheck = container.querySelector("[role='checkbox']") as HTMLElement;
    expect(motionCheck).not.toBeNull();
    expect(motionCheck.getAttribute("data-state")).toBe("checked");
  });
});

// ---------------------------------------------------------------------------
// Checkbox interactions
// ---------------------------------------------------------------------------

describe("GalleryScaleTiming – checkbox interactions", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-zoom");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.removeAttribute("data-tug-motion");
  });

  it("unchecking motion toggle sets data-tug-motion='off' on body", () => {
    const { container } = renderScaleTiming();
    act(() => { fireEvent.click(container.querySelector("[role='checkbox']") as HTMLElement); });
    expect(document.body.getAttribute("data-tug-motion")).toBe("off");
  });

  it("re-checking motion toggle removes data-tug-motion from body", () => {
    const { container } = renderScaleTiming();
    const cb = container.querySelector("[role='checkbox']") as HTMLElement;
    act(() => { fireEvent.click(cb); }); // off
    act(() => { fireEvent.click(cb); }); // on again
    expect(document.body.getAttribute("data-tug-motion")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cleanup on unmount
// ---------------------------------------------------------------------------

describe("GalleryScaleTiming – cleanup on unmount", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-zoom");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.removeAttribute("data-tug-motion");
  });

  it("removes data-tug-motion attribute from body on unmount", () => {
    const { container, unmount } = renderScaleTiming();
    act(() => { fireEvent.click(container.querySelector("[role='checkbox']") as HTMLElement); });
    expect(document.body.getAttribute("data-tug-motion")).toBe("off");
    act(() => { unmount(); });
    expect(document.body.getAttribute("data-tug-motion")).toBeNull();
  });
});
