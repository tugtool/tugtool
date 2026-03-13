/**
 * TugButton unit tests.
 *
 * Tests cover:
 * - Default render (push, outlined active, md)
 * - All four subtypes: push, icon, icon-text, three-state
 * - Emphasis x role system: default class, all 8 Table T01 combinations
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

  it("renders with default props (push, outlined active, md)", () => {
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
// Emphasis x Role CSS classes (Spec S02, [D03])
// ============================================================================

describe("TugButton – emphasis x role", () => {
  it("default (no props): applies tug-button-outlined-action class [D04]", () => {
    const btn = renderButton({ children: "Default" });
    expect(btn.className).toContain("tug-button-outlined-action");
  });

  it("emphasis=filled role=accent: applies tug-button-filled-accent class", () => {
    const btn = renderButton({ emphasis: "filled", role: "accent", children: "CTA" });
    expect(btn.className).toContain("tug-button-filled-accent");
  });

  it("emphasis=filled role=active: applies tug-button-filled-action class", () => {
    const btn = renderButton({ emphasis: "filled", role: "action", children: "Active" });
    expect(btn.className).toContain("tug-button-filled-action");
  });

  it("emphasis=filled role=danger: applies tug-button-filled-danger class", () => {
    const btn = renderButton({ emphasis: "filled", role: "danger", children: "Delete" });
    expect(btn.className).toContain("tug-button-filled-danger");
  });

  it("emphasis=filled role=agent: applies tug-button-filled-agent class", () => {
    const btn = renderButton({ emphasis: "filled", role: "agent", children: "AI" });
    expect(btn.className).toContain("tug-button-filled-agent");
  });

  it("emphasis=outlined role=active: applies tug-button-outlined-action class", () => {
    const btn = renderButton({ emphasis: "outlined", role: "action", children: "Secondary" });
    expect(btn.className).toContain("tug-button-outlined-action");
  });

  it("emphasis=outlined role=agent: applies tug-button-outlined-agent class", () => {
    const btn = renderButton({ emphasis: "outlined", role: "agent", children: "AI Sec" });
    expect(btn.className).toContain("tug-button-outlined-agent");
  });

  it("emphasis=ghost role=active: applies tug-button-ghost-action class", () => {
    const btn = renderButton({ emphasis: "ghost", role: "action", children: "Ghost" });
    expect(btn.className).toContain("tug-button-ghost-action");
  });

  it("emphasis=ghost role=danger: applies tug-button-ghost-danger class", () => {
    const btn = renderButton({ emphasis: "ghost", role: "danger", children: "Subtle Delete" });
    expect(btn.className).toContain("tug-button-ghost-danger");
  });
});

// ============================================================================
// Size CSS classes
// ============================================================================

describe("TugButton – sizes", () => {
  it("sm size: applies tug-button-size-sm class", () => {
    const btn = renderButton({ size: "sm", children: "Small" });
    expect(btn.className).toContain("tug-button-size-sm");
  });

  it("md size: applies tug-button-size-md class", () => {
    const btn = renderButton({ size: "md", children: "Medium" });
    expect(btn.className).toContain("tug-button-size-md");
  });

  it("lg size: applies tug-button-size-lg class", () => {
    const btn = renderButton({ size: "lg", children: "Large" });
    expect(btn.className).toContain("tug-button-size-lg");
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

  it("renders spinner overlay when loading", () => {
    const { container } = render(<TugButton loading={true}>Saving</TugButton>);
    const spinner = container.querySelector(".tug-button-spinner-overlay");
    expect(spinner).not.toBeNull();
  });

  it("applies tug-button-loading class when loading", () => {
    const btn = renderButton({ loading: true, children: "Saving" });
    expect(btn.className).toContain("tug-button-loading");
  });

  it("loading button has pointer-events disabled via CSS class, not HTML disabled", () => {
    const btn = renderButton({ loading: true, children: "Saving" });
    expect(btn.className).toContain("tug-button-loading");
    expect(btn.disabled).toBe(false);
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

// ============================================================================
// aria-disabled (chain-action-independent direct-action check)
// ============================================================================

describe("TugButton – aria-disabled in direct-action mode", () => {
  it("direct-action button does not set aria-disabled by default", () => {
    const btn = renderButton({ children: "Active" });
    expect(btn.getAttribute("aria-disabled")).toBeNull();
  });

  it("disabled button still carries tug-button base class", () => {
    const btn = renderButton({ disabled: true, children: "Disabled" });
    expect(btn.className).toContain("tug-button");
    expect(btn.disabled).toBe(true);
  });
});
