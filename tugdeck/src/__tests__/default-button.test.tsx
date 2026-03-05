/**
 * Default button stack unit tests -- Step 1.
 *
 * Tests cover:
 * - setDefaultButton: push one element, getDefaultButton returns it
 * - setDefaultButton: push two elements, getDefaultButton returns the second (most recent)
 * - clearDefaultButton: push two, clear the second, getDefaultButton returns the first
 * - clearDefaultButton: clear with element not on stack -- no-op, stack unchanged
 * - clearDefaultButton: clear on empty stack -- no-op, returns null
 * - clearDefaultButton: push same element twice, clear once -- one instance removed, element still on stack
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ResponderChainManager } from "../components/tugways/responder-chain";

// ---- Helpers ----

function makeManager(): ResponderChainManager {
  return new ResponderChainManager();
}

/**
 * Create a minimal HTMLButtonElement stub suitable for reference-equality
 * testing in a jsdom / bun environment. We use Object.create to produce
 * distinct objects that satisfy the HTMLButtonElement type without a full DOM.
 */
function makeButton(label: string): HTMLButtonElement {
  const btn = {
    tagName: "BUTTON",
    _label: label,
    click: () => {},
    disabled: false,
  } as unknown as HTMLButtonElement;
  return btn;
}

// ---- Default button stack ----

describe("default button stack", () => {
  let mgr: ResponderChainManager;

  beforeEach(() => {
    mgr = makeManager();
  });

  it("push one element -- getDefaultButton returns it", () => {
    const btn = makeButton("confirm");
    mgr.setDefaultButton(btn);
    expect(mgr.getDefaultButton()).toBe(btn);
  });

  it("push two elements -- getDefaultButton returns the second (most recent)", () => {
    const btn1 = makeButton("outer");
    const btn2 = makeButton("inner");
    mgr.setDefaultButton(btn1);
    mgr.setDefaultButton(btn2);
    expect(mgr.getDefaultButton()).toBe(btn2);
  });

  it("push two, clear the second -- getDefaultButton returns the first", () => {
    const btn1 = makeButton("outer");
    const btn2 = makeButton("inner");
    mgr.setDefaultButton(btn1);
    mgr.setDefaultButton(btn2);
    mgr.clearDefaultButton(btn2);
    expect(mgr.getDefaultButton()).toBe(btn1);
  });

  it("clear with element not on stack -- no-op, stack unchanged", () => {
    const btn1 = makeButton("registered");
    const btn2 = makeButton("never-pushed");
    mgr.setDefaultButton(btn1);
    mgr.clearDefaultButton(btn2);
    expect(mgr.getDefaultButton()).toBe(btn1);
  });

  it("clear on empty stack -- no-op, getDefaultButton returns null", () => {
    const btn = makeButton("orphan");
    mgr.clearDefaultButton(btn);
    expect(mgr.getDefaultButton()).toBe(null);
  });

  it("getDefaultButton returns null when stack is empty", () => {
    expect(mgr.getDefaultButton()).toBe(null);
  });

  it("push same element twice, clear once -- one instance removed, element still on stack", () => {
    const btn = makeButton("duplicate");
    mgr.setDefaultButton(btn);
    mgr.setDefaultButton(btn);
    mgr.clearDefaultButton(btn);
    // One instance remains -- last push was the removed one (lastIndexOf), first push stays
    expect(mgr.getDefaultButton()).toBe(btn);
  });

  it("clearing the last element leaves stack empty", () => {
    const btn = makeButton("only");
    mgr.setDefaultButton(btn);
    mgr.clearDefaultButton(btn);
    expect(mgr.getDefaultButton()).toBe(null);
  });

  it("clearDefaultButton removes the LAST occurrence (lastIndexOf semantics)", () => {
    const btn = makeButton("shared");
    const other = makeButton("other");
    mgr.setDefaultButton(btn);
    mgr.setDefaultButton(other);
    mgr.setDefaultButton(btn);
    // Stack is [btn, other, btn]. lastIndexOf(btn) == 2.
    // After clear: [btn, other]. getDefaultButton() == other.
    mgr.clearDefaultButton(btn);
    expect(mgr.getDefaultButton()).toBe(other);
  });
});
