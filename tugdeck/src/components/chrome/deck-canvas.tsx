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
import { animate, type TugAnimation } from "@/components/tugways/tug-animator";
import { getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";
import { useResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { applyBagFocus, transferFocusForActivation } from "@/focus-transfer";
import { CANVAS_BACKGROUND_ATTRIBUTE } from "@/gesture-interpreter";
import { TugPane } from "./tug-pane";
import { CardHost } from "./card-host";
import { CanvasOverlayRoot } from "./canvas-overlay-root";
import { OpenQuicklyOverlay } from "./open-quickly-overlay";
import { DeckCommitBeacon } from "./deck-commit-beacon";
import { usePaneFocusController } from "./pane-focus-controller";
import { usePaneOcclusionController } from "./pane-occlusion-controller";
import { getRegistration, getStackSizePolicy } from "@/card-registry";
import { LENS_CARD_ID } from "@/lib/lens-card-id";
import { findLensPane } from "@/deck-store-selectors";
import type { DeckState, TugPaneState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { cardDragCoordinator } from "@/card-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { copySelectionAsPlainText } from "@/lib/copy-as-plain-text";
import { openFileInCard } from "@/lib/open-file-in-card";
import { revealPathInFinder } from "@/lib/os-open";
import { cardServicesStore } from "@/lib/card-services-store";
import { flipDelta, springKeyframes } from "@/lib/pane-flip";
import { dispatchAction } from "@/action-dispatch";
import {
  isLensPinned,
  resolvePlacement,
  slotCount,
  IMPOSITION_GAP_PX,
  IMPOSITION_SETTLE_MS,
  LENS_WIDTH_PROPERTY,
  RESIZE_RETUNE_QUIET_MS,
} from "@/lib/layout-imposer";

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
 * Z-index for the Lens pane. It must sit ABOVE every free pane (tiny
 * array-order z, 1..N) so the Lens is never occluded by a card, yet
 * strictly BELOW the canvas-overlay base (`--tug-z-overlay-base` = 9000)
 * into which every popup/menu/tooltip — including the Lens's own `…` menu
 * and section popovers — portals. A naive "always on top" z above 9000
 * would bury those popups behind the Lens. 8999 is the tier the former
 * dev-panel overlay used.
 */
const LENS_PANE_ZINDEX = 8999;

/**
 * The width the pinned Lens PAINTS at: its stored width raised to its stack's
 * size floor. A stored width below the floor is a number the frame never shows,
 * so packing the band on it would run the chain under the Lens's real edge.
 * Zero when there is no pinned Lens to inset the band.
 */
function lensRenderWidthOf(state: DeckState): number {
  const lensPane = findLensPane(state);
  if (lensPane === undefined || !isLensPinned(state.imposition)) return 0;
  return Math.max(
    lensPane.size.width,
    getStackSizePolicy(
      state.cards
        .filter((card) => lensPane.cardIds.includes(card.id))
        .map((card) => card.componentId),
    ).min.width,
  );
}

/**
 * Everything the imposer reads, as one string: the imposition record, which
 * pane holds which slot, and the pinned Lens's width. Two decks with the same
 * signature put every derived frame in the same place, so a change to it is
 * exactly the set of moments the deck should cross to a new arrangement rather
 * than cut.
 *
 * The pane terms are sorted, so the signature is blind to the panes array's
 * ORDER — which is z-order, and z-order moves nothing: `imposeRect` reads a
 * pane's slot, its width, and the span, never its place in the array. Order
 * sensitivity here would make every pane activation — a click on a title bar —
 * arm a settle window with no frame to move in it, holding session
 * notifications for the length of a motion that never happens.
 *
 * The Lens width is a term because the space allocator can change it with the
 * arrangement otherwise untouched — a settled window resize re-solves the width
 * and nothing else — and every imposed frame moves when it does. Without the
 * term that motion would cut. It changes on a Lens edge drag too, which arms a
 * window whose tweens are all no-ops: the drag wrote the width live, so each
 * frame's first and last rects are the same one.
 */
function arrangementSignature(state: DeckState): string {
  const panes = state.panes
    .map((pane) => `${pane.id}:${pane.slot ?? ""}`)
    .sort();
  return `${state.imposition.kind ?? ""}|${state.imposition.lens}|${
    isLensPinned(state.imposition) ? "pinned" : "free"
  }|${lensRenderWidthOf(state)}|${panes.join(",")}`;
}

/**
 * The settle duration actually in force on `el`, in milliseconds — the resolved
 * `--tugx-imposer-settle-duration`, so a tuning override anywhere up the tree
 * retimes the attribute along with the transition it gates. Falls back to
 * {@link IMPOSITION_SETTLE_MS} for an unresolvable or malformed value.
 */
function readSettleMs(el: HTMLElement): number {
  const raw = getComputedStyle(el)
    .getPropertyValue("--tugx-imposer-settle-duration")
    .trim();
  const seconds = raw.endsWith("ms") ? 0.001 : raw.endsWith("s") ? 1 : 0;
  if (seconds === 0) return IMPOSITION_SETTLE_MS;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0
    ? value * seconds * 1000
    : IMPOSITION_SETTLE_MS;
}

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
  TUG_ACTIONS.MOVE_TO_SLOT,
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
  // The Lens pane carries no marker of its own — it is the pane hosting the
  // Lens card ([P04]). Resolved once here and reused by the z-order, the band
  // insets, the placements memo, and the `lensSide` prop below.
  const lensPane = findLensPane(deckState);
  const lensPaneId = lensPane?.id;
  // The side the Lens is HOLDING, or null when there is none to hold it —
  // because the Lens is closed, or because it has been dragged off its pin and
  // is standing in the deck as an ordinary free pane. Either way the
  // arrangement spans the whole canvas.
  const lensSide =
    lensPane === undefined || !isLensPinned(deckState.imposition)
      ? null
      : deckState.imposition.lens;

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
        pane.id === lensPaneId ? LENS_PANE_ZINDEX : CARD_ZINDEX_BASE + i,
      ),
    );
    const sorted = [...panes].sort((a, b) => a.id.localeCompare(b.id));
    return { sortedStacks: sorted, zIndexMap: map };
  }, [panes, lensPaneId]);

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
  usePaneOcclusionController(deckRootRef);

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
      // ⌘1..⌘9 — put the selected card at slot N of the active
      // imposition. The canvas owns the layout tree, so it owns this;
      // the chord walks past the focused card and its pane to get here.
      // Every gate below is a silent return, never a warn: the digit row
      // is bound in full, and a number the current arrangement doesn't
      // have is a chord the user simply hasn't configured. `assign-slot`
      // does the work, so the keyboard and the Lens's SlotPicker share
      // one path (detach-from-tab-group, raise, clamp, persist).
      [TUG_ACTIONS.MOVE_TO_SLOT]: (event: ActionEvent) => {
        if (typeof event.value !== "number") return;
        const deck = store.getSnapshot();
        const kind = deck.imposition.kind;
        if (kind === undefined) return;
        if (event.value < 1 || event.value > slotCount(kind)) return;
        const cardId = store.getFirstResponderCardId();
        if (cardId === null) return;
        const card = deck.cards.find((c) => c.id === cardId);
        if (!card || card.componentId === LENS_CARD_ID) return;
        dispatchAction({
          action: "assign-slot",
          cardId,
          slot: event.value - 1,
        });
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
        revealPathInFinder(event.value);
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
        // Settings is `placement: "center"`: it lands in the middle of the
        // canvas on every show, not only the first, so a position saved under
        // an older arrangement can never leave it hiding behind the Lens. The
        // menu path gets this from `showSingletonCard`; ⌘, does its own
        // find-or-create, so it asks for the same thing here.
        if (settingsCard) store.centerPane(incomingCardId);
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
      // the keyboard `place()` — no bespoke plumbing.
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
          } else {
            // No live prior to return to (never stashed, or that card has
            // closed). ⌘L must never be a silent no-op: re-dispatch the
            // Lens's own focus claim with keyboard modality, so the key
            // view is re-asserted visibly — healing any stale descend the
            // closed card left behind.
            applyBagFocus(lensCard.id, store, {
              site: "focus-lens",
              modality: "keyboard",
            });
          }
          return;
        }

        // Focus in: stash the current card, open/raise the Lens, activate it.
        // ⌘L is a keyboard gesture, so the transfer asserts keyboard modality:
        // the Lens's remembered key view comes back RINGED and revealed, not
        // replayed with whatever modality a pointer interaction left it —
        // Cmd-L must always visibly show where the keyboard landed.
        lensPriorFocusRef.current = currentFR;
        const incomingCardId = store.showLensPane();
        if (incomingCardId === null) return;
        transferFocusForActivation({
          outgoingCardId: currentFR,
          incomingCardId,
          store,
          commitMutation: () => store.activateCard(incomingCardId),
          modality: "keyboard",
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

  // ---------------------------------------------------------------------------
  // Layout-imposer span insets
  // ---------------------------------------------------------------------------
  // The band imposed panes are placed across is the canvas minus the Lens on
  // the side it holds — slotted positions are never under it, though a free
  // pane may still be dragged there. The two insets reach CSS as custom
  // properties on the frames' own containing block, so an imposed frame's
  // `calc()` tracks a window resize or a Lens width drag with no JavaScript at
  // all ([L06]). This is why a resize costs the deck nothing while it is
  // happening: the browser does the reflow, and no code here runs per frame.
  //
  // The one exception is the settled-resize observer below, which runs no
  // geometry of its own and only after the canvas has stopped moving. The live
  // path stays pure CSS, and it must stay that way — nothing else may be hung
  // off that observer.
  //
  // The inset is the Lens's width plus one gap, because the Lens is itself
  // imposed a gap off the canvas edge — its near edge is that far in. The
  // width is the one the frame will actually PAINT at, raised to the stack's
  // size floor exactly as `TugPane`'s `renderWidth` and the placements memo
  // below do; packing on a stored width below the floor would run the chain
  // under the Lens's real edge. `resolveSpan` adds the identical gap, so the
  // numeric twin and the CSS agree by construction ([P05]).
  //
  // The width itself is published as `LENS_WIDTH_PROPERTY` and the insets are
  // written as expressions over it, so the Lens frame's own pin and the band
  // the chain rides read ONE number. A width drag rewrites that one property
  // (`TugPane`'s `handleLensResizeStart`) and the whole arrangement re-resolves
  // in the browser's next reflow: the Lens grows off its own pinned edge and
  // the cards re-impose live under the moving edge, which is the same response
  // the deck already gives a window resize.
  const lensRenderWidth = lensRenderWidthOf(deckState);
  const lensInset =
    lensRenderWidth === 0
      ? "0px"
      : `calc(var(${LENS_WIDTH_PROPERTY}) + ${IMPOSITION_GAP_PX}px)`;
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.setProperty(LENS_WIDTH_PROPERTY, `${lensRenderWidth}px`);
    el.style.setProperty(
      "--tug-imposer-inset-left",
      lensSide === "left" ? lensInset : "0px",
    );
    el.style.setProperty(
      "--tug-imposer-inset-right",
      lensSide === "right" ? lensInset : "0px",
    );
  }, [lensSide, lensInset, lensRenderWidth]);

  // ---------------------------------------------------------------------------
  // Settled-resize re-tune
  // ---------------------------------------------------------------------------
  // A new canvas width is a new band, and the Lens width that made the chain
  // tile evenly at the old one may not at the new one. So the space allocator
  // gets a third moment beside the Layouts pick: the canvas came to rest at a
  // size it was not at before — because the user dragged the window edge, or
  // because the OS resized it (a display change, a space move).
  //
  // Both are the same event as far as the deck is concerned, and neither is
  // observed WHILE it happens: the timer restarts on every observation and only
  // its expiry asks the store to re-tune, so a drag of the window edge runs the
  // pure-CSS path throughout and re-tunes once, when the hand stops. Observing
  // the container rather than `window` also catches host chrome that resizes
  // the canvas without a window resize event.
  //
  // `ResizeObserver` reports the current size as soon as it starts observing.
  // That one is swallowed — a deck that re-tuned as it appeared would rearrange
  // itself under the user at the worst possible moment, before they had touched
  // anything ([L03]: registration and its cleanup live in a layout effect; the
  // timer is a ref, not React state).
  const retuneTimerRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let seenInitial = false;
    const observer = new ResizeObserver(() => {
      if (!seenInitial) {
        seenInitial = true;
        return;
      }
      if (retuneTimerRef.current !== null) {
        window.clearTimeout(retuneTimerRef.current);
      }
      retuneTimerRef.current = window.setTimeout(() => {
        retuneTimerRef.current = null;
        store.retuneLensAllocation();
      }, RESIZE_RETUNE_QUIET_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (retuneTimerRef.current !== null) {
        window.clearTimeout(retuneTimerRef.current);
        retuneTimerRef.current = null;
      }
    };
  }, [store]);

  // ---------------------------------------------------------------------------
  // Settling into a new arrangement
  // ---------------------------------------------------------------------------
  // A change to the ARRANGEMENT moves derived frames without anyone touching
  // them: the Lens crossing to the other side, an N-up swap, the pin coming
  // back, a card sent to another slot. The frames cross to their new places
  // rather than cutting, and the crossing is FLIP: React commits the final
  // geometry in one layout pass, and each moved frame is then tweened by a
  // transform that starts at the inverse of the move and ends at nothing.
  // Appearance only, written straight to the DOM, never through React state
  // ([L06]); the motion itself goes through TugAnimator ([L13]).
  //
  // FLIP rather than a transition on `left`/`top`/`width` because transitioning
  // layout properties re-runs layout for every moving frame on every frame of
  // the motion. A transform tween in the accelerated form (`lib/pane-flip.ts`
  // holds the rules) costs one compositing walk when it starts, one when it
  // ends, and nothing in between — see
  // `roadmap/jul30-perf-brief.md#i1-sparkline-exception`.
  //
  // The trigger is a signature over exactly what the imposer reads — the
  // record, plus which pane holds which slot. Watching the record alone would
  // make a slot assignment animate or cut depending on whether it happened to
  // land inside some earlier change's window, and a gesture that sometimes
  // crosses and sometimes jumps is worse than one that always jumps.
  //
  // The work is split across a store subscriber and a layout effect because
  // FLIP needs both sides of the commit. A store subscriber runs BEFORE the
  // re-render it causes, so it is the only place that can see where the frames
  // are now (First); the layout effect runs after the commit and before paint,
  // so it is where they can be measured in their new places (Last). Nothing is
  // painted between the two, which is what makes the inversion invisible.
  //
  // The timing lives in one place: `IMPOSITION_SETTLE_MS` reaches CSS as
  // `--tugx-imposer-settle-duration` and the resolved value is read back, so an
  // override on the container retimes the tween and the attribute together.
  // What `animate()` is handed is that RAW number, because TugAnimator scales
  // its own durations by `getTugTiming()`; the window timer is handed the
  // scaled product, so the two can never disagree.
  const arrangement = arrangementSignature(deckState);
  const arrangementRef = useRef(arrangement);
  const settleTimerRef = useRef<number | null>(null);
  /** Where each non-gesturing frame sat before the commit, by pane id. */
  const settleFirstRectsRef = useRef<Map<string, DOMRect>>(new Map());
  /** The tween running on each frame, by pane id — DOM zone, never React state. */
  const settleTweensRef = useRef<
    Map<string, { el: HTMLElement; anim: TugAnimation }>
  >(new Map());
  /** The raw (unscaled) settle duration read back for the current gesture. */
  const settleDurationRef = useRef(IMPOSITION_SETTLE_MS);

  // Hold every session card's notifications for the length of the
  // gesture, and release them on the same edges the tweens land on.
  //
  // A React commit landing INSIDE the window is not merely one more
  // commit: measured on release, the settle alone cost 343 walk samples
  // and a commit stream alone 654, but the two together cost 1809 —
  // 81% above their sum, with median frame delivery going 17ms to 20ms
  // and four times the dropped frames
  // (`roadmap/jul30-perf-brief.md#s5-imposer`). A commit while a
  // transform animation is running dirties compositing with the
  // animation's extent already reserved, which forces exactly the
  // recompute that reservation exists to avoid.
  //
  // Nothing is dropped — the events reduce and run their effects as
  // they arrive, and only the React notification waits, flushing once
  // at release. The cap is the store's own guard against a holder that
  // never comes back; release below is what normally ends it.
  const holdSessions = useCallback((capMs: number) => {
    cardServicesStore.forEachCodeSessionStore((store) => {
      store.holdNotifications(capMs);
    });
  }, []);
  const releaseSessions = useCallback(() => {
    cardServicesStore.forEachCodeSessionStore((store) => {
      store.releaseNotifications();
    });
  }, []);

  // Drop a frame's tween registration and, crucially, the inline `transform`
  // TugAnimator leaves on it.
  //
  // TugAnimator commits an animation's final value into `el.style` when it
  // completes — unconditionally, whatever `fill` says, and `cancel()` in
  // snap-to-end mode takes the same path. Here that final value is
  // `translate(0px, 0px)`, and React will never remove it: `transform` is not
  // among the style keys TugPane renders, and React only clears keys it set
  // itself. A frame left wearing any transform is a containing block for its
  // `position: fixed` descendants — and TugSheet portals into the frame, while
  // completion popups, alerts, and banners all position from viewport
  // coordinates — so the residue would offset every one of them by the pane's
  // origin, and only after the first arrangement change. Removing it is not
  // tidiness; it is what keeps the frame's geometry the store's to own ([L09]).
  //
  // Idempotent by construction, because it runs more than once per frame: the
  // completion handler, the window sweep, and effect teardown all call it, and
  // a cancelled tween's handler lands a microtask later — after a replacement
  // tween may already have been registered, which is why the registry entry is
  // only dropped when it still belongs to the animation that finished.
  const clearFlipRef = useRef(
    (paneId: string, el: HTMLElement, anim: TugAnimation | null): void => {
      const entry = settleTweensRef.current.get(paneId);
      if (anim === null || entry?.anim === anim) {
        settleTweensRef.current.delete(paneId);
      }
      el.style.removeProperty("transform");
    },
  );

  useEffect(() => {
    const clearFlip = clearFlipRef.current;
    const arm = (): void => {
      const el = containerRef.current;
      if (el === null) return;
      const next = arrangementSignature(store.getSnapshot());
      if (next === arrangementRef.current) return;
      arrangementRef.current = next;

      // First: where every frame the imposer may move is right now. A running
      // tween's transform is included in the rect, which is the point — a
      // second arrangement change mid-motion starts its tween from where the
      // eye actually is. Cancelling comes after the measurement, and is safe at
      // any moment because the tween's last keyframe is no transform at all:
      // there is no wrong pose to snap to.
      // Under reduced motion there will be no tween: the layout snap IS the
      // settle. Measuring would force a layout for rects nobody reads, and
      // holding would defer session notifications against a commit-during-
      // animation cost that cannot arise without an animation — so both are
      // skipped, while cancelling any straggler tween stays unconditional.
      const motion = isTugMotionEnabled();
      const firstRects = settleFirstRectsRef.current;
      firstRects.clear();
      for (const frame of el.querySelectorAll<HTMLElement>(
        ".tug-pane[data-pane-id]",
      )) {
        // A pane under the pointer writes its own `left`/`top` every frame;
        // motion on top of a pointer lags the pointer.
        if (frame.hasAttribute("data-gesture")) continue;
        const paneId = frame.getAttribute("data-pane-id");
        if (paneId === null) continue;
        if (motion) firstRects.set(paneId, frame.getBoundingClientRect());
        const running = settleTweensRef.current.get(paneId);
        if (running !== undefined) {
          running.anim.cancel("snap-to-end");
          clearFlip(paneId, frame, running.anim);
        }
      }

      el.style.setProperty(
        "--tugx-imposer-settle-duration",
        `${IMPOSITION_SETTLE_MS}ms`,
      );
      el.setAttribute("data-imposer-settling", "");
      const settleMs = readSettleMs(el);
      settleDurationRef.current = settleMs;
      const windowMs = settleMs * getTugTiming();

      // The cap is generous against the window it guards — it is a
      // wedge guard, not a second clock, and firing it early would
      // reintroduce the very commit the hold is here to keep out.
      if (motion) holdSessions(Math.max(2 * windowMs, 1000));

      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = window.setTimeout(() => {
        settleTimerRef.current = null;
        el.removeAttribute("data-imposer-settling");
        releaseSessions();
        // Every tween should have finished and swept itself by now. The sweep
        // is what guarantees no frame keeps the inline residue if one didn't.
        for (const [paneId, entry] of [...settleTweensRef.current]) {
          entry.anim.cancel("snap-to-end");
          clearFlip(paneId, entry.el, entry.anim);
        }
      }, windowMs);
    };
    const unsubscribe = store.subscribe(arm);
    return () => {
      unsubscribe();
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      // Unmounting mid-gesture leaves neither a running tween nor a
      // transform — nor a card whose notifications nobody will release.
      releaseSessions();
      for (const [paneId, entry] of [...settleTweensRef.current]) {
        entry.anim.cancel("snap-to-end");
        clearFlip(paneId, entry.el, entry.anim);
      }
      settleFirstRectsRef.current.clear();
      containerRef.current?.removeAttribute("data-imposer-settling");
    };
  }, [store, holdSessions, releaseSessions]);

  // Last, and the tween. Declared AFTER the inset effect above, and that order
  // is load-bearing: React runs layout effects in declaration order, and the
  // inset effect writes the `--tug-imposer-inset-*` values every imposed
  // frame's `left` calc resolves against. Measuring Last before the fresh
  // insets land would tween every Lens side flip from a stale delta.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const firstRects = settleFirstRectsRef.current;
    if (el === null || firstRects.size === 0) {
      firstRects.clear();
      return;
    }
    // Reduced motion: the layout has already snapped, and that IS the settle.
    // The check is made here rather than left to TugAnimator, which would
    // strip the spatial keyframes and substitute an opacity fade — a flash on
    // every frame, all of which already sit where they belong.
    if (!isTugMotionEnabled()) {
      firstRects.clear();
      return;
    }
    const clearFlip = clearFlipRef.current;
    const duration = settleDurationRef.current;
    for (const frame of el.querySelectorAll<HTMLElement>(
      ".tug-pane[data-pane-id]",
    )) {
      const paneId = frame.getAttribute("data-pane-id");
      if (paneId === null) continue;
      const firstRect = firstRects.get(paneId);
      if (firstRect === undefined) continue;
      if (frame.hasAttribute("data-gesture")) continue;
      const { dx, dy } = flipDelta(firstRect, frame.getBoundingClientRect());
      // A frame that did not move gets no animation at all.
      if (dx === 0 && dy === 0) continue;
      const anim = animate(frame, springKeyframes(dx, dy), {
        // Raw ms: TugAnimator scales by getTugTiming() itself.
        duration,
        // A keyword easing, because the curve rides in the keyframe offsets —
        // `lib/pane-flip.ts` says why a sampled `linear()` cannot be used here.
        easing: "linear",
        // No retained effect after the tween ends ([D6]).
        fill: "none",
        composite: "replace",
        key: "imposer-flip",
        slotCancelMode: "snap-to-end",
      });
      settleTweensRef.current.set(paneId, { el: frame, anim });
      // Both arms: `finished` rejects under hold-at-current, and while this
      // surface never asks for that mode, a bare `.then` would turn a future
      // edit into an unhandled rejection.
      const done = (): void => clearFlip(paneId, frame, anim);
      anim.finished.then(done, done);
    }
    firstRects.clear();
  }, [arrangement]);

  // Where each imposed pane sits. A slot's anchor is a pure function of the
  // kind and the slot — no pane's place depends on any other's, and the Lens's
  // side moves the band's edges rather than the numbering — so this is a
  // per-pane lookup rather than a chain resolved from a vantage point that sees
  // them all. Resolved here only because the canvas is where the kind is
  // already in hand.
  const impositionKind = deckState.imposition.kind;
  const placementFor = useCallback(
    (pane: TugPaneState) =>
      impositionKind === undefined || pane.slot === undefined
        ? undefined
        : resolvePlacement(impositionKind, pane.slot),
    [impositionKind],
  );

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
      {/*
        * `overflow: clip` is the deck's "the page is not a scroller" law, not a
        * styling choice. A pane parked so its frame reaches past a window edge
        * overflows this box; because `#deck-container` is unpositioned, that
        * overflow resolves against the viewport and lands in `<body>`'s scroll
        * box, which `globals.css` makes invisible (`overflow: hidden`) but NOT
        * unscrollable. Anything that walks ancestor scrollports — a stray
        * `scrollIntoView`, a browser focus reveal — can then scroll the page,
        * which slides the whole deck under the window with no scrollbar, no
        * wheel target, and no gesture that returns it.
        *
        * `clip` (not `hidden`) is the operative word: it clips at the same box
        * but forms no scroll container at all, so the range never exists to be
        * spent. Panes are already clipped at the window edge by the window
        * itself, so nothing that was visible before is lost.
        */}
      <div ref={setDeckRef} style={{ position: "absolute", inset: 0, overflow: "clip" }}>
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
        *
        * It also carries the canvas-background marker. Every pane renders as a
        * child of this element, so a pointerdown whose target IS this element
        * struck bare canvas — a deliberate deselect. The gesture interpreter
        * matches on target identity, not containment, so a click that merely
        * misses every pane (a portal gap, an overlay seam, geometry below the
        * fold) does not deselect.
        */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={containerRef}
        style={{ position: "absolute", inset: 0 }}
        {...{ [CANVAS_BACKGROUND_ATTRIBUTE]: "" }}
      >
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
            placement={placementFor(stackState)}
            lensSide={
              stackState.id === lensPaneId && lensSide !== null
                ? lensSide
                : undefined
            }
            isLensPane={stackState.id === lensPaneId}
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
