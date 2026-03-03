/**
 * useCSSVar hook tests -- Step 1.
 *
 * Tests cover:
 * - T1: mount sets the CSS custom property on the ref'd element
 * - T2: value change updates the property to the new value
 * - T3: unmount removes the CSS custom property (cleanup effect)
 * - T4: null ref on mount does not throw (no-op safety)
 * - T5: name change removes old property and sets new property
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import { useCSSVar } from "@/components/tugways/hooks";

// ---- Helper: component that exercises useCSSVar ----

function CSSVarTarget({
  name,
  value,
  useNullRef = false,
}: {
  name: string;
  value: string;
  useNullRef?: boolean;
}) {
  const realRef = useRef<HTMLDivElement>(null);
  // A ref that always holds null, for the null-ref safety test
  const nullRef = useRef<HTMLDivElement>(null);
  const ref = useNullRef ? nullRef : realRef;
  useCSSVar(ref, name, value);
  if (useNullRef) {
    // Return without attaching the ref to any element -- ref.current stays null
    return <div data-testid="box" />;
  }
  return <div ref={realRef} data-testid="box" />;
}

// ============================================================================
// T1: mount sets the CSS custom property
// ============================================================================

describe("useCSSVar – mount sets CSS custom property", () => {
  it("T1: sets the named CSS var on the element after mount", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <CSSVarTarget name="--demo-color" value="red" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("--demo-color")).toBe("red");
  });
});

// ============================================================================
// T2: value change updates the property
// ============================================================================

describe("useCSSVar – value change updates the property", () => {
  it("T2: re-render with new value applies the updated CSS var", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <CSSVarTarget name="--demo-color" value="red" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("--demo-color")).toBe("red");

    act(() => {
      rerender(<CSSVarTarget name="--demo-color" value="blue" />);
    });
    expect(box.style.getPropertyValue("--demo-color")).toBe("blue");
  });
});

// ============================================================================
// T3: unmount removes the CSS custom property
// ============================================================================

describe("useCSSVar – unmount removes the CSS custom property", () => {
  it("T3: cleanup effect removes the CSS var when component unmounts", () => {
    let container!: HTMLElement;
    let unmount!: () => void;
    act(() => {
      ({ container, unmount } = render(
        <CSSVarTarget name="--demo-color" value="green" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("--demo-color")).toBe("green");

    act(() => {
      unmount();
    });
    // After unmount, the cleanup function should have removed the property
    expect(box.style.getPropertyValue("--demo-color")).toBe("");
  });
});

// ============================================================================
// T4: null ref does not throw
// ============================================================================

describe("useCSSVar – null ref is a no-op", () => {
  it("T4: does not throw when ref.current is null on mount", () => {
    expect(() => {
      act(() => {
        render(<CSSVarTarget name="--demo-color" value="red" useNullRef />);
      });
    }).not.toThrow();
  });
});

// ============================================================================
// T5: name change removes old property and sets new property
// ============================================================================

describe("useCSSVar – name change removes old and sets new", () => {
  it("T5: changing name removes old property and sets the new one", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <CSSVarTarget name="--demo-old" value="purple" />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.style.getPropertyValue("--demo-old")).toBe("purple");

    act(() => {
      rerender(<CSSVarTarget name="--demo-new" value="purple" />);
    });
    // Old property removed, new one set
    expect(box.style.getPropertyValue("--demo-old")).toBe("");
    expect(box.style.getPropertyValue("--demo-new")).toBe("purple");
  });
});
