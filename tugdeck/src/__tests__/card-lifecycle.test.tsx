/**
 * CardLifecycle unit tests.
 *
 * Pins the Step 5.5 invariant:
 *   - activateCard(id) updates both state systems (store + responder
 *     chain) and notifies observers, synchronously.
 *   - observeCardDidActivate fires on transitions only, plus initial
 *     sync for current active on subscribe.
 *   - useCardDelegate wires both ends through a React context.
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
  useCardDelegate,
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

/**
 * Flush pending deferred callbacks so any observer notifications
 * scheduled via `deferToNextMacrotask` inside `activateCard` have
 * fired before the test asserts on them.
 */
async function flushDeferred(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("CardLifecycle.activateCard", () => {
  it("T-CL-01: focuses the store, promotes the key responder, notifies observers", async () => {
    const { lifecycle, store, manager } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardDidActivate("card-A", (id) => calls.push(id));

    lifecycle.activateCard("card-A");

    // Store + responder chain updates are synchronous; observer
    // notify is deferred to the next macrotask so side effects
    // run after the triggering browser gesture completes.
    expect(store.state.focused).toBe("card-A");
    expect(manager.state.keyCard).toBe("card-A");
    await flushDeferred();
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

  it("T-CL-03: same-card re-activation does not fire observers", async () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];
    // Wildcard plus specific — both must stay silent on re-activation.
    const unsubWild = lifecycle.observeCardDidActivate(null, (id) =>
      calls.push(`wild:${id}`),
    );
    const unsubSpecific = lifecycle.observeCardDidActivate("card-A", (id) =>
      calls.push(`specific:${id}`),
    );
    // The subscribe-time initial sync counts as two calls; clear them.
    calls.length = 0;

    lifecycle.activateCard("card-A");
    await flushDeferred();

    expect(calls).toEqual([]);

    unsubWild();
    unsubSpecific();
  });

  it("T-CL-04: cross-card activation fires transition on both wildcard and matching specific observers", async () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];
    lifecycle.observeCardDidActivate(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardDidActivate("card-B", (id) =>
      calls.push(`specific-B:${id}`),
    );
    lifecycle.observeCardDidActivate("card-C", (id) =>
      calls.push(`specific-C:${id}`),
    );
    calls.length = 0;

    lifecycle.activateCard("card-B");
    await flushDeferred();

    expect(calls).toEqual(["wild:card-B", "specific-B:card-B"]);
  });

  it("T-CL-DEACT-01: cross-card activation fires DEACTIVATION for the previous card, synchronously", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const deactivations: string[] = [];
    lifecycle.observeCardDidDeactivate("card-A", (id) =>
      deactivations.push(id),
    );

    lifecycle.activateCard("card-B");

    // Deactivation fires synchronously (before activation's deferred fire).
    expect(deactivations).toEqual(["card-A"]);
  });

  it("T-CL-DEACT-02: activating with no prior active does not fire deactivation", () => {
    const { lifecycle } = makeLifecycle(null);
    const deactivations: string[] = [];
    lifecycle.observeCardDidDeactivate(null, (id) => deactivations.push(id));

    lifecycle.activateCard("card-A");

    expect(deactivations).toEqual([]);
  });

  it("T-CL-DEACT-03: same-card re-activation does not fire deactivation", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const deactivations: string[] = [];
    lifecycle.observeCardDidDeactivate(null, (id) => deactivations.push(id));

    lifecycle.activateCard("card-A");

    expect(deactivations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Construction / Destruction
// ---------------------------------------------------------------------------

describe("CardLifecycle.notifyCardDidFinishConstruction", () => {
  it("T-CL-CON-01: notifyCardDidFinishConstruction fires matching + wildcard observers (deferred)", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardDidFinishConstruction(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardDidFinishConstruction("card-A", (id) =>
      calls.push(`specific:${id}`),
    );
    // Initial-sync fires for both subscribers on subscribe (deferred).
    await flushDeferred();
    calls.length = 0;

    lifecycle.notifyCardDidFinishConstruction("card-A");
    await flushDeferred();

    expect(calls).toEqual(["wild:card-A", "specific:card-A"]);
  });

  it("T-CL-CON-02: late subscriber receives initial-sync for already-constructed card (deferred)", async () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidFinishConstruction("card-A");
    await flushDeferred();

    const calls: string[] = [];
    lifecycle.observeCardDidFinishConstruction("card-A", (id) => calls.push(id));
    await flushDeferred();

    // Initial-sync: fires for the already-constructed card on subscribe.
    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-CON-03: wildcard subscriber receives initial-sync for every currently-constructed card (deferred)", async () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidFinishConstruction("card-A");
    lifecycle.notifyCardDidFinishConstruction("card-B");
    await flushDeferred();

    const calls: string[] = [];
    lifecycle.observeCardDidFinishConstruction(null, (id) => calls.push(id));
    await flushDeferred();

    expect(calls.sort()).toEqual(["card-A", "card-B"]);
  });

  it("T-CL-CON-04: destroyed cards are removed from the constructed-set and do not initial-sync", async () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidFinishConstruction("card-A");
    await flushDeferred();
    lifecycle.notifyCardWillBeginDestruction("card-A");

    const calls: string[] = [];
    lifecycle.observeCardDidFinishConstruction("card-A", (id) => calls.push(id));
    await flushDeferred();

    expect(calls).toEqual([]);
  });
});

describe("CardLifecycle.notifyCardWillBeginDestruction", () => {
  it("T-CL-DES-01: notifyCardWillBeginDestruction fires matching + wildcard observers synchronously", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidFinishConstruction("card-A");
    const calls: string[] = [];
    lifecycle.observeCardWillBeginDestruction(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardWillBeginDestruction("card-A", (id) =>
      calls.push(`specific:${id}`),
    );

    lifecycle.notifyCardWillBeginDestruction("card-A");

    expect(calls).toEqual(["wild:card-A", "specific:card-A"]);
  });

  it("T-CL-DES-02: destruction observers have no initial-sync", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidFinishConstruction("card-A");
    lifecycle.notifyCardWillBeginDestruction("card-A");

    const calls: string[] = [];
    // Subscribing after destruction completed — no replay.
    lifecycle.observeCardWillBeginDestruction("card-A", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// observeCardDidActivate
// ---------------------------------------------------------------------------

describe("CardLifecycle.observeCardDidActivate", () => {
  it("T-CL-05: fires synchronously on subscribe if the card is already active", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    lifecycle.observeCardDidActivate("card-A", (id) => calls.push(id));

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-06: wildcard fires synchronously on subscribe when any card is active", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    lifecycle.observeCardDidActivate(null, (id) => calls.push(id));

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-07: does NOT fire initial sync when no card is active", () => {
    const { lifecycle } = makeLifecycle(null);
    const calls: string[] = [];

    lifecycle.observeCardDidActivate(null, (id) => calls.push(id));
    lifecycle.observeCardDidActivate("card-A", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });

  it("T-CL-08: does NOT fire initial sync for a mismatched specific subscription", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    lifecycle.observeCardDidActivate("card-B", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });

  it("T-CL-09: unsubscribe stops future callbacks", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    const unsub = lifecycle.observeCardDidActivate("card-A", (id) =>
      calls.push(id),
    );

    unsub();
    lifecycle.activateCard("card-A");
    await flushDeferred();

    expect(calls).toEqual([]);
  });

  it("T-CL-10: throwing observer does not starve other subscribers", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    // Suppress the expected console.error so test output stays clean.
    const originalError = console.error;
    console.error = () => {};

    try {
      lifecycle.observeCardDidActivate(null, () => {
        throw new Error("boom");
      });
      lifecycle.observeCardDidActivate(null, (id) => calls.push(id));

      lifecycle.activateCard("card-A");
      await flushDeferred();

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
// useCardDelegate
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

describe("useCardDelegate", () => {
  it("T-CL-HOOK-01: cardDidActivate fires initial sync when the card is already active at mount", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-HOOK-02: cardDidActivate does not fire initial sync when the card is not the active one", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-B", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-03: cardDidActivate fires on a subsequent activation", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.activateCard("card-A");
    });
    await flushDeferred();

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-HOOK-04: unmount unsubscribes", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    const { unmount } = renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    unmount();
    act(() => {
      lifecycle.activateCard("card-A");
    });
    await flushDeferred();

    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-05: no-op when no CardLifecycle is provided", () => {
    // No wrapper — useCardLifecycle returns null; subscriptions are skipped.
    const calls: string[] = [];
    expect(() => {
      renderHook(() =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(id),
        }),
      );
    }).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-06: inline delegate re-renders don't re-install the subscription", () => {
    // If the subscription were re-installed on each render, the initial-
    // sync would fire on every render; with the delegate-ref pattern it
    // fires exactly once at mount.
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    const { rerender } = renderHook(
      ({ tag }: { tag: number }) =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(`${tag}:${id}`),
        }),
      {
        initialProps: { tag: 1 },
        wrapper: wrapperFor(lifecycle),
      },
    );

    // Force re-renders with fresh delegate-object identities.
    rerender({ tag: 2 });
    rerender({ tag: 3 });

    // Only the first (mount) subscription's initial sync fires. The
    // delegate ref updates so the most-recent closure would receive
    // later activations, but there are none here.
    expect(calls).toEqual(["1:card-A"]);
  });

  it("T-CL-HOOK-07: routes to the right method by event type", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidFinishConstruction: (id) => calls.push(`construct:${id}`),
          cardDidActivate: (id) => calls.push(`activate:${id}`),
          cardDidDeactivate: (id) => calls.push(`deactivate:${id}`),
          cardWillBeginDestruction: (id) => calls.push(`destroy:${id}`),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyCardDidFinishConstruction("card-A");
      lifecycle.activateCard("card-A");
      lifecycle.activateCard("card-B");
      lifecycle.notifyCardWillBeginDestruction("card-A");
    });
    await flushDeferred();

    expect(calls).toEqual([
      "construct:card-A",
      "activate:card-A",
      "deactivate:card-A",
      "destroy:card-A",
    ]);
  });

  it("T-CL-HOOK-08: missing delegate methods are no-ops", async () => {
    // Only cardDidActivate is defined; other events fire but produce
    // no delegate invocations.
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyCardDidFinishConstruction("card-A");
      lifecycle.activateCard("card-A");
      lifecycle.notifyCardWillBeginDestruction("card-A");
    });
    await flushDeferred();

    expect(calls).toEqual(["card-A"]);
  });
});

