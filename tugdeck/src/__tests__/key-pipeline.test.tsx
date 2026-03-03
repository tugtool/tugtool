/**
 * Key pipeline tests -- Step 3.
 *
 * Tests cover:
 * - ResponderChainProvider renders children and provides manager via context
 * - useResponderChain() returns the manager inside the provider
 * - useResponderChain() returns null outside the provider (does not throw)
 * - useRequiredResponderChain() throws outside the provider
 * - Key pipeline: Ctrl+` triggers cyclePanel via capture-phase and calls
 *   preventDefault + stopImmediatePropagation when dispatch returns true
 * - Key pipeline: matched keybinding where dispatch returns false does not
 *   call preventDefault and event reaches bubble-phase listener
 * - Key pipeline: unmatched key does not trigger dispatch
 * - Key pipeline: typing in an input element does not trigger chain dispatch
 *   for bubble-phase (non-global-shortcut keys)
 * - Key pipeline: Ctrl+` still works when an input element is focused
 * - matchKeybinding returns correct action for matching key event
 * - matchKeybinding returns null for non-matching key event
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useContext } from "react";
import { describe, it, expect, mock, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

// Clean up all mounted React trees after each test to prevent DOM accumulation
// across tests in the same bun worker (happy-dom does not auto-reset).
afterEach(() => {
  cleanup();
});

import { ResponderChainContext, ResponderChainManager } from "@/components/tugways/responder-chain";
import {
  ResponderChainProvider,
  useResponderChain,
  useRequiredResponderChain,
} from "@/components/tugways/responder-chain-provider";
import { matchKeybinding } from "@/components/tugways/keybinding-map";

// ---- Helpers ----

/**
 * Create and dispatch a KeyboardEvent on document.
 * Returns the event so callers can inspect it afterward.
 */
function fireKeydown(options: {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: EventTarget;
}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    code: options.code,
    key: options.code,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (options.target) {
    options.target.dispatchEvent(event);
  } else {
    document.dispatchEvent(event);
  }
  return event;
}

// ============================================================================
// Provider rendering and context
// ============================================================================

describe("ResponderChainProvider – rendering", () => {
  it("renders children", () => {
    const { getByTestId } = render(
      <ResponderChainProvider>
        <div data-testid="child" />
      </ResponderChainProvider>
    );
    expect(getByTestId("child")).not.toBeNull();
  });

  it("provides a ResponderChainManager instance via context", () => {
    let captured: ResponderChainManager | null = null;
    function Consumer() {
      captured = useContext(ResponderChainContext);
      return null;
    }
    act(() => {
      render(
        <ResponderChainProvider>
          <Consumer />
        </ResponderChainProvider>
      );
    });
    expect(captured).toBeInstanceOf(ResponderChainManager);
  });
});

// ============================================================================
// useResponderChain
// ============================================================================

describe("useResponderChain", () => {
  it("returns the manager inside the provider", () => {
    let captured: ResponderChainManager | null = null;
    function Consumer() {
      captured = useResponderChain();
      return null;
    }
    act(() => {
      render(
        <ResponderChainProvider>
          <Consumer />
        </ResponderChainProvider>
      );
    });
    expect(captured).toBeInstanceOf(ResponderChainManager);
  });

  it("returns null outside the provider (does not throw)", () => {
    let captured: ResponderChainManager | null | undefined = undefined;
    function Consumer() {
      captured = useResponderChain();
      return null;
    }
    act(() => {
      render(<Consumer />);
    });
    expect(captured).toBeNull();
  });
});

// ============================================================================
// useRequiredResponderChain
// ============================================================================

describe("useRequiredResponderChain", () => {
  it("throws outside the provider", () => {
    const origError = console.error;
    console.error = () => {};

    function BareConsumer() {
      useRequiredResponderChain();
      return null;
    }

    let caughtError: unknown = null;
    class ErrorBoundary extends React.Component<
      { children: React.ReactNode },
      { hasError: boolean }
    > {
      state = { hasError: false };
      static getDerivedStateFromError() { return { hasError: true }; }
      componentDidCatch(err: unknown) { caughtError = err; }
      render() {
        return this.state.hasError ? <div>error</div> : this.props.children;
      }
    }

    act(() => {
      render(
        <ErrorBoundary>
          <BareConsumer />
        </ErrorBoundary>
      );
    });

    console.error = origError;
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain(
      "useRequiredResponderChain must be used inside a <ResponderChainProvider>"
    );
  });
});

// ============================================================================
// Key pipeline: capture-phase (stage 1, global shortcuts)
// ============================================================================

describe("key pipeline – capture-phase (stage 1)", () => {
  it("Ctrl+` dispatches cyclePanel and calls preventDefault + stopImmediatePropagation when handler is registered", () => {
    let cyclePanelCalled = false;
    let manager!: ResponderChainManager;

    function Setup() {
      const m = useResponderChain();
      if (m) {
        manager = m;
      }
      return null;
    }

    act(() => {
      render(
        <ResponderChainProvider>
          <Setup />
        </ResponderChainProvider>
      );
    });

    // Register a cyclePanel handler
    manager.register({
      id: "deck-canvas",
      parentId: null,
      actions: { cyclePanel: () => { cyclePanelCalled = true; } },
    });

    let preventDefaultCalled = false;
    let stopImmediatePropagationCalled = false;

    // Intercept the event to check if the pipeline called preventDefault
    // and stopImmediatePropagation. We use a capture-phase listener that
    // runs AFTER the provider's capture listener (added later = lower priority
    // in same phase). Instead, track via a bubble-phase listener that should
    // NOT fire when stopImmediatePropagation was called. We'll use a different
    // approach: patch the event prototype.
    const origPreventDefault = KeyboardEvent.prototype.preventDefault;
    const origStopImmediate = KeyboardEvent.prototype.stopImmediatePropagation;
    KeyboardEvent.prototype.preventDefault = function (this: KeyboardEvent) {
      preventDefaultCalled = true;
      origPreventDefault.call(this);
    };
    KeyboardEvent.prototype.stopImmediatePropagation = function (this: KeyboardEvent) {
      stopImmediatePropagationCalled = true;
      origStopImmediate.call(this);
    };

    act(() => {
      fireKeydown({ code: "Backquote", ctrlKey: true });
    });

    KeyboardEvent.prototype.preventDefault = origPreventDefault;
    KeyboardEvent.prototype.stopImmediatePropagation = origStopImmediate;

    expect(cyclePanelCalled).toBe(true);
    expect(preventDefaultCalled).toBe(true);
    expect(stopImmediatePropagationCalled).toBe(true);
  });

  it("matched keybinding where dispatch returns false does NOT call preventDefault", () => {
    // No handler registered for cyclePanel -- dispatch returns false.
    let preventDefaultCalled = false;
    let bubbleListenerFired = false;

    act(() => {
      render(
        <ResponderChainProvider>
          <div />
        </ResponderChainProvider>
      );
    });

    // The provider's manager has no handlers, so dispatch("cyclePanel") returns false.
    // The event should continue normally and reach bubble-phase listeners.
    const bubbleListener = () => { bubbleListenerFired = true; };
    document.addEventListener("keydown", bubbleListener);

    const origPreventDefault = KeyboardEvent.prototype.preventDefault;
    KeyboardEvent.prototype.preventDefault = function (this: KeyboardEvent) {
      preventDefaultCalled = true;
      origPreventDefault.call(this);
    };

    act(() => {
      fireKeydown({ code: "Backquote", ctrlKey: true });
    });

    KeyboardEvent.prototype.preventDefault = origPreventDefault;
    document.removeEventListener("keydown", bubbleListener);

    expect(preventDefaultCalled).toBe(false);
    expect(bubbleListenerFired).toBe(true);
  });

  it("unmatched key does not trigger dispatch", () => {
    let manager!: ResponderChainManager;
    function Setup() {
      const m = useResponderChain();
      if (m) manager = m;
      return null;
    }

    act(() => {
      render(
        <ResponderChainProvider>
          <Setup />
        </ResponderChainProvider>
      );
    });

    const dispatchSpy = mock(manager.dispatch.bind(manager));
    manager.dispatch = dispatchSpy;

    act(() => {
      fireKeydown({ code: "KeyA" });
    });

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Key pipeline: bubble-phase input guard
// ============================================================================

describe("key pipeline – bubble-phase input guard", () => {
  it("typing in an input element does not trigger chain dispatch (bubble stage 3 skipped)", () => {
    // The bubble-phase listener skips stage 3 for input elements.
    // We verify this by checking the manager does NOT dispatch for a non-keybinding key.
    let manager!: ResponderChainManager;
    function Setup() {
      const m = useResponderChain();
      if (m) manager = m;
      return null;
    }

    let { getByTestId } = { getByTestId: (_id: string): HTMLElement => document.body };
    act(() => {
      ({ getByTestId } = render(
        <ResponderChainProvider>
          <Setup />
          <input data-testid="text-input" />
        </ResponderChainProvider>
      ));
    });

    const dispatchSpy = mock(manager.dispatch.bind(manager));
    manager.dispatch = dispatchSpy;

    const input = getByTestId("text-input");

    act(() => {
      // Typing a regular letter in the input
      fireKeydown({ code: "KeyA", target: input });
    });

    // The bubble-phase listener should have skipped stage 3 for the input target.
    // dispatch is only called from the capture-phase listener for keybinding matches.
    // Since "KeyA" doesn't match any keybinding, dispatch should not be called at all.
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("Ctrl+` still triggers cyclePanel when an input element is focused (stage 1 capture takes priority)", () => {
    let cyclePanelCalled = false;
    let manager!: ResponderChainManager;

    function Setup() {
      const m = useResponderChain();
      if (m) manager = m;
      return null;
    }

    let getByTestId!: (id: string) => HTMLElement;
    act(() => {
      ({ getByTestId } = render(
        <ResponderChainProvider>
          <Setup />
          <input data-testid="text-input" />
        </ResponderChainProvider>
      ));
    });

    manager.register({
      id: "deck-canvas",
      parentId: null,
      actions: { cyclePanel: () => { cyclePanelCalled = true; } },
    });

    const input = getByTestId("text-input");

    act(() => {
      // Ctrl+` fired with an input as the target -- stage 1 capture should still fire
      fireKeydown({ code: "Backquote", ctrlKey: true, target: input });
    });

    expect(cyclePanelCalled).toBe(true);
  });
});

// ============================================================================
// matchKeybinding
// ============================================================================

describe("matchKeybinding", () => {
  function makeEvent(
    code: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}
  ): KeyboardEvent {
    return new KeyboardEvent("keydown", {
      code,
      ctrlKey: modifiers.ctrlKey ?? false,
      metaKey: modifiers.metaKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
      altKey: modifiers.altKey ?? false,
    });
  }

  it("returns full KeyBinding object for Ctrl+Backquote (cyclePanel)", () => {
    const event = makeEvent("Backquote", { ctrlKey: true });
    expect(matchKeybinding(event)?.action).toBe("cyclePanel");
  });

  it("returns full KeyBinding object for Cmd+A (selectAll) with preventDefaultOnMatch", () => {
    const event = makeEvent("KeyA", { metaKey: true });
    const binding = matchKeybinding(event);
    expect(binding?.action).toBe("selectAll");
    expect(binding?.preventDefaultOnMatch).toBe(true);
  });

  it("returns full KeyBinding object for Ctrl+Backquote (backward compat: cyclePanel)", () => {
    const event = makeEvent("Backquote", { ctrlKey: true });
    const binding = matchKeybinding(event);
    expect(binding).not.toBeNull();
    expect(binding?.action).toBe("cyclePanel");
    expect(binding?.preventDefaultOnMatch).toBeUndefined();
  });

  it("returns null for Backquote without Ctrl", () => {
    const event = makeEvent("Backquote");
    expect(matchKeybinding(event)).toBeNull();
  });

  it("returns null for an unrelated key with Ctrl", () => {
    const event = makeEvent("KeyN", { ctrlKey: true });
    expect(matchKeybinding(event)).toBeNull();
  });

  it("returns null for Ctrl+Backquote with extra Shift modifier", () => {
    const event = makeEvent("Backquote", { ctrlKey: true, shiftKey: true });
    expect(matchKeybinding(event)).toBeNull();
  });

  it("returns null for an empty event", () => {
    const event = makeEvent("Space");
    expect(matchKeybinding(event)).toBeNull();
  });
});
