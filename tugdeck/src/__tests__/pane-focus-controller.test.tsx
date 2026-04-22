/**
 * pane-focus-controller tests — Commit 0.
 *
 * Pins the DOM-authority contract for `data-focused`:
 *   - On mount with an active pane, the active pane's `.tug-pane`
 *     frame has `data-focused="true"`, others "false".
 *   - `activePaneId` changes propagate via useLayoutEffect on the
 *     next React commit.
 *   - Pane add/remove via store notify re-applies attribution.
 *   - On unmount, the controller writes no more DOM mutations.
 *
 * Commit 1 will extend this file with classification-listener
 * cases (pointerdown, metaKey, data-no-activate, portal gate, etc.).
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type { CardState, DeckState, TugPaneState } from "@/layout-tree";
import { usePaneFocusController } from "@/components/chrome/pane-focus-controller";

// ---------------------------------------------------------------------------
// Minimal IDeckManagerStore stub — just enough for the focus controller.
// ---------------------------------------------------------------------------

class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;

  constructor(initial: DeckState) {
    this.state = initial;
  }

  setState(next: DeckState): void {
    this.state = next;
    this.version += 1;
    for (const l of this.listeners) l();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): DeckState => this.state;
  getVersion = (): number => this.version;

  // Unused stubs.
  handlePaneMoved = (): void => {};
  handlePaneClosed = (): void => {};
  focusCard = (): void => {};
  activateCard = (): void => {};
  getFirstResponderCardId = (): string | null => null;
  observeCardDidFinishConstruction = (): (() => void) => () => {};
  observeCardDidActivate = (): (() => void) => () => {};
  observeCardDidDeactivate = (): (() => void) => () => {};
  observeCardWillBeginDestruction = (): (() => void) => () => {};
  addCard = (): string | null => null;
  addCardToPane = (): string | null => null;
  removeCard = (): void => {};
  setActiveCardInPane = (): void => {};
  reorderCardInPane = (): void => {};
  detachCard = (): string | null => null;
  moveCardToPane = (): void => {};
  getCardState = () => undefined;
  setCardState = (): void => {};
  registerSaveCallback = (): void => {};
  unregisterSaveCallback = (): void => {};
  invokeSaveCallback = (): void => {};
  togglePaneCollapse = (): void => {};
}

// ---------------------------------------------------------------------------
// Test host: renders pane fixtures inside a deckRootRef div and calls the
// controller hook.
// ---------------------------------------------------------------------------

function Host({ paneIds }: { paneIds: readonly string[] }) {
  const deckRootRef = useRef<HTMLDivElement | null>(null);
  usePaneFocusController(deckRootRef);
  return (
    <div ref={deckRootRef} data-testid="deck-root">
      {paneIds.map((id) => (
        <div
          key={id}
          className="tug-pane"
          data-pane-id={id}
          data-testid={`pane-${id}`}
        />
      ))}
    </div>
  );
}

function renderHost(store: Store, paneIds: readonly string[]) {
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      <DeckManagerContext.Provider value={store}>
        <Host paneIds={paneIds} />
      </DeckManagerContext.Provider>,
    ));
  });
  return container;
}

function pane(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-pane-id="${id}"]`);
  if (!el) throw new Error(`pane ${id} not found`);
  return el;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function paneState(id: string, cardIds: readonly string[]): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds: [...cardIds],
    activeCardId: cardIds[0],
    title: "",
    acceptsFamilies: ["standard"],
  };
}

function card(id: string): CardState {
  return { id, componentId: "probe", title: id, closable: true };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pane-focus-controller", () => {
  afterEach(() => {
    cleanup();
  });

  it("T1: initial attribution with an active pane writes true on it and false on others", () => {
    const store = new Store({
      cards: [card("c1"), card("c2")],
      panes: [paneState("p1", ["c1"]), paneState("p2", ["c2"])],
      activePaneId: "p1",
    });
    const container = renderHost(store, ["p1", "p2"]);
    expect(pane(container, "p1").dataset.focused).toBe("true");
    expect(pane(container, "p2").dataset.focused).toBe("false");
  });

  it("T2: no active pane — every pane gets data-focused=false", () => {
    const store = new Store({
      cards: [card("c1"), card("c2")],
      panes: [paneState("p1", ["c1"]), paneState("p2", ["c2"])],
      // activePaneId left undefined
    });
    const container = renderHost(store, ["p1", "p2"]);
    expect(pane(container, "p1").dataset.focused).toBe("false");
    expect(pane(container, "p2").dataset.focused).toBe("false");
  });

  it("T3: activation change propagates via useLayoutEffect", () => {
    const store = new Store({
      cards: [card("c1"), card("c2")],
      panes: [paneState("p1", ["c1"]), paneState("p2", ["c2"])],
      activePaneId: "p1",
    });
    const container = renderHost(store, ["p1", "p2"]);
    expect(pane(container, "p1").dataset.focused).toBe("true");
    expect(pane(container, "p2").dataset.focused).toBe("false");

    act(() => {
      store.setState({ ...store.getSnapshot(), activePaneId: "p2" });
    });

    expect(pane(container, "p1").dataset.focused).toBe("false");
    expect(pane(container, "p2").dataset.focused).toBe("true");
  });

  it("T4: pane added — new pane receives data-focused=false on the same commit", () => {
    const store = new Store({
      cards: [card("c1")],
      panes: [paneState("p1", ["c1"])],
      activePaneId: "p1",
    });
    // Host re-reads paneIds via a separate prop; emulate add by re-rendering.
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DeckManagerContext.Provider value={store}>
          <Host paneIds={["p1"]} />
        </DeckManagerContext.Provider>,
      ));
    });
    expect(pane(container, "p1").dataset.focused).toBe("true");

    act(() => {
      store.setState({
        ...store.getSnapshot(),
        cards: [...store.getSnapshot().cards, card("c2")],
        panes: [...store.getSnapshot().panes, paneState("p2", ["c2"])],
      });
      rerender(
        <DeckManagerContext.Provider value={store}>
          <Host paneIds={["p1", "p2"]} />
        </DeckManagerContext.Provider>,
      );
    });

    expect(pane(container, "p1").dataset.focused).toBe("true");
    expect(pane(container, "p2").dataset.focused).toBe("false");
  });

  it("T5: pane removed — no throw; remaining panes keep correct attribution", () => {
    const store = new Store({
      cards: [card("c1"), card("c2")],
      panes: [paneState("p1", ["c1"]), paneState("p2", ["c2"])],
      activePaneId: "p1",
    });
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ container, rerender } = render(
        <DeckManagerContext.Provider value={store}>
          <Host paneIds={["p1", "p2"]} />
        </DeckManagerContext.Provider>,
      ));
    });
    expect(pane(container, "p1").dataset.focused).toBe("true");
    expect(pane(container, "p2").dataset.focused).toBe("false");

    act(() => {
      store.setState({
        ...store.getSnapshot(),
        cards: [card("c1")],
        panes: [paneState("p1", ["c1"])],
      });
      rerender(
        <DeckManagerContext.Provider value={store}>
          <Host paneIds={["p1"]} />
        </DeckManagerContext.Provider>,
      );
    });

    expect(pane(container, "p1").dataset.focused).toBe("true");
    expect(container.querySelector('[data-pane-id="p2"]')).toBeNull();
  });

  it("T6: cleanup on unmount — subsequent store notifies cause no writes", () => {
    const store = new Store({
      cards: [card("c1"), card("c2")],
      panes: [paneState("p1", ["c1"]), paneState("p2", ["c2"])],
      activePaneId: "p1",
    });
    let unmount!: () => void;
    act(() => {
      ({ unmount } = render(
        <DeckManagerContext.Provider value={store}>
          <Host paneIds={["p1", "p2"]} />
        </DeckManagerContext.Provider>,
      ));
    });

    // Unmount, then notify the store. With the effect cleanup working,
    // no listener remains to write DOM; since the host is gone, the
    // attribute writes simply wouldn't happen. The assertion below is
    // effectively: the store's listener set is empty after unmount.
    act(() => {
      unmount();
    });
    expect((store as unknown as { ["listeners"]: Set<() => void> })["listeners"].size)
      .toBe(0);

    // Notify anyway — must not throw.
    act(() => {
      store.setState({ ...store.getSnapshot(), activePaneId: "p2" });
    });
  });
});
