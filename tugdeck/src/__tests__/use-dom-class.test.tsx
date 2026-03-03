/**
 * useDOMClass hook tests -- Step 2.
 *
 * Tests cover:
 * - T6:  mount with condition=true adds the class to the element
 * - T7:  mount with condition=false does not add the class
 * - T8:  condition change from true to false removes the class
 * - T9:  unmount removes the class (cleanup effect)
 * - T10: null ref on mount does not throw (no-op safety)
 * - T11: className change removes old class and adds new class (when condition=true)
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import { useDOMClass } from "@/components/tugways/hooks";

// ---- Helper: component that exercises useDOMClass ----

function DOMClassTarget({
  className,
  condition,
  useNullRef = false,
}: {
  className: string;
  condition: boolean;
  useNullRef?: boolean;
}) {
  const realRef = useRef<HTMLDivElement>(null);
  const nullRef = useRef<HTMLDivElement>(null);
  const ref = useNullRef ? nullRef : realRef;
  useDOMClass(ref, className, condition);
  if (useNullRef) {
    // Return without attaching ref -- ref.current stays null
    return <div data-testid="box" />;
  }
  return <div ref={realRef} data-testid="box" />;
}

// ============================================================================
// T6: mount with condition=true adds the class
// ============================================================================

describe("useDOMClass – mount with condition=true adds class", () => {
  it("T6: class is present on the element after mount when condition is true", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DOMClassTarget className="demo-active" condition={true} />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.classList.contains("demo-active")).toBe(true);
  });
});

// ============================================================================
// T7: mount with condition=false does not add the class
// ============================================================================

describe("useDOMClass – mount with condition=false does not add class", () => {
  it("T7: class is absent on the element after mount when condition is false", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DOMClassTarget className="demo-active" condition={false} />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.classList.contains("demo-active")).toBe(false);
  });
});

// ============================================================================
// T8: condition change from true to false removes the class
// ============================================================================

describe("useDOMClass – condition change from true to false removes class", () => {
  it("T8: re-render with condition=false removes the class", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DOMClassTarget className="demo-active" condition={true} />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.classList.contains("demo-active")).toBe(true);

    act(() => {
      rerender(<DOMClassTarget className="demo-active" condition={false} />);
    });
    expect(box.classList.contains("demo-active")).toBe(false);
  });
});

// ============================================================================
// T9: unmount removes the class
// ============================================================================

describe("useDOMClass – unmount removes the class", () => {
  it("T9: cleanup effect removes the class when component unmounts", () => {
    let container!: HTMLElement;
    let unmount!: () => void;
    act(() => {
      ({ container, unmount } = render(
        <DOMClassTarget className="demo-active" condition={true} />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.classList.contains("demo-active")).toBe(true);

    act(() => {
      unmount();
    });
    expect(box.classList.contains("demo-active")).toBe(false);
  });
});

// ============================================================================
// T10: null ref does not throw
// ============================================================================

describe("useDOMClass – null ref is a no-op", () => {
  it("T10: does not throw when ref.current is null on mount", () => {
    expect(() => {
      act(() => {
        render(
          <DOMClassTarget className="demo-active" condition={true} useNullRef />
        );
      });
    }).not.toThrow();
  });
});

// ============================================================================
// T11: className change removes old class and adds new class (condition=true)
// ============================================================================

describe("useDOMClass – className change removes old and adds new", () => {
  it("T11: changing className removes old class and sets the new one", () => {
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DOMClassTarget className="demo-old" condition={true} />
      ));
    });
    const box = container.querySelector("[data-testid='box']") as HTMLElement;
    expect(box.classList.contains("demo-old")).toBe(true);

    act(() => {
      rerender(<DOMClassTarget className="demo-new" condition={true} />);
    });
    expect(box.classList.contains("demo-old")).toBe(false);
    expect(box.classList.contains("demo-new")).toBe(true);
  });
});
