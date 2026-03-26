/**
 * GalleryScaleTimingContent tests -- Scale & Timing demo tab.
 *
 * Tests cover:
 * - GalleryScaleTimingContent renders without errors
 * - Scale slider is present with correct range and default value
 * - Scale slider sets --tug-zoom on :root via onCommit (pointer release)
 * - Timing slider sets --tug-timing on :root continuously
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

import { GalleryScaleTimingContent } from "@/components/tugways/cards/gallery-scale-timing";

// ---------------------------------------------------------------------------
// Helper: invoke a React input element's onChange handler directly.
// happy-dom does not propagate fireEvent.change to React synthetic events for
// controlled range inputs. Calling the handler via React fiber props is the
// only reliable way to test onChange side effects in this environment.
// ---------------------------------------------------------------------------

function getReactProps(el: HTMLElement): Record<string, unknown> | null {
  const key = Object.keys(el).find(
    (k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$")
  );
  if (!key) return null;

  const fiberOrProps = (el as unknown as Record<string, unknown>)[key];

  if (key.startsWith("__reactProps$")) {
    return fiberOrProps as Record<string, unknown>;
  }

  // Traverse up the fiber chain to find memoizedProps
  let fiber = fiberOrProps as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
  while (fiber) {
    if (fiber.memoizedProps) return fiber.memoizedProps;
    fiber = fiber.return as typeof fiber;
  }
  return null;
}

function invokeRangeOnChange(el: HTMLInputElement, value: string): void {
  const props = getReactProps(el);
  const onChange = props?.["onChange"] as ((e: { target: { value: string } }) => void) | undefined;
  if (typeof onChange === "function") {
    act(() => { onChange!({ target: { value } }); });
  }
}

function invokeRangeOnPointerUp(el: HTMLInputElement, value: string): void {
  const props = getReactProps(el);
  const onPointerUp = props?.["onPointerUp"] as ((e: { target: { value: string } }) => void) | undefined;
  if (typeof onPointerUp === "function") {
    act(() => { onPointerUp!({ target: { value } } as unknown as React.PointerEvent<HTMLInputElement>); });
  }
}

// ---------------------------------------------------------------------------
// Render tests
// ---------------------------------------------------------------------------

describe("GalleryScaleTimingContent – renders without errors", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-zoom");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.removeAttribute("data-tug-motion");
  });

  it("renders without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<GalleryScaleTimingContent />));
      });
    }).not.toThrow();
    expect(container.querySelector("[data-testid='gallery-scale-timing']")).not.toBeNull();
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
});

// ---------------------------------------------------------------------------
// Slider interactions
// ---------------------------------------------------------------------------

describe("GalleryScaleTimingContent – slider interactions", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.style.removeProperty("--tug-zoom");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.removeAttribute("data-tug-motion");
  });

  it("scale slider onCommit (pointer up) sets --tug-zoom on :root", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    invokeRangeOnChange(scaleInput, "1.5");
    invokeRangeOnPointerUp(scaleInput, "1.5");
    const applied = document.documentElement.style.getPropertyValue("--tug-zoom");
    expect(applied).toBe("1.5");
  });

  it("scale slider onChange alone does NOT set --tug-zoom (deferred to commit)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    invokeRangeOnChange(scaleInput, "1.5");
    // onChange only updates React state; CSS property is set on pointer release
    const applied = document.documentElement.style.getPropertyValue("--tug-zoom");
    expect(applied).toBe("");
  });

  it("after scale commit, preview area still renders buttons", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    invokeRangeOnChange(scaleInput, "1.25");
    invokeRangeOnPointerUp(scaleInput, "1.25");
    const preview = container.querySelector("[data-testid='st-preview']")!;
    const buttons = preview.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    expect(document.documentElement.style.getPropertyValue("--tug-zoom")).toBe("1.25");
  });

  it("timing slider onChange sets --tug-timing on :root", () => {
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
    document.documentElement.style.removeProperty("--tug-zoom");
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
    document.body.removeAttribute("data-tug-motion");
  });

  it("removes --tug-zoom from :root on unmount", () => {
    let container!: HTMLElement;
    let unmount!: () => void;
    act(() => {
      ({ container, unmount } = render(<GalleryScaleTimingContent />));
    });
    const scaleInput = container.querySelector("#st-scale") as HTMLInputElement;
    invokeRangeOnChange(scaleInput, "1.5");
    invokeRangeOnPointerUp(scaleInput, "1.5");
    expect(document.documentElement.style.getPropertyValue("--tug-zoom")).toBe("1.5");
    act(() => { unmount(); });
    expect(document.documentElement.style.getPropertyValue("--tug-zoom")).toBe("");
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
