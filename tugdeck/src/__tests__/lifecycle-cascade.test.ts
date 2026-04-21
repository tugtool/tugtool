/**
 * lifecycle-cascade unit tests.
 *
 * Pins the Step 7 invariants from the lifecycle-delegates plan:
 *   - `applicationWillResignActive` / `applicationWillHide` each
 *     fire `cardWillDeactivate` + `cardDidDeactivate` on the active
 *     card, exactly once per cycle (idempotent).
 *   - `applicationDidBecomeActive` / `applicationDidUnhide` each
 *     restore with `cardWillActivate` + `cardDidActivate` on the
 *     card that was deactivated by the app, exactly once per cycle.
 *   - No cascade fires when no card is active.
 *   - `dispose()` removes all observer subscriptions.
 */

import { describe, it, expect, spyOn } from "bun:test";
import {
  CardLifecycle,
  type CardLifecycleStore,
} from "@/lib/card-lifecycle";
import { AppLifecycle } from "@/lib/app-lifecycle";
import { installLifecycleCascade } from "@/lib/lifecycle-cascade";

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

function makeLifecycles(initialActive: string | null = null) {
  const store = makeStore(initialActive);
  const cardLifecycle = new CardLifecycle(store);
  const appLifecycle = new AppLifecycle();
  // Mirror the real invariant: an active card is always a constructed
  // card. The 11.6.5 H8 skip-on-destroyed guard in `lifecycle-cascade`
  // reads `cardLifecycle.hasConstructed(cardId)` before firing
  // reactivation — tests that never flip this on would look like a
  // "destroyed" card to the cascade.
  if (initialActive !== null) {
    cardLifecycle.notifyCardDidFinishConstruction(initialActive);
  }
  return { cardLifecycle, appLifecycle, store };
}

/**
 * Install observers on all four card channels and record the
 * sequence of firings as `"<method>:<cardId>"` strings. Returns the
 * log array so the caller can assert on order.
 */
function recordCardEvents(cardLifecycle: CardLifecycle): string[] {
  const log: string[] = [];
  cardLifecycle.observeCardWillDeactivate(null, (id) =>
    log.push(`willDeactivate:${id}`),
  );
  cardLifecycle.observeCardDidDeactivate(null, (id) =>
    log.push(`didDeactivate:${id}`),
  );
  cardLifecycle.observeCardWillActivate(null, (id) =>
    log.push(`willActivate:${id}`),
  );
  cardLifecycle.observeCardDidActivate(null, (id) =>
    log.push(`didActivate:${id}`),
  );
  return log;
}

// ---------------------------------------------------------------------------
// Deactivation cascade
// ---------------------------------------------------------------------------

describe("lifecycle-cascade — deactivation", () => {
  it("T-LCC-01: applicationWillResignActive fires will+didDeactivate on the active card", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0; // drop any initial-sync noise from didActivate

    appLifecycle.notifyApplicationWillResignActive();

    expect(log).toEqual(["willDeactivate:card-A", "didDeactivate:card-A"]);
  });

  it("T-LCC-02: applicationWillHide fires the same deactivation cascade", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillHide();

    expect(log).toEqual(["willDeactivate:card-A", "didDeactivate:card-A"]);
  });

  it("T-LCC-03: resignActive followed by willHide deactivates exactly once (idempotent)", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationWillHide();

    // Second will-event is a no-op because the guard is set.
    expect(log).toEqual(["willDeactivate:card-A", "didDeactivate:card-A"]);
  });

  it("T-LCC-04: deactivation cascade is a no-op when no card is active", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles(null);
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);

    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationWillHide();

    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Reactivation cascade
// ---------------------------------------------------------------------------

describe("lifecycle-cascade — reactivation", () => {
  it("T-LCC-05: applicationDidBecomeActive fires will+didActivate on the deactivated card", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    // Full cycle: resign → become-active.
    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationDidBecomeActive();

    expect(log).toEqual([
      "willDeactivate:card-A",
      "didDeactivate:card-A",
      "willActivate:card-A",
      "didActivate:card-A",
    ]);
  });

  it("T-LCC-06: applicationDidUnhide fires the same reactivation cascade", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillHide();
    appLifecycle.notifyApplicationDidUnhide();

    expect(log).toEqual([
      "willDeactivate:card-A",
      "didDeactivate:card-A",
      "willActivate:card-A",
      "didActivate:card-A",
    ]);
  });

  it("T-LCC-07: becomeActive followed by didUnhide reactivates exactly once (idempotent)", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationDidBecomeActive();
    // Second reactivate-side event — guard already cleared.
    appLifecycle.notifyApplicationDidUnhide();

    expect(log).toEqual([
      "willDeactivate:card-A",
      "didDeactivate:card-A",
      "willActivate:card-A",
      "didActivate:card-A",
    ]);
  });

  it("T-LCC-08: reactivation restores the card that was active at deactivation time", () => {
    // If the active card changed between the deactivate and the
    // reactivate (shouldn't happen under normal flow, but pinning
    // the behavior), the cascade reactivates the card captured at
    // deactivate time, not whatever the store now says.
    const { cardLifecycle, appLifecycle, store } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillResignActive();
    // Simulate the store having moved on (direct mutation — bypasses
    // activateCard's observer chain).
    store.state.focused = "card-B";

    appLifecycle.notifyApplicationDidBecomeActive();

    expect(log).toEqual([
      "willDeactivate:card-A",
      "didDeactivate:card-A",
      "willActivate:card-A",
      "didActivate:card-A",
    ]);
  });

  it("T-LCC-09: reactivation is a no-op when no prior deactivation cascade fired", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    // No preceding resign/hide — the guard is null.
    appLifecycle.notifyApplicationDidBecomeActive();

    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe("lifecycle-cascade — dispose", () => {
  it("T-LCC-10: dispose() removes all app-lifecycle subscriptions", () => {
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    const handle = installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    handle.dispose();

    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationDidBecomeActive();
    appLifecycle.notifyApplicationWillHide();
    appLifecycle.notifyApplicationDidUnhide();

    expect(log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 11.6.1b transition 9: cascade targets the composite first responder
// ---------------------------------------------------------------------------

describe("lifecycle-cascade — 11.6.5 H8/H-A9 skip-on-destroyed", () => {
  it("T-LCC-DESTROYED: cascade skips reactivation when the deactivated card was destroyed", () => {
    // Setup: card-A is constructed and active. App resigns → cascade
    // deactivates A. A is then destroyed (willBeginDestruction removes
    // it from `constructedCards`). App becomes active → cascade must
    // skip reactivation instead of firing will/didActivate on a freed id.
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    cardLifecycle.notifyCardDidFinishConstruction("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillResignActive();
    expect(log).toEqual([
      "willDeactivate:card-A",
      "didDeactivate:card-A",
    ]);

    // Card-A is destroyed while the app is backgrounded.
    cardLifecycle.notifyCardWillBeginDestruction("card-A");
    log.length = 0;

    // App returns → cascade sees `!hasConstructed("card-A")` and skips.
    appLifecycle.notifyApplicationDidBecomeActive();
    expect(log).toEqual([]);
  });
});

describe("lifecycle-cascade — 11.6.1b composite first responder", () => {
  it("T-11-6-1b-09: cascade fires on getFirstResponderCardId, not getFocusedCardId", () => {
    // Build a store where the z-order top (`getFocusedCardId`) and the
    // composite first responder (`getFirstResponderCardId`) point at
    // different cards. Pre-11.6.1b the cascade picked the z-order top;
    // 11.6.1b retargets it to the composite bit so the blurred card
    // matches the card that actually holds focus in the UI.
    const state = { topOfZ: "card-top", firstResponder: "card-fr" };
    const store: CardLifecycleStore & { state: typeof state } = {
      state,
      focusCard(id: string) {
        state.topOfZ = id;
      },
      getFocusedCardId() {
        return state.topOfZ;
      },
      getFirstResponderCardId() {
        return state.firstResponder;
      },
    };
    const cardLifecycle = new CardLifecycle(store);
    // Mark the FR as constructed so the 11.6.5 H8 skip-on-destroyed
    // guard inside `reactivateIfNeeded` does not suppress reactivation.
    cardLifecycle.notifyCardDidFinishConstruction(state.firstResponder);
    const appLifecycle = new AppLifecycle();
    installLifecycleCascade(cardLifecycle, appLifecycle);
    const log = recordCardEvents(cardLifecycle);
    log.length = 0;

    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationDidBecomeActive();

    expect(log).toEqual([
      "willDeactivate:card-fr",
      "didDeactivate:card-fr",
      "willActivate:card-fr",
      "didActivate:card-fr",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Step 11.6.5 Piece 2 — dev-mode log gating
// ---------------------------------------------------------------------------

describe("lifecycle trace logs gated by LIFECYCLE_LOG (11.6.5 H10)", () => {
  it("lifecycle notify methods and cascade transitions emit no console.log when the gate is closed", () => {
    // Bun tests run with `import.meta.env?.DEV` absent, so the
    // module-level `LIFECYCLE_LOG` constants in card-lifecycle.ts,
    // app-lifecycle.ts, and lifecycle-cascade.ts resolve to `false`.
    // Every wrapped `console.log` is a no-op under these conditions;
    // the spy captures any call that leaks through the gate.
    const { cardLifecycle, appLifecycle } = makeLifecycles("card-A");
    installLifecycleCascade(cardLifecycle, appLifecycle);

    const spy = spyOn(console, "log");
    spy.mockClear();

    // Card-lifecycle channels.
    cardLifecycle.notifyCardDidFinishConstruction("card-B");
    cardLifecycle.notifyCardWillActivate("card-B");
    cardLifecycle.notifyCardDidActivate("card-B");
    cardLifecycle.notifyCardWillDeactivate("card-B");
    cardLifecycle.notifyCardDidDeactivate("card-B");
    cardLifecycle.notifyCardWillMove("card-B");
    cardLifecycle.notifyCardDidMove("card-B");
    cardLifecycle.notifyCardWillResize("card-B");
    cardLifecycle.notifyCardDidResize("card-B");
    cardLifecycle.notifyCardWillBeginDestruction("card-B");

    // App-lifecycle channels.
    appLifecycle.notifyApplicationWillBecomeActive();
    appLifecycle.notifyApplicationDidBecomeActive();
    appLifecycle.notifyApplicationWillResignActive();
    appLifecycle.notifyApplicationDidResignActive();
    appLifecycle.notifyApplicationWillHide();
    appLifecycle.notifyApplicationDidHide();
    appLifecycle.notifyApplicationWillUnhide();
    appLifecycle.notifyApplicationDidUnhide();

    // Cascade trace (fires during the resign/become-active pair above).
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
