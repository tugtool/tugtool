/**
 * useTugcardPersistence hook unit tests -- Phase 5f4.
 *
 * Tests cover:
 * - T-P01: useTugcardPersistence registers callbacks called by Tugcard on
 *   deactivation (onSave) and activation (onRestore).
 * - T-P02: Updating onSave/onRestore options does not cause re-registration
 *   (stable useLayoutEffect with [register] deps, refs used inside wrappers).
 * - T-P03: Integration with Tugcard context (round-trip through Tugcard).
 * - T-P04: restorePendingRef is included in registered callbacks and defaults
 *   to false. ([D03])
 * - T-P05: When restorePendingRef.current is set to true and onContentReady is
 *   written into the callbacks object, triggering a re-render causes the no-deps
 *   useLayoutEffect to fire onContentReady and reset the flag. ([D01], [D02])
 * - T-P06: Parent-sets-ref, child-reads-ref indirection (mirrors the real Tugcard
 *   code path): provider sets callbacks.restorePendingRef.current = true, writes
 *   callbacks.onContentReady = mock(), then calls callbacks.onRestore(state) to
 *   trigger child setState. Verifies onContentReady fires and flag resets. ([D01])
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React, { useState } from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, act } from "@testing-library/react";

import { TugcardPersistenceContext, useTugcardPersistence } from "@/components/tugways/use-tugcard-persistence";
import type { TugcardPersistenceCallbacks } from "@/components/tugways/use-tugcard-persistence";

// ---------------------------------------------------------------------------
// Test helper: tracks how many times register is called (registration count).
// ---------------------------------------------------------------------------

/**
 * Build a context provider that exposes the register function, records every
 * call to it, and returns a ref to the most recently registered callbacks.
 */
function makeTestProvider() {
  let registrationCount = 0;
  let latestCallbacks: TugcardPersistenceCallbacks | null = null;

  function register(callbacks: TugcardPersistenceCallbacks) {
    registrationCount += 1;
    latestCallbacks = callbacks;
  }

  function getRegistrationCount() { return registrationCount; }
  function getLatestCallbacks() { return latestCallbacks; }

  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TugcardPersistenceContext value={register}>
        {children}
      </TugcardPersistenceContext>
    );
  }

  return { Provider, getRegistrationCount, getLatestCallbacks };
}

// ---------------------------------------------------------------------------
// T-P01: useTugcardPersistence registers callbacks called by Tugcard
// ---------------------------------------------------------------------------

describe("useTugcardPersistence – callback registration and invocation", () => {
  it("T-P01a: onSave registered callback is called and returns the card's state", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const savedState = { counter: 7 };
    const onSave = mock(() => savedState);
    const onRestore = mock((_s: typeof savedState) => {});

    function CardContent() {
      useTugcardPersistence({ onSave, onRestore });
      return <div>content</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    // After mount, callbacks should be registered.
    const callbacks = getLatestCallbacks();
    expect(callbacks).not.toBeNull();

    // Tugcard calls onSave on deactivation.
    const result = callbacks!.onSave();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(result).toEqual(savedState);
  });

  it("T-P01b: onRestore registered callback is called with the saved state", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const onSave = mock(() => ({ value: 42 }));
    const restoredValues: unknown[] = [];
    const onRestore = mock((s: { value: number }) => { restoredValues.push(s); });

    function CardContent() {
      useTugcardPersistence({ onSave, onRestore });
      return <div>content</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    const callbacks = getLatestCallbacks();
    expect(callbacks).not.toBeNull();

    // Tugcard calls onRestore on activation with saved state.
    const savedState = { value: 99 };
    callbacks!.onRestore(savedState);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(restoredValues).toEqual([savedState]);
  });

  it("T-P01c: no-op when rendered outside a Tugcard (context is null)", () => {
    // Without a Provider, TugcardPersistenceContext value is null.
    // The hook must not throw and must not call register.
    const onSave = mock(() => ({}));
    const onRestore = mock((_s: unknown) => {});

    function CardContent() {
      useTugcardPersistence({ onSave, onRestore });
      return <div>no provider</div>;
    }

    // Should not throw.
    expect(() => {
      act(() => {
        render(<CardContent />);
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-P02: Updating options does not cause re-registration
// ---------------------------------------------------------------------------

describe("useTugcardPersistence – stable registration across re-renders", () => {
  it("T-P02: updating onSave/onRestore does not trigger re-registration", () => {
    const { Provider, getRegistrationCount, getLatestCallbacks } = makeTestProvider();

    let onSaveV1 = mock(() => ({ version: 1 }));
    let onRestoreV1 = mock((_s: unknown) => {});

    // Ref-like wrapper so we can swap implementations from the test.
    let currentOnSave = onSaveV1;
    let currentOnRestore = onRestoreV1;

    function CardContent() {
      useTugcardPersistence({
        onSave: () => currentOnSave(),
        onRestore: (s: unknown) => currentOnRestore(s),
      });
      return <div>content</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];

    act(() => {
      ({ rerender } = render(
        <Provider>
          <CardContent />
        </Provider>
      ));
    });

    // Should have registered once on mount.
    expect(getRegistrationCount()).toBe(1);

    // Swap the onSave implementation by re-rendering with new closures.
    const onSaveV2 = mock(() => ({ version: 2 }));
    const onRestoreV2 = mock((_s: unknown) => {});
    currentOnSave = onSaveV2;
    currentOnRestore = onRestoreV2;

    act(() => {
      rerender(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    // Re-render must NOT cause an additional registration call.
    expect(getRegistrationCount()).toBe(1);

    // The registered wrapper should now delegate to the updated implementations
    // (because the wrapper reads from refs, not captured closure values).
    const callbacks = getLatestCallbacks()!;
    const result = callbacks.onSave();
    // The current implementation is v2 (assigned above), so we get version: 2.
    expect(result).toEqual({ version: 2 });
    expect(onSaveV2).toHaveBeenCalledTimes(1);
    expect(onSaveV1).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-P03: Integration with Tugcard context (round-trip through Tugcard)
// ---------------------------------------------------------------------------

describe("useTugcardPersistence – Tugcard context round-trip", () => {
  it("T-P03: card content using useTugcardPersistence receives onRestore via Tugcard activation", () => {
    // Simulate Tugcard providing context and calling onSave/onRestore.
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const contentState = { scroll: 100, selected: ["item-1"] };
    const onSave = mock(() => contentState);
    const restoredStates: unknown[] = [];
    const onRestore = mock((s: typeof contentState) => { restoredStates.push(s); });

    function CardContent() {
      useTugcardPersistence({ onSave, onRestore });
      return <div>card content</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    const callbacks = getLatestCallbacks()!;
    expect(callbacks).not.toBeNull();

    // Simulate deactivation: Tugcard calls onSave to capture state.
    const saved = callbacks.onSave();
    expect(saved).toEqual(contentState);

    // Simulate activation: Tugcard calls onRestore with the saved state.
    callbacks.onRestore(saved);
    expect(restoredStates).toHaveLength(1);
    expect(restoredStates[0]).toEqual(contentState);
  });
});

// ---------------------------------------------------------------------------
// T-P04: restorePendingRef is included in registered callbacks
// ---------------------------------------------------------------------------

describe("useTugcardPersistence – restorePendingRef in registered callbacks", () => {
  it("T-P04: restorePendingRef is present on registered callbacks and defaults to false", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const onSave = mock(() => ({}));
    const onRestore = mock((_s: unknown) => {});

    function CardContent() {
      useTugcardPersistence({ onSave, onRestore });
      return <div>content</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    const callbacks = getLatestCallbacks();
    expect(callbacks).not.toBeNull();
    // restorePendingRef must be present and start as false.
    expect(callbacks!.restorePendingRef).toBeDefined();
    expect(callbacks!.restorePendingRef!.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-P05: No-deps useLayoutEffect fires onContentReady when flag is set
// ---------------------------------------------------------------------------

describe("useTugcardPersistence – no-deps useLayoutEffect fires onContentReady", () => {
  it("T-P05: setting restorePendingRef to true and writing onContentReady fires callback on re-render", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const onSave = mock(() => ({}));
    let currentState = "initial";
    const onRestoreMock = mock((s: unknown) => { currentState = s as string; });

    function CardContent() {
      useTugcardPersistence({ onSave, onRestore: onRestoreMock });
      return <div data-testid="content">{currentState}</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => {
      ({ rerender } = render(
        <Provider>
          <CardContent />
        </Provider>
      ));
    });

    const callbacks = getLatestCallbacks()!;
    expect(callbacks).not.toBeNull();
    expect(callbacks.restorePendingRef!.current).toBe(false);

    const onContentReady = mock(() => {});
    callbacks.onContentReady = onContentReady;
    callbacks.restorePendingRef!.current = true;

    // Trigger child re-render by calling onRestore (which calls setState in
    // the card component via the registered wrapper). We simulate this by
    // directly re-rendering -- the no-deps useLayoutEffect must fire on any
    // re-render of the card component, not just setState.
    act(() => {
      rerender(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    // The no-deps useLayoutEffect should have fired onContentReady and reset the flag.
    expect(onContentReady).toHaveBeenCalledTimes(1);
    expect(callbacks.restorePendingRef!.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-P06: Parent-sets-ref, child-reads-ref: mirrors real Tugcard code path
// ---------------------------------------------------------------------------

describe("useTugcardPersistence – parent-sets-ref, child-reads-ref indirection", () => {
  it("T-P06: Tugcard sets flag + writes onContentReady before onRestore; callback fires after child re-render commits", () => {
    // This test exercises the exact indirection the real Tugcard code path uses:
    // 1. Provider (parent) gets the registered callbacks object.
    // 2. Parent sets callbacks.restorePendingRef.current = true.
    // 3. Parent writes callbacks.onContentReady = handler.
    // 4. Parent calls callbacks.onRestore(state) -- this triggers child setState.
    // 5. The child's no-deps useLayoutEffect fires, reads the flag, calls onContentReady.
    // 6. onContentReady fires with the child DOM already reflecting the restored state.

    let readyFiredWithState: string | null = null;
    let domTextAtReady: string | null = null;

    const { Provider, getLatestCallbacks } = makeTestProvider();

    function CardContent() {
      const [text, setText] = useState("initial");

      useTugcardPersistence<string>({
        onSave: () => text,
        onRestore: (s: string) => { setText(s); },
      });

      return <div data-testid="card-text">{text}</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    const callbacks = getLatestCallbacks()!;
    expect(callbacks).not.toBeNull();
    expect(callbacks.restorePendingRef).toBeDefined();

    // Simulate Tugcard's Phase 1 effect: set flag, write onContentReady, call onRestore.
    act(() => {
      callbacks.restorePendingRef!.current = true;
      callbacks.onContentReady = () => {
        const el = document.querySelector("[data-testid='card-text']");
        domTextAtReady = el?.textContent ?? null;
        readyFiredWithState = domTextAtReady;
      };
      callbacks.onRestore("restored-value");
    });

    // onContentReady should have fired with the restored DOM state.
    expect(readyFiredWithState as unknown as string).toBe("restored-value");
    expect(domTextAtReady as unknown as string).toBe("restored-value");
    // Flag must be reset to false after firing.
    expect(callbacks.restorePendingRef!.current).toBe(false);
  });
});

