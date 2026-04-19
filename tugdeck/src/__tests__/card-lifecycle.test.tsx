/**
 * CardLifecycle unit tests.
 *
 * Pins the Step 5.5 invariant:
 *   - activateCard(id) updates both state systems (store + responder
 *     chain) and notifies observers, synchronously.
 *   - observeCardActivation fires on transitions only, plus initial
 *     sync for current active on subscribe.
 *   - useOnCardActivated wires both ends through a React context.
 *
 * Plain mocks stand in for DeckManager and ResponderChainManager so
 * the tests run without any deck / responder infrastructure.
 */

import "./setup-rtl";

import React from "react";
import { describe, it, expect, mock } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import {
  CardLifecycle,
  CardLifecycleContext,
  useOnCardActivated,
  type CardActivationObserver,
  type CardLifecycleManager,
  type CardLifecycleStore,
} from "@/lib/card-lifecycle";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStore(initial: string | null = null): CardLifecycleStore & {
  state: { focused: string | null };
} {
  const state = { focused: initial };
  return {
    state,
    focusCard(id: string) {
      state.focused = id;
    },
    getFocusedCardId() {
      return state.focused;
    },
  };
}

function makeManager(initialKeyCard: string | null = null): CardLifecycleManager & {
  state: { keyCard: string | null };
  makeFirstResponder: ReturnType<typeof mock>;
} {
  const state = { keyCard: initialKeyCard };
  const makeFirstResponder = mock((id: string) => {
    state.keyCard = id;
  });
  return {
    state,
    getKeyCard() {
      return state.keyCard;
    },
    makeFirstResponder,
  };
}

function makeLifecycle(initialActive: string | null = null) {
  const store = makeStore(initialActive);
  const manager = makeManager(initialActive);
  const lifecycle = new CardLifecycle(store, manager);
  return { lifecycle, store, manager };
}

// ---------------------------------------------------------------------------
// activateCard
// ---------------------------------------------------------------------------

describe("CardLifecycle.activateCard", () => {
  it("T-CL-01: focuses the store, promotes the key responder, notifies observers", () => {
    const { lifecycle, store, manager } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardActivation("card-A", (id) => calls.push(id));

    lifecycle.activateCard("card-A");

    expect(store.state.focused).toBe("card-A");
    expect(manager.state.keyCard).toBe("card-A");
    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-02: skips makeFirstResponder when getKeyCard already matches", () => {
    // Scenario: in-card descendant (editor) already holds first responder,
    // so getKeyCard walks up and returns this card id. Click on the card's
    // own title bar fires activateCard again; we must NOT demote focus
    // by promoting the outer card responder.
    const { lifecycle, manager } = makeLifecycle();
    manager.state.keyCard = "card-A";

    lifecycle.activateCard("card-A");

    expect(manager.makeFirstResponder).not.toHaveBeenCalled();
  });

  it("T-CL-03: same-card re-activation does not fire observers", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];
    // Wildcard plus specific — both must stay silent on re-activation.
    const unsubWild = lifecycle.observeCardActivation(null, (id) =>
      calls.push(`wild:${id}`),
    );
    const unsubSpecific = lifecycle.observeCardActivation("card-A", (id) =>
      calls.push(`specific:${id}`),
    );
    // The subscribe-time initial sync counts as two calls; clear them.
    calls.length = 0;

    lifecycle.activateCard("card-A");

    expect(calls).toEqual([]);

    unsubWild();
    unsubSpecific();
  });

  it("T-CL-04: cross-card activation fires transition on both wildcard and matching specific observers", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];
    lifecycle.observeCardActivation(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardActivation("card-B", (id) =>
      calls.push(`specific-B:${id}`),
    );
    lifecycle.observeCardActivation("card-C", (id) =>
      calls.push(`specific-C:${id}`),
    );
    calls.length = 0;

    lifecycle.activateCard("card-B");

    expect(calls).toEqual(["wild:card-B", "specific-B:card-B"]);
  });
});

// ---------------------------------------------------------------------------
// observeCardActivation
// ---------------------------------------------------------------------------

describe("CardLifecycle.observeCardActivation", () => {
  it("T-CL-05: fires synchronously on subscribe if the card is already active", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    lifecycle.observeCardActivation("card-A", (id) => calls.push(id));

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-06: wildcard fires synchronously on subscribe when any card is active", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    lifecycle.observeCardActivation(null, (id) => calls.push(id));

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-07: does NOT fire initial sync when no card is active", () => {
    const { lifecycle } = makeLifecycle(null);
    const calls: string[] = [];

    lifecycle.observeCardActivation(null, (id) => calls.push(id));
    lifecycle.observeCardActivation("card-A", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });

  it("T-CL-08: does NOT fire initial sync for a mismatched specific subscription", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    lifecycle.observeCardActivation("card-B", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });

  it("T-CL-09: unsubscribe stops future callbacks", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    const unsub = lifecycle.observeCardActivation("card-A", (id) =>
      calls.push(id),
    );

    unsub();
    lifecycle.activateCard("card-A");

    expect(calls).toEqual([]);
  });

  it("T-CL-10: throwing observer does not starve other subscribers", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    // Suppress the expected console.error so test output stays clean.
    const originalError = console.error;
    console.error = () => {};

    try {
      lifecycle.observeCardActivation(null, () => {
        throw new Error("boom");
      });
      lifecycle.observeCardActivation(null, (id) => calls.push(id));

      lifecycle.activateCard("card-A");

      expect(calls).toEqual(["card-A"]);
    } finally {
      console.error = originalError;
    }
  });
});

// ---------------------------------------------------------------------------
// getActiveCardId
// ---------------------------------------------------------------------------

describe("CardLifecycle.getActiveCardId", () => {
  it("T-CL-11: returns the store's current focused card", () => {
    const { lifecycle, store } = makeLifecycle();
    expect(lifecycle.getActiveCardId()).toBeNull();
    store.state.focused = "card-X";
    expect(lifecycle.getActiveCardId()).toBe("card-X");
  });
});

// ---------------------------------------------------------------------------
// useOnCardActivated
// ---------------------------------------------------------------------------

function wrapperFor(
  lifecycle: CardLifecycle | null,
): React.ComponentType<{ children: React.ReactNode }> {
  return function Wrapper({ children }) {
    return (
      <CardLifecycleContext.Provider value={lifecycle}>
        {children}
      </CardLifecycleContext.Provider>
    );
  };
}

describe("useOnCardActivated", () => {
  it("T-CL-HOOK-01: fires initial sync when the card is already active at mount", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];
    const cb: CardActivationObserver = (id) => calls.push(id);

    renderHook(() => useOnCardActivated("card-A", cb), {
      wrapper: wrapperFor(lifecycle),
    });

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-HOOK-02: does not fire initial sync when the card is not the active one", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    renderHook(() => useOnCardActivated("card-B", (id) => calls.push(id)), {
      wrapper: wrapperFor(lifecycle),
    });

    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-03: fires on a subsequent activation", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    renderHook(() => useOnCardActivated("card-A", (id) => calls.push(id)), {
      wrapper: wrapperFor(lifecycle),
    });

    act(() => {
      lifecycle.activateCard("card-A");
    });

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-HOOK-04: unmount unsubscribes", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    const { unmount } = renderHook(
      () => useOnCardActivated("card-A", (id) => calls.push(id)),
      { wrapper: wrapperFor(lifecycle) },
    );

    unmount();
    act(() => {
      lifecycle.activateCard("card-A");
    });

    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-05: no-op when no CardLifecycle is provided", () => {
    // No wrapper — useCardLifecycle returns null; subscription is skipped.
    const calls: string[] = [];
    expect(() => {
      renderHook(() => useOnCardActivated("card-A", (id) => calls.push(id)));
    }).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-06: inline callback re-renders don't re-install the subscription", () => {
    // If the subscription were re-installed on each render, the initial-
    // sync would fire on every render; with the callback-ref pattern it
    // fires exactly once at mount.
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    const { rerender } = renderHook(
      ({ tag }: { tag: number }) =>
        useOnCardActivated("card-A", (id) => calls.push(`${tag}:${id}`)),
      {
        initialProps: { tag: 1 },
        wrapper: wrapperFor(lifecycle),
      },
    );

    // Force re-renders with fresh closure identities.
    rerender({ tag: 2 });
    rerender({ tag: 3 });

    // Only the first (mount) subscription's initial sync fires. The
    // callback ref updates so the most-recent closure would receive
    // later activations, but there are none here.
    expect(calls).toEqual(["1:card-A"]);
  });
});
