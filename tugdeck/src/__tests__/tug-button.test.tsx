/**
 * TugButton unit tests.
 *
 * Tests cover:
 * - Default render (text, outlined action, md)
 * - All three subtypes: text, icon, icon-text
 * - Emphasis x role system: default class, all 8 Table T01 combinations
 * - All three sizes: sm, md, lg
 * - Icon subtype square aspect ratio class
 * - Loading state: aria-busy and spinner
 * - Disabled state: disabled attribute
 * - Icon subtype without aria-label: console.warn
 * - TugPushButton: wrapper, class, props, ref, onClick
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock, spyOn } from "bun:test";
import { render, fireEvent } from "@testing-library/react";

import { TugButton, TugPushButton } from "@/components/tugways/tug-button";

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

  it("renders with default props (text, outlined action, md)", () => {
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

describe("TugButton – text subtype", () => {
  it("renders children as content", () => {
    const btn = renderButton({ children: "Save" });
    expect(btn.textContent).toContain("Save");
  });

  it("calls onClick when clicked", () => {
    const handler = mock(() => {});
    const btn = renderButton({ children: "Go", onClick: handler });
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

  it("emphasis=outlined role=active: applies tug-button-outlined-action class", () => {
    const btn = renderButton({ emphasis: "outlined", role: "action", children: "Secondary" });
    expect(btn.className).toContain("tug-button-outlined-action");
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

// ============================================================================
// forwardRef: ref forwarding
// ============================================================================

describe("TugButton – forwardRef", () => {
  it("forwards a ref to the underlying button element", () => {
    let capturedRef: HTMLButtonElement | null = null;
    const { container } = render(
      <TugButton ref={(el) => { capturedRef = el; }}>Ref Test</TugButton>
    );
    const btn = container.querySelector("button");
    expect(capturedRef).not.toBeNull();
    expect(capturedRef).toBe(btn);
  });
});

// ============================================================================
// rest props: Radix-merged props reach the DOM
// ============================================================================

describe("TugButton – rest props (Radix composition)", () => {
  it("passes arbitrary data attributes to the DOM button", () => {
    const btn = renderButton({ children: "Open", "data-state": "open" } as Parameters<typeof TugButton>[0]);
    expect(btn.getAttribute("data-state")).toBe("open");
  });

  it("passes aria-expanded to the DOM button", () => {
    const btn = renderButton({ children: "Open", "aria-expanded": true } as Parameters<typeof TugButton>[0]);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });
});

// ============================================================================
// trailingIcon prop
// ============================================================================

describe("TugButton – trailingIcon prop", () => {
  it("renders trailingIcon in text subtype when provided", () => {
    const trailing = <span data-testid="trailing-chevron">v</span>;
    const { container } = render(
      <TugButton trailingIcon={trailing}>Open</TugButton>
    );
    const wrapper = container.querySelector(".tug-button-trailing-icon");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("[data-testid='trailing-chevron']")).not.toBeNull();
  });

  it("renders trailingIcon in icon-text subtype when provided", () => {
    const icon = <span data-testid="leading-icon">*</span>;
    const trailing = <span data-testid="trailing-chevron">v</span>;
    const { container } = render(
      <TugButton subtype="icon-text" icon={icon} trailingIcon={trailing}>Open</TugButton>
    );
    const wrapper = container.querySelector(".tug-button-trailing-icon");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("[data-testid='trailing-chevron']")).not.toBeNull();
  });

  it("does NOT render .tug-button-trailing-icon when trailingIcon is not provided", () => {
    const { container } = render(
      <TugButton>Save</TugButton>
    );
    const wrapper = container.querySelector(".tug-button-trailing-icon");
    expect(wrapper).toBeNull();
  });
});

// ============================================================================
// TugPushButton (T03–T07)
// ============================================================================

describe("TugPushButton", () => {
  it("T03: renders a button element", () => {
    const { container } = render(<TugPushButton>Save</TugPushButton>);
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
  });

  it("T04: applies .tug-push-button class", () => {
    const { container } = render(<TugPushButton>Save</TugPushButton>);
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-push-button");
  });

  it("T05: forwards all TugButton props (emphasis, role, size)", () => {
    const { container } = render(
      <TugPushButton emphasis="filled" role="accent" size="sm">
        Save
      </TugPushButton>
    );
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("tug-button-filled-accent");
    expect(btn?.className).toContain("tug-button-size-sm");
  });

  it("T06: forwards ref to underlying button element", () => {
    let capturedRef: HTMLButtonElement | null = null;
    const { container } = render(
      <TugPushButton ref={(el) => { capturedRef = el; }}>Save</TugPushButton>
    );
    const btn = container.querySelector("button");
    expect(capturedRef).not.toBeNull();
    expect(capturedRef).toBe(btn);
  });

  it("T07: calls onClick when clicked", () => {
    const handler = mock(() => {});
    const { container } = render(
      <TugPushButton onClick={handler}>Save</TugPushButton>
    );
    const btn = container.querySelector("button")!;
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
