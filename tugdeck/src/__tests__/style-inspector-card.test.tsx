/**
 * StyleInspectorContent card tests -- Step 3.
 *
 * Tests cover:
 * - registerStyleInspectorCard registers with componentId "style-inspector"
 * - StyleInspectorContent renders empty state when no element is selected
 * - StyleInspectorContent has an inspect button in its rendered output
 * - Three-state button: rest / scanning / inspecting label and class assertions
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import { StyleInspectorContent, registerStyleInspectorCard } from "@/components/tugways/cards/style-inspector-card";
import { getRegistration, _resetForTest } from "@/card-registry";

// Clean up mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ============================================================================
// T-SI-01: registerStyleInspectorCard registers with componentId "style-inspector"
// ============================================================================

describe("registerStyleInspectorCard -- T-SI-01: registers 'style-inspector' in card registry", () => {
  beforeEach(() => { _resetForTest(); });
  afterEach(() => { _resetForTest(); });

  it("getRegistration('style-inspector') returns undefined before registration", () => {
    expect(getRegistration("style-inspector")).toBeUndefined();
  });

  it("getRegistration('style-inspector') returns a registration after registerStyleInspectorCard()", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg).not.toBeUndefined();
    expect(reg!.componentId).toBe("style-inspector");
  });

  it("registration has the correct defaultMeta title", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.defaultMeta.title).toBe("Style Inspector");
  });

  it("registration has closable: true", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.defaultMeta.closable).toBe(true);
  });

  it("registration has family 'developer'", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.family).toBe("developer");
  });

  it("registration accepts family 'developer'", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg!.acceptsFamilies).toContain("developer");
  });

  it("contentFactory returns StyleInspectorContent", () => {
    registerStyleInspectorCard();
    const reg = getRegistration("style-inspector");
    expect(reg).not.toBeUndefined();

    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <>{reg!.contentFactory("card-si-test")}</>
      ));
    });

    const content = container.querySelector("[data-testid='style-inspector-content']");
    expect(content).not.toBeNull();
  });
});

// ============================================================================
// T-SI-02: StyleInspectorContent renders empty state when no element is selected
// ============================================================================

describe("StyleInspectorContent -- T-SI-02: renders empty state when no element selected", () => {
  it("renders the empty state element when no element has been inspected", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-1" />));
    });

    const emptyState = container.querySelector("[data-testid='style-inspector-empty-state']");
    expect(emptyState).not.toBeNull();
  });

  it("empty state contains instructional text referencing Inspect Element", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-2" />));
    });

    const emptyState = container.querySelector("[data-testid='style-inspector-empty-state']");
    expect(emptyState).not.toBeNull();
    expect(emptyState!.textContent).toContain("Inspect Element");
  });

  it("does not render token chain sections in empty state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-3" />));
    });

    // When no element is selected there should be no chain sections
    const chainSections = container.querySelectorAll(".tug-inspector-chain");
    expect(chainSections.length).toBe(0);
  });
});

// ============================================================================
// T-SI-03: Inspect button is present in rendered output
// ============================================================================

describe("StyleInspectorContent -- T-SI-03: inspect button is present", () => {
  it("renders an inspect button", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-4" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();
  });

  it("inspect button is a TugButton (has tug-button class)", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-5" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();
    // TugButton renders with the tug-button base class
    expect(inspectBtn!.classList.contains("tug-button")).toBe(true);
  });

  it("inspect button has aria-label attribute", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-6" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();
    const ariaLabel = inspectBtn!.getAttribute("aria-label");
    expect(ariaLabel).not.toBeNull();
    expect(ariaLabel!.length).toBeGreaterThan(0);
  });

  it("renders the content wrapper", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-7" />));
    });

    const wrapper = container.querySelector("[data-testid='style-inspector-content']");
    expect(wrapper).not.toBeNull();
  });

  it("inspect button uses ghost-action emphasis in rest state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-8" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();
    // Rest state: ghost-action TugButton variant (subtle, not attention-grabbing)
    expect(inspectBtn!.classList.contains("tug-button-ghost-action")).toBe(true);
  });
});

// ============================================================================
// T-SI-04: Three-state button label assertions
// ============================================================================

describe("StyleInspectorContent -- T-SI-04: button labels by state", () => {
  it("button shows 'Inspect Element' in rest state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-9" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();
    expect(inspectBtn!.textContent).toContain("Inspect Element");
  });

  it("button transitions to scanning state on click, showing 'Cancel Inspection'", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-10" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();

    act(() => {
      fireEvent.click(inspectBtn!);
    });

    // Should now show "Cancel Inspection" with outlined-action TugButton variant
    expect(inspectBtn!.textContent).toContain("Cancel Inspection");
    expect(inspectBtn!.classList.contains("tug-button-outlined-action")).toBe(true);
  });

  it("button shows aria-pressed=true in scanning state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-11" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();

    // Initially aria-pressed is false
    expect(inspectBtn!.getAttribute("aria-pressed")).toBe("false");

    act(() => {
      fireEvent.click(inspectBtn!);
    });

    // After click (scanning), aria-pressed is true
    expect(inspectBtn!.getAttribute("aria-pressed")).toBe("true");
  });

  it("button returns to 'Inspect Element' after clicking Cancel Inspection", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-12" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();

    // Click to scan
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    expect(inspectBtn!.textContent).toContain("Cancel Inspection");

    // Click to cancel
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    expect(inspectBtn!.textContent).toContain("Inspect Element");
    // Back to ghost-action in rest state
    expect(inspectBtn!.classList.contains("tug-button-ghost-action")).toBe(true);
  });
});

// ============================================================================
// T-SI-05: Hint text presence by state
// ============================================================================

describe("StyleInspectorContent -- T-SI-05: hint text by state", () => {
  it("no hint text in rest state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-13" />));
    });

    const hint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(hint).toBeNull();
  });

  it("hint text appears in scanning state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-14" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    act(() => {
      fireEvent.click(inspectBtn!);
    });

    const hint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("\u2318-click");
    expect(hint!.textContent).toContain("\u2325");
  });

  it("hint text disappears after cancelling scan", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-15" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");

    // Enter scanning
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    expect(container.querySelector("[data-testid='style-inspector-hint']")).not.toBeNull();

    // Cancel scanning
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    expect(container.querySelector("[data-testid='style-inspector-hint']")).toBeNull();
  });
});
