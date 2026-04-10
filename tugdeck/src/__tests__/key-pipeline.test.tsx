/**
 * Key pipeline tests -- Step 3.
 *
 * Tests cover:
 * - ResponderChainProvider renders children and provides manager via context
 * - useResponderChain() returns the manager inside the provider
 * - useResponderChain() returns null outside the provider (does not throw)
 * - useRequiredResponderChain() throws outside the provider
 * - Key pipeline: Ctrl+` triggers cycleCard via capture-phase and calls
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
import type { ActionEvent } from "@/components/tugways/responder-chain";
import {
  ResponderChainProvider,
  useResponderChain,
  useRequiredResponderChain,
} from "@/components/tugways/responder-chain-provider";
import { matchKeybinding } from "@/components/tugways/keybinding-map";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

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
  it("Ctrl+` dispatches cycleCard and calls preventDefault + stopImmediatePropagation when handler is registered", () => {
    let cycleCardCalled = false;
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

    // Register a cycleCard handler
    manager.register({
      id: "deck-canvas",
      parentId: null,
      actions: { [TUG_ACTIONS.CYCLE_CARD]: (_event: ActionEvent) => { cycleCardCalled = true; } },
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

    expect(cycleCardCalled).toBe(true);
    expect(preventDefaultCalled).toBe(true);
    expect(stopImmediatePropagationCalled).toBe(true);
  });

  it("matched keybinding where dispatch returns false does NOT call preventDefault", () => {
    // No handler registered for cycleCard -- dispatch returns false.
    let preventDefaultCalled = false;
    let bubbleListenerFired = false;

    act(() => {
      render(
        <ResponderChainProvider>
          <div />
        </ResponderChainProvider>
      );
    });

    // The provider's manager has no handlers, so dispatch("cycle-card") returns false.
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

  it("Ctrl+` still triggers cycleCard when an input element is focused (stage 1 capture takes priority)", () => {
    let cycleCardCalled = false;
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
      actions: { [TUG_ACTIONS.CYCLE_CARD]: (_event: ActionEvent) => { cycleCardCalled = true; } },
    });

    const input = getByTestId("text-input");

    act(() => {
      // Ctrl+` fired with an input as the target -- stage 1 capture should still fire
      fireKeydown({ code: "Backquote", ctrlKey: true, target: input });
    });

    expect(cycleCardCalled).toBe(true);
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

  it("returns full KeyBinding object for Ctrl+Backquote (cycleCard)", () => {
    const event = makeEvent("Backquote", { ctrlKey: true });
    expect(matchKeybinding(event)?.action).toBe("cycle-card");
  });

  it("returns full KeyBinding object for Cmd+A (selectAll) with preventDefaultOnMatch", () => {
    const event = makeEvent("KeyA", { metaKey: true });
    const binding = matchKeybinding(event);
    expect(binding?.action).toBe("select-all");
    expect(binding?.preventDefaultOnMatch).toBe(true);
  });

  it("returns full KeyBinding object for Ctrl+Backquote (backward compat: cycleCard)", () => {
    const event = makeEvent("Backquote", { ctrlKey: true });
    const binding = matchKeybinding(event);
    expect(binding).not.toBeNull();
    expect(binding?.action).toBe("cycle-card");
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

  // ---- Phase A3 / R4: macOS standard shortcut set ----
  //
  // Each case below asserts that the binding resolves to the correct
  // typed action. The action handlers themselves are tested in the
  // component files (tug-card for close / previousTab / nextTab /
  // find, deck-canvas for addTabToActiveCard / showSettings,
  // tug-prompt-input + use-text-input-responder for undo / redo,
  // the four floating surfaces for cancelDialog). This block is
  // narrowly scoped to the map lookup so a misspelled modifier or
  // key code fails loudly at the keybinding level.

  it("Cmd+Z (KeyZ, meta) → undo with preventDefaultOnMatch", () => {
    const binding = matchKeybinding(makeEvent("KeyZ", { metaKey: true }));
    expect(binding?.action).toBe("undo");
    expect(binding?.preventDefaultOnMatch).toBe(true);
  });

  it("Shift+Cmd+Z (KeyZ, meta+shift) → redo with preventDefaultOnMatch", () => {
    const binding = matchKeybinding(
      makeEvent("KeyZ", { metaKey: true, shiftKey: true }),
    );
    expect(binding?.action).toBe("redo");
    expect(binding?.preventDefaultOnMatch).toBe(true);
  });

  it("Cmd+Z must not match redo (shift discriminator)", () => {
    // Regression guard: undo and redo share the same key code, and
    // the only discriminator is shift. If matchKeybinding loses its
    // strict modifier equality we get a silent shortcut collision.
    const binding = matchKeybinding(makeEvent("KeyZ", { metaKey: true }));
    expect(binding?.action).not.toBe("redo");
  });

  it("Cmd+W → close", () => {
    expect(matchKeybinding(makeEvent("KeyW", { metaKey: true }))?.action).toBe(
      "close",
    );
  });

  it("Cmd+T → addTabToActiveCard", () => {
    expect(matchKeybinding(makeEvent("KeyT", { metaKey: true }))?.action).toBe(
      "add-tab-to-active-card",
    );
  });

  it("Cmd+, → showSettings", () => {
    expect(matchKeybinding(makeEvent("Comma", { metaKey: true }))?.action).toBe(
      "show-settings",
    );
  });

  it("Cmd+. → cancelDialog", () => {
    expect(matchKeybinding(makeEvent("Period", { metaKey: true }))?.action).toBe(
      "cancel-dialog",
    );
  });

  it("Cmd+F → find", () => {
    expect(matchKeybinding(makeEvent("KeyF", { metaKey: true }))?.action).toBe(
      "find",
    );
  });

  it("Shift+Cmd+[ → previousTab", () => {
    const binding = matchKeybinding(
      makeEvent("BracketLeft", { metaKey: true, shiftKey: true }),
    );
    expect(binding?.action).toBe("previous-tab");
  });

  it("Shift+Cmd+] → nextTab", () => {
    const binding = matchKeybinding(
      makeEvent("BracketRight", { metaKey: true, shiftKey: true }),
    );
    expect(binding?.action).toBe("next-tab");
  });

  it("Cmd+[ without shift does not match previousTab", () => {
    // Tab-nav shortcuts require the shift modifier; plain ⌘[ is a
    // browser back binding we do not want to reinterpret.
    const binding = matchKeybinding(
      makeEvent("BracketLeft", { metaKey: true }),
    );
    expect(binding).toBeNull();
  });

  // ---- ⌘1..⌘9 → jumpToTab with static payload ----
  //
  // Each of the nine digit bindings resolves to the `jumpToTab`
  // action and carries its 1-based index on `KeyBinding.value`.
  // The capture-phase pipeline threads that value onto the
  // dispatched ActionEvent (tested below in the "payload threading"
  // describe).

  it("Cmd+1..Cmd+9 → jumpToTab with matching 1-based value", () => {
    for (let i = 1; i <= 9; i++) {
      const binding = matchKeybinding(
        makeEvent(`Digit${i}`, { metaKey: true }),
      );
      expect(binding?.action).toBe("jump-to-tab");
      expect(binding?.value).toBe(i);
    }
  });
});

// ============================================================================
// Capture-phase payload threading — KeyBinding.value → ActionEvent.value
// ============================================================================

describe("capture-phase payload threading", () => {
  it("⌘3 dispatches jumpToTab with event.value === 3", () => {
    // Register a responder that captures the dispatched event so we
    // can assert that `KeyBinding.value` (from the ⌘3 map entry) was
    // copied onto `ActionEvent.value` by the capture listener.
    let receivedValue: unknown = undefined;

    function Harness() {
      const manager = useRequiredResponderChain();
      React.useLayoutEffect(() => {
        const responderId = "test-jump-harness";
        manager.register({
          id: responderId,
          parentId: null,
          actions: {
            [TUG_ACTIONS.JUMP_TO_TAB]: (event: ActionEvent) => {
              receivedValue = event.value;
            },
          },
        });
        return () => manager.unregister(responderId);
      }, [manager]);
      return null;
    }

    render(
      <ResponderChainProvider>
        <Harness />
      </ResponderChainProvider>,
    );

    act(() => {
      fireKeydown({ code: "Digit3", metaKey: true });
    });

    expect(receivedValue).toBe(3);
  });

  it("⌘Z dispatches undo with undefined value (no payload)", () => {
    // Regression guard: the payload spread must only attach `value`
    // when the binding defines one. A binding without `value` must
    // not leak `value: undefined` (or anything else) onto the event.
    let received: unknown = "SENTINEL_UNTOUCHED";

    function Harness() {
      const manager = useRequiredResponderChain();
      React.useLayoutEffect(() => {
        const responderId = "test-undo-harness";
        manager.register({
          id: responderId,
          parentId: null,
          actions: {
            [TUG_ACTIONS.UNDO]: (event: ActionEvent) => {
              received = event.value;
            },
          },
        });
        return () => manager.unregister(responderId);
      }, [manager]);
      return null;
    }

    render(
      <ResponderChainProvider>
        <Harness />
      </ResponderChainProvider>,
    );

    act(() => {
      fireKeydown({ code: "KeyZ", metaKey: true });
    });

    expect(received).toBeUndefined();
  });
});
