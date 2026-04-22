/**
 * useCardContentRestore hook unit tests.
 *
 * Host-side hook that runs the mount-time content-restore effect. Tests
 * cover:
 *   - no-op when no saved bag exists
 *   - no-persistence branch: scroll + selection apply synchronously
 *   - persistence-aware branch: restorePendingRef flag flips, onRestore
 *     runs with saved content, onContentReady installed on the callbacks
 *   - unmount mid-restore clears restorePendingRef and restores
 *     visibility
 *
 * The hook uses useLayoutEffect + the child-driven ready callback pattern
 * [L04, D78]. Tests drive `onContentReady` synchronously — the child's
 * own useLayoutEffect is out of scope for a hook-level test.
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import React, { useRef } from "react";
import { render, renderHook } from "@testing-library/react";

import { useCardContentRestore } from "@/components/tugways/hooks/use-card-content-restore";
import type { CardPersistenceCallbacks } from "@/components/tugways/use-card-persistence";
import { DeckManagerContext } from "@/deck-manager-context";
import { selectionGuard } from "@/components/tugways/selection-guard";

import { makeMockStore } from "./mock-deck-manager-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHostEl(): HTMLDivElement {
  const el = document.createElement("div");
  // Make the element scrollable so contentEl.scrollLeft/scrollTop can
  // take effect under JSDOM.
  Object.defineProperty(el, "scrollLeft", {
    value: 0,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    value: 0,
    writable: true,
    configurable: true,
  });
  return el as HTMLDivElement;
}

function wrap(store: ReturnType<typeof makeMockStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      DeckManagerContext.Provider,
      { value: store },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCardContentRestore", () => {
  it("is a no-op when no CardStateBag is saved", () => {
    const store = makeMockStore();
    const host = makeHostEl();
    const ref = { current: null } as React.RefObject<CardPersistenceCallbacks | null>;

    expect(() => {
      renderHook(
        () =>
          useCardContentRestore({
            cardId: "c1",
            hostStackId: "s1",
            hostContentEl: host,
            persistenceCallbacksRef: ref,
          }),
        { wrapper: wrap(store) },
      );
    }).not.toThrow();

    expect(host.scrollLeft).toBe(0);
    expect(host.scrollTop).toBe(0);
  });

  it("applies scroll synchronously in the no-persistence branch", () => {
    const store = makeMockStore();
    store.setCardState("c1", { scroll: { x: 100, y: 200 } });
    const host = makeHostEl();
    const ref = { current: null } as React.RefObject<CardPersistenceCallbacks | null>;

    renderHook(
      () =>
        useCardContentRestore({
          cardId: "c1",
          hostStackId: "s1",
          hostContentEl: host,
          persistenceCallbacksRef: ref,
        }),
      { wrapper: wrap(store) },
    );

    expect(host.scrollLeft).toBe(100);
    expect(host.scrollTop).toBe(200);
  });

  it("uses the persistence-aware branch: flips restorePendingRef, calls onRestore, installs onContentReady", () => {
    const store = makeMockStore();
    store.setCardState("c1", {
      scroll: { x: 50, y: 75 },
      content: { saved: "payload" },
    });
    const host = makeHostEl();

    const restorePendingRef = { current: false };
    let receivedState: unknown = undefined;
    const callbacks: CardPersistenceCallbacks = {
      onSave: () => undefined,
      onRestore: (state: unknown) => {
        receivedState = state;
      },
      restorePendingRef,
    };
    const ref = { current: callbacks } as React.RefObject<CardPersistenceCallbacks | null>;

    renderHook(
      () =>
        useCardContentRestore({
          cardId: "c1",
          hostStackId: "s1",
          hostContentEl: host,
          persistenceCallbacksRef: ref,
        }),
      { wrapper: wrap(store) },
    );

    // restorePendingRef set; onRestore invoked with the saved content;
    // onContentReady installed; host visibility hidden until ready fires.
    expect(restorePendingRef.current).toBe(true);
    expect(receivedState).toEqual({ saved: "payload" });
    expect(typeof callbacks.onContentReady).toBe("function");
    expect(host.style.visibility).toBe("hidden");

    // Simulating the child's own useLayoutEffect firing onContentReady:
    callbacks.onContentReady!();
    expect(host.scrollLeft).toBe(50);
    expect(host.scrollTop).toBe(75);
    expect(host.style.visibility).toBe("");
  });

  it("unmount mid-restore clears restorePendingRef and unhides the host", () => {
    const store = makeMockStore();
    store.setCardState("c1", {
      scroll: { x: 10, y: 20 },
      content: { saved: true },
    });
    const host = makeHostEl();

    const restorePendingRef = { current: false };
    const callbacks: CardPersistenceCallbacks = {
      onSave: () => undefined,
      onRestore: () => {},
      restorePendingRef,
    };
    const ref = { current: callbacks } as React.RefObject<CardPersistenceCallbacks | null>;

    const { unmount } = renderHook(
      () =>
        useCardContentRestore({
          cardId: "c1",
          hostStackId: "s1",
          hostContentEl: host,
          persistenceCallbacksRef: ref,
        }),
      { wrapper: wrap(store) },
    );

    expect(restorePendingRef.current).toBe(true);
    expect(host.style.visibility).toBe("hidden");

    unmount();

    expect(restorePendingRef.current).toBe(false);
    expect(host.style.visibility).toBe("");
  });

  it("applies saved selection via selectionGuard in the no-persistence branch", () => {
    const store = makeMockStore();
    const host = document.createElement("div");
    host.textContent = "hello";
    document.body.appendChild(host);
    selectionGuard.registerBoundary("s-sel", host);

    store.setCardState("c1", {
      selection: {
        anchorPath: [0],
        anchorOffset: 1,
        focusPath: [0],
        focusOffset: 3,
      },
    });
    const ref = { current: null } as React.RefObject<CardPersistenceCallbacks | null>;

    renderHook(
      () =>
        useCardContentRestore({
          cardId: "c1",
          hostStackId: "s-sel",
          hostContentEl: host as HTMLDivElement,
          persistenceCallbacksRef: ref,
        }),
      { wrapper: wrap(store) },
    );

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    // Selection text should be "el" (offsets 1..3 of "hello").
    expect(sel?.toString()).toBe("el");

    selectionGuard.unregisterBoundary("s-sel");
    host.remove();
  });
});
