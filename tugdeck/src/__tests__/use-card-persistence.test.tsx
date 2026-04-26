/**
 * useCardPersistence hook unit tests.
 *
 * Tests cover:
 * - T-P01: useCardPersistence registers callbacks called by TugPane on
 *   deactivation (onSave) and activation (onRestore).
 * - T-P02: Updating onSave/onRestore options does not cause re-registration
 *   (stable useLayoutEffect with [register] deps, refs used inside wrappers).
 * - T-P03: Integration with TugPane context (round-trip through TugPane).
 * - T-P04: restorePendingRef is included in registered callbacks and defaults
 *   to false. ([D03])
 * - T-P05: When restorePendingRef.current is set to true and onContentReady is
 *   written into the callbacks object, triggering a re-render causes the no-deps
 *   useLayoutEffect to fire onContentReady and reset the flag. ([D01], [D02])
 * - T-P06: Parent-sets-ref, child-reads-ref indirection (mirrors the real TugPane
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

import { CardPersistenceContext, useCardPersistence } from "@/components/tugways/use-card-persistence";
import type { CardPersistenceCallbacks } from "@/components/tugways/use-card-persistence";
import { DeckManagerContext } from "@/deck-manager-context";
import { makeMockStore } from "./mock-deck-manager-store";
import type { IDeckManagerStore } from "@/deck-manager-store";

// ---------------------------------------------------------------------------
// Test helper: tracks how many times register is called (registration count).
// ---------------------------------------------------------------------------

/**
 * Build a context provider that exposes the register function, records every
 * call to it, and returns a ref to the most recently registered callbacks.
 */
function makeTestProvider() {
  let registrationCount = 0;
  let latestCallbacks: CardPersistenceCallbacks | null = null;

  function register(callbacks: CardPersistenceCallbacks) {
    registrationCount += 1;
    latestCallbacks = callbacks;
  }

  function getRegistrationCount() { return registrationCount; }
  function getLatestCallbacks() { return latestCallbacks; }

  function Provider({
    children,
    cardId = "test-card",
  }: {
    children: React.ReactNode;
    cardId?: string;
  }) {
    return (
      <CardPersistenceContext value={{ cardId, register }}>
        {children}
      </CardPersistenceContext>
    );
  }

  return { Provider, getRegistrationCount, getLatestCallbacks };
}

// ---------------------------------------------------------------------------
// T-P01: useCardPersistence registers callbacks called by TugPane
// ---------------------------------------------------------------------------

describe("useCardPersistence – callback registration and invocation", () => {
  it("T-P01a: onSave registered callback is called and returns the card's state", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const savedState = { counter: 7 };
    const onSave = mock(() => savedState);
    const onRestore = mock((_s: typeof savedState) => {});

    function CardContent() {
      useCardPersistence({ onSave, onRestore });
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

    // TugPane calls onSave on deactivation.
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
      useCardPersistence({ onSave, onRestore });
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

    // TugPane calls onRestore on activation with saved state.
    const savedState = { value: 99 };
    callbacks!.onRestore(savedState, { isActive: true });
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(restoredValues).toEqual([savedState]);
  });

  it("T-P01c: no-op when rendered outside a TugPane (context is null)", () => {
    // Without a Provider, CardPersistenceContext value is null.
    // The hook must not throw and must not call register.
    const onSave = mock(() => ({}));
    const onRestore = mock((_s: unknown) => {});

    function CardContent() {
      useCardPersistence({ onSave, onRestore });
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

describe("useCardPersistence – stable registration across re-renders", () => {
  it("T-P02: updating onSave/onRestore does not trigger re-registration", () => {
    const { Provider, getRegistrationCount, getLatestCallbacks } = makeTestProvider();

    let onSaveV1 = mock(() => ({ version: 1 }));
    let onRestoreV1 = mock((_s: unknown) => {});

    // Ref-like wrapper so we can swap implementations from the test.
    let currentOnSave = onSaveV1;
    let currentOnRestore = onRestoreV1;

    function CardContent() {
      useCardPersistence({
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
    const onSaveV2 = mock(() => ({ version: 4 }));
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
    // The mock returns the shape the test assigns (here: layout v4).
    expect(result).toEqual({ version: 4 });
    expect(onSaveV2).toHaveBeenCalledTimes(1);
    expect(onSaveV1).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-P03: Integration with TugPane context (round-trip through TugPane)
// ---------------------------------------------------------------------------

describe("useCardPersistence – TugPane context round-trip", () => {
  it("T-P03: card content using useCardPersistence receives onRestore via TugPane activation", () => {
    // Simulate TugPane providing context and calling onSave/onRestore.
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const contentState = { scroll: 100, selected: ["item-1"] };
    const onSave = mock(() => contentState);
    const restoredStates: unknown[] = [];
    const onRestore = mock((s: typeof contentState) => { restoredStates.push(s); });

    function CardContent() {
      useCardPersistence({ onSave, onRestore });
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

    // Simulate deactivation: TugPane calls onSave to capture state.
    const saved = callbacks.onSave();
    expect(saved).toEqual(contentState);

    // Simulate activation: TugPane calls onRestore with the saved state.
    callbacks.onRestore(saved, { isActive: true });
    expect(restoredStates).toHaveLength(1);
    expect(restoredStates[0]).toEqual(contentState);
  });
});

// ---------------------------------------------------------------------------
// T-P04: restorePendingRef is included in registered callbacks
// ---------------------------------------------------------------------------

describe("useCardPersistence – restorePendingRef in registered callbacks", () => {
  it("T-P04: restorePendingRef is present on registered callbacks and defaults to false", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const onSave = mock(() => ({}));
    const onRestore = mock((_s: unknown) => {});

    function CardContent() {
      useCardPersistence({ onSave, onRestore });
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

describe("useCardPersistence – no-deps useLayoutEffect fires onContentReady", () => {
  it("T-P05: setting restorePendingRef to true and writing onContentReady fires callback on re-render", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    const onSave = mock(() => ({}));
    let currentState = "initial";
    const onRestoreMock = mock((s: unknown) => { currentState = s as string; });

    function CardContent() {
      useCardPersistence({ onSave, onRestore: onRestoreMock });
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
// T-P06: Parent-sets-ref, child-reads-ref: mirrors real TugPane code path
// ---------------------------------------------------------------------------

describe("useCardPersistence – parent-sets-ref, child-reads-ref indirection", () => {
  it("T-P06: TugPane sets flag + writes onContentReady before onRestore; callback fires after child re-render commits", () => {
    // This test exercises the exact indirection the real TugPane code path uses:
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

      useCardPersistence<string>({
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

    // Simulate TugPane's Phase 1 effect: set flag, write onContentReady, call onRestore.
    act(() => {
      callbacks.restorePendingRef!.current = true;
      callbacks.onContentReady = () => {
        const el = document.querySelector("[data-testid='card-text']");
        domTextAtReady = el?.textContent ?? null;
        readyFiredWithState = domTextAtReady;
      };
      callbacks.onRestore("restored-value", { isActive: true });
    });

    // onContentReady should have fired with the restored DOM state.
    expect(readyFiredWithState as unknown as string).toBe("restored-value");
    expect(domTextAtReady as unknown as string).toBe("restored-value");
    // Flag must be reset to false after firing.
    expect(callbacks.restorePendingRef!.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-P07: `onCardActivated` is declared + forwarded — Step 22 ([A2]).
//
// At Step 22, the field is threaded through the hook but no dispatcher
// exists yet; the shared CardHost activation effect lands in Step 23
// as part of [A3] and becomes the first caller. These tests pin the
// declarative shape so content factories can register in advance.
//
// TODO(step-23): extend this suite with a behavior test: once [A3]
// wires the dispatcher, verify that `onCardActivated` fires on
// `false → true` transitions of `isFocusDestination(cardId)` and is
// skipped on the initial mount activation.
// ---------------------------------------------------------------------------

describe("useCardPersistence – onCardActivated field ([A2], Step 22)", () => {
  it("T-P07a: accepts the onCardActivated option (compile-time shape)", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    function CardContent() {
      // Compile-time assertion: the hook's option type accepts the new
      // optional field. Any type regression here fails `tsc --noEmit`.
      useCardPersistence({
        onSave: () => ({}),
        onRestore: () => {},
        onCardActivated: () => {},
      });
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
    // The hook forwards a stable wrapper on the callbacks record so the
    // activation effect ([A3], Step 23) can invoke it without checking
    // option-presence first.
    expect(typeof callbacks!.onCardActivated).toBe("function");
  });

  it("T-P07b: invoking registered onCardActivated calls the caller's latest implementation", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    let invocations = 0;
    function CardContent() {
      useCardPersistence({
        onSave: () => ({}),
        onRestore: () => {},
        onCardActivated: () => {
          invocations += 1;
        },
      });
      return <div>content</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>
      );
    });

    const callbacks = getLatestCallbacks()!;
    // Simulate the Step 23 dispatcher firing the callback.
    callbacks.onCardActivated!();
    callbacks.onCardActivated!();
    expect(invocations).toBe(2);
  });

  it("T-P07c: updating onCardActivated across re-renders does not re-register; wrapper reads latest (Rule 5)", () => {
    const { Provider, getRegistrationCount, getLatestCallbacks } =
      makeTestProvider();

    // Indirect through a module-scope var so the test can swap the
    // implementation without React prop changes re-registering.
    let current: () => void = mock(() => {});

    function CardContent() {
      useCardPersistence({
        onSave: () => ({}),
        onRestore: () => {},
        onCardActivated: () => current(),
      });
      return <div>content</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => {
      ({ rerender } = render(
        <Provider>
          <CardContent />
        </Provider>,
      ));
    });

    expect(getRegistrationCount()).toBe(1);

    const v2 = mock(() => {});
    current = v2;

    act(() => {
      rerender(
        <Provider>
          <CardContent />
        </Provider>,
      );
    });

    // Re-render did not re-register.
    expect(getRegistrationCount()).toBe(1);

    // The stable wrapper now delegates to the new implementation.
    const callbacks = getLatestCallbacks()!;
    callbacks.onCardActivated!();
    expect(v2).toHaveBeenCalledTimes(1);
  });

  it("T-P07d: callers that omit onCardActivated get a no-op wrapper that does not throw", () => {
    const { Provider, getLatestCallbacks } = makeTestProvider();

    function CardContent() {
      useCardPersistence({
        onSave: () => ({}),
        onRestore: () => {},
        // onCardActivated intentionally omitted.
      });
      return <div>content</div>;
    }

    act(() => {
      render(
        <Provider>
          <CardContent />
        </Provider>,
      );
    });

    const callbacks = getLatestCallbacks()!;
    // The wrapper is present (matches the onSave/onRestore pattern) but
    // no-ops silently when the caller didn't opt in.
    expect(typeof callbacks.onCardActivated).toBe("function");
    expect(() => callbacks.onCardActivated!()).not.toThrow();
  });

  // Helper: a provider that wires BOTH CardPersistenceContext and
  // DeckManagerContext, so the hook's new store-channel registration
  // (Step 23A) runs alongside the record-channel registration.
  function ProviderWithStore({
    store,
    cardId,
    children,
  }: {
    store: IDeckManagerStore;
    cardId: string;
    children: React.ReactNode;
  }) {
    return (
      <DeckManagerContext.Provider value={store}>
        <CardPersistenceContext value={{ cardId, register: () => {} }}>
          {children}
        </CardPersistenceContext>
      </DeckManagerContext.Provider>
    );
  }

  it("T-P07e: store.invokeActivationCallback(cardId, dispatchedFrom) fires the registered onCardActivated", () => {
    const store = makeMockStore();
    const cardId = "card-store-channel";

    let invocations = 0;
    function CardContent() {
      useCardPersistence({
        onSave: () => ({}),
        onRestore: () => {},
        onCardActivated: () => {
          invocations += 1;
        },
      });
      return <div>content</div>;
    }

    act(() => {
      render(
        <ProviderWithStore store={store} cardId={cardId}>
          <CardContent />
        </ProviderWithStore>,
      );
    });

    // Before the fire, the store channel has the wrapper registered.
    store.invokeActivationCallback(cardId, "test");
    store.invokeActivationCallback(cardId, "test");
    expect(invocations).toBe(2);
  });

  it("T-P07f: re-rendering with a different onCardActivated updates what store.invokeActivationCallback fires", () => {
    const store = makeMockStore();
    const cardId = "card-ref-sync";

    let current: () => void = mock(() => {});

    function CardContent() {
      useCardPersistence({
        onSave: () => ({}),
        onRestore: () => {},
        onCardActivated: () => current(),
      });
      return <div>content</div>;
    }

    let rerender!: ReturnType<typeof render>["rerender"];
    act(() => {
      ({ rerender } = render(
        <ProviderWithStore store={store} cardId={cardId}>
          <CardContent />
        </ProviderWithStore>,
      ));
    });

    const v2 = mock(() => {});
    current = v2;

    act(() => {
      rerender(
        <ProviderWithStore store={store} cardId={cardId}>
          <CardContent />
        </ProviderWithStore>,
      );
    });

    // The store-channel wrapper reads `onCardActivatedRef.current` at
    // call time, so the caller's latest implementation fires without
    // re-registration.
    store.invokeActivationCallback(cardId, "test");
    expect(v2).toHaveBeenCalledTimes(1);
  });
});
