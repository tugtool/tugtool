/**
 * use-focus-destination.test.tsx — React-subscription coverage for
 * `useFocusDestination(cardId)` ([A1]).
 *
 * The hook wraps the pure `isFocusDestination` selector with
 * `useSyncExternalStore` and the `DeckManagerContext` store. These
 * tests pin three guarantees visible to consumers:
 *
 *   1. The hook returns the selector's current value on first render.
 *   2. The hook re-renders when `hasFocus` flips (simulating window
 *      focus / blur transitions).
 *   3. The hook re-renders when the active-pane / active-card identity
 *      changes.
 *
 * Pure-selector behavior is covered in `deck-store-selectors.test.ts`.
 */

import "./setup-rtl";

import React from "react";
import { describe, test, expect, afterEach } from "bun:test";
import { render, cleanup, act } from "@testing-library/react";

import type { CardState, DeckState, TugPaneState } from "../layout-tree";
import type { IDeckManagerStore } from "../deck-manager-store";
import { DeckManagerContext } from "../deck-manager-context";
import { useFocusDestination } from "../deck-store-hooks";
import { makeMockStore } from "./mock-deck-manager-store";

function makeCard(id: string): CardState {
  return { id, componentId: "probe", title: id, closable: true };
}

function makePane(
  id: string,
  cardIds: string[],
  activeCardId: string,
): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds,
    activeCardId,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

/**
 * Build a store whose `subscribe` wires real listeners and whose
 * `getSnapshot` reflects mutations made via a local `setState` helper.
 * The hook tests need observability of state changes, which the
 * no-op mock can't provide by default.
 */
function makeReactiveStore(initial: DeckState): {
  store: IDeckManagerStore;
  setState: (next: DeckState) => void;
  getState: () => DeckState;
} {
  let state = initial;
  const listeners = new Set<() => void>();
  const base = makeMockStore({
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot: () => state,
    setHasFocus: (value: boolean) => {
      if (state.hasFocus === value) return;
      state = { ...state, hasFocus: value };
      for (const l of listeners) l();
    },
  });
  function setState(next: DeckState): void {
    state = next;
    for (const l of listeners) l();
  }
  return { store: base, setState, getState: () => state };
}

function Probe({ cardId }: { cardId: string }): React.ReactElement {
  const isDestination = useFocusDestination(cardId);
  return (
    <span data-testid="probe">{isDestination ? "yes" : "no"}</span>
  );
}

function renderWithStore(
  store: IDeckManagerStore,
  cardId: string,
): { getValue: () => string } {
  const { getByTestId } = render(
    <DeckManagerContext.Provider value={store}>
      <Probe cardId={cardId} />
    </DeckManagerContext.Provider>,
  );
  return { getValue: () => getByTestId("probe").textContent ?? "" };
}

afterEach(() => {
  cleanup();
});

describe("useFocusDestination", () => {
  test("returns the selector's current value on first render", () => {
    const initial: DeckState = {
      cards: [makeCard("a"), makeCard("b")],
      panes: [makePane("p1", ["a", "b"], "a")],
      activePaneId: "p1",
      hasFocus: true,
    };
    const { store } = makeReactiveStore(initial);

    const yes = renderWithStore(store, "a");
    expect(yes.getValue()).toBe("yes");
    cleanup();

    const no = renderWithStore(store, "b");
    expect(no.getValue()).toBe("no");
  });

  test("re-renders when hasFocus flips via setHasFocus (window focus → blur)", () => {
    const initial: DeckState = {
      cards: [makeCard("a")],
      panes: [makePane("p1", ["a"], "a")],
      activePaneId: "p1",
      hasFocus: true,
    };
    const { store } = makeReactiveStore(initial);
    const probe = renderWithStore(store, "a");
    expect(probe.getValue()).toBe("yes");

    act(() => {
      store.setHasFocus(false);
    });
    expect(probe.getValue()).toBe("no");

    act(() => {
      store.setHasFocus(true);
    });
    expect(probe.getValue()).toBe("yes");
  });

  test("re-renders when the active pane flips", () => {
    const initial: DeckState = {
      cards: [makeCard("a"), makeCard("b")],
      panes: [
        makePane("p1", ["a"], "a"),
        makePane("p2", ["b"], "b"),
      ],
      activePaneId: "p1",
      hasFocus: true,
    };
    const { store, setState, getState } = makeReactiveStore(initial);
    const probe = renderWithStore(store, "a");
    expect(probe.getValue()).toBe("yes");

    act(() => {
      setState({ ...getState(), activePaneId: "p2" });
    });
    expect(probe.getValue()).toBe("no");
  });

  test("re-renders when pane.activeCardId flips within the active pane", () => {
    const initial: DeckState = {
      cards: [makeCard("a"), makeCard("b")],
      panes: [makePane("p1", ["a", "b"], "a")],
      activePaneId: "p1",
      hasFocus: true,
    };
    const { store, setState, getState } = makeReactiveStore(initial);
    const probe = renderWithStore(store, "a");
    expect(probe.getValue()).toBe("yes");

    act(() => {
      const s = getState();
      setState({
        ...s,
        panes: s.panes.map((p) =>
          p.id === "p1" ? { ...p, activeCardId: "b" } : p,
        ),
      });
    });
    expect(probe.getValue()).toBe("no");
  });

  test("setHasFocus is idempotent — same-value call produces no re-render churn", () => {
    const initial: DeckState = {
      cards: [makeCard("a")],
      panes: [makePane("p1", ["a"], "a")],
      activePaneId: "p1",
      hasFocus: true,
    };
    const { store } = makeReactiveStore(initial);
    const probe = renderWithStore(store, "a");
    expect(probe.getValue()).toBe("yes");

    // No-op: hasFocus is already true. The mock's setHasFocus early-exits
    // so listeners don't fire; the value stays "yes".
    act(() => {
      store.setHasFocus(true);
    });
    expect(probe.getValue()).toBe("yes");
  });
});
