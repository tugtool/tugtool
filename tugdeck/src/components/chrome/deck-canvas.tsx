/**
 * DeckCanvas — canvas shell with responder chain support and TugPane rendering
 * from `DeckState`.
 *
 * Registers as root responder "deck-canvas" via `useResponder`. Handles
 * canvas-level actions: `cycleCard`, `resetLayout`, `showSettings`,
 * `showComponentGallery`. As a root node (`parentId` null) DeckCanvas is the
 * default first responder so canvas shortcuts work right after mount.
 *
 * `DeckCanvas` receives `DeckState` and stable callbacks from `DeckManager`
 * via the `DeckManagerContext` store (`useSyncExternalStore`, [D01], [D04]).
 * Maps `deckState.panes` to `TugPane` components. Z-index follows stack
 * order. `showComponentGallery` uses show-only semantics ([D05], [D06], [D07]).
 *
 * The canvas div with grid background is provided by `#deck-container` in
 * index.html. Deck actions include `cycleCard`, `resetLayout`, `showSettings`,
 * and `showComponentGallery`.
 */

import React, { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore, useLayoutEffect } from "react";
import { animate } from "@/components/tugways/tug-animator";
import { useResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { transferFocusForActivation } from "@/focus-transfer";
import { TugPane } from "./tug-pane";
import { CardHost } from "./card-host";
import { CanvasOverlayRoot } from "./canvas-overlay-root";
import { OpenQuicklyOverlay } from "./open-quickly-overlay";
import { DeckCommitBeacon } from "./deck-commit-beacon";
import { usePaneFocusController } from "./pane-focus-controller";
import { getRegistration, getStackSizePolicy } from "@/card-registry";
import { LENS_CARD_ID } from "@/components/lens/lens-register-card";
import type { TugPaneState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { cardDragCoordinator } from "@/card-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { copySelectionAsPlainText } from "@/lib/copy-as-plain-text";
import { openFileInCard } from "@/lib/open-file-in-card";
import { openPathInOS } from "@/lib/os-open";

// ---- DeckCanvasProps ----

/**
 * Empty props: deck state is read from `DeckManagerContext`.
 *
 * deckState, onCardMoved, onStackClosed, and onStackActivated are removed --
 * DeckCanvas reads them from the DeckManagerContext store via
 * useSyncExternalStore. No props remain.
 */
export interface DeckCanvasProps {}

// ---- Card z-index base ----

/**
 * Z-index base for cards. Card at index i in deckState.cards gets
 * z-index CARD_ZINDEX_BASE + i.
 */
const CARD_ZINDEX_BASE = 1;

/**
 * Z-index for an anchored rail (the Lens). It must sit ABOVE every free
 * pane (tiny array-order z, 1..N) so the rail is never occluded by a
 * card, yet strictly BELOW the canvas-overlay base
 * (`--tug-z-overlay-base` = 9000) into which every popup/menu/tooltip —
 * including the rail's own `…` menu and section popovers — portals. A
 * naive "always on top" z above 9000 would bury those popups behind the
 * rail. 8999 is the tier the former dev-panel overlay used.
 */
const ANCHORED_PANE_ZINDEX = 8999;

// ---- DeckCanvas ----

/**
 * The actions DeckCanvas genuinely implements (its actions-map keys).
 *
 * DeckCanvas's `canHandle: () => true` is a *dispatch* last-resort so
 * chain-action buttons stay enabled in practice ([D08]); it must NOT make
 * `validateAction` answer true for every action, or every menu item gated
 * on `chain.validateAction(...)` would light up the moment any card is
 * focused (the chain always reaches this root). `validateAction` below
 * affirms only the canvas's real capabilities; everything else falls
 * through as disabled — keep this set in sync with the actions map.
 */
const DECK_CANVAS_VALIDATED_ACTIONS: ReadonlySet<string> = new Set([
  TUG_ACTIONS.CYCLE_CARD,
  // Handled here only while deselected (chain FR is the deck-canvas root), to
  // re-activate a card. A focused pane's TugPane handles them otherwise.
  TUG_ACTIONS.PREVIOUS_TAB,
  TUG_ACTIONS.NEXT_TAB,
  TUG_ACTIONS.SHOW_SETTINGS,
  TUG_ACTIONS.SHOW_DEVTOOLS,
  TUG_ACTIONS.FOCUS_LENS,
  TUG_ACTIONS.TOGGLE_LENS,
  TUG_ACTIONS.SHOW_COMPONENT_GALLERY,
  TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE,
  TUG_ACTIONS.CLOSE,
  TUG_ACTIONS.CLOSE_ALL,
  TUG_ACTIONS.OPEN_FILE,
  TUG_ACTIONS.REVEAL_IN_FINDER,
]);

/**
 * DeckCanvas — plain function component (no `forwardRef`).
 *
 * Renders the responder-chain root and one TugPane per entry in deckState.panes.
 *
 * State is read from DeckManagerContext via useSyncExternalStore -- no
 * deckState prop. The variable `store` holds the IDeckManagerStore instance;
 * `manager` continues to hold the ResponderChainManager (unchanged).
 */
export function DeckCanvas(_props: DeckCanvasProps) {
  // ---- Store subscription ([D04]) ----
  // Named `store` (not `manager`) to avoid collision with the ResponderChainManager
  // variable below.
  const store = useDeckManager();
  const deckState = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const panes = deckState.panes;
  const cards = deckState.cards;

  // ---------------------------------------------------------------------------
  // Stable render order
  // ---------------------------------------------------------------------------
  // Stacks are rendered in a stable order (sorted by ID) so that focusCard
  // reordering the store array only changes z-index values -- React never
  // calls insertBefore to move DOM nodes. This preserves the browser's
  // pointer->click event sequence when clicking interactive elements on
  // unfocused stacks: the synchronous pane-activation path on pointerdown
  // updates z-index before click fires, so the stack is already focused.
  //
  // Z-index comes from each stack's position in the *store* array (focus
  // order), not from the stable render order.

  const { sortedStacks, zIndexMap } = useMemo(() => {
    const map = new Map<string, number>();
    panes.forEach((pane, i) =>
      map.set(
        pane.id,
        pane.anchor !== undefined ? ANCHORED_PANE_ZINDEX : CARD_ZINDEX_BASE + i,
      ),
    );
    const sorted = [...panes].sort((a, b) => a.id.localeCompare(b.id));
    return { sortedStacks: sorted, zIndexMap: map };
  }, [panes]);

  // Build a cardId → hostStackId map so `CardHost` can look up its
  // host stack without re-scanning the stacks array on every render.
  const hostStackIdByCardId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of panes) {
      for (const cid of s.cardIds) map.set(cid, s.id);
    }
    return map;
  }, [panes]);

  // Build a cardId → CardState map once per render. Consumed by the stack
  // render loop (active-card lookup, componentId resolution) and by the
  // card render loop. Hoisted out of `.map()` so the Map isn't rebuilt per
  // stack.
  const cardsById = useMemo(() => {
    const map = new Map<string, typeof cards[number]>();
    for (const c of cards) map.set(c.id, c);
    return map;
  }, [cards]);

  // ---------------------------------------------------------------------------
  // Visual focus
  // ---------------------------------------------------------------------------
  // Pane focus appearance (the `data-focused` attribute on each pane frame)
  // is owned by `pane-focus-controller.ts` — a DOM-authority hook that
  // subscribes to the store and writes `data-focused` directly, bypassing
  // React state and props. See that module's docstring for the contract
  // (L06, L10, L22).
  //
  // `deckRootRef` is the element the controller scopes its DOM queries to.
  // It's merged onto the same div that carries `responderRef` below.

  const deckRootRef = useRef<HTMLDivElement | null>(null);
  usePaneFocusController(deckRootRef);

  // ---------------------------------------------------------------------------
  // Refs for cycleCard closure (registered once on mount via useResponder)
  // ---------------------------------------------------------------------------
  // cycleCard is captured at mount time and never re-registered. All mutable
  // state it accesses must be via refs or stable values.

  const panesRef = useRef<readonly TugPaneState[]>(panes);
  panesRef.current = panes;

  // The responder chain manager — used by the last-resort `close` handler below
  // to route to the active pane when the first responder has fallen up to the
  // canvas root (e.g. a card/pane closed and nothing re-promoted a card).
  const manager = useResponderChain();
  const managerRef = useRef(manager);
  managerRef.current = manager;

  /**
   * containerRef: ref to the positioning wrapper div that card frames and snap guides
   * are rendered into. [D03]
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The card that held focus before Cmd-L moved it into the Lens, so a
  // second Cmd-L (or Escape inside the Lens) can restore it ([P05]).
  const lensPriorFocusRef = useRef<string | null>(null);

  // Hook order: useDeckManager -> useSyncExternalStore -> useRef ->
  //             usePaneFocusController -> useRequiredResponderChain ->
  //             useCallback -> useResponder ->
  //             useEffect (cardDragCoordinator init) -> useEffect (initial focused card restore) ->
  //             useLayoutEffect (startup overlay fade-out) ->
  //             useLayoutEffect (selection highlight sync)

  // Re-activate a card when the deck is deselected (canvas-background click
  // cleared `activePaneId`). Targets the topmost pane's active card. Returns
  // true when it acted, false when a card is already active (so the normal
  // navigation handlers run). Shared by the three card / pane nav actions,
  // which all land here while deselected (the chain first responder is the
  // deck-canvas root).
  const reactivateWhenDeselected = (): boolean => {
    if (store.getSnapshot().activePaneId !== undefined) return false;
    const s = panesRef.current;
    if (s.length === 0) return false;
    const incomingCardId = s[s.length - 1].activeCardId; // topmost pane
    transferFocusForActivation({
      outgoingCardId: null,
      incomingCardId,
      store,
      commitMutation: () => store.activateCard(incomingCardId),
    });
    return true;
  };

  // Register DeckCanvas as the root responder node.
  // Action handlers close over stable values only: refs, React state setters,
  // store instance (stable singleton), and the manager singleton.
  // DeckCanvas auto-becomes first responder on mount because parentId is null
  // and no first responder is set yet.
  const { ResponderScope, responderRef } = useResponder({
    id: "deck-canvas",
    /**
     * canHandle: () => true makes DeckCanvas a last-resort responder.
     *
     * DeckCanvas claims to handle all actions so that chain-action buttons
     * remain visible and enabled in practice (the chain walk always reaches
     * deck-canvas). Dispatch still checks the actions map -- unregistered
     * actions are safe no-ops. Unhandled dispatches are logged to console
     * for development debugging.
     *
     * [D08] DeckCanvas last-resort responder
     */
    canHandle: () => true,
    /**
     * Capability query (used by `chain.validateAction`, e.g. the native
     * menu's edit/find enablement) must reflect what DeckCanvas actually
     * does, not the `canHandle` dispatch catch-all. Affirm only the
     * canvas's own actions; everything else is "not handled here" so the
     * walk reports the action as unavailable when nothing real handles it.
     */
    validateAction: (action) => DECK_CANVAS_VALIDATED_ACTIONS.has(action),
    actions: {
      [TUG_ACTIONS.CYCLE_CARD]: (_event: ActionEvent) => {
        // Deselected deck (canvas-background click cleared the active card) →
        // re-activate the topmost pane's card instead of cycling. With one
        // pane this is the whole job; with several it re-focuses the top one.
        if (reactivateWhenDeselected()) return;
        const s = panesRef.current;
        if (s.length < 2) return;
        // Bottom stack rotates to top — activate its active card.
        const nextId = s[0].activeCardId;
        // Route through `transferFocusForActivation` so the keystroke
        // path matches the click-driven row-1/2/3 activation taxonomy
        // (SAVE outgoing → commit → resolve incoming → focus transfer).
        // A raw `store.activateCard(nextId)` flips the composite first-
        // responder bit but skips the focus-transfer step entirely, so
        // `document.activeElement` stays inside whichever card it was
        // in before — visible to the user as the blinking caret
        // remaining in the now-inactive card (typing still routes there
        // until the next click). The helper's internal save/commit/
        // resolve trio handles both engine-managed and content-owning
        // incoming cards correctly.
        transferFocusForActivation({
          outgoingCardId: store.getFirstResponderCardId(),
          incomingCardId: nextId,
          store,
          commitMutation: () => store.activateCard(nextId),
        });
      },
      // Previous / Next card only reach the deck canvas when nothing is
      // focused — a focused pane's TugPane handles them first. That state is
      // exactly the deselected deck, so both just re-activate a card.
      [TUG_ACTIONS.PREVIOUS_TAB]: (_event: ActionEvent) => {
        reactivateWhenDeselected();
      },
      [TUG_ACTIONS.NEXT_TAB]: (_event: ActionEvent) => {
        reactivateWhenDeselected();
      },
      // open-file / reveal-in-finder — deck-level file-reference
      // actions dispatched by context menus on transcript file refs.
      // The chain payload carries the absolute path as `value`; the
      // richer `{ path, line }` form arrives via `dispatchAction` and
      // is handled in `action-dispatch.ts`. Both converge on
      // `openFileInCard` (path-keyed Text-card reuse).
      [TUG_ACTIONS.OPEN_FILE]: (event: ActionEvent) => {
        if (typeof event.value !== "string" || event.value === "") return;
        openFileInCard(store, event.value);
      },
      [TUG_ACTIONS.REVEAL_IN_FINDER]: (event: ActionEvent) => {
        if (typeof event.value !== "string" || event.value === "") return;
        // The host's `openPath` bridge opens a `folder` kind in Finder;
        // showing the file's parent directory is the reveal.
        const parent = event.value.replace(/\/[^/]*$/, "");
        openPathInOS(parent === "" ? "/" : parent, "folder");
      },
      [TUG_ACTIONS.SHOW_SETTINGS]: (_event: ActionEvent) => {
        // ⌘, — open (or raise) the Settings singleton card. This
        // handler is why the keybinding owns the chord in-app: with the
        // WKWebView first responder, the web layer captures ⌘, before
        // AppKit's menu ever sees it, so the menu's key equivalent can't
        // be relied on — the chord must do its work here. Same
        // find-or-create-then-focus-claim shape as the gallery action
        // (and the focus-correct sibling of the native menu's
        // `show-card settings` → `showSingletonCard` path).
        const snapshot = store.getSnapshot();
        const settingsCard = snapshot.cards.find(
          (c) => c.componentId === "settings",
        );
        const incomingCardId = settingsCard
          ? settingsCard.id
          : store.addCard("settings");
        if (incomingCardId === null) return;
        transferFocusForActivation({
          outgoingCardId: store.getFirstResponderCardId(),
          incomingCardId,
          store,
          commitMutation: () => store.activateCard(incomingCardId),
        });
      },
      [TUG_ACTIONS.SHOW_DEVTOOLS]: (_event: ActionEvent) => {
        // ⌥⌘/ — open (or raise) the DevTools singleton card (Log +
        // Telemetry). Same find-or-create-then-focus-claim shape as
        // SHOW_SETTINGS.
        const snapshot = store.getSnapshot();
        const devtoolsCard = snapshot.cards.find(
          (c) => c.componentId === "devtools",
        );
        const incomingCardId = devtoolsCard
          ? devtoolsCard.id
          : store.addCard("devtools");
        if (incomingCardId === null) return;
        transferFocusForActivation({
          outgoingCardId: store.getFirstResponderCardId(),
          incomingCardId,
          store,
          commitMutation: () => store.activateCard(incomingCardId),
        });
      },
      // ⌥⌘L — toggle the Lens rail's visibility (presence = open, [P02]).
      // Pure visibility; focus semantics belong to FOCUS_LENS.
      [TUG_ACTIONS.TOGGLE_LENS]: (_event: ActionEvent) => {
        store.toggleLensPane();
      },
      // ⌘L — move focus INTO the Lens through the normal activation path
      // (opening it if hidden); a second ⌘L while the Lens is the key card
      // focuses back out to the previously-focused card ([P05]). The
      // open-then-focus ordering is handled by `applyBagFocus`'s late-mount
      // `armKeyboardRestore` — no bespoke plumbing.
      [TUG_ACTIONS.FOCUS_LENS]: (_event: ActionEvent) => {
        const snapshot = store.getSnapshot();
        const lensCard = snapshot.cards.find(
          (c) => c.componentId === LENS_CARD_ID,
        );
        const currentFR = store.getFirstResponderCardId();

        // Already inside the Lens → focus back out to the stashed card.
        if (lensCard && currentFR === lensCard.id) {
          const prior = lensPriorFocusRef.current;
          lensPriorFocusRef.current = null;
          if (
            prior !== null &&
            store.getSnapshot().cards.some((c) => c.id === prior)
          ) {
            transferFocusForActivation({
              outgoingCardId: currentFR,
              incomingCardId: prior,
              store,
              commitMutation: () => store.activateCard(prior),
            });
          }
          return;
        }

        // Focus in: stash the current card, open/raise the Lens, activate it.
        lensPriorFocusRef.current = currentFR;
        const incomingCardId = store.showLensPane();
        if (incomingCardId === null) return;
        transferFocusForActivation({
          outgoingCardId: currentFR,
          incomingCardId,
          store,
          commitMutation: () => store.activateCard(incomingCardId),
        });
      },
      /**
       * show-component-gallery — find or create the gallery card ([D05], [D07]).
       *
       * Show-only semantics ([D07]): the gallery card is never closed by this
       * action. Derives the gallery stack from the live snapshot on every
       * dispatch (walk `cards` for a `gallery-buttons` card, look up its host
       * stack) so detach / merge / close operations stay in sync without a
       * separate tracking ref. If no gallery card exists, create one and
       * activate its seeded card.
       */
      [TUG_ACTIONS.SHOW_COMPONENT_GALLERY]: (_event: ActionEvent) => {
        const snapshot = store.getSnapshot();
        const galleryCard = snapshot.cards.find(
          (c) => c.componentId === "gallery-buttons",
        );
        const galleryStack = galleryCard
          ? snapshot.panes.find((st) => st.cardIds.includes(galleryCard.id))
          : undefined;

        if (galleryStack) {
          // Phase E.11 Step 4i D9b — runtime activation routed
          // through `transferFocusForActivation` so the chain action
          // fires SAVE outgoing → commit → `applyBagFocus` on
          // incoming. Raw `activateCard` would flip the composite
          // first responder but skip the focus claim.
          const incomingCardId = galleryStack.activeCardId;
          transferFocusForActivation({
            outgoingCardId: store.getFirstResponderCardId(),
            incomingCardId,
            store,
            commitMutation: () => store.activateCard(incomingCardId),
          });
        } else {
          // No gallery card anywhere — create one and activate its seed.
          const newCardId = store.addCard("gallery-buttons");
          if (newCardId) {
            transferFocusForActivation({
              outgoingCardId: store.getFirstResponderCardId(),
              incomingCardId: newCardId,
              store,
              commitMutation: () => store.activateCard(newCardId),
            });
          }
        }
      },
      // add-card-to-active-pane: Add a new "hello" card to the active pane
      // (last in array). Reads cardsRef so the closure never goes stale.
      // If no cards exist, this is a no-op. The componentId "hello" is
      // intentionally hardcoded because it is the only registered card
      // type in Phase 5; parameterized componentId dispatch is deferred
      // until payload support is added.
      // [D06] Add-tab action uses DeckManager + responder chain
      // [D09] Add-tab routed as DeckCanvas responder action
      [TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE]: (_event: ActionEvent) => {
        const s = panesRef.current;
        if (s.length === 0) return;
        const activePaneId = s[s.length - 1].id; // topmost pane (z-order)
        store.addCardToPane(activePaneId, "hello");
      },
      // Last-resort `close` ([D08]). `close` is normally handled by the active
      // pane (an innermost-first walk from a card reaches the pane before the
      // canvas). It only reaches the canvas root when the first responder has
      // fallen up to "deck-canvas" — a card/pane closed and the next active card
      // never reclaimed the first responder (no `focusin` on a non-text card).
      // Route it to the topmost pane so Cmd-W is never dropped on the frontmost
      // card, regardless of the first-responder restoration state.
      [TUG_ACTIONS.CLOSE]: (_event: ActionEvent) => {
        const m = managerRef.current;
        const s = panesRef.current;
        if (m === null || s.length === 0) return;
        const activePaneId = s[s.length - 1].id; // topmost pane (z-order)
        m.sendToTarget(activePaneId, { action: TUG_ACTIONS.CLOSE, phase: "discrete" });
      },
      // Last-resort `close-all` ([D08]), symmetric with the `close`
      // backstop above. Route File ▸ Close All Card Tabs to the topmost pane
      // even when the first responder has stranded on the canvas, so the
      // command is never dropped on the frontmost pane.
      [TUG_ACTIONS.CLOSE_ALL]: (_event: ActionEvent) => {
        const m = managerRef.current;
        const s = panesRef.current;
        if (m === null || s.length === 0) return;
        const activePaneId = s[s.length - 1].id; // topmost pane (z-order)
        m.sendToTarget(activePaneId, { action: TUG_ACTIONS.CLOSE_ALL, phase: "discrete" });
      },
      // Copy as Plain Text ([D08] last-resort). Plain Copy operates on the
      // live document selection wherever it lives — in Tug.app ⌘C routes to
      // WebKit's native `copy:`, not the responder chain — so Copy as Plain
      // Text reads that same selection directly here at the root rather than
      // per surface. The walk always reaches the canvas (dispatch consults
      // only the actions map, never an intervening `canHandle`), so this one
      // handler covers every text-bearing surface: transcript, markdown /
      // code views, terminal output, the prompt editor, and native inputs.
      [TUG_ACTIONS.COPY_AS_PLAIN_TEXT]: (_event: ActionEvent) => {
        copySelectionAsPlainText();
      },
    },
  });

  // Provide the coordinator with the store reference so it can call
  // reorderTab / detachTab / mergeTab on drop. [D07]
  //
  // useEffect runs after the first render (after mount), which is always
  // before any user interaction, so the coordinator is ready before any
  // tab drag can be attempted. Re-initialization is safe: init() only
  // overwrites the stored IDeckManagerStore reference; no cleanup needed.
  useEffect(() => {
    cardDragCoordinator.init(store);
  }, [store]);

  // Phase 5f: Focused card restoration after app reload ([D03]).
  //
  // On mount, read store.initialFocusedCardId (populated by the DeckManager
  // constructor from the tugbank-fetched focusedCardId). If the card still
  // exists in the deck, call `store.activateCard(id)` — the single entry
  // point that updates z-order, promotes the responder-chain key card, and
  // notifies lifecycle observers (selection guard, session-card focus, etc.).
  // Then clear the field so this only fires once on mount.
  //
  // Empty deps array: runs once on mount. The store is a stable singleton.
  useEffect(() => {
    const focusedCardId = store.initialFocusedCardId;
    if (!focusedCardId) return;

    // Clear immediately so subsequent re-mounts (HMR, StrictMode) do not re-fire.
    store.initialFocusedCardId = undefined;

    const snapshot = store.getSnapshot();
    const cardExists = snapshot.cards.some(
      (c) => c.id === focusedCardId,
    );
    if (!cardExists) return;

    // On mount, route through `activateCard` — `_flipFirstResponder`
    // treats the layout blob's `activePaneId` as the pre-existing
    // composite bit and delivers initial-sync to late-mounting
    // lifecycle subscribers via `observeCardDidActivate`'s
    // subscribe-time read of the current focused card.
    store.activateCard(focusedCardId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fade out the startup overlay once DeckCanvas has committed its first render.
  //
  // useLayoutEffect fires after React commits DOM mutations but before the browser
  // paints, so the browser composites the React content and the first frame of the
  // overlay fade in a single paint — no visible transition between "overlay covers
  // everything" and "React content is visible". This is the onContentReady pattern
  // (Rules 11-12, D78, D79) applied at viewport scope.
  //
  // The overlay is removed from the DOM after the TugAnimator animation completes.
  // The `if (!overlay) return` guard handles rapid HMR reloads where the overlay
  // may already be absent. [D02]
  // Startup overlay removed — the native window background (set from tugbank)
  // provides visual continuity while the WebView is hidden. The WebView is
  // revealed by frontendReady after the theme and layout are fully applied.

  // SelectionGuard highlight sync is handled by the guard's own
  // subscription to the card lifecycle (installed via
  // `selectionGuard.attach(lifecycle)` in ResponderChainProvider).
  // The deck-canvas no longer drives it from a focused-card effect;
  // the lifecycle's wildcard observer + initial-sync covers every
  // activation path without a coupled react-side effect.

  // Merge `deckRootRef` (pane-focus-controller's query scope) and
  // `responderRef` (responder-chain wiring) onto the same element.
  // `useCallback` with `[responderRef]` keeps the callback identity
  // stable across renders because `useResponder` returns a stable
  // ref callback. Same pattern as `rootRefCallback` in tug-pane.tsx.
  const setDeckRef = useCallback(
    (el: HTMLDivElement | null) => {
      deckRootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  return (
    <ResponderScope>
      {/*
       * Responder root wrapper: filters all pointerdowns below through
       * this element's data-responder-id so the chain's document-level
       * promotion resolves "deck-canvas" as the ancestor responder
       * when a click lands on the canvas background or any card
       * without its own data-responder-id. Card-level responders
       * inside containerRef win via innermost-first DOM walk.
       */}
      <div ref={setDeckRef} style={{ position: "absolute", inset: 0 }}>
      {/*
        * DeckCommitBeacon: zero-output React commit observer. Mounted
        * once at the deck root so every React commit of the deck tree
        * emits a `commit-tick` event into the deck trace. See
        * deck-commit-beacon.tsx for the rationale.
        */}
      <DeckCommitBeacon />
      {/*
        * containerRef wrapper: positioning context for card frames, snap guides,
        * and SVG flash elements. Fills the full canvas area (position:absolute, inset:0).
        * [D03]
        */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {/* TugPanes: one per pane in deckState.panes.
          Rendered in stable ID order (no DOM reordering on focus change).
          Z-index from store array position (first = lowest). Panes whose
          active card's componentId is unregistered are skipped with a
          warning. */}
      {sortedStacks.map((stackState) => {
        const activeCard = cardsById.get(stackState.activeCardId);
        const fallbackCard =
          activeCard ?? cardsById.get(stackState.cardIds[0]);
        const componentId = fallbackCard?.componentId;
        if (!componentId) {
          console.warn(
            `[DeckCanvas] stack "${stackState.id}" has no active card -- skipping render.`,
          );
          return null;
        }

        const registration = getRegistration(componentId);
        if (!registration) {
          console.warn(
            `[DeckCanvas] stack "${stackState.id}" references unregistered componentId "${componentId}" -- skipping render.`,
          );
          return null;
        }

        /**
         * onClose wrapper: when the closed stack matches
         * Close-button handler: delegates to store. No gallery-stack bookkeeping
         * needed — show-component-gallery re-derives the gallery stack from
         * the live snapshot on every dispatch.
         */
        const handleClose = () => {
          store.handlePaneClosed(stackState.id);
        };

        const stackCards = stackState.cardIds
          .map((cid) => cardsById.get(cid))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        const hasMultipleCards = stackCards.length > 1;

        return (
          <TugPane
            key={stackState.id}
            stackState={stackState}
            meta={registration.defaultMeta}
            // A pane is one box shared by every tab in the stack, so
            // its resize floor must clear the widest card kind it
            // hosts — not just the active tab. `getStackSizePolicy`
            // takes the element-wise max of the stack's mins.
            sizePolicy={getStackSizePolicy(
              stackCards.map((c) => c.componentId),
            )}
            zIndex={zIndexMap.get(stackState.id) ?? CARD_ZINDEX_BASE}
            onCardMoved={store.handlePaneMoved}
            onClose={handleClose}
            onCardCollapsed={(id) => store.togglePaneCollapse(id)}
            onCardMerged={(sourceStackId, targetStackId, insertIndex) => {
              // Resolve the active card id from the source stack at commit time.
              const snapshot = store.getSnapshot();
              const sourceStack = snapshot.panes.find(
                (s) => s.id === sourceStackId,
              );
              if (!sourceStack) return;
              store.moveCardToPane(
                sourceStackId,
                sourceStack.activeCardId,
                targetStackId,
                insertIndex,
              );
            }}
            activeCardId={stackState.activeCardId}
            cards={hasMultipleCards ? stackCards : undefined}
            cardTitle={hasMultipleCards ? stackState.title : undefined}
            acceptedFamilies={
              hasMultipleCards ? stackState.acceptsFamilies : undefined
            }
          />
        );
      })}

      {/* Flat card-content list: every card is mounted exactly once and
          routes its DOM via portal into its host stack's content div. React
          keys by cardId so React preserves component identity when a card
          moves between stacks (detach / merge). Non-active cards render
          with `display: none` so they stay alive without affecting layout.
          Content factories and contexts live in CardHost; see
          card-host.tsx. */}
      {cards.map((card) => {
        const hostStackId = hostStackIdByCardId.get(card.id);
        if (!hostStackId) return null;
        const hostStack = panes.find((s) => s.id === hostStackId);
        return (
          <CardHost
            key={card.id}
            cardId={card.id}
            hostStackId={hostStackId}
            componentId={card.componentId}
            isActive={hostStack?.activeCardId === card.id}
          />
        );
      })}
      </div>
      {/*
        * CanvasOverlayRoot: single deck-level container for popup-class
        * overlays (completion menus, popovers, etc.). Mounted as a
        * SIBLING of containerRef — not a descendant — so no pane's
        * `overflow: hidden` clips the overlay. The root is
        * position-fixed; pointer-events: none on the root, opt-in
        * pointer-events: auto on its children. See
        * canvas-overlay-root.tsx for the full contract. [D01, D07, D09]
        */}
      <CanvasOverlayRoot />
      {/* Deck-global Open Quickly popup (File ▸ Open Quickly). Renders
        * nothing until opened; portals into the overlay root above. */}
      <OpenQuicklyOverlay />
      </div>
    </ResponderScope>
  );
}
