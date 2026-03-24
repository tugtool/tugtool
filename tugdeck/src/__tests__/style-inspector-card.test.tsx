/**
 * StyleInspectorContent card tests -- Steps 3 and 4.
 *
 * Tests cover:
 * - registerStyleInspectorCard registers with componentId "style-inspector"
 * - StyleInspectorContent renders empty state when no element is selected
 * - StyleInspectorContent has an inspect button in its rendered output
 * - Three-state button: rest / scanning / inspecting label and class assertions
 * - Step 4: inline editing helpers (extractLastNumericLiteral, getEditableType)
 * - Step 4: activateNumericInput creates input, Enter commits, Escape cancels
 * - Step 4: formulas-updated bus event triggers re-fetch
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup, fireEvent } from "@testing-library/react";

import {
  StyleInspectorContent,
  registerStyleInspectorCard,
  styleInspectorBus,
  extractLastNumericLiteral,
  getEditableType,
  activateNumericInput,
} from "@/components/tugways/cards/style-inspector-card";
import { getRegistration, _resetForTest } from "@/card-registry";
import type { FormulaRow } from "@/components/tugways/style-inspector-core";

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
  it("hint text shows in rest state with keyboard shortcut", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-13" />));
    });

    const hint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("to scan");
  });

  it("hint text shows 'Esc to cancel' in scanning state", () => {
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
    expect(hint!.textContent).toContain("Esc to cancel");
  });

  it("hint text returns to rest hint after cancelling scan", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-15" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");

    // Enter scanning
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    const scanHint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(scanHint).not.toBeNull();
    expect(scanHint!.textContent).toContain("Esc to cancel");

    // Cancel scanning — back to rest hint
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    const restHint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(restHint).not.toBeNull();
    expect(restHint!.textContent).toContain("to scan");
  });
});

// ============================================================================
// T-SI-06: Escape key cancels scanning and returns to rest state
// ============================================================================

describe("StyleInspectorContent -- T-SI-06: Escape key cancels scanning", () => {
  it("Escape key during scanning returns button to 'Inspect Element' rest state", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-16" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");
    expect(inspectBtn).not.toBeNull();

    // Enter scanning state
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    expect(inspectBtn!.textContent).toContain("Cancel Inspection");

    // Press Escape to cancel
    act(() => {
      const escKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(escKey);
    });

    // Button should return to rest state
    expect(inspectBtn!.textContent).toContain("Inspect Element");
    expect(inspectBtn!.classList.contains("tug-button-ghost-action")).toBe(true);
  });

  it("Escape key during scanning reverts hint text to rest hint", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<StyleInspectorContent cardId="test-card-17" />));
    });

    const inspectBtn = container.querySelector("[data-testid='style-inspector-reticle-button']");

    // Enter scanning state
    act(() => {
      fireEvent.click(inspectBtn!);
    });
    const scanHint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(scanHint).not.toBeNull();
    expect(scanHint!.textContent).toContain("Esc to cancel");

    // Press Escape to cancel
    act(() => {
      const escKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(escKey);
    });

    // Hint reverts to rest hint (not gone — rest state shows shortcut hint)
    const restHint = container.querySelector("[data-testid='style-inspector-hint']");
    expect(restHint).not.toBeNull();
    expect(restHint!.textContent).toContain("to scan");
  });

  it("Escape key in rest state (not scanning) does not throw", () => {
    act(() => {
      render(<StyleInspectorContent cardId="test-card-18" />);
    });

    // Escape when not scanning should not throw
    expect(() => {
      act(() => {
        const escKey = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        document.dispatchEvent(escKey);
      });
    }).not.toThrow();
  });
});

// ============================================================================
// T-SI-07: extractLastNumericLiteral unit tests
// ============================================================================

describe("extractLastNumericLiteral -- T-SI-07: extract last numeric literal from source expression", () => {
  it("returns '28' from 'primaryTextTone - 28'", () => {
    expect(extractLastNumericLiteral("primaryTextTone - 28")).toBe("28");
  });

  it("returns '6' from 'canvasTone + 6'", () => {
    expect(extractLastNumericLiteral("canvasTone + 6")).toBe("6");
  });

  it("returns '2' from bare literal '2'", () => {
    expect(extractLastNumericLiteral("2")).toBe("2");
  });

  it("returns '5' from clamped expression 'spec.role.tone - 5'", () => {
    expect(extractLastNumericLiteral("spec.role.tone - 5")).toBe("5");
  });

  it("returns null for bare variable ref 'primaryTextTone'", () => {
    expect(extractLastNumericLiteral("primaryTextTone")).toBeNull();
  });

  it("returns null for spec path 'spec.role.tone'", () => {
    expect(extractLastNumericLiteral("spec.role.tone")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractLastNumericLiteral("")).toBeNull();
  });

  it("returns last literal from multiple numbers: '100' not '0' from 'Math.max(0, Math.min(100, x))'", () => {
    // Returns the last literal found
    const result = extractLastNumericLiteral("Math.max(0, Math.min(100, x))");
    expect(result).toBe("100");
  });
});

// ============================================================================
// T-SI-08: getEditableType unit tests
// ============================================================================

describe("getEditableType -- T-SI-08: determine editability of a formula row", () => {
  const makeRow = (
    field: string,
    value: number | string | boolean,
    property: "tone" | "intensity" | "alpha" | "hueSlot"
  ): FormulaRow => ({ field, value, property, isStructural: false });

  it("hueSlot property returns 'hue' regardless of sources", () => {
    const row = makeRow("primaryHue", "action", "hueSlot");
    expect(getEditableType(row, { primaryHue: "action" })).toBe("hue");
  });

  it("boolean value returns 'readonly'", () => {
    const row = makeRow("isDark", true, "tone");
    expect(getEditableType(row, { isDark: "true" })).toBe("readonly");
  });

  it("undefined sources[field] returns 'readonly'", () => {
    const row = makeRow("cardBodyTone", 50, "tone");
    expect(getEditableType(row, {})).toBe("readonly");
  });

  it("source with numeric literal returns 'numeric'", () => {
    const row = makeRow("mutedTextTone", 66, "tone");
    expect(getEditableType(row, { mutedTextTone: "primaryTextTone - 28" })).toBe("numeric");
  });

  it("source with no numeric literal (bare variable) returns 'readonly'", () => {
    const row = makeRow("contentTextTone", 72, "tone");
    expect(getEditableType(row, { contentTextTone: "primaryTextTone" })).toBe("readonly");
  });

  it("bare literal source returns 'numeric'", () => {
    const row = makeRow("surfaceAppIntensity", 2, "intensity");
    expect(getEditableType(row, { surfaceAppIntensity: "2" })).toBe("numeric");
  });
});

// ============================================================================
// T-SI-09: activateNumericInput -- clicking creates input, Enter commits, Escape cancels
// ============================================================================

describe("activateNumericInput -- T-SI-09: inline numeric input lifecycle", () => {
  // Mock fetch for POST tests
  const originalFetch = (global as any).fetch;

  afterEach(() => {
    (global as any).fetch = originalFetch;
    cleanup();
  });

  it("clicking a numeric value creates an input element appended to the span", () => {
    const span = document.createElement("span");
    span.textContent = "66";
    document.body.appendChild(span);

    activateNumericInput(span, "28", "mutedTextTone");

    const input = span.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.value).toBe("28");
    expect(input!.getAttribute("data-testid")).toBe("formula-edit-input-mutedTextTone");

    document.body.removeChild(span);
  });

  it("Enter key commits the edit and calls POST with correct field and value", async () => {
    const fetchCalls: Array<[string, RequestInit]> = [];
    (global as any).fetch = (url: string, init: RequestInit) => {
      fetchCalls.push([url, init]);
      return Promise.resolve({ ok: true });
    };

    const span = document.createElement("span");
    span.textContent = "66";
    document.body.appendChild(span);

    activateNumericInput(span, "28", "mutedTextTone");

    const input = span.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();

    // Change value and press Enter
    input.value = "30";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    // Allow microtasks (fetch promise) to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0][0]).toBe("/__themes/formula");
    const body = JSON.parse(fetchCalls[0][1].body as string) as { field: string; value: number };
    expect(body.field).toBe("mutedTextTone");
    expect(body.value).toBe(30);

    // Input should be removed after commit
    expect(span.querySelector("input")).toBeNull();

    document.body.removeChild(span);
  });

  it("Escape key cancels the edit without calling POST", async () => {
    const fetchCalls: Array<unknown> = [];
    (global as any).fetch = (...args: unknown[]) => {
      fetchCalls.push(args);
      return Promise.resolve({ ok: true });
    };

    const span = document.createElement("span");
    span.textContent = "66";
    document.body.appendChild(span);

    activateNumericInput(span, "28", "mutedTextTone");

    const input = span.querySelector("input");
    expect(input).not.toBeNull();

    // Press Escape — should cancel without POSTing
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    await new Promise((r) => setTimeout(r, 0));

    expect(fetchCalls.length).toBe(0);

    // Input should be removed after cancel
    expect(span.querySelector("input")).toBeNull();

    document.body.removeChild(span);
  });

  it("does not create a second input if one is already active", () => {
    const span = document.createElement("span");
    span.textContent = "66";
    document.body.appendChild(span);

    activateNumericInput(span, "28", "mutedTextTone");
    activateNumericInput(span, "28", "mutedTextTone"); // second call should be no-op

    const inputs = span.querySelectorAll("input");
    expect(inputs.length).toBe(1);

    document.body.removeChild(span);
  });
});

// ============================================================================
// T-SI-10: formulas-updated bus event triggers re-fetch in StyleInspectorContent
// ============================================================================

describe("styleInspectorBus formulas-updated -- T-SI-10: HMR re-fetch signal", () => {
  afterEach(() => {
    cleanup();
  });

  it("emitting formulas-updated on styleInspectorBus calls registered listener", () => {
    let callCount = 0;
    const listener = () => { callCount++; };

    styleInspectorBus.on("formulas-updated", listener);
    styleInspectorBus.emit("formulas-updated");
    styleInspectorBus.off("formulas-updated", listener);

    expect(callCount).toBe(1);
  });

  it("listener is removed after off() and no longer called", () => {
    let callCount = 0;
    const listener = () => { callCount++; };

    styleInspectorBus.on("formulas-updated", listener);
    styleInspectorBus.emit("formulas-updated");
    styleInspectorBus.off("formulas-updated", listener);
    styleInspectorBus.emit("formulas-updated");

    expect(callCount).toBe(1);
  });

  it("multiple listeners for formulas-updated are all called", () => {
    let count1 = 0;
    let count2 = 0;
    const l1 = () => { count1++; };
    const l2 = () => { count2++; };

    styleInspectorBus.on("formulas-updated", l1);
    styleInspectorBus.on("formulas-updated", l2);
    styleInspectorBus.emit("formulas-updated");
    styleInspectorBus.off("formulas-updated", l1);
    styleInspectorBus.off("formulas-updated", l2);

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});
