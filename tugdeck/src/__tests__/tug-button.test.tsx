/**
 * TugButton unit tests -- Step 1.
 *
 * Tests cover:
 * - Default render (push, secondary, md)
 * - All four subtypes: push, icon, icon-text, three-state
 * - All four variants: primary, secondary, ghost, destructive
 * - All three sizes: sm, md, lg
 * - Icon subtype square aspect ratio class
 * - Three-state: aria-pressed matches state prop
 * - Three-state: click toggles on/off and calls onStateChange
 * - Loading state: aria-busy and spinner
 * - Disabled state: disabled attribute
 * - Icon subtype without aria-label: console.warn
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";

import { TugButton } from "@/components/tugways/tug-button";

// ---- Helper: render TugButton and get the <button> element ----

function renderButton(props: Parameters<typeof TugButton>[0] = {}) {
  const { container } = render(<TugButton {...props} />);
  return container.querySelector("button") as HTMLButtonElement;
}

// ============================================================================
// Default render
// ============================================================================

describe("TugButton – default render", () => {
  it("renders a button element", () => {
    const btn = renderButton();
    expect(btn).not.toBeNull();
  });

  it("renders with default props (push, secondary, md)", () => {
    const btn = renderButton({ children: "Click me" });
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Click me");
    // Should not be disabled by default
    expect(btn.disabled).toBe(false);
  });
});

// ============================================================================
// Subtype rendering
// ============================================================================

describe("TugButton – push subtype", () => {
  it("renders children as content", () => {
    const btn = renderButton({ subtype: "push", children: "Save" });
    expect(btn.textContent).toContain("Save");
  });

  it("calls onClick when clicked", () => {
    const handler = mock(() => {});
    const btn = renderButton({ subtype: "push", children: "Go", onClick: handler });
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("TugButton – icon subtype", () => {
  it("renders without children", () => {
    const icon = <span data-testid="icon">X</span>;
    const { container } = render(
      <TugButton subtype="icon" icon={icon} aria-label="Close" />
    );
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.querySelector("[data-testid='icon']")).not.toBeNull();
  });

  it("applies square aspect ratio class for sm size", () => {
    const { container } = render(
      <TugButton subtype="icon" size="sm" icon={<span>X</span>} aria-label="Close" />
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-icon-sm");
  });

  it("applies square aspect ratio class for md size", () => {
    const { container } = render(
      <TugButton subtype="icon" size="md" icon={<span>X</span>} aria-label="Close" />
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-icon-md");
  });

  it("applies square aspect ratio class for lg size", () => {
    const { container } = render(
      <TugButton subtype="icon" size="lg" icon={<span>X</span>} aria-label="Close" />
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-icon-lg");
  });

  it("logs dev warning when aria-label and children are missing", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    render(<TugButton subtype="icon" icon={<span>X</span>} />);
    expect(warnSpy).toHaveBeenCalled();
    const warningArgs = warnSpy.mock.calls[0];
    expect(String(warningArgs[0])).toContain("aria-label");
    warnSpy.mockRestore();
  });
});

describe("TugButton – icon-text subtype", () => {
  it("renders both icon and label", () => {
    const icon = <span data-testid="icon">*</span>;
    const { container } = render(
      <TugButton subtype="icon-text" icon={icon}>
        Submit
      </TugButton>
    );
    const btn = container.querySelector("button");
    expect(btn?.querySelector("[data-testid='icon']")).not.toBeNull();
    expect(btn?.textContent).toContain("Submit");
  });

  it("applies icon-text layout wrapper class", () => {
    const { container } = render(
      <TugButton subtype="icon-text" icon={<span>*</span>}>
        Label
      </TugButton>
    );
    const btn = container.querySelector("button");
    expect(btn?.querySelector(".tug-button-icon-text")).not.toBeNull();
  });
});

describe("TugButton – three-state subtype", () => {
  it("sets aria-pressed to false when state is 'off'", () => {
    const btn = renderButton({
      subtype: "three-state",
      state: "off",
      children: "Toggle",
    });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("sets aria-pressed to true when state is 'on'", () => {
    const btn = renderButton({
      subtype: "three-state",
      state: "on",
      children: "Toggle",
    });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("sets aria-pressed to 'mixed' when state is 'mixed'", () => {
    const btn = renderButton({
      subtype: "three-state",
      state: "mixed",
      children: "Toggle",
    });
    expect(btn.getAttribute("aria-pressed")).toBe("mixed");
  });

  it("cycles from off to on and calls onStateChange", async () => {
    const onChange = mock((_state: string) => {});
    const { container } = render(
      <TugButton subtype="three-state" state="off" onStateChange={onChange}>
        Toggle
      </TugButton>
    );
    const btn = container.querySelector("button")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("on");
  });

  it("cycles from on to mixed and calls onStateChange", async () => {
    const onChange = mock((_state: string) => {});
    const { container } = render(
      <TugButton subtype="three-state" state="on" onStateChange={onChange}>
        Toggle
      </TugButton>
    );
    const btn = container.querySelector("button")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("mixed");
  });

  it("cycles from mixed to off and calls onStateChange", async () => {
    const onChange = mock((_state: string) => {});
    const { container } = render(
      <TugButton subtype="three-state" state="mixed" onStateChange={onChange}>
        Toggle
      </TugButton>
    );
    const btn = container.querySelector("button")!;
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe("off");
  });

  it("shows state indicator element", () => {
    const { container } = render(
      <TugButton subtype="three-state" state="off" children="Toggle" />
    );
    const indicator = container.querySelector(".tug-button-state-indicator");
    expect(indicator).not.toBeNull();
  });

  it("applies state CSS classes: tug-button-state-on", () => {
    const { container } = render(
      <TugButton subtype="three-state" state="on" children="Toggle" />
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-state-on");
  });

  it("applies state CSS classes: tug-button-state-off", () => {
    const { container } = render(
      <TugButton subtype="three-state" state="off" children="Toggle" />
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-state-off");
  });

  it("applies state CSS classes: tug-button-state-mixed", () => {
    const { container } = render(
      <TugButton subtype="three-state" state="mixed" children="Toggle" />
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-state-mixed");
  });
});

// ============================================================================
// Variant CSS classes
// ============================================================================

describe("TugButton – variants", () => {
  it("primary variant: maps to shadcn default and applies variant class", () => {
    const btn = renderButton({ variant: "primary", children: "Primary" });
    expect(btn.className).toContain("bg-primary");
    expect(btn.className).toContain("tug-button-primary");
    expect(btn.className).toContain("tug-button-bordered");
  });

  it("secondary variant: maps to shadcn secondary and applies variant class", () => {
    const btn = renderButton({ variant: "secondary", children: "Secondary" });
    expect(btn.className).toContain("bg-secondary");
    expect(btn.className).toContain("tug-button-secondary");
    expect(btn.className).toContain("tug-button-bordered");
  });

  it("ghost variant: applies tug-button-ghost class, no border", () => {
    const btn = renderButton({ variant: "ghost", children: "Ghost" });
    expect(btn.className).toContain("tug-button-ghost");
    expect(btn.className).not.toContain("tug-button-bordered");
  });

  it("destructive variant: maps to shadcn destructive and applies variant class", () => {
    const btn = renderButton({ variant: "destructive", children: "Delete" });
    expect(btn.className).toContain("bg-destructive");
    expect(btn.className).toContain("tug-button-destructive");
    expect(btn.className).toContain("tug-button-bordered");
  });
});

// ============================================================================
// Size CSS classes
// ============================================================================

describe("TugButton – sizes", () => {
  it("sm size: applies h-9 class", () => {
    const btn = renderButton({ size: "sm", children: "Small" });
    expect(btn.className).toContain("h-9");
  });

  it("md size: applies h-10 class (shadcn default)", () => {
    const btn = renderButton({ size: "md", children: "Medium" });
    expect(btn.className).toContain("h-10");
  });

  it("lg size: applies h-11 class", () => {
    const btn = renderButton({ size: "lg", children: "Large" });
    expect(btn.className).toContain("h-11");
  });
});

// ============================================================================
// Loading state
// ============================================================================

describe("TugButton – loading state", () => {
  it("sets aria-busy=true when loading", () => {
    const btn = renderButton({ loading: true, children: "Saving" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });

  it("does not set aria-busy when not loading", () => {
    const btn = renderButton({ loading: false, children: "Save" });
    expect(btn.getAttribute("aria-busy")).toBeNull();
  });

  it("renders spinner element when loading", () => {
    const { container } = render(<TugButton loading={true}>Saving</TugButton>);
    const spinner = container.querySelector(".tug-button-spinner");
    expect(spinner).not.toBeNull();
  });

  it("applies tug-button-loading class when loading", () => {
    const btn = renderButton({ loading: true, children: "Saving" });
    expect(btn.className).toContain("tug-button-loading");
  });

  it("button is disabled when loading (pointer-events disabled via HTML disabled)", () => {
    const btn = renderButton({ loading: true, children: "Saving" });
    expect(btn.disabled).toBe(true);
  });

  it("does not call onClick when loading", () => {
    const handler = mock(() => {});
    const btn = renderButton({ loading: true, onClick: handler, children: "Save" });
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(0);
  });
});

// ============================================================================
// Disabled state
// ============================================================================

describe("TugButton – disabled state", () => {
  it("sets disabled attribute when disabled=true", () => {
    const btn = renderButton({ disabled: true, children: "Disabled" });
    expect(btn.disabled).toBe(true);
  });

  it("is not disabled by default", () => {
    const btn = renderButton({ children: "Active" });
    expect(btn.disabled).toBe(false);
  });

  it("does not call onClick when disabled", () => {
    const handler = mock(() => {});
    const btn = renderButton({ disabled: true, onClick: handler, children: "Save" });
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(0);
  });
});
