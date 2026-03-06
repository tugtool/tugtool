/**
 * Default button tests -- Steps 1 and 2.
 *
 * Unit tests (Step 1): default button stack push / pop / get semantics.
 * Integration tests (Step 2): Enter-key pipeline activation through
 * ResponderChainProvider bubbleListener stage 2.
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useLayoutEffect, useRef } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { ResponderChainManager } from "../components/tugways/responder-chain";
import { ResponderChainProvider, useRequiredResponderChain } from "../components/tugways/responder-chain-provider";

// Clean up all mounted React trees after each test.
afterEach(() => {
  cleanup();
});

// ============================================================================
// Unit tests: default button stack (Step 1)
// ============================================================================

// ---- Helpers ----

function makeManager(): ResponderChainManager {
  return new ResponderChainManager();
}

/**
 * Create a minimal HTMLButtonElement stub suitable for reference-equality
 * testing without a full DOM render.
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

// ============================================================================
// Integration tests: Enter-key pipeline (Step 2)
// ============================================================================

/**
 * Fire a keydown event on document with the given key and optional target.
 * When target is provided the event is dispatched on that element (it bubbles
 * up to document for the bubble-phase listener).
 */
function fireKey(key: string, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
  });
  if (target) {
    target.dispatchEvent(event);
  } else {
    document.dispatchEvent(event);
  }
  return event;
}

/**
 * A test component that registers a button element as the default button via
 * useLayoutEffect, following Rules of Tugways [D41].
 *
 * The component renders a <button> with a given data-testid and calls
 * onButtonRef with the element once it is mounted.
 */
interface DefaultButtonFixtureProps {
  buttonTestId: string;
  onButtonRef: (el: HTMLButtonElement | null) => void;
  onButtonClick?: () => void;
}

function DefaultButtonFixture({ buttonTestId, onButtonRef, onButtonClick }: DefaultButtonFixtureProps) {
  const manager = useRequiredResponderChain();
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    onButtonRef(el);
    manager.setDefaultButton(el);
    return () => {
      manager.clearDefaultButton(el);
      onButtonRef(null);
    };
  }, [manager, onButtonRef]);

  return (
    <button
      ref={btnRef}
      data-testid={buttonTestId}
      onClick={onButtonClick}
    >
      Default
    </button>
  );
}

describe("Enter-key pipeline integration", () => {
  it("pressing Enter on a div activates the registered default button", () => {
    let clickCount = 0;
    let capturedRef: HTMLButtonElement | null = null;

    act(() => {
      render(
        <ResponderChainProvider>
          <DefaultButtonFixture
            buttonTestId="default-btn"
            onButtonRef={(el) => { capturedRef = el; }}
            onButtonClick={() => { clickCount++; }}
          />
          <div data-testid="focus-area" />
        </ResponderChainProvider>
      );
    });

    expect(capturedRef).not.toBeNull();

    act(() => {
      // Simulate Enter with focus on a div (no active element guard triggers)
      fireKey("Enter");
    });

    expect(clickCount).toBe(1);
  });

  it("pressing Enter when an INPUT is focused does NOT activate the default button", () => {
    let clickCount = 0;
    let inputEl: HTMLInputElement | null = null;

    let getByTestId!: (id: string) => HTMLElement;
    act(() => {
      ({ getByTestId } = render(
        <ResponderChainProvider>
          <DefaultButtonFixture
            buttonTestId="default-btn"
            onButtonRef={() => {}}
            onButtonClick={() => { clickCount++; }}
          />
          <input data-testid="text-input" />
        </ResponderChainProvider>
      ));
    });

    inputEl = getByTestId("text-input") as HTMLInputElement;

    act(() => {
      inputEl!.focus();
      fireKey("Enter", inputEl!);
    });

    expect(clickCount).toBe(0);
  });

  it("pressing Enter when a TEXTAREA is focused does NOT activate the default button", () => {
    let clickCount = 0;
    let textareaEl: HTMLTextAreaElement | null = null;

    let getByTestId!: (id: string) => HTMLElement;
    act(() => {
      ({ getByTestId } = render(
        <ResponderChainProvider>
          <DefaultButtonFixture
            buttonTestId="default-btn"
            onButtonRef={() => {}}
            onButtonClick={() => { clickCount++; }}
          />
          <textarea data-testid="text-area" />
        </ResponderChainProvider>
      ));
    });

    textareaEl = getByTestId("text-area") as HTMLTextAreaElement;

    act(() => {
      textareaEl!.focus();
      fireKey("Enter", textareaEl!);
    });

    expect(clickCount).toBe(0);
  });

  it("pressing Enter when a native BUTTON is focused does NOT activate the default button", () => {
    let defaultClickCount = 0;
    let otherClickCount = 0;

    let getByTestId!: (id: string) => HTMLElement;
    act(() => {
      ({ getByTestId } = render(
        <ResponderChainProvider>
          <DefaultButtonFixture
            buttonTestId="default-btn"
            onButtonRef={() => {}}
            onButtonClick={() => { defaultClickCount++; }}
          />
          <button data-testid="other-btn" onClick={() => { otherClickCount++; }}>
            Other
          </button>
        </ResponderChainProvider>
      ));
    });

    const otherBtn = getByTestId("other-btn") as HTMLButtonElement;

    act(() => {
      otherBtn.focus();
      fireKey("Enter", otherBtn);
    });

    // The default button should NOT have been activated via the Enter pipeline.
    // The native button's own behavior handles Enter.
    expect(defaultClickCount).toBe(0);
  });

  it("pressing Enter when no default button is registered does not throw", () => {
    let errorThrown = false;

    act(() => {
      render(
        <ResponderChainProvider>
          <div data-testid="canvas" />
        </ResponderChainProvider>
      );
    });

    act(() => {
      try {
        fireKey("Enter");
      } catch {
        errorThrown = true;
      }
    });

    expect(errorThrown).toBe(false);
  });

  it("nested stack: inner default button receives Enter, after clear outer button receives Enter", () => {
    const innerClicks: string[] = [];

    // We'll test this by directly manipulating the manager rather than
    // rendering nested fixtures, to keep the test deterministic.
    let capturedManager: ResponderChainManager | null = null;

    function ManagerCapture() {
      capturedManager = useRequiredResponderChain();
      return null;
    }

    act(() => {
      render(
        <ResponderChainProvider>
          <ManagerCapture />
        </ResponderChainProvider>
      );
    });

    expect(capturedManager).not.toBeNull();
    const manager = capturedManager!;

    // Create two real button elements in the document
    const outerBtn = document.createElement("button");
    const innerBtn = document.createElement("button");
    outerBtn.addEventListener("click", () => innerClicks.push("outer"));
    innerBtn.addEventListener("click", () => innerClicks.push("inner"));
    document.body.appendChild(outerBtn);
    document.body.appendChild(innerBtn);

    act(() => {
      manager.setDefaultButton(outerBtn);
    });

    act(() => {
      manager.setDefaultButton(innerBtn);
    });

    // Press Enter -- inner button should activate
    act(() => {
      fireKey("Enter");
    });

    expect(innerClicks).toEqual(["inner"]);

    act(() => {
      manager.clearDefaultButton(innerBtn);
    });

    // Press Enter again -- outer button should activate now
    act(() => {
      fireKey("Enter");
    });

    expect(innerClicks).toEqual(["inner", "outer"]);

    // Cleanup
    manager.clearDefaultButton(outerBtn);
    document.body.removeChild(outerBtn);
    document.body.removeChild(innerBtn);
  });
});
