/**
 * GalleryScaleTimingContent tests -- Scale & Timing demo tab.
 *
 * Tests cover:
 * - GalleryScaleTimingContent renders without errors
 * - Scale slider is present with correct range and default value
 * - Moving scale slider (via React prop call) sets --tug-scale on :root
 * - Motion toggle sets data-tug-motion="off" on body when unchecked
 *
 * Implementation note: happy-dom does not propagate fireEvent.change to React's
 * synthetic onChange handler for controlled range inputs. The slider interaction
 * tests invoke the React onChange handler directly via the element's React fiber
 * props, which is the established pattern for testing range inputs in this test
 * suite under bun + happy-dom.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { GalleryScaleTimingContent } from "@/components/tugways/cards/gallery-scale-timing-content";

// ---------------------------------------------------------------------------
// Helper: invoke a React input element's onChange handler directly.
// happy-dom does not propagate fireEvent.change to React synthetic events for
// controlled range inputs. Calling the handler via React fiber props is the
// only reliable way to test onChange side effects in this environment.
// ---------------------------------------------------------------------------

function invokeRangeOnChange(el: HTMLInputElement, value: string): void {
  // Access the React internal fiber to retrieve the memoized props with onChange.
  // The key is "__reactFiber$..." or "__reactProps$..." depending on React version.
  const key = Object.keys(el).find(
    (k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$")
  );
  if (!key) return;

  const fiberOrProps = (el as unknown as Record<string, unknown>)[key];

  // React 19 uses __reactProps$ which directly holds the props object.
  let onChange: ((e: { target: { value: string } }) => void) | undefined;
  if (key.startsWith("__reactProps$")) {
    const props = fiberOrProps as Record<string, unknown>;
    onChange = props["onChange"] as typeof onChange;
  } else {
    // Traverse up the fiber chain to find memoizedProps.onChange
    let fiber = fiberOrProps as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
    while (fiber && !onChange) {
      if (fiber.memoizedProps?.["onChange"]) {
        onChange = fiber.memoizedProps["onChange"] as typeof onChange;
      }
      fiber = fiber.return as typeof fiber;
    }
  }

  if (typeof onChange === "function") {
    act(() => {
      onChange!({ target: { value } });
    });
  }
}

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe("GalleryScaleTimingContent – renders without errors", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-scale");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.style.removeProperty("--tug-comp-button-scale");
    document.body.style.removeProperty("--tug-comp-tab-scale");
    document.body.style.removeProperty("--tug-comp-dock-scale");
    document.body.removeAttribute("data-tug-motion");
  });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryScaleTimingContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-scale-timing-content']")).not.toBeNull();
  });

  it("renders the JS helper readout section", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    expect(container.querySelector("[data-testid='st-readout']")).not.toBeNull();
  });

  it("renders the live preview section", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    expect(container.querySelector("[data-testid='st-preview']")).not.toBeNull();
  });

  it("preview section contains buttons", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const preview = container.querySelector("[data-testid='st-preview']")!;
    const buttons = preview.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("renders the scale range input with correct attributes", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    expect(scaleInput).not.toBeNull();
    expect(scaleInput.type).toBe("range");
    expect(scaleInput.min).toBe("0.85");
    expect(scaleInput.max).toBe("2");
    expect(scaleInput.value).toBe("1");
  });

  it("renders the timing range input with correct attributes", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const timingInput = container.querySelector("#st-timing") as HTMLInputElement;
    expect(timingInput).not.toBeNull();
    expect(timingInput.type).toBe("range");
    expect(timingInput.min).toBe("0.1");
    expect(timingInput.max).toBe("10");
    expect(timingInput.value).toBe("1");
  });

  it("renders the motion toggle checkbox checked by default", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const motionCheck = container.querySelector("#st-motion") as HTMLInputElement;
    expect(motionCheck).not.toBeNull();
    expect(motionCheck.type).toBe("checkbox");
    expect(motionCheck.checked).toBe(true);
  });

  it("renders component-level scale sliders for button, tab, and dock", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    expect(container.querySelector("#st-button-scale")).not.toBeNull();
    expect(container.querySelector("#st-tab-scale")).not.toBeNull();
    expect(container.querySelector("#st-dock-scale")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scale slider updates --tug-scale on :root and visually affects preview
// ---------------------------------------------------------------------------

describe("GalleryScaleTimingContent – scale slider updates --tug-scale on :root", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-scale");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.style.removeProperty("--tug-comp-button-scale");
    document.body.style.removeProperty("--tug-comp-tab-scale");
    document.body.style.removeProperty("--tug-comp-dock-scale");
    document.body.removeAttribute("data-tug-motion");
  });

  it("invoking scale slider onChange sets --tug-scale on document.documentElement", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    invokeRangeOnChange(scaleInput, "1.5");
    const applied = document.documentElement.style.getPropertyValue("--tug-scale");
    expect(applied).toBe("1.5");
  });

  it("after scale change, preview area still renders buttons (visually affected)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    invokeRangeOnChange(scaleInput, "1.25");
    // --tug-scale is set on :root; buttons in the preview are affected via
    // --td-space-* tokens which now resolve through calc(Npx * var(--tug-scale))
    const preview = container.querySelector("[data-testid='st-preview']")!;
    const buttons = preview.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(document.documentElement.style.getPropertyValue("--tug-scale")).toBe("1.25");
  });

  it("invoking timing slider onChange sets --tug-timing on document.documentElement", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const timingInput = container.querySelector("#st-timing") as HTMLInputElement;
    invokeRangeOnChange(timingInput, "5");
    const applied = document.documentElement.style.getPropertyValue("--tug-timing");
    expect(applied).toBe("5");
  });

  it("unchecking motion toggle sets data-tug-motion='off' on body", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const motionCheck = container.querySelector("#st-motion") as HTMLInputElement;
    act(() => { fireEvent.click(motionCheck); });
    expect(document.body.getAttribute("data-tug-motion")).toBe("off");
  });

  it("re-checking motion toggle removes data-tug-motion from body", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const motionCheck = container.querySelector("#st-motion") as HTMLInputElement;
    act(() => { fireEvent.click(motionCheck); }); // off
    act(() => { fireEvent.click(motionCheck); }); // on again
    expect(document.body.getAttribute("data-tug-motion")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cleanup on unmount
// ---------------------------------------------------------------------------

describe("GalleryScaleTimingContent – cleanup on unmount", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-scale");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.style.removeProperty("--tug-comp-button-scale");
    document.body.style.removeProperty("--tug-comp-tab-scale");
    document.body.style.removeProperty("--tug-comp-dock-scale");
    document.body.removeAttribute("data-tug-motion");
  });

  it("removes --tug-scale from :root on unmount", () => {
    let container!: HTMLElement;
    let unmount!: () => void;
    act(() => {
      ({ container, unmount } = render(<GalleryScaleTimingContent />));
    });
    invokeRangeOnChange(container.querySelector("#st-scale") as HTMLInputElement, "1.5");
    expect(document.documentElement.style.getPropertyValue("--tug-scale")).toBe("1.5");
    act(() => { unmount(); });
    expect(document.documentElement.style.getPropertyValue("--tug-scale")).toBe("");
  });

  it("removes data-tug-motion attribute from body on unmount", () => {
    let container!: HTMLElement;
    let unmount!: () => void;
    act(() => {
      ({ container, unmount } = render(<GalleryScaleTimingContent />));
    });
    act(() => { fireEvent.click(container.querySelector("#st-motion") as HTMLInputElement); });
    expect(document.body.getAttribute("data-tug-motion")).toBe("off");
    act(() => { unmount(); });
    expect(document.body.getAttribute("data-tug-motion")).toBeNull();
  });
});
