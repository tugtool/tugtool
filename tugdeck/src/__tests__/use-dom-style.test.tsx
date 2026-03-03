/**
 * useDOMStyle hook tests -- Step 3.
 *
 * Tests cover:
 * - T12: mount sets the inline style property on the ref'd element
 * - T13: value change updates the property to the new value
 * - T14: unmount removes the inline style property (cleanup effect)
 * - T15: null ref on mount does not throw (no-op safety)
 * - T16: empty string value removes the property
 * - T17: property change removes old property and sets new property
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import { useDOMStyle } from "@/components/tugways/hooks";

// ---- Helper: component that exercises useDOMStyle ----

function DOMStyleTarget({
  property,
  value,
  useNullRef = false,
}: {
  property: string;
  value: string;
  useNullRef?: boolean;
}) {
  const realRef = useRef<HTMLDivElement>(null);
  const nullRef = useRef<HTMLDivElement>(null);
  const ref = useNullRef ? nullRef : realRef;
  useDOMStyle(ref, property, value);
  if (useNullRef) {
    // Return without attaching ref -- ref.current stays null
    return <div data-testid="box" />;
  }
  return <div ref={realRef} data-testid="box" />;
}

// ============================================================================
// T12: mount sets the inline style property
// ============================================================================

describe("useDOMStyle – mount sets inline style property", () => {
  it("T12: sets the named style property on the element after mount", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DOMStyleTarget property="border-width" value="2px" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("border-width")).toBe("2px");
  });
});

// ============================================================================
// T13: value change updates the property
// ============================================================================

describe("useDOMStyle – value change updates the property", () => {
  it("T13: re-render with new value applies the updated style property", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DOMStyleTarget property="border-width" value="1px" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("border-width")).toBe("1px");

    act(() => {
      rerender(<DOMStyleTarget property="border-width" value="3px" />);
    });
    expect(box.style.getPropertyValue("border-width")).toBe("3px");
  });
});

// ============================================================================
// T14: unmount removes the inline style property
// ============================================================================

describe("useDOMStyle – unmount removes the inline style property", () => {
  it("T14: cleanup effect removes the style property when component unmounts", () => {
    let container!: HTMLElement;
    let unmount!: () => void;
    act(() => {
      ({ container, unmount } = render(
        <DOMStyleTarget property="border-width" value="4px" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("border-width")).toBe("4px");

    act(() => {
      unmount();
    });
    expect(box.style.getPropertyValue("border-width")).toBe("");
  });
});

// ============================================================================
// T15: null ref does not throw
// ============================================================================

describe("useDOMStyle – null ref is a no-op", () => {
  it("T15: does not throw when ref.current is null on mount", () => {
    expect(() => {
      act(() => {
        render(
          <DOMStyleTarget property="border-width" value="2px" useNullRef />
        );
      });
    }).not.toThrow();
  });
});

// ============================================================================
// T16: empty string value removes the property
// ============================================================================

describe("useDOMStyle – empty string value removes the property", () => {
  it("T16: setting value to empty string removes the property from the element", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DOMStyleTarget property="border-width" value="2px" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("border-width")).toBe("2px");

    act(() => {
      rerender(<DOMStyleTarget property="border-width" value="" />);
    });
    expect(box.style.getPropertyValue("border-width")).toBe("");
  });
});

// ============================================================================
// T17: property change removes old property and sets new property
// ============================================================================

describe("useDOMStyle – property change removes old and sets new", () => {
  it("T17: changing property name removes old property and sets the new one", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DOMStyleTarget property="border-width" value="2px" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("border-width")).toBe("2px");

    act(() => {
      rerender(<DOMStyleTarget property="outline-width" value="2px" />);
    });
    expect(box.style.getPropertyValue("border-width")).toBe("");
    expect(box.style.getPropertyValue("outline-width")).toBe("2px");
  });
});
