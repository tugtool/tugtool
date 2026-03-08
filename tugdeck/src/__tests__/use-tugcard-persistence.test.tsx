/**
 * useTugcardPersistence hook unit tests -- Phase 5f Step 6.
 *
 * Tests cover:
 * - T-P01: useTugcardPersistence registers callbacks called by Tugcard on
 *   deactivation (onSave) and activation (onRestore).
 * - T-P02: Updating onSave/onRestore options does not cause re-registration
 *   (stable useLayoutEffect with empty deps, refs used inside wrappers).
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock } from "bun:test";
import { render, act } from "@testing-library/react";
import { useLayoutEffect } from "react";

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

// Suppress unused-import warning for useLayoutEffect (used implicitly via hook).
void useLayoutEffect;
