/**
 * Cross-module drain-order tests for the shared delegate-drain queue.
 *
 * The contract:
 *   `useCardDelegate` and `useAppDelegate` enqueue onto the same
 *   module-scoped `MessageChannel`. A drain flushes every queued call
 *   in FIFO order on the next macrotask, regardless of which hook
 *   enqueued it. Before the shared queue, card and app drains ran on
 *   separate channels and their relative order was non-deterministic.
 */

import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import {
  CardLifecycle,
  CardLifecycleContext,
  useCardDelegate,
  type CardLifecycleStore,
  type CardLifecycleManager,
} from "@/lib/card-lifecycle";
import {
  AppLifecycle,
  AppLifecycleContext,
  useAppDelegate,
} from "@/lib/app-lifecycle";

async function flushDeferred(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function makeCardStore(initial: string | null): CardLifecycleStore {
  const state = { focused: initial };
  return {
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

function makeCardManager(): CardLifecycleManager {
  let keyCard: string | null = null;
  return {
    getKeyCard: () => keyCard,
    makeFirstResponder: (id: string) => {
      keyCard = id;
    },
  };
}

function combinedWrapper(
  card: CardLifecycle,
  app: AppLifecycle,
): React.ComponentType<{ children: React.ReactNode }> {
  return function Wrapper({ children }) {
    return (
      <CardLifecycleContext.Provider value={card}>
        <AppLifecycleContext.Provider value={app}>
          {children}
        </AppLifecycleContext.Provider>
      </CardLifecycleContext.Provider>
    );
  };
}

describe("delegate-drain cross-module FIFO", () => {
  it("T-DDRAIN-01: card and app delegate callbacks drain in enqueue order", async () => {
    const cardLifecycle = new CardLifecycle(makeCardStore(null), makeCardManager());
    const appLifecycle = new AppLifecycle();
    const log: string[] = [];

    renderHook(
      () => {
        useCardDelegate("card-A", {
          cardDidActivate: (id) => log.push(`card:didActivate:${id}`),
          cardWillDeactivate: (id) => log.push(`card:willDeactivate:${id}`),
        });
        useAppDelegate({
          applicationDidBecomeActive: () =>
            log.push("app:didBecomeActive"),
          applicationWillResignActive: () =>
            log.push("app:willResignActive"),
        });
      },
      { wrapper: combinedWrapper(cardLifecycle, appLifecycle) },
    );

    // Interleave card and app fires. Each notify synchronously schedules
    // a delegate call on the shared queue; the drain runs in FIFO order
    // on the next macrotask.
    act(() => {
      cardLifecycle.activateCard("card-A"); // enqueue: card:didActivate
      appLifecycle.notifyApplicationDidBecomeActive(); // enqueue: app:didBecomeActive
      appLifecycle.notifyApplicationWillResignActive(); // enqueue: app:willResignActive
      cardLifecycle.notifyCardWillDeactivate("card-A"); // enqueue: card:willDeactivate
    });
    await flushDeferred();

    expect(log).toEqual([
      "card:didActivate:card-A",
      "app:didBecomeActive",
      "app:willResignActive",
      "card:willDeactivate:card-A",
    ]);
  });

  it("T-DDRAIN-02: reversed enqueue order drains in reversed order (ordering depends on enqueue, not hook order)", async () => {
    const cardLifecycle = new CardLifecycle(makeCardStore(null), makeCardManager());
    const appLifecycle = new AppLifecycle();
    const log: string[] = [];

    renderHook(
      () => {
        useCardDelegate("card-A", {
          cardDidActivate: (id) => log.push(`card:${id}`),
        });
        useAppDelegate({
          applicationDidBecomeActive: () => log.push("app"),
        });
      },
      { wrapper: combinedWrapper(cardLifecycle, appLifecycle) },
    );

    act(() => {
      appLifecycle.notifyApplicationDidBecomeActive(); // enqueue app first
      cardLifecycle.activateCard("card-A"); // enqueue card second
    });
    await flushDeferred();

    expect(log).toEqual(["app", "card:card-A"]);
  });

  it("T-DDRAIN-03: multiple fires on the same channel preserve pairwise order across modules", async () => {
    const cardLifecycle = new CardLifecycle(makeCardStore(null), makeCardManager());
    const appLifecycle = new AppLifecycle();
    const log: string[] = [];

    renderHook(
      () => {
        useCardDelegate("card-A", {
          cardDidActivate: (id) => log.push(`card:didActivate:${id}`),
        });
        useCardDelegate("card-B", {
          cardDidActivate: (id) => log.push(`card:didActivate:${id}`),
        });
        useAppDelegate({
          applicationDidBecomeActive: () =>
            log.push("app:didBecomeActive"),
          applicationDidResignActive: () =>
            log.push("app:didResignActive"),
        });
      },
      { wrapper: combinedWrapper(cardLifecycle, appLifecycle) },
    );

    act(() => {
      cardLifecycle.activateCard("card-A");
      appLifecycle.notifyApplicationDidBecomeActive();
      cardLifecycle.activateCard("card-B");
      appLifecycle.notifyApplicationDidResignActive();
    });
    await flushDeferred();

    // card-A activation fires cardDidActivate; then the app event;
    // then card-B activation fires cardWillDeactivate(A) +
    // cardDidActivate(B) on wildcard channels, but the delegates here
    // listen per-card so only the matching id fires.
    expect(log).toEqual([
      "card:didActivate:card-A",
      "app:didBecomeActive",
      "card:didActivate:card-B",
      "app:didResignActive",
    ]);
  });
});
