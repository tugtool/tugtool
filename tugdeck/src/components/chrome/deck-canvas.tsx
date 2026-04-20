/**
 * DeckCanvas -- canvas shell with responder chain support and StackFrame rendering
 * from DeckState (Phase 5).
 *
 * Phase 3: Registers as root responder "deck-canvas" via useResponder.
 *          Handles canvas-level actions: cycleCard, resetLayout, showSettings,
 *          showComponentGallery. DeckCanvas auto-becomes the first responder when
 *          it registers as a root node (parentId null, per Spec S01 auto-first-
 *          responder behavior), so Ctrl+` works immediately after mount with no
 *          explicit makeFirstResponder call.
 *
 * Phase 5 (Spec S06, Spec S07): Receives DeckState + stable callbacks from
 *          DeckManager via props. Maps deckState.cards to StackFrame components.
 *          For each card, looks up the registry to obtain the Tugcard factory.
 *          Cards with unregistered componentIds are skipped (warning logged).
 *          Z-index by array position: first card = lowest, last card = highest.
 *          forwardRef / DeckCanvasHandle removed -- DeckManager drives via props.
 *
 * Phase 5a2 (Spec S04, [D01], [D04]):
 *          DeckCanvas reads deckState via useSyncExternalStore from the
 *          DeckManagerContext store. Props deckState / onCardMoved /
 *          onCardClosed / onCardFocused are removed. DeckCanvasProps now
 *          contains only `connection`. The store variable is named `store`
 *          (not `manager`) to avoid collision with the existing `manager`
 *          variable used for the ResponderChainManager via
 *          useRequiredResponderChain().
 *
 * Phase 5b3 (Step 6, [D05], [D06], [D07]):
 *          Floating ComponentGallery panel removed. showComponentGallery now
 *          uses a galleryCardIdRef to find-or-create the gallery card via
 *          store.addCard("gallery-buttons"). Show-only semantics: the gallery
 *          is never closed by showComponentGallery -- only focused if already
 *          present ([D07]). The onClose callback clears galleryCardIdRef when
 *          the user explicitly closes the card (defense-in-depth). The Mac
 *          menu show-component-gallery action now dispatches through the
 *          responder chain manager (registerGallerySetter removed from
 *          action-dispatch).
 *
 * Hook order (rules-of-hooks compliant):
 *   useDeckManager -> useSyncExternalStore -> useState -> useRef ->
 *   useRequiredResponderChain -> useCallback -> useResponder ->
 *   useEffect (cardDragCoordinator init) -> useEffect (initial focused card restore) ->
 *   useLayoutEffect (startup overlay fade-out) ->
 *   useLayoutEffect (selection highlight sync)
 *
 * The canvas div with grid background is provided by #deck-container in
 * index.html and styled by globals.css. DeckCanvas renders inside it.
 *
 * Spec S03 (#s03-deckcanvas-shape), [D03] Keep disconnect banner
 * Spec S04 (#s04-canvas-props), Spec S04 (#s04-gallery-panel), Spec S05 (#s05-gallery-action)
 * Spec S06 (#deckcanvas-props), Spec S07 (#tugcard-visual-stack)
 * [D01] DeckManager is a subscribable store with one root.render() at mount
 * [D04] DeckCanvas reads state from store, not props
 * [D05] Focus logic in DeckCanvas
 * [D06] Remove floating panel infrastructure
 * [D07] Show-only semantics
 * [D07] ResponderChainProvider wraps DeckCanvas only
 * Table T01: cycleCard, resetLayout, showSettings, showComponentGallery
 */

import React, { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore, useLayoutEffect } from "react";
import { animate } from "@/components/tugways/tug-animator";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { Tugcard } from "@/components/tugways/tug-card";
import { StackFrame } from "./stack-frame";
import { CardContentHost } from "./card-content-host";
import { getRegistration, getSizePolicy } from "@/card-registry";
import type { CardState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { cardDragCoordinator } from "@/card-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";

// ---- DeckCanvasProps (Spec S04) ----

/**
 * DeckCanvasProps after Phase 5a2 migration (Spec S04).
 *
 * deckState, onCardMoved, onCardClosed, and onCardFocused are removed --
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
 * DeckCanvas -- plain function component (Phase 5 removes forwardRef).
 *
 * Renders the responder-chain root and one StackFrame per card in deckState.
 *
 * State is read from DeckManagerContext via useSyncExternalStore -- no
 * deckState prop. The variable `store` holds the IDeckManagerStore instance;
 * `manager` continues to hold the ResponderChainManager (unchanged).
 */
export function DeckCanvas(_props: DeckCanvasProps) {
  // ---- Store subscription ([D04], Spec S04) ----
  // Named `store` (not `manager`) to avoid collision with the ResponderChainManager
  // variable below.
  const store = useDeckManager();
  const deckState = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const cards = deckState.cards;

  // ---------------------------------------------------------------------------
  // Stable render order
  // ---------------------------------------------------------------------------
  // Cards are rendered in a stable order (sorted by ID) so that focusCard
  // reordering the store array only changes z-index values -- React never
  // calls insertBefore to move DOM nodes. This preserves the browser's
  // pointer->click event sequence when clicking interactive elements on
  // unfocused cards (the synchronous onCardFocused on pointerdown updates
  // z-index before click fires, so the card is already focused).
  //
  // Z-index comes from each card's position in the *store* array (focus
  // order), not from the stable render order.

  const { sortedCards, zIndexMap } = useMemo(() => {
    const map = new Map<string, number>();
    cards.forEach((card, i) => map.set(card.id, CARD_ZINDEX_BASE + i));
    const sorted = [...cards].sort((a, b) => a.id.localeCompare(b.id));
    return { sortedCards: sorted, zIndexMap: map };
  }, [cards]);

  // ---------------------------------------------------------------------------
  // Visual focus
  // ---------------------------------------------------------------------------
  // Focus is derived from z-order: the last card in the array is the focused
  // card. A `deselected` flag allows explicitly clearing focus (canvas click)
  // without changing z-order.

  const [deselected, setDeselected] = useState(false);

  // Focused card: last in array (highest z-index), unless explicitly deselected.
  const focusedCardId = deselected ? null : (cards.length > 0 ? cards[cards.length - 1].id : null);

  // ---------------------------------------------------------------------------
  // Refs for cycleCard closure (registered once on mount via useResponder)
  // ---------------------------------------------------------------------------
  // cycleCard is captured at mount time and never re-registered. All mutable
  // state it accesses must be via refs or stable values.
  // store.handleCardFocused is stable (bound once in DeckManager constructor),
  // so it can be called directly from the closure without a ref.

  const cardsRef = useRef<readonly CardState[]>(cards);
  cardsRef.current = cards;

  /**
   * galleryCardIdRef tracks the ID of the currently-open gallery card.
   *
   * showComponentGallery reads this ref to determine whether to create a new
   * gallery card or focus the existing one ([D07] show-only semantics).
   * The onClose callback for gallery cards clears this ref so that the next
   * showComponentGallery dispatch creates a fresh gallery card.
   *
   * [D05] Focus logic in DeckCanvas
   * [D06] Remove floating panel infrastructure
   * [D07] Show-only semantics (never close via showComponentGallery)
   */
  const galleryCardIdRef = useRef<string | null>(null);

  /**
   * containerRef: ref to the positioning wrapper div that card frames and snap guides
   * are rendered into. [D03, Spec S04]
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Thin adapter: card-frame's pointerdown → deck-wide activation.
  // The full choreography (z-order, responder chain, selection
  // guard notification, lifecycle observer broadcast) lives in
  // `deck.activateCard`. Deck-canvas only contributes its local
  // `setDeselected(false)` React state, subscribed below via
  // `observeCardDidActivate` (wildcard) so every activation path
  // — pointerdown, CYCLE_CARD, SHOW_COMPONENT_GALLERY, initial load —
  // clears the canvas deselect flag uniformly.
  const handleCardActivate = useCallback(
    (id: string) => {
      store.activateCard(id);
    },
    [store],
  );

  // Deck-canvas-local reaction to any card activation: clear the
  // canvas-background-click deselect flag. Subscribed on mount; the
  // initial-sync in observeCardDidActivate fires for the currently-
  // active card so the startup state is consistent.
  useLayoutEffect(() => {
    return store.observeCardDidActivate(null, () => {
      setDeselected(false);
    });
  }, [store]);

  // ---------------------------------------------------------------------------
  // Canvas background click: deselect all cards
  // ---------------------------------------------------------------------------

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only deselect when clicking the canvas background itself, not a card.
      // First-responder promotion is handled by the
      // ResponderChainProvider's document-level pointerdown listener
      // via data-responder-id; this handler is purely about the
      // canvas-deselect visual feedback.
      if (e.target === e.currentTarget) {
        setDeselected(true);
      }
    },
    [],
  );

  // Hook order: useDeckManager -> useSyncExternalStore -> useState -> useRef ->
  //             useRequiredResponderChain -> useCallback -> useResponder ->
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
        const c = cardsRef.current;
        if (c.length < 2) return;
        const nextId = c[0].id; // bottom card rotates to top
        // Single activation entry point: updates z-order, promotes
        // the key responder, fires deselect-clear + selection-guard
        // + tide-card focus via the observer pipe.
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
       * show-component-gallery -- find or create the gallery card ([D05], [D07]).
       *
       * Show-only semantics ([D07]): the gallery card is never closed by this
       * action. If a gallery card is already present (tracked via galleryCardIdRef),
       * it is focused. If not, a new gallery card is created via
       * store.addCard("gallery-buttons") and the returned ID is stored in
       * galleryCardIdRef. In both paths, makeFirstResponder is called so the
       * gallery takes responder focus immediately ([D05]).
       */
      [TUG_ACTIONS.SHOW_COMPONENT_GALLERY]: (_event: ActionEvent) => {
        const existingId = galleryCardIdRef.current;
        const c = cardsRef.current;

        // Check whether the tracked gallery card still exists in the store
        const existingCard = existingId ? c.find((card) => card.id === existingId) : null;

        if (existingCard) {
          // Gallery card already exists -- activate it ([D07] show-only,
          // never close). activateCard replaces the former three-line
          // sequence (focusCard + setDeselected + makeFirstResponder).
          store.activateCard(existingCard.id);
        } else {
          // No gallery card -- create one and activate.
          const newId = store.addCard("gallery-buttons");
          if (newId) {
            galleryCardIdRef.current = newId;
            store.activateCard(newId);
          }
        }
      },
      // add-tab-to-active-card: Add a new "hello" tab to the topmost card
      // (last in array). Reads cardsRef so the closure never goes stale.
      // If no cards exist, this is a no-op. The componentId "hello" is
      // intentionally hardcoded because it is the only registered card
      // type in Phase 5; parameterized componentId dispatch is deferred
      // until payload support is added.
      // [D06] Add-tab action uses DeckManager + responder chain
      // [D09] Add-tab routed as DeckCanvas responder action
      [TUG_ACTIONS.ADD_TAB_TO_ACTIVE_CARD]: (_event: ActionEvent) => {
        const c = cardsRef.current;
        if (c.length === 0) return;
        const focusedCard = c[c.length - 1]; // topmost card
        store.addTab(focusedCard.id, "hello");
      },
    },
  });

  // Provide the coordinator with the store reference so it can call
  // reorderTab / detachTab / mergeTab on drop. [D07, Spec S04]
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
    const cardExists = snapshot.cards.some((c) => c.id === focusedCardId);
    if (!cardExists) return;

    // Pass `null` as known-previous: the app just launched, no card
    // was previously active in this session. Without this the loaded
    // top-of-stack card would same-card-bail inside activateCard and
    // fire no will/didActivate — delegates waiting on activation
    // would miss the event on reload.
    store.activateCard(focusedCardId, null);
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
  // may already be absent. [D02, Spec S03, Phase 7c]
  // Startup overlay removed — the native window background (set from tugbank)
  // provides visual continuity while the WebView is hidden. The WebView is
  // revealed by frontendReady after the theme and layout are fully applied.

  // SelectionGuard highlight sync is handled by the guard's own
  // subscription to the card lifecycle (installed via
  // `selectionGuard.attach(lifecycle)` in ResponderChainProvider).
  // The deck-canvas no longer drives it from a focused-card effect;
  // the lifecycle's wildcard observer + initial-sync covers every
  // activation path without a coupled react-side effect.

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
      <div ref={responderRef} style={{ position: "absolute", inset: 0 }}>
      {/* Canvas background click target for deselecting cards */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        data-testid="deck-canvas-bg"
        onPointerDown={handleCanvasPointerDown}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      {/*
        * containerRef wrapper: positioning context for card frames, snap guides,
        * and SVG flash elements. Fills the full canvas area (position:absolute, inset:0).
        * [D03]
        */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {/* StackFrames (Spec S06, S07): one per card in deckState.cards.
          Rendered in stable ID order (no DOM reordering on focus change).
          Z-index from store array position (first = lowest). Cards with
          unregistered componentIds are skipped with a warning. */}
      {sortedCards.map((cardState) => {
        // Resolve active componentId: prefer the active tab, fall back to first tab.
        // This ensures the correct registration is used for header title/icon (D05).
        const componentId =
          cardState.tabs.find((t) => t.id === cardState.activeTabId)?.componentId ??
          cardState.tabs[0]?.componentId;
        if (!componentId) {
          console.warn(
            `[DeckCanvas] card "${cardState.id}" has no tabs -- skipping render.`,
          );
          return null;
        }

        const registration = getRegistration(componentId);
        if (!registration) {
          console.warn(
            `[DeckCanvas] card "${cardState.id}" references unregistered componentId "${componentId}" -- skipping render.`,
          );
          return null;
        }

        /**
         * onClose wrapper: when the closed card matches galleryCardIdRef.current,
         * clear the ref to null. This ensures that the next showComponentGallery
         * dispatch creates a fresh gallery card rather than looking for a card
         * that no longer exists (defense-in-depth, [D07]).
         */
        const handleClose = () => {
          if (galleryCardIdRef.current === cardState.id) {
            galleryCardIdRef.current = null;
          }
          // Card-type-agnostic per [L10]: tell the deck to remove the
          // card. Per-card-type cleanup (e.g. tide's `close_session`
          // wire frame) is wired at module scope in `main.tsx` —
          // CardServicesStore subscribes to deck-manager and reacts
          // to card-removal transitions on its own.
          store.handleCardClosed(cardState.id);
        };

        return (
          <StackFrame
            key={cardState.id}
            cardState={cardState}
            sizePolicy={getSizePolicy(componentId)}
            zIndex={zIndexMap.get(cardState.id) ?? CARD_ZINDEX_BASE}
            isFocused={cardState.id === focusedCardId}
            onCardMoved={store.handleCardMoved}
            onCardClosed={handleClose}
            onCardFocused={handleCardActivate}
            onCardCollapsed={(id) => store.toggleCardCollapse(id)}
            onCardMerged={(sourceCardId, targetCardId, insertIndex) => {
              // Resolve the active tab id from the source card at commit time.
              // store.mergeTab takes (sourceCardId, tabId, targetCardId, insertAtIndex).
              // [D45]
              const snapshot = store.getSnapshot();
              const sourceCard = snapshot.cards.find((c) => c.id === sourceCardId);
              if (!sourceCard) return;
              const tabId = sourceCard.activeTabId;
              store.mergeTab(sourceCardId, tabId, targetCardId, insertIndex);
            }}
            activeTabId={cardState.activeTabId}
            renderContent={(injected) => {
              // Tugcard renders card chrome only after Piece 1.iii: title
              // bar, tab bar (when multi-tab), and the content div. The
              // content div is the portal target for CardContentHost DOM
              // (see the flat CardContentHost list below). Tugcard's
              // `children` prop is unused in the DeckCanvas render path.
              const hasMultipleTabs = cardState.tabs.length > 1;
              return (
                <Tugcard
                  cardId={cardState.id}
                  meta={registration.defaultMeta}
                  feedIds={registration.defaultFeedIds ?? []}
                  tabs={hasMultipleTabs ? cardState.tabs : undefined}
                  activeTabId={cardState.activeTabId}
                  onClose={handleClose}
                  onDragStart={injected.onDragStart}
                  onMinSizeChange={injected.onMinSizeChange}
                  collapsed={injected.collapsed}
                  onCollapse={injected.onCollapse}
                  cardTitle={hasMultipleTabs ? cardState.title : undefined}
                  acceptedFamilies={hasMultipleTabs ? cardState.acceptsFamilies : undefined}
                >
                  {null}
                </Tugcard>
              );
            }}
          />
        );
      })}

      {/* Flat tab-content list: every tab across every card is mounted
          exactly once and routes its DOM via portal into its host card's
          content div. React keys by tabId so React preserves component
          identity when tabs move between cards (detach / merge) — the
          crux of Piece 1.iii. Non-active tabs render with `display: none`
          so they stay alive without affecting layout. Content factories
          and contexts live in CardContentHost; see card-content-host.tsx. */}
      {cards.flatMap((cardState) =>
        cardState.tabs.map((tab) => (
          <CardContentHost
            key={tab.id}
            tabId={tab.id}
            hostCardId={cardState.id}
            componentId={tab.componentId}
            isActive={tab.id === cardState.activeTabId}
          />
        )),
      )}
      </div>
      </div>
    </ResponderScope>
  );
}
