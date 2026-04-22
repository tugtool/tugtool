/**
 * pane-focus-controller tests.
 *
 * Commit 0 cases (T1–T6): pin the DOM-authority contract for
 * `data-focused` — initial attribution, activation change, pane
 * add/remove, cleanup.
 *
 * Commit 1 cases (C1–C17): pin the document-level pointerdown
 * classification listener — activation path, deselect branch,
 * portal/overlay gate, metaKey skip, data-no-activate skip,
 * idempotence, auto-clear, early registration, coexistence with
 * `ResponderChainProvider`, and cleanup on unmount.
 */
import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";

import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type {
  CardLifecycleObserver,
} from "@/lib/card-lifecycle";
import type { CardState, DeckState, TugPaneState } from "@/layout-tree";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { usePaneFocusController } from "@/components/chrome/pane-focus-controller";

// ---------------------------------------------------------------------------
// Minimal IDeckManagerStore stub — just enough for the focus controller.
// Supports `observeCardDidActivate` (wildcard) with an imperative trigger
// so tests can simulate `_flipFirstResponder`'s didActivate dispatch.
// ---------------------------------------------------------------------------

class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  private didActivateSubs = new Set<CardLifecycleObserver>();
  public initialFocusedCardId: string | undefined = undefined;
  public activateCardCalls: string[] = [];

  constructor(initial: DeckState) {
    this.state = initial;
  }

  setState(next: DeckState): void {
    this.state = next;
    this.version += 1;
    for (const l of this.listeners) l();
  }

  /** Simulate `_flipFirstResponder`'s didActivate side-effect. */
  fireDidActivate(cardId: string): void {
    for (const cb of this.didActivateSubs) cb(cardId);
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): DeckState => this.state;
  getVersion = (): number => this.version;

  handlePaneMoved = (): void => {};
  handlePaneClosed = (): void => {};
  focusCard = (): void => {};
  activateCard = (cardId: string): void => {
    this.activateCardCalls.push(cardId);
    // Simulate same-bit path: fire didActivate if already active.
    const currentActive = this.getFirstResponderCardId();
    if (currentActive !== cardId) {
      // Update state so subsequent reads see the new active.
      // Minimal: find the pane that contains this card and mark
      // it activePaneId.
      const hostPane = this.state.panes.find((p) => p.cardIds.includes(cardId));
      if (hostPane) {
        this.setState({
          ...this.state,
          activePaneId: hostPane.id,
          panes: this.state.panes.map((p) =>
            p.id === hostPane.id ? { ...p, activeCardId: cardId } : p,
          ),
        });
      }
    }
    this.fireDidActivate(cardId);
  };
  getFirstResponderCardId = (): string | null => {
    const paneId = this.state.activePaneId;
    if (paneId === undefined) return null;
    const pane = this.state.panes.find((p) => p.id === paneId);
    return pane?.activeCardId ?? null;
  };
  observeCardDidFinishConstruction = (): (() => void) => () => {};
  observeCardDidActivate = (
    cardId: string | null,
    callback: CardLifecycleObserver,
  ): (() => void) => {
    // Only wildcard subscriptions used in these tests.
    if (cardId !== null) return () => {};
    this.didActivateSubs.add(callback);
    return () => {
      this.didActivateSubs.delete(callback);
    };
  };
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
// Plain host (used by T1–T6).
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
// Classification host — realistic pane chrome descendants.
// ---------------------------------------------------------------------------

function ClassificationHost() {
  const deckRootRef = useRef<HTMLDivElement | null>(null);
  usePaneFocusController(deckRootRef);
  return (
    <div ref={deckRootRef} data-testid="deck-root">
      {/* A wrapper sibling of panes — analogous to canvas snap-guide layer */}
      <div data-testid="canvas-wrapper">
        <div
          className="tug-pane"
          data-pane-id="paneA"
          data-testid="paneA"
        >
          <div data-testid="paneA-content">
            <button data-testid="paneA-nested-responder" data-responder-id="editor">
              nested
            </button>
          </div>
          <div data-testid="paneA-titlebar" className="tug-pane-title-bar">
            <button
              data-testid="paneA-close"
              data-no-activate
            >
              ×
            </button>
          </div>
        </div>
        <div
          className="tug-pane"
          data-pane-id="paneB"
          data-testid="paneB"
        >
          <div data-testid="paneB-content">content</div>
          <div data-testid="paneB-titlebar" className="tug-pane-title-bar">title</div>
          <div data-testid="paneB-resize" className="tug-pane-resize tug-pane-resize-e" />
          <button data-testid="paneB-close" data-no-activate>×</button>
        </div>
      </div>
    </div>
  );
}

function classificationStore(): Store {
  return new Store({
    cards: [
      { id: "cA", componentId: "probe", title: "A", closable: true },
      { id: "cB", componentId: "probe", title: "B", closable: true },
    ],
    panes: [
      paneState("paneA", ["cA"]),
      paneState("paneB", ["cB"]),
    ],
    activePaneId: "paneA",
  });
}

function renderClassificationHost(store: Store) {
  let container!: HTMLElement;
  let unmount!: () => void;
  act(() => {
    ({ container, unmount } = render(
      <DeckManagerContext.Provider value={store}>
        <ClassificationHost />
      </DeckManagerContext.Provider>,
    ));
  });
  return { container, unmount };
}

/** Dispatch a real DOM PointerEvent on the target. `PointerEvent` isn't
 * always present in happy-dom; fall back to dispatching a bubbling
 * `Event` of type "pointerdown" with a `metaKey` override. */
function dispatchPointerDown(
  target: EventTarget,
  init: { metaKey?: boolean } = {},
): void {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "metaKey", {
    value: init.metaKey === true,
    configurable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
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
// T1–T6 — DOM attribute authority (Commit 0)
// ---------------------------------------------------------------------------

describe("pane-focus-controller — attribute authority", () => {
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

  it("T6: cleanup on unmount — subscribe listener set is empty", () => {
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

    act(() => {
      unmount();
    });

    expect(
      (store as unknown as { ["listeners"]: Set<() => void> })["listeners"].size,
    ).toBe(0);

    act(() => {
      store.setState({ ...store.getSnapshot(), activePaneId: "p2" });
    });
  });
});

// ---------------------------------------------------------------------------
// C1–C17 — Classification listener (Commit 1)
// ---------------------------------------------------------------------------

describe("pane-focus-controller — classification listener", () => {
  afterEach(() => {
    cleanup();
  });

  it("C1: content click on background pane activates it", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const contentB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-content"]',
    );
    dispatchPointerDown(contentB!);
    expect(store.activateCardCalls).toEqual(["cB"]);
    // After activation, DOM reflects new focus.
    expect(pane(container, "paneB").dataset.focused).toBe("true");
    expect(pane(container, "paneA").dataset.focused).toBe("false");
  });

  it("C2: click on nested responder-scoped element still activates host pane", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const nested = container.querySelector<HTMLElement>(
      '[data-testid="paneA-nested-responder"]',
    );
    dispatchPointerDown(nested!);
    expect(store.activateCardCalls).toEqual(["cA"]);
  });

  it("C3: title bar click activates pane", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const titlebarB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-titlebar"]',
    );
    dispatchPointerDown(titlebarB!);
    expect(store.activateCardCalls).toEqual(["cB"]);
  });

  it("C4: resize handle click activates pane", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const resizeB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-resize"]',
    );
    dispatchPointerDown(resizeB!);
    expect(store.activateCardCalls).toEqual(["cB"]);
  });

  it("C5: Cmd-click on content does not activate (preserves #1)", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const contentB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-content"]',
    );
    dispatchPointerDown(contentB!, { metaKey: true });
    expect(store.activateCardCalls).toEqual([]);
    // DOM focus unchanged.
    expect(pane(container, "paneA").dataset.focused).toBe("true");
    expect(pane(container, "paneB").dataset.focused).toBe("false");
  });

  it("C6: Cmd-click on resize handle does not activate (preserves #3)", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const resizeB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-resize"]',
    );
    dispatchPointerDown(resizeB!, { metaKey: true });
    expect(store.activateCardCalls).toEqual([]);
  });

  it("C7: click on data-no-activate descendant (close box) does not activate (preserves #2)", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const closeB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-close"]',
    );
    dispatchPointerDown(closeB!);
    expect(store.activateCardCalls).toEqual([]);
    expect(pane(container, "paneA").dataset.focused).toBe("true");
    expect(pane(container, "paneB").dataset.focused).toBe("false");
  });

  it("C8: empty-deck click sets all panes to data-focused=false (activates deselect)", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    // Initial: paneA focused.
    expect(pane(container, "paneA").dataset.focused).toBe("true");
    const wrapper = container.querySelector<HTMLElement>(
      '[data-testid="canvas-wrapper"]',
    );
    dispatchPointerDown(wrapper!);
    expect(store.activateCardCalls).toEqual([]);
    expect(pane(container, "paneA").dataset.focused).toBe("false");
    expect(pane(container, "paneB").dataset.focused).toBe("false");
  });

  it("C9: deep-nested empty-deck click — still classified as canvas background", () => {
    // Build an extra nested wrapper inside the deck root but outside
    // any pane, and dispatch on its leaf.
    function Host2() {
      const deckRootRef = useRef<HTMLDivElement | null>(null);
      usePaneFocusController(deckRootRef);
      return (
        <div ref={deckRootRef} data-testid="deck-root">
          <div data-testid="outer">
            <div data-testid="inner">
              <div data-testid="leaf" />
            </div>
          </div>
          <div className="tug-pane" data-pane-id="paneA" data-testid="paneA" />
        </div>
      );
    }
    const store = new Store({
      cards: [card("cA")],
      panes: [paneState("paneA", ["cA"])],
      activePaneId: "paneA",
    });
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DeckManagerContext.Provider value={store}>
          <Host2 />
        </DeckManagerContext.Provider>,
      ));
    });
    const leaf = container.querySelector<HTMLElement>('[data-testid="leaf"]');
    dispatchPointerDown(leaf!);
    expect(store.activateCardCalls).toEqual([]);
    expect(pane(container, "paneA").dataset.focused).toBe("false");
  });

  it("C10: Cmd + empty-deck click still deselects (metaKey is activation-only)", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const wrapper = container.querySelector<HTMLElement>(
      '[data-testid="canvas-wrapper"]',
    );
    dispatchPointerDown(wrapper!, { metaKey: true });
    expect(store.activateCardCalls).toEqual([]);
    expect(pane(container, "paneA").dataset.focused).toBe("false");
    expect(pane(container, "paneB").dataset.focused).toBe("false");
  });

  it("C11: click outside the deck root entirely — neither branch fires", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    // Attach a sibling to document.body, outside the rendered tree's
    // test container but still in the document.
    const outsideEl = document.createElement("button");
    outsideEl.setAttribute("data-testid", "outside");
    document.body.appendChild(outsideEl);
    try {
      dispatchPointerDown(outsideEl);
      expect(store.activateCardCalls).toEqual([]);
      expect(pane(container, "paneA").dataset.focused).toBe("true");
      expect(pane(container, "paneB").dataset.focused).toBe("false");
    } finally {
      outsideEl.remove();
    }
  });

  it("C12: click inside a portaled overlay — neither branch fires (portal gate)", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    // Simulate a createPortal mount to document.body.
    const portalRoot = document.createElement("div");
    portalRoot.setAttribute("role", "menu");
    portalRoot.setAttribute("data-testid", "menu-portal");
    const item = document.createElement("div");
    item.setAttribute("role", "menuitem");
    portalRoot.appendChild(item);
    document.body.appendChild(portalRoot);
    try {
      dispatchPointerDown(item);
      expect(store.activateCardCalls).toEqual([]);
      // Focus state unchanged.
      expect(pane(container, "paneA").dataset.focused).toBe("true");
      expect(pane(container, "paneB").dataset.focused).toBe("false");
    } finally {
      portalRoot.remove();
    }
  });

  it("C13: activation auto-clears deselect — next activation re-focuses that pane", () => {
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const wrapper = container.querySelector<HTMLElement>(
      '[data-testid="canvas-wrapper"]',
    );
    // Deselect.
    dispatchPointerDown(wrapper!);
    expect(pane(container, "paneA").dataset.focused).toBe("false");
    expect(pane(container, "paneB").dataset.focused).toBe("false");

    // Simulate an activation: click paneB content.
    const contentB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-content"]',
    );
    dispatchPointerDown(contentB!);
    expect(store.activateCardCalls).toEqual(["cB"]);
    expect(pane(container, "paneA").dataset.focused).toBe("false");
    expect(pane(container, "paneB").dataset.focused).toBe("true");
  });

  it("C14: already-focused pane click is idempotent (activateCard called; same-bit behavior)", () => {
    // Note: _flipFirstResponder's same-bit branch (deck-manager.ts:262–266)
    // short-circuits will/didActivate events. Our Store stub mirrors this:
    // activateCard still fires didActivate, but the fresh-bit state
    // transition code path is skipped by the real DeckManager. Commit 9
    // of 5.5.c refactors this helper; if that refactor changes same-bit
    // semantics, this test should flag it.
    const store = classificationStore();
    const { container } = renderClassificationHost(store);
    const contentA = container.querySelector<HTMLElement>(
      '[data-testid="paneA-content"]',
    );
    dispatchPointerDown(contentA!);
    expect(store.activateCardCalls).toEqual(["cA"]);
    expect(pane(container, "paneA").dataset.focused).toBe("true");
  });

  it("C15: early registration — pointerdown on the same tick as render reaches the listener", () => {
    // useLayoutEffect installs the listener before paint. After
    // render() returns (which internally wraps in act), the DOM is
    // committed and the listener is registered. Dispatching
    // pointerdown on the very next statement — no awaits, no
    // queued microtasks — must hit it.
    const store = classificationStore();
    const { container } = render(
      <DeckManagerContext.Provider value={store}>
        <ClassificationHost />
      </DeckManagerContext.Provider>,
    );
    const contentB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-content"]',
    );
    expect(contentB).not.toBeNull();
    contentB!.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(store.activateCardCalls).toEqual(["cB"]);
  });

  it("C16: coexists with ResponderChainProvider — both listeners receive the same pointerdown", () => {
    const store = classificationStore();
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <DeckManagerContext.Provider value={store}>
          <ResponderChainProvider>
            <ClassificationHost />
          </ResponderChainProvider>
        </DeckManagerContext.Provider>,
      ));
    });
    const nested = container.querySelector<HTMLElement>(
      '[data-testid="paneA-nested-responder"]',
    );
    // paneA is already the focused pane; click the nested responder
    // inside it. activation fires (same-bit behavior) and the
    // responder chain sees the same pointerdown. We verify only that
    // the two listeners coexist without interfering (no exception;
    // our activation branch fires).
    dispatchPointerDown(nested!);
    expect(store.activateCardCalls).toEqual(["cA"]);
  });

  it("C17: cleanup on unmount — subsequent pointerdown does not reach activateCard", () => {
    const store = classificationStore();
    const { container, unmount } = renderClassificationHost(store);
    const contentB = container.querySelector<HTMLElement>(
      '[data-testid="paneB-content"]',
    );
    // Sanity: before unmount, the listener is active.
    dispatchPointerDown(contentB!);
    expect(store.activateCardCalls).toEqual(["cB"]);

    act(() => {
      unmount();
    });

    // After unmount, clicks elsewhere should not reach the listener.
    // contentB is detached from the document; dispatch on a fresh
    // element in the body.
    const outside = document.createElement("div");
    outside.className = "tug-pane";
    outside.setAttribute("data-pane-id", "paneB");
    document.body.appendChild(outside);
    try {
      dispatchPointerDown(outside);
      // Still only the pre-unmount call.
      expect(store.activateCardCalls).toEqual(["cB"]);
    } finally {
      outside.remove();
    }
  });
});
