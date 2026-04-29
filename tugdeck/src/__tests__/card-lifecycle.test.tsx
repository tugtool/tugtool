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
    getFirstResponderCardId() {
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
    // Stub: tests in this file pre-date the at-or-below guard. The
    // mock answers "first responder equals queried id" by checking
    // its tracked keyCard, which is what the existing tests rely
    // on (every test sets keyCard explicitly before driving the
    // lifecycle). Returns false when keyCard is null so calls fall
    // through to makeFirstResponder.
    firstResponderIsAtOrBelow(id: string): boolean {
      return state.keyCard === id;
    },
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
 * Wait one macrotask so the MessageChannel drain that `useCardDelegate`
 * schedules has a chance to fire. `setTimeout(0)` is a macrotask and
 * in practice drains after the MessageChannel port's `onmessage` has
 * already flushed the queue, so this is the canonical "let deferred
 * delegate callbacks run" barrier.
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

  it("T-CL-ORDER-01: A→B switch fires will/did events in D3 order", () => {
    // Per D3 of the lifecycle-delegates plan, activating card B while
    // card A is active fires:
    //   1. cardAWillDeactivate
    //   2. cardBWillActivate
    //   3. (store + responder chain update)
    //   4. cardADidDeactivate
    //   5. cardBDidActivate
    const { lifecycle, store } = makeLifecycle("card-A");
    const log: string[] = [];

    lifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeactivate:${id}`),
    );
    lifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    lifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeactivate:${id}`),
    );
    lifecycle.observeCardDidActivate(null, (id) => {
      // Record store state at didActivate time to confirm the store
      // transition happened BEFORE the did-phase.
      log.push(`didActivate:${id}@store=${store.state.focused}`);
    });
    // Clear initial-sync noise from observeCardDidActivate.
    log.length = 0;

    lifecycle.activateCard("card-B");

    expect(log).toEqual([
      "willDeactivate:card-A",
      "willActivate:card-B",
      "didDeactivate:card-A",
      "didActivate:card-B@store=card-B",
    ]);
  });

  it("T-CL-ORDER-02: same-card re-activation is silent on all four will/did channels", () => {
    const { lifecycle } = makeLifecycle("card-A");
    const log: string[] = [];

    lifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeactivate:${id}`),
    );
    lifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    lifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeactivate:${id}`),
    );
    lifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didActivate:${id}`),
    );
    log.length = 0;

    lifecycle.activateCard("card-A");

    expect(log).toEqual([]);
  });

  it("T-CL-ORDER-03: first activation (no prior) skips deactivation phases", () => {
    const { lifecycle } = makeLifecycle(null);
    const log: string[] = [];

    lifecycle.observeCardWillDeactivate(null, (id) =>
      log.push(`willDeactivate:${id}`),
    );
    lifecycle.observeCardWillActivate(null, (id) =>
      log.push(`willActivate:${id}`),
    );
    lifecycle.observeCardDidDeactivate(null, (id) =>
      log.push(`didDeactivate:${id}`),
    );
    lifecycle.observeCardDidActivate(null, (id) =>
      log.push(`didActivate:${id}`),
    );

    lifecycle.activateCard("card-A");

    expect(log).toEqual(["willActivate:card-A", "didActivate:card-A"]);
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
// Move / Resize
// ---------------------------------------------------------------------------

describe("CardLifecycle move/resize events", () => {
  it("T-CL-MOVE-01: notifyCardWillMove fires matching + wildcard observers synchronously", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardWillMove(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardWillMove("card-A", (id) =>
      calls.push(`specific:${id}`),
    );
    lifecycle.observeCardWillMove("card-B", (id) =>
      calls.push(`specific-B:${id}`),
    );

    lifecycle.notifyCardWillMove("card-A");

    expect(calls).toEqual(["wild:card-A", "specific:card-A"]);
  });

  it("T-CL-MOVE-02: notifyCardDidMove fires matching + wildcard observers synchronously", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardDidMove(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardDidMove("card-A", (id) => calls.push(`specific:${id}`));

    lifecycle.notifyCardDidMove("card-A");

    expect(calls).toEqual(["wild:card-A", "specific:card-A"]);
  });

  it("T-CL-MOVE-03: move observers have no initial-sync", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidMove("card-A");

    const calls: string[] = [];
    // Subscribing after a fire — no replay.
    lifecycle.observeCardDidMove("card-A", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });

  it("T-CL-RESIZE-01: notifyCardWillResize fires matching + wildcard observers synchronously", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardWillResize(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardWillResize("card-A", (id) =>
      calls.push(`specific:${id}`),
    );

    lifecycle.notifyCardWillResize("card-A");

    expect(calls).toEqual(["wild:card-A", "specific:card-A"]);
  });

  it("T-CL-RESIZE-02: notifyCardDidResize fires matching + wildcard observers synchronously", () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];
    lifecycle.observeCardDidResize(null, (id) => calls.push(`wild:${id}`));
    lifecycle.observeCardDidResize("card-A", (id) =>
      calls.push(`specific:${id}`),
    );

    lifecycle.notifyCardDidResize("card-A");

    expect(calls).toEqual(["wild:card-A", "specific:card-A"]);
  });

  it("T-CL-RESIZE-03: resize observers have no initial-sync", () => {
    const { lifecycle } = makeLifecycle();
    lifecycle.notifyCardDidResize("card-A");

    const calls: string[] = [];
    lifecycle.observeCardDidResize("card-A", (id) => calls.push(id));

    expect(calls).toEqual([]);
  });

  it("T-CL-HOOK-10: cardDidMove and cardDidResize fire through useCardDelegate", async () => {
    // Verifies the new events route through the MessageChannel drain
    // and reach the delegate methods. Complements T-CL-HOOK-07.
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardWillMove: (id) => calls.push(`willMove:${id}`),
          cardDidMove: (id) => calls.push(`didMove:${id}`),
          cardWillResize: (id) => calls.push(`willResize:${id}`),
          cardDidResize: (id) => calls.push(`didResize:${id}`),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyCardWillMove("card-A");
      lifecycle.notifyCardDidMove("card-A");
      lifecycle.notifyCardWillResize("card-A");
      lifecycle.notifyCardDidResize("card-A");
    });
    await flushDeferred();

    expect(calls).toEqual([
      "willMove:card-A",
      "didMove:card-A",
      "willResize:card-A",
      "didResize:card-A",
    ]);
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
  it("T-CL-HOOK-01: cardDidActivate fires initial sync when the card is already active at mount", async () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );
    // Initial-sync enqueues the delegate call to the MessageChannel
    // drain queue; the macrotask fires after the current task.
    await flushDeferred();

    expect(calls).toEqual(["card-A"]);
  });

  it("T-CL-HOOK-02: cardDidActivate does not fire initial sync when the card is not the active one", async () => {
    const { lifecycle } = makeLifecycle("card-A");
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-B", {
          cardDidActivate: (id) => calls.push(id),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );
    await flushDeferred();

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

  it("T-CL-HOOK-06: inline delegate re-renders don't re-install the subscription", async () => {
    // Proof that the subscription installs once and isn't torn down /
    // re-installed on every render: drain the first initial-sync (sees
    // tag=1), then re-render twice, drain again — no new events fire,
    // because no new initial-sync runs.
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
    // Drain mount's initial-sync. The delegate ref still points at
    // tag=1's closure at drain time.
    await flushDeferred();
    expect(calls).toEqual(["1:card-A"]);

    // Force re-renders with fresh delegate-object identities.
    rerender({ tag: 2 });
    rerender({ tag: 3 });
    await flushDeferred();

    // No new subscriptions, so no new initial-syncs — call log is
    // unchanged after re-renders.
    expect(calls).toEqual(["1:card-A"]);
  });

  it("T-CL-HOOK-07: routes to the right method by event type (all six channels)", async () => {
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    renderHook(
      () =>
        useCardDelegate("card-A", {
          cardDidFinishConstruction: (id) => calls.push(`construct:${id}`),
          cardWillActivate: (id) => calls.push(`willActivate:${id}`),
          cardDidActivate: (id) => calls.push(`didActivate:${id}`),
          cardWillDeactivate: (id) => calls.push(`willDeactivate:${id}`),
          cardDidDeactivate: (id) => calls.push(`didDeactivate:${id}`),
          cardWillBeginDestruction: (id) => calls.push(`destroy:${id}`),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    act(() => {
      lifecycle.notifyCardDidFinishConstruction("card-A");
      lifecycle.activateCard("card-A"); // first activation: no deactivate phase
      lifecycle.activateCard("card-B"); // switch: deactivates A, activates B (B ignored by delegate)
      lifecycle.notifyCardWillBeginDestruction("card-A");
    });
    await flushDeferred();

    expect(calls).toEqual([
      "construct:card-A",
      "willActivate:card-A",
      "didActivate:card-A",
      "willDeactivate:card-A",
      "didDeactivate:card-A",
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

  it("T-CL-HOOK-09: cardWillBeginDestruction delegate fires even when the hosting component unmounts (H1)", async () => {
    // Resolution of hole H1 in the lifecycle-delegate-reliability
    // study: under the old setState+useEffect deferral, an unmount
    // between fire and drain dropped the destruction callback. Under
    // the MessageChannel drain, the queued closure captures the
    // delegate ref directly and survives unmount.
    const { lifecycle } = makeLifecycle();
    const calls: string[] = [];

    const { unmount } = renderHook(
      () =>
        useCardDelegate("card-A", {
          cardWillBeginDestruction: (id) => calls.push(`destroy:${id}`),
        }),
      { wrapper: wrapperFor(lifecycle) },
    );

    // Synchronously: fire destruction, then unmount the component.
    // The observer subscription is torn down by the unmount, but the
    // queued delegate closure has already captured the delegate ref.
    act(() => {
      lifecycle.notifyCardWillBeginDestruction("card-A");
      unmount();
    });
    await flushDeferred();

    expect(calls).toEqual(["destroy:card-A"]);
  });
});

