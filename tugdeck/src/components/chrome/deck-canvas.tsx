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
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugPane } from "./tug-pane";
import { CardHost } from "./card-host";
import { CanvasOverlayRoot } from "./canvas-overlay-root";
import { DeckCommitBeacon } from "./deck-commit-beacon";
import { usePaneFocusController } from "./pane-focus-controller";
import { getRegistration, getSizePolicy } from "@/card-registry";
import type { TugPaneState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { cardDragCoordinator } from "@/card-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";

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

// ---- DeckCanvas ----

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
    panes.forEach((pane, i) => map.set(pane.id, CARD_ZINDEX_BASE + i));
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

  /**
   * containerRef: ref to the positioning wrapper div that card frames and snap guides
   * are rendered into. [D03]
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Hook order: useDeckManager -> useSyncExternalStore -> useRef ->
  //             usePaneFocusController -> useRequiredResponderChain ->
  //             useCallback -> useResponder ->
  //             useEffect (cardDragCoordinator init) -> useEffect (initial focused card restore) ->
  //             useLayoutEffect (startup overlay fade-out) ->
  //             useLayoutEffect (selection highlight sync)

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
    actions: {
      [TUG_ACTIONS.CYCLE_CARD]: (_event: ActionEvent) => {
        const s = panesRef.current;
        if (s.length < 2) return;
        // Bottom stack rotates to top — activate its active card.
        const nextId = s[0].activeCardId;
        store.activateCard(nextId);
      },
      [TUG_ACTIONS.RESET_LAYOUT]: (_event: ActionEvent) => {
        // Phase 5 will reset card positions.
        console.log("reset-layout: stub -- not implemented until Phase 5");
      },
      [TUG_ACTIONS.SHOW_SETTINGS]: (_event: ActionEvent) => {
        // Phase 8 will open the settings panel.
        console.log("show-settings: stub -- not implemented until Phase 8");
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
          // Gallery stack already exists — activate its active card.
          // `activateCard` alone drives z-order, persistence, and lifecycle.
          store.activateCard(galleryStack.activeCardId);
        } else {
          // No gallery card anywhere — create one and activate its seed.
          const newCardId = store.addCard("gallery-buttons");
          if (newCardId) {
            store.activateCard(newCardId);
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
  // notifies lifecycle observers (selection guard, tide-card focus, etc.).
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
            sizePolicy={getSizePolicy(componentId)}
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
      </div>
    </ResponderScope>
  );
}
