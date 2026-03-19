/**
 * MutationModelDemo tests -- Step 5.
 *
 * Tests cover:
 * - T18: MutationModelDemo renders without errors
 * - T19: Three toggle buttons are present in the rendered output
 * - T20: Click "Toggle CSS Var" button and assert --demo-bg is set on the box
 *
 * MutationModelDemo is a self-contained component that does not require a
 * ResponderChainProvider -- it uses direct-action TugButton (onClick) and
 * the three appearance-zone hooks (useCSSVar, useDOMClass, useDOMStyle).
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";

import { MutationModelDemo } from "@/components/tugways/cards/gallery-card";

// ============================================================================
// T18: MutationModelDemo renders without errors
// ============================================================================

describe("MutationModelDemo – renders without errors", () => {
  it("T18: renders the demo box and buttons without throwing", () => {
    let container!: HTMLElement;
    expect(() => {
      act(() => {
        ({ container } = render(<MutationModelDemo />));
      });
    }).not.toThrow();
    const box = container.querySelector("[data-testid='mutation-demo-box']");
    expect(box).not.toBeNull();
  });
});

// ============================================================================
// T19: Three toggle buttons are present
// ============================================================================

describe("MutationModelDemo – three toggle buttons present", () => {
  it("T19: 'Toggle CSS Var', 'Toggle Class', and 'Toggle Style' buttons are rendered", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<MutationModelDemo />));
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const labels = buttons.map((b) => b.textContent?.trim() ?? "");
    expect(labels).toContain("Toggle CSS Var");
    expect(labels).toContain("Toggle Class");
    expect(labels).toContain("Toggle Style");
  });
});

// ============================================================================
// T20: Click "Toggle CSS Var" sets --demo-bg on the box element
// ============================================================================

describe("MutationModelDemo – Toggle CSS Var applies --demo-bg via useCSSVar", () => {
  it("T20: clicking Toggle CSS Var sets --demo-bg on the box element", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<MutationModelDemo />));
    });

    const box = container.querySelector(
      "[data-testid='mutation-demo-box']"
    ) as HTMLElement;
    expect(box).not.toBeNull();

    // Before first click: --demo-bg not set (hook starts with varOn=false,
    // which maps to "var(--tug-base-surface-global-primary-normal-default-rest)" -- a non-empty value so it IS set).
    // After first click: varOn becomes true -> value = "var(--tug-base-element-global-fill-normal-accent-rest)".
    const buttons = Array.from(container.querySelectorAll("button"));
    const toggleCSSVarBtn = buttons.find(
      (b) => b.textContent?.trim() === "Toggle CSS Var"
    )!;
    expect(toggleCSSVarBtn).not.toBeUndefined();

    act(() => {
      fireEvent.click(toggleCSSVarBtn);
    });

    // After click: varOn=true -> --demo-bg = "var(--tug-base-element-global-fill-normal-accent-rest)"
    expect(box.style.getPropertyValue("--demo-bg")).toBe("var(--tug-base-element-global-fill-normal-accent-rest)");
  });
});
