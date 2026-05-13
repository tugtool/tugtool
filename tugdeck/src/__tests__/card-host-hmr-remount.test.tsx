/**
 * CardHost HMR-remount tests — content-factory unmount-then-remount
 * while CardHost stays up.
 *
 * # What this pins
 *
 * The remount-detection logic in CardHost's
 * `registerStatePreservationCallbacks` (added in
 * `tugplan-hmr-state-preservation` Step 4) treats the
 * "no-op pair → real callbacks" transition as evidence that a
 * content factory just unmounted and remounted while CardHost
 * itself stayed mounted. This is the exact bookkeeping signature
 * Vite HMR / React Fast Refresh produces in dev: a downstream
 * component is hot-replaced, its tree unmounts and remounts, but
 * the CardHost wrapper above it is unaffected.
 *
 * The capture half (Step 3, `hmr-bridge.ts`) writes the bag on
 * `vite:beforeUpdate`. The restore half (Step 4) detects the
 * remount and re-fires CardHost's existing restore effects so
 * `bag.content` and `bag.components` replay onto the new tree.
 *
 * Faithfully simulating Vite HMR plus React Fast Refresh end-to-end
 * inside an app-test is environment-specific and intractable
 * (`import.meta.hot` events have no public synthetic-fire API; Fast
 * Refresh can't be invoked from test code). The test below does the
 * next-best thing: it produces the same React-tree-shape signal
 * that Fast Refresh produces, which is exactly what
 * `registerStatePreservationCallbacks` reacts to. If a future
 * change to the remount-detection logic breaks the contract, this
 * test sees it; if a future change to Vite or Fast Refresh changes
 * the high-level flow, the manual gallery walkthrough in Step 7 of
 * the plan covers that surface.
 *
 * # How the simulation works
 *
 * The card content factory is a `Wrapper` component that holds its
 * own `useState<boolean>` controlling whether a child `Probe` is
 * rendered. The `Probe` uses `useCardStatePreservation` and / or
 * `useComponentStatePreservation`. Toggling Wrapper's state →
 * Probe unmounts → `useCardStatePreservation`'s `useLayoutEffect`
 * cleanup re-registers a no-op pair with CardHost (per
 * `useCardStatePreservation`'s implementation). Toggling back →
 * Probe remounts → fresh callbacks register. This is the exact
 * transition `registerStatePreservationCallbacks` is watching for.
 *
 * Both axes covered:
 *   1. **Content axis** — `useCardStatePreservation`'s `onSave` /
 *      `onRestore` round-trip a payload across the simulated
 *      remount.
 *   2. **Components axis** — `useComponentStatePreservation`'s
 *      `captureState` / `restoreState` round-trip a separate
 *      payload across the same remount.
 *
 * # Note on the bag.content gating in card-host
 *
 * The framework-axes restore effect skips writing `bag.focus` /
 * `bag.domSelection` for content-owning cards (those whose
 * `bag.content` is defined). This test deliberately defines
 * `bag.content` so it exercises the content-owning path — same as
 * `tug-text-editor` / `tug-prompt-input` in production. Tests that pin
 * the form-control / non-content path live separately.
 */
import "./setup-rtl";

import React, { useEffect, useState } from "react";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, cleanup } from "@testing-library/react";

import { DeckCanvas } from "@/components/chrome/deck-canvas";
import * as paneContentRegistry from "@/components/chrome/pane-content-registry";
import { registerCard, _resetForTest } from "@/card-registry";
import type {
  CardState,
  TugPaneState,
  DeckState,
  CardStateBag,
} from "@/layout-tree";
import { DeckManagerContext } from "@/deck-manager-context";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { ResponderChainProvider } from "@/components/tugways/responder-chain-provider";
import { TugTooltipProvider } from "@/components/tugways/tug-tooltip";
import { useCardStatePreservation } from "@/components/tugways/use-card-state-preservation";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";
import { ComponentStatePreservationRegistry } from "@/components/tugways/component-state-preservation-registry";
import { CardStateOrchestrator } from "@/card-state-orchestrator";

// ---------------------------------------------------------------------------
// Probe and Wrapper — the conditional-mount harness
// ---------------------------------------------------------------------------

interface ProbeHandles {
  /** Set the content-axis payload from outside the React tree. */
  setContent: ((next: string) => void) | null;
  /** Set the component-axis payload from outside the React tree. */
  setComponent: ((next: number) => void) | null;
  /** Read the current content-axis payload. */
  getContent: (() => string) | null;
  /** Read the current component-axis payload. */
  getComponent: (() => number) | null;
  /** Each onRestore call appends a snapshot. */
  contentRestoreCalls: Array<{ state: unknown; isActive: boolean }>;
  /** Each component-axis restoreState call appends the value. */
  componentRestoreCalls: Array<unknown>;
  /** Each onSave call appends the returned payload. */
  contentSaveCalls: Array<unknown>;
}

function makeProbeHandles(): ProbeHandles {
  return {
    setContent: null,
    setComponent: null,
    getContent: null,
    getComponent: null,
    contentRestoreCalls: [],
    componentRestoreCalls: [],
    contentSaveCalls: [],
  };
}

let handles: ProbeHandles;

function Probe({ cardId: _cardId }: { cardId: string }) {
  const [content, setContent] = useState<string>("initial-content");

  // Components axis: mount-in-saved-state via `useSavedComponentState`
  // inside `useState`'s initializer. On a remount (Fast Refresh
  // hot-replace), the saved value is read synchronously in render and
  // becomes the initial state of the new instance — no post-mount
  // apply pass, no flicker. Each mount that reads a saved value
  // appends to `componentRestoreCalls` so the test can assert the
  // remount picked the saved value up.
  const savedComponent = useSavedComponentState<number>("probeComponent");
  const [component, setComponent] = useState<number>(() => {
    if (typeof savedComponent === "number") {
      handles.componentRestoreCalls.push(savedComponent);
      return savedComponent;
    }
    return 7;
  });

  // Content axis: registered via useCardStatePreservation. The hook
  // stores onSave / onRestore in refs internally, so the closures
  // we pass here always see the latest React state at call time.
  useCardStatePreservation<string>({
    onSave: () => {
      handles.contentSaveCalls.push(content);
      return content;
    },
    onRestore: (state, opts) => {
      handles.contentRestoreCalls.push({ state, isActive: opts.isActive });
      if (typeof state === "string") setContent(state);
    },
  });

  // Components axis: register for capture. The mount-in-saved-state
  // half lives above in `useState`'s initializer.
  useComponentStatePreservation<number>({
    componentStatePreservationKey: "probeComponent",
    captureState: () => component,
  });

  // Expose state setters / getters for the test harness without
  // pulling them through the React tree's prop graph. useEffect with
  // every render is fine because the handles ref is module-scope —
  // not a React subscriber.
  useEffect(() => {
    handles.setContent = setContent;
    handles.setComponent = setComponent;
    handles.getContent = () => content;
    handles.getComponent = () => component;
    return () => {
      handles.setContent = null;
      handles.setComponent = null;
      handles.getContent = null;
      handles.getComponent = null;
    };
  });

  return (
    <div data-testid="probe">
      <span data-testid="probe-content">{content}</span>
      <span data-testid="probe-component">{component}</span>
    </div>
  );
}

interface WrapperHandles {
  toggleProbe: (() => void) | null;
}

let wrapperHandles: WrapperHandles;

function Wrapper({ cardId }: { cardId: string }) {
  const [showProbe, setShowProbe] = useState(true);

  useEffect(() => {
    wrapperHandles.toggleProbe = () => setShowProbe((s) => !s);
    return () => {
      wrapperHandles.toggleProbe = null;
    };
  });

  return (
    <div data-testid="wrapper">
      {showProbe ? <Probe cardId={cardId} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal IDeckManagerStore stub — same shape as
// `card-host-composition.test.tsx` keeps; pared down to the surface
// CardHost touches for save / restore.
// ---------------------------------------------------------------------------

class Store implements IDeckManagerStore {
  private state: DeckState;
  private listeners = new Set<() => void>();
  private version = 0;
  public initialFocusedCardId: string | undefined = undefined;
  private saveCallbacks = new Map<string, () => void>();
  public cardStates = new Map<string, CardStateBag>();
  public setCardStateCalls: Array<{ id: string; bag: CardStateBag }> = [];

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
  togglePaneCollapse = (): void => {};

  getCardState = (id: string): CardStateBag | undefined => this.cardStates.get(id);
  setCardState = (id: string, bag: CardStateBag): void => {
    this.cardStates.set(id, bag);
    this.setCardStateCalls.push({ id, bag });
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

  setHasFocus = (value: boolean): void => {
    if (this.state.hasFocus === value) return;
    this.state = { ...this.state, hasFocus: value };
    this.notify();
  };

  private componentStatePreservationRegistries = new Map<
    string,
    ComponentStatePreservationRegistry
  >();
  getComponentStatePreservationRegistry = (
    cardId: string,
  ): ComponentStatePreservationRegistry => {
    let r = this.componentStatePreservationRegistries.get(cardId);
    if (!r) {
      r = new ComponentStatePreservationRegistry();
      this.componentStatePreservationRegistries.set(cardId, r);
    }
    return r;
  };
  peekComponentStatePreservationRegistry = (
    cardId: string,
  ): ComponentStatePreservationRegistry | undefined =>
    this.componentStatePreservationRegistries.get(cardId);

  private orchestrator = new CardStateOrchestrator((cardId) =>
    this.componentStatePreservationRegistries.get(cardId),
  );
  registerCardAssembler: IDeckManagerStore["registerCardAssembler"] = (
    cardId,
    assembler,
  ) => this.orchestrator.registerAssembler(cardId, assembler);
  captureCardState: IDeckManagerStore["captureCardState"] = (cardId) =>
    this.orchestrator.captureCardState(cardId);

  private activationCallbacks = new Map<string, () => void>();
  private deactivationCallbacks = new Map<string, () => void>();
  private cardHostRoots = new Map<string, HTMLElement>();
  registerActivationCallback = (
    cardId: string,
    cb: () => void,
  ): (() => void) => {
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
  registerDeactivationCallback = (
    cardId: string,
    cb: () => void,
  ): (() => void) => {
    this.deactivationCallbacks.set(cardId, cb);
    return () => {
      if (this.deactivationCallbacks.get(cardId) === cb) {
        this.deactivationCallbacks.delete(cardId);
      }
    };
  };
  invokeDeactivationCallback = (cardId: string): void => {
    this.deactivationCallbacks.get(cardId)?.();
  };
  registerCardHostRoot = (cardId: string, el: HTMLElement | null): void => {
    if (el === null) this.cardHostRoots.delete(cardId);
    else this.cardHostRoots.set(cardId, el);
  };
  peekCardHostRoot = (cardId: string): HTMLElement | null =>
    this.cardHostRoots.get(cardId) ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePane(id: string, cards: CardState[]): TugPaneState {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    cardIds: cards.map((c) => c.id),
    activeCardId: cards[0].id,
    title: "",
    acceptsFamilies: ["standard"],
  };
}

function renderDeck(store: Store): HTMLElement {
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

function makeStore(): Store {
  const cardA: CardState = {
    id: "A",
    componentId: "probe-wrapper",
    title: "A",
    closable: true,
  };
  const initial: DeckState = {
    cards: [cardA],
    panes: [makePane("p1", [cardA])],
    activePaneId: "p1",
    hasFocus: true,
  };
  return new Store(initial);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CardHost — HMR-remount detection replays bag.content + bag.components", () => {
  beforeEach(() => {
    handles = makeProbeHandles();
    wrapperHandles = { toggleProbe: null };
    paneContentRegistry._resetForTests();
    _resetForTest();
    registerCard({
      componentId: "probe-wrapper",
      defaultMeta: { title: "Probe Wrapper", closable: true },
      contentFactory: (cardId: string) => <Wrapper cardId={cardId} />,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("replays bag.content via onRestore when the content factory remounts", () => {
    const store = makeStore();
    renderDeck(store);

    // Probe is mounted; content axis registered. Push a new content
    // payload through the React state, then force a save into the
    // store's cache. After this, store.cardStates.get("A").content
    // should hold the modified payload.
    act(() => {
      handles.setContent!("typed-content");
    });
    expect(handles.getContent!()).toBe("typed-content");

    act(() => {
      store.invokeSaveCallback("A");
    });
    const savedBag = store.cardStates.get("A");
    expect(savedBag).toBeDefined();
    expect(savedBag!.content).toBe("typed-content");
    // Sanity: the onSave closure was invoked exactly once (the
    // forced save) and saw the modified payload.
    expect(handles.contentSaveCalls).toEqual(["typed-content"]);

    // Pre-toggle: no onRestore has fired yet. (Cold-boot path
    // doesn't call onRestore when the bag was empty at first
    // mount, which it was here.)
    expect(handles.contentRestoreCalls).toEqual([]);

    // Simulate the React Fast Refresh remount by toggling the
    // wrapper's `useState`. The probe unmounts, then remounts. The
    // wrapper above stays mounted; CardHost stays mounted. This is
    // the exact tree-shape signal Fast Refresh produces — and the
    // exact signature `registerStatePreservationCallbacks` watches
    // for via the no-op-pair → real-callbacks transition.
    act(() => {
      wrapperHandles.toggleProbe!();
    });
    // Probe is now unmounted. Pull it back.
    act(() => {
      wrapperHandles.toggleProbe!();
    });

    // The remount-detection in `registerStatePreservationCallbacks`
    // should have reset `hasAppliedContentRestoreRef.current`,
    // letting the content-axis restore effect fire again. The
    // effect reads the bag from store.cardStates and invokes
    // callbacks.onRestore, which our probe's onRestore closure then
    // pushes back into React state. The new probe instance starts
    // with `useState("initial-content")` but immediately runs the
    // restore handler, ending at "typed-content".
    expect(handles.contentRestoreCalls.length).toBeGreaterThanOrEqual(1);
    expect(handles.contentRestoreCalls[0]!.state).toBe("typed-content");
    expect(handles.getContent!()).toBe("typed-content");
  });

  it("replays bag.components via the component-state registry on remount", () => {
    const store = makeStore();
    renderDeck(store);

    act(() => {
      handles.setComponent!(42);
    });
    expect(handles.getComponent!()).toBe(42);

    // Force a save: the assembler runs onSave (content) AND walks
    // the components registry (which captures componentRestoreCalls'
    // sibling — captureState — into bag.components.probeComponent).
    act(() => {
      store.invokeSaveCallback("A");
    });
    const savedBag = store.cardStates.get("A");
    expect(savedBag).toBeDefined();
    expect(savedBag!.components).toBeDefined();
    expect(savedBag!.components!["probeComponent"]).toBe(42);

    // No restoreState calls yet (cold-boot with empty initial bag).
    expect(handles.componentRestoreCalls).toEqual([]);

    // Simulate the Fast Refresh remount.
    act(() => {
      wrapperHandles.toggleProbe!();
    });
    act(() => {
      wrapperHandles.toggleProbe!();
    });

    // Phase E.8: the remounted Probe's `useState` initializer reads
    // the saved value via `useSavedComponentState` synchronously in
    // render, so the new instance's component state is the saved
    // value on the very first paint. `componentRestoreCalls` is
    // appended inside the initializer when a saved value is found.
    expect(handles.componentRestoreCalls.length).toBeGreaterThanOrEqual(1);
    expect(handles.componentRestoreCalls[0]).toBe(42);
    expect(handles.getComponent!()).toBe(42);
  });

  it("does not fire restore on the first mount (cold-boot guard preserved)", () => {
    const store = makeStore();
    renderDeck(store);

    // No prior bag in the store; the cold-boot restore effects see
    // `bag === undefined` and return early. Neither axis should
    // have observed an onRestore / restoreState call.
    expect(handles.contentRestoreCalls).toEqual([]);
    expect(handles.componentRestoreCalls).toEqual([]);
  });

  it("survives multiple remount cycles without state loss", () => {
    const store = makeStore();
    renderDeck(store);

    act(() => {
      handles.setContent!("first");
    });
    act(() => {
      store.invokeSaveCallback("A");
    });

    // First remount cycle.
    act(() => {
      wrapperHandles.toggleProbe!();
    });
    act(() => {
      wrapperHandles.toggleProbe!();
    });
    expect(handles.getContent!()).toBe("first");

    // Update content, save again.
    act(() => {
      handles.setContent!("second");
    });
    act(() => {
      store.invokeSaveCallback("A");
    });

    // Second remount cycle — the bag now has "second" and the
    // remount should restore "second", not stale "first".
    act(() => {
      wrapperHandles.toggleProbe!();
    });
    act(() => {
      wrapperHandles.toggleProbe!();
    });
    expect(handles.getContent!()).toBe("second");
  });

});
