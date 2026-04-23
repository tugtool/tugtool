/**
 * card-host-activation-effect.test.tsx — pin [A3] (Step 23).
 *
 * The shared activation effect subscribes to
 * `isFocusDestination(cardId)` and fires on `false → true`
 * transitions other than the initial mount. These tests pin five
 * invariants:
 *
 *   1. Mount-only flow: the body does not fire on the mount-time
 *      `true` reading — the has-been-active ref-guard skips it.
 *   2. `false → true` transition on an FC card (no `bag.content`):
 *      the body re-applies `bag.focus` via `applyFocusSnapshot` and
 *      republishes `bag.domSelection` to `selectionGuard`.
 *   3. `false → true` transition on an EM card (has `bag.content`):
 *      the body invokes `callbacks.onCardActivated`. (FC handling is
 *      bypassed for EM because `bag.content !== undefined`.)
 *   4. Unsafe focus-theft gate: when the user's caret is on a real
 *      input outside the target card, the body aborts silently.
 *   5. `true → false` transition: no-op (deactivation is not this
 *      effect's responsibility).
 */

import "./setup-rtl";

import React, { useRef } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import type {
  CardState,
  CardStateBag,
  DeckState,
  TugPaneState,
} from "@/layout-tree";
import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { useCardPersistence } from "@/components/tugways/use-card-persistence";
import { ComponentPersistenceRegistry } from "@/components/tugways/component-persistence-registry";
import { CardStateOrchestrator } from "@/card-state-orchestrator";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { registerDeckStore } from "@/lib/deck-store-registry";

// ---------------------------------------------------------------------------
// Minimal reactive Store — reused pattern from card-host-composition.
// ---------------------------------------------------------------------------

class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;
  private saveCallbacks = new Map<string, () => void>();
  public cardStates = new Map<string, CardStateBag>();

  constructor(initial: DeckState) {
    this.state = initial;
  }

  private notify() {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = (): DeckState => this.state;
  getVersion = (): number => this.version;

  setState = (next: DeckState): void => {
    this.state = next;
    this.notify();
  };

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

  setActiveCardInPane = (paneId: string, cardId: string): void => {
    this.state = {
      ...this.state,
      panes: this.state.panes.map((p) =>
        p.id === paneId ? { ...p, activeCardId: cardId } : p,
      ),
    };
    this.notify();
  };

  setActivePane = (paneId: string | undefined): void => {
    this.state = {
      ...this.state,
      ...(paneId !== undefined
        ? { activePaneId: paneId }
        : { activePaneId: undefined }),
    };
    this.notify();
  };

  reorderCardInPane = (): void => {};
  detachCard = (): string | null => null;
  moveCardToPane = (): void => {};

  getCardState = (id: string): CardStateBag | undefined =>
    this.cardStates.get(id);
  setCardState = (id: string, bag: CardStateBag): void => {
    this.cardStates.set(id, bag);
  };
  registerSaveCallback = (id: string, cb: () => void): void => {
    this.saveCallbacks.set(id, cb);
  };
  unregisterSaveCallback = (id: string): void => {
    this.saveCallbacks.delete(id);
  };
  invokeSaveCallback = (id: string): void => {
    this.saveCallbacks.get(id)?.();
  };
  togglePaneCollapse = (): void => {};

  private componentRegistries = new Map<string, ComponentPersistenceRegistry>();
  getComponentRegistry = (cardId: string): ComponentPersistenceRegistry => {
    let r = this.componentRegistries.get(cardId);
    if (!r) {
      r = new ComponentPersistenceRegistry();
      this.componentRegistries.set(cardId, r);
    }
    return r;
  };
  peekComponentRegistry = (
    cardId: string,
  ): ComponentPersistenceRegistry | undefined =>
    this.componentRegistries.get(cardId);

  private orchestrator = new CardStateOrchestrator((cardId) =>
    this.componentRegistries.get(cardId),
  );
  registerCardAssembler: IDeckManagerStore["registerCardAssembler"] = (
    cardId,
    assembler,
  ) => this.orchestrator.registerAssembler(cardId, assembler);
  captureCardState: IDeckManagerStore["captureCardState"] = (cardId) =>
    this.orchestrator.captureCardState(cardId);
  restoreCardState: IDeckManagerStore["restoreCardState"] = (cardId, bag) =>
    this.orchestrator.restoreCardState(cardId, bag);

  setHasFocus = (value: boolean): void => {
    if (this.state.hasFocus === value) return;
    this.state = { ...this.state, hasFocus: value };
    this.notify();
  };

  private activationCallbacks = new Map<string, () => void>();
  private cardHostRoots = new Map<string, HTMLElement>();
  registerActivationCallback = (cardId: string, cb: () => void): (() => void) => {
    this.activationCallbacks.set(cardId, cb);
    return () => {
      if (this.activationCallbacks.get(cardId) === cb) {
        this.activationCallbacks.delete(cardId);
      }
    };
  };
  invokeActivationCallback = (cardId: string): void => {
    this.activationCallbacks.get(cardId)?.();
  };
  registerCardHostRoot = (cardId: string, el: HTMLElement | null): void => {
    if (el === null) this.cardHostRoots.delete(cardId);
    else this.cardHostRoots.set(cardId, el);
  };
  peekCardHostRoot = (cardId: string): HTMLElement | null =>
    this.cardHostRoots.get(cardId) ?? null;
}

// ---------------------------------------------------------------------------
// Test probes
// ---------------------------------------------------------------------------

// FC card: a plain content factory with a persist-value input so
// `bag.focus` / `bag.domSelection` have something real to target.
function FCProbe({ cardId }: { cardId: string }): React.ReactElement {
  return (
    <div data-fc-root={cardId}>
      <input
        type="text"
        data-tug-persist-value={`fc-${cardId}-input`}
        data-tug-focus-key={`fc-${cardId}-input`}
        data-testid={`fc-${cardId}-input`}
        defaultValue="typed"
      />
    </div>
  );
}

// EM card: a content factory that registers `onCardActivated` and
// writes `bag.content` via `onSave`. The activation spy lets tests
// assert fire counts without coupling to the engine.
const emActivations: Map<string, number> = new Map();

function EMProbe({ cardId }: { cardId: string }): React.ReactElement {
  const countRef = useRef(0);
  useCardPersistence({
    onSave: () => ({ kind: "em", value: countRef.current }),
    onRestore: () => {},
    onCardActivated: () => {
      countRef.current += 1;
      emActivations.set(cardId, (emActivations.get(cardId) ?? 0) + 1);
    },
  });
  return <div data-em-root={cardId}>em-content</div>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePane(
  id: string,
  cards: CardState[],
  activeCardId?: string,
  position = { x: 0, y: 0 },
): TugPaneState {
  return {
    id,
    position,
    size: { width: 400, height: 300 },
    cardIds: cards.map((c) => c.id),
    activeCardId: activeCardId ?? cards[0].id,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

function renderDeck(store: Store) {
  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      <TugTooltipProvider>
        <ResponderChainProvider>
          <DeckManagerContext.Provider value={store}>
            <DeckCanvas />
          </DeckManagerContext.Provider>
        </ResponderChainProvider>
      </TugTooltipProvider>,
    ));
  });
  return container;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetForTest();
  paneContentRegistry._resetForTests();
  emActivations.clear();
  selectionGuard.reset();
  registerCard({
    componentId: "fc-probe",
    defaultMeta: { title: "FC Probe", closable: true },
    contentFactory: (cardId: string) => <FCProbe cardId={cardId} />,
  });
  registerCard({
    componentId: "em-probe",
    defaultMeta: { title: "EM Probe", closable: true },
    contentFactory: (cardId: string) => <EMProbe cardId={cardId} />,
  });
});

afterEach(() => {
  cleanup();
  registerDeckStore(null);
  document.body.innerHTML = "";
  selectionGuard.reset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("[A3] activation effect — has-been-active mount guard", () => {
  it("does not invoke onCardActivated on the first (mount) true reading", () => {
    const emCard: CardState = {
      id: "em-1",
      componentId: "em-probe",
      title: "EM",
      closable: true,
    };
    const store = new Store({
      cards: [emCard],
      panes: [makePane("p1", [emCard])],
      activePaneId: "p1",
      hasFocus: true,
    });
    // Seed bag.content so the content-owning branch would be taken on
    // activation. The mount guard still skips the body — that's the
    // invariant this test pins.
    store.setCardState("em-1", { content: { kind: "em", value: 0 } });
    renderDeck(store);

    // Mount activation: guard skips the body.
    expect(emActivations.get("em-1") ?? 0).toBe(0);
  });
});

describe("[A3] activation effect — false → true transition", () => {
  it("EM branch: invokes onCardActivated on intra-pane tab switch back", () => {
    const emCard: CardState = {
      id: "em-1",
      componentId: "em-probe",
      title: "EM",
      closable: true,
    };
    const fcCard: CardState = {
      id: "fc-1",
      componentId: "fc-probe",
      title: "FC",
      closable: true,
    };
    const store = new Store({
      cards: [emCard, fcCard],
      panes: [makePane("p1", [emCard, fcCard], "em-1")],
      activePaneId: "p1",
      hasFocus: true,
    });
    // Seed bag.content so the activation effect's content-owning
    // branch dispatches to the factory's onCardActivated instead of
    // falling through to the DOM-authority path.
    store.setCardState("em-1", { content: { kind: "em", value: 0 } });
    renderDeck(store);
    expect(emActivations.get("em-1") ?? 0).toBe(0);

    // Switch away from em-1 (isFocusDestination → false).
    act(() => {
      store.setActiveCardInPane("p1", "fc-1");
    });
    expect(emActivations.get("em-1") ?? 0).toBe(0);

    // Switch back to em-1 (isFocusDestination: false → true).
    act(() => {
      store.setActiveCardInPane("p1", "em-1");
    });
    expect(emActivations.get("em-1") ?? 0).toBe(1);
  });

  it("FC branch: re-applies bag.focus and republishes bag.domSelection", () => {
    const fcA: CardState = {
      id: "fc-a",
      componentId: "fc-probe",
      title: "A",
      closable: true,
    };
    const fcB: CardState = {
      id: "fc-b",
      componentId: "fc-probe",
      title: "B",
      closable: true,
    };
    const store = new Store({
      cards: [fcA, fcB],
      panes: [makePane("p1", [fcA, fcB], "fc-a")],
      activePaneId: "p1",
      hasFocus: true,
    });
    // Seed bag.focus so the [A3] FC branch has something to re-apply
    // when we flip back. `bag.focus` is keyed by `data-tug-focus-key`
    // on the rendered input; the DOM-selection shape uses anchor/focus
    // paths relative to the card root.
    store.setCardState("fc-a", {
      focus: { kind: "dom", focusKey: "fc-fc-a-input" },
      domSelection: {
        anchorPath: [],
        anchorOffset: 0,
        focusPath: [],
        focusOffset: 0,
      },
    });
    renderDeck(store);

    // Flip to fc-b → back to fc-a. Mount-time activation is skipped
    // by the guard. The return flip is the first observable trigger.
    act(() => {
      store.setActiveCardInPane("p1", "fc-b");
    });
    // Move focus to body to make the re-apply observable (otherwise
    // focus never leaves fc-a's input since the flip doesn't blur).
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
    });
    expect(document.activeElement).toBe(document.body);

    act(() => {
      store.setActiveCardInPane("p1", "fc-a");
    });

    // After the activation effect fires, fc-a's input has keyboard
    // focus once again — the FC re-apply path ran.
    const input = document.querySelector<HTMLInputElement>(
      "[data-testid='fc-fc-a-input']",
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});

describe("[A3] activation effect — focus-theft gate aborts", () => {
  it("does not re-apply focus when the user's caret is on a real input outside the card", () => {
    const fcA: CardState = {
      id: "fc-a",
      componentId: "fc-probe",
      title: "A",
      closable: true,
    };
    const fcB: CardState = {
      id: "fc-b",
      componentId: "fc-probe",
      title: "B",
      closable: true,
    };
    const store = new Store({
      cards: [fcA, fcB],
      panes: [makePane("p1", [fcA, fcB], "fc-a")],
      activePaneId: "p1",
      hasFocus: true,
    });
    store.setCardState("fc-a", {
      focus: { kind: "dom", focusKey: "fc-fc-a-input" },
    });
    renderDeck(store);

    // User clicks into a real input outside the card — focus is
    // committed there, so the gate must refuse to steal it back.
    const outside = document.createElement("input");
    outside.type = "text";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    // Flip to fc-b then back to fc-a to cross a false → true
    // transition for fc-a.
    act(() => {
      store.setActiveCardInPane("p1", "fc-b");
    });
    act(() => {
      store.setActiveCardInPane("p1", "fc-a");
    });

    // Gate refused: focus stayed on the outside input.
    expect(document.activeElement).toBe(outside);
  });
});

describe("[A3] activation effect — true → false is a no-op", () => {
  it("deactivation does not run the activation body and does not call onCardActivated", () => {
    const emCard: CardState = {
      id: "em-1",
      componentId: "em-probe",
      title: "EM",
      closable: true,
    };
    const fcCard: CardState = {
      id: "fc-1",
      componentId: "fc-probe",
      title: "FC",
      closable: true,
    };
    const store = new Store({
      cards: [emCard, fcCard],
      panes: [makePane("p1", [emCard, fcCard], "em-1")],
      activePaneId: "p1",
      hasFocus: true,
    });
    store.setCardState("em-1", { content: { kind: "em", value: 0 } });
    renderDeck(store);

    // Round-trip to stamp `hasBeenFocusDestinationRef`.
    act(() => {
      store.setActiveCardInPane("p1", "fc-1");
    });
    act(() => {
      store.setActiveCardInPane("p1", "em-1");
    });
    expect(emActivations.get("em-1") ?? 0).toBe(1);

    // Now deactivate em-1 (true → false). The activation body must
    // not run — there's no further bump to the counter.
    act(() => {
      store.setActiveCardInPane("p1", "fc-1");
    });
    expect(emActivations.get("em-1") ?? 0).toBe(1);
  });
});
