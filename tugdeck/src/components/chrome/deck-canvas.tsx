/**
 * DeckCanvas -- canvas shell with responder chain support and CardFrame rendering
 * from DeckState (Phase 5).
 *
 * Phase 2: Rendered DisconnectBanner and optionally the ComponentGallery panel.
 *          Gallery visibility driven by show-component-gallery action via
 *          action-dispatch -- registerGallerySetter connected React state to
 *          the module-level gallerySetterRef.
 *
 * Phase 3: Registers as root responder "deck-canvas" via useResponder.
 *          Handles canvas-level actions: cycleCard, resetLayout, showSettings,
 *          showComponentGallery. DeckCanvas auto-becomes the first responder when
 *          it registers as a root node (parentId null, per Spec S01 auto-first-
 *          responder behavior), so Ctrl+` works immediately after mount with no
 *          explicit makeFirstResponder call.
 *
 * Phase 5 (Spec S06, Spec S07): Receives DeckState + stable callbacks from
 *          DeckManager via props. Maps deckState.cards to CardFrame components.
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
 *   useEffect (tabDragCoordinator init) -> useLayoutEffect (initial shadow) ->
 *   useEffect (store subscriber for shadow updates)
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
import type { TugConnection } from "@/connection";
import { useResponder } from "@/components/tugways/use-responder";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { Tugcard } from "@/components/tugways/tugcard";
import { DisconnectBanner } from "./disconnect-banner";
import { CardFrame, updateSetAppearance, isGestureActive } from "./card-frame";
import { getRegistration } from "@/card-registry";
import type { CardState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { tabDragCoordinator } from "@/tab-drag-coordinator";

// ---- DeckCanvasProps (Spec S04) ----

/**
 * DeckCanvasProps after Phase 5a2 migration (Spec S04).
 *
 * deckState, onCardMoved, onCardClosed, and onCardFocused are removed --
 * DeckCanvas reads them from the DeckManagerContext store via
 * useSyncExternalStore. Only `connection` remains as a prop (for DisconnectBanner).
 */
export interface DeckCanvasProps {
  connection: TugConnection | null;
}

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
 * Renders the responder-chain root, the disconnect banner, and one CardFrame
 * per card in deckState.
 *
 * State is read from DeckManagerContext via useSyncExternalStore -- no
 * deckState prop. The variable `store` holds the IDeckManagerStore instance;
 * `manager` continues to hold the ResponderChainManager (unchanged).
 */
export function DeckCanvas({ connection }: DeckCanvasProps) {
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
   * containerRef: ref to the positioning wrapper div that card frames, shadow divs,
   * snap guides, and SVG flash elements are rendered into. Passed to updateSetAppearance
   * for initial-load hull shadow creation. [D03, Spec S04]
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Responder chain manager (stable singleton, safe in mount-time closure).
  // Named `manager` as before -- distinct from `store` (IDeckManagerStore).
  const manager = useRequiredResponderChain();

  // Bring card to front (z-order via store) and clear deselect flag.
  // Dependency is `store` -- a stable singleton from context.
  const handleCardFocused = useCallback(
    (id: string) => {
      store.handleCardFocused(id);
      setDeselected(false);
    },
    [store],
  );

  // ---------------------------------------------------------------------------
  // Canvas background click: deselect all cards
  // ---------------------------------------------------------------------------

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only deselect when clicking the canvas background itself, not a card.
      if (e.target === e.currentTarget) {
        setDeselected(true);
        manager.makeFirstResponder("deck-canvas");
      }
    },
    [manager],
  );

  // Hook order: useDeckManager -> useSyncExternalStore -> useState -> useRef ->
  //             useRequiredResponderChain -> useCallback -> useResponder ->
  //             useEffect (tabDragCoordinator) -> useLayoutEffect (initial shadows) ->
  //             useEffect (store subscriber for shadow updates)

  // Register DeckCanvas as the root responder node.
  // Action handlers close over stable values only: refs, React state setters,
  // store instance (stable singleton), and the manager singleton.
  // DeckCanvas auto-becomes first responder on mount because parentId is null
  // and no first responder is set yet.
  const { ResponderScope } = useResponder({
    id: "deck-canvas",
    actions: {
      cycleCard: () => {
        const c = cardsRef.current;
        if (c.length < 2) return;
        const nextId = c[0].id; // bottom card rotates to top
        store.handleCardFocused(nextId); // z-order update (stable store method)
        setDeselected(false); // clear deselect flag (stable state setter)
        manager.makeFirstResponder(nextId); // responder chain focus
      },
      resetLayout: () => {
        // Phase 5 will reset card positions.
        console.log("resetLayout: stub -- not implemented until Phase 5");
      },
      showSettings: () => {
        // Phase 8 will open the settings panel.
        console.log("showSettings: stub -- not implemented until Phase 8");
      },
      /**
       * showComponentGallery -- find or create the gallery card ([D05], [D07]).
       *
       * Show-only semantics ([D07]): the gallery card is never closed by this
       * action. If a gallery card is already present (tracked via galleryCardIdRef),
       * it is focused. If not, a new gallery card is created via
       * store.addCard("gallery-buttons") and the returned ID is stored in
       * galleryCardIdRef. In both paths, makeFirstResponder is called so the
       * gallery takes responder focus immediately ([D05]).
       */
      showComponentGallery: () => {
        const existingId = galleryCardIdRef.current;
        const c = cardsRef.current;

        // Check whether the tracked gallery card still exists in the store
        const existingCard = existingId ? c.find((card) => card.id === existingId) : null;

        if (existingCard) {
          // Gallery card already exists -- focus it ([D07] show-only, never close)
          store.handleCardFocused(existingCard.id);
          setDeselected(false);
          manager.makeFirstResponder(existingCard.id);
        } else {
          // No gallery card -- create one
          const newId = store.addCard("gallery-buttons");
          if (newId) {
            galleryCardIdRef.current = newId;
            manager.makeFirstResponder(newId);
          }
        }
      },
      // addTab: Add a new "hello" tab to the topmost card (last in array).
      // Reads cardsRef so the closure never goes stale. If no cards exist,
      // this is a no-op. The componentId "hello" is intentionally hardcoded
      // because it is the only registered card type in Phase 5; parameterized
      // componentId dispatch is deferred until payload support is added.
      // [D06] Add-tab action uses DeckManager + responder chain
      // [D09] Add-tab routed as DeckCanvas responder action
      addTab: () => {
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
    tabDragCoordinator.init(store);
  }, [store]);

  // Run updateSetAppearance once after initial mount so set hull shadows are drawn
  // for any cards that are already in sets when the layout is first rendered. [D08, D03]
  useLayoutEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const canvasBounds = containerEl.getBoundingClientRect();
    updateSetAppearance(canvasBounds.width > 0 ? canvasBounds : null, containerEl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to store mutations and rebuild set shadows on every notification. [D03, S03]
  // This ensures shadows stay current after card close, undo, and redo without requiring
  // a React re-render. The callback is a DOM side-effect (not a state update), so
  // useEffect + store.subscribe() is correct here — useSyncExternalStore is not used
  // because no React state is being read or derived. [D40 compliance]
  //
  // The isGestureActive() guard prevents updateSetAppearance from removing the shadow
  // element that is currently being translated by an active drag or resize gesture.
  // postActionSetUpdate (called at gesture-end) performs the authoritative rebuild
  // after the flag is cleared. [D03 Risk R02]
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      if (isGestureActive()) return; // skip while drag/resize owns shadow refs
      const containerEl = containerRef.current;
      if (!containerEl) return;
      const canvasBounds = containerEl.getBoundingClientRect();
      updateSetAppearance(canvasBounds.width > 0 ? canvasBounds : null, containerEl);
    });
    return unsubscribe;
  }, [store]);

  return (
    <ResponderScope>
      {/* Canvas background click target for deselecting cards */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        data-testid="deck-canvas-bg"
        onPointerDown={handleCanvasPointerDown}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      <DisconnectBanner connection={connection} />

      {/*
        * containerRef wrapper: positioning context for card frames, snap guides, hull shadows,
        * and SVG flash elements. Fills the full canvas area (position:absolute, inset:0).
        * The ref is used by updateSetAppearance for initial-load hull shadow creation. [D03]
        */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {/* CardFrames (Spec S06, S07): one per card in deckState.cards.
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
          store.handleCardClosed(cardState.id);
        };

        return (
          <CardFrame
            key={cardState.id}
            cardState={cardState}
            zIndex={zIndexMap.get(cardState.id) ?? CARD_ZINDEX_BASE}
            isFocused={cardState.id === focusedCardId}
            onCardMoved={store.handleCardMoved}
            onCardClosed={handleClose}
            onCardFocused={handleCardFocused}
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
              // Fork rendering based on tab count (Spec S05, D08).
              //
              // Single-tab path (tabs.length <= 1):
              //   Use the existing factory(cardId, injected) + cloneElement(element, { onClose })
              //   pattern unchanged. All existing single-tab cards continue to work.
              //
              // Multi-tab path (tabs.length > 1):
              //   Construct Tugcard directly, passing all tab props explicitly.
              //   This avoids nested Tugcards (D08) and avoids fragile cloneElement
              //   prop injection for tab props. contentFactory provides the active
              //   tab's content without the outer Tugcard chrome.
              if (cardState.tabs.length > 1) {
                return (
                  <Tugcard
                    cardId={cardState.id}
                    meta={registration.defaultMeta}
                    feedIds={registration.defaultFeedIds ?? []}
                    tabs={cardState.tabs}
                    activeTabId={cardState.activeTabId}
                    onTabSelect={(tabId) => store.setActiveTab(cardState.id, tabId)}
                    onTabClose={(tabId) => store.removeTab(cardState.id, tabId)}
                    onTabAdd={(cId) => store.addTab(cardState.id, cId)}
                    onClose={handleClose}
                    onDragStart={injected.onDragStart}
                    onMinSizeChange={injected.onMinSizeChange}
                    cardTitle={cardState.title}
                    acceptedFamilies={cardState.acceptsFamilies}
                  >
                    {registration.contentFactory?.(cardState.id) ?? null}
                  </Tugcard>
                );
              }

              // Single-tab path: unchanged factory + cloneElement injection.
              const element = registration.factory(cardState.id, injected);
              return React.cloneElement(element, {
                onClose: handleClose,
              });
            }}
          />
        );
      })}
      </div>
    </ResponderScope>
  );
}
