/**
 * DeckCanvas -- canvas shell with Component Gallery, responder chain support,
 * and CardFrame rendering from DeckState (Phase 5).
 *
 * Phase 2: Renders DisconnectBanner and optionally the ComponentGallery panel.
 *          Gallery visibility driven by show-component-gallery action via
 *          action-dispatch -- registerGallerySetter connects React state to
 *          the module-level gallerySetterRef.
 *
 * Phase 3: Registers as root responder "deck-canvas" via useResponder.
 *          Handles canvas-level actions: cycleCard, resetLayout, showSettings,
 *          showComponentGallery. DeckCanvas auto-becomes the first responder when
 *          it registers as a root node (parentId null, per Spec S01 auto-first-
 *          responder behavior), so Ctrl+` works immediately after mount with no
 *          explicit makeFirstResponder call.
 *
 *          The existing show-component-gallery action-dispatch handler (for Mac
 *          menu control frames) remains operational alongside the new responder
 *          chain action -- both converge on the same setGalleryVisible state setter.
 *
 * Phase 5 (Spec S06, Spec S07): Receives DeckState + stable callbacks from
 *          DeckManager via props. Maps deckState.cards to CardFrame components.
 *          For each card, looks up the registry to obtain the Tugcard factory.
 *          Cards with unregistered componentIds are skipped (warning logged).
 *          Z-index by array position: first card = lowest, last card = highest.
 *          Gallery renders above all cards (highest z-index).
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
 * Hook order (rules-of-hooks compliant):
 *   useDeckManager -> useSyncExternalStore -> useState -> useRef ->
 *   useRequiredResponderChain -> useCallback -> useState -> useResponder ->
 *   useEffect
 *
 * The canvas div with grid background is provided by #deck-container in
 * index.html and styled by globals.css. DeckCanvas renders inside it.
 *
 * Spec S03 (#s03-deckcanvas-shape), [D03] Keep disconnect banner
 * Spec S04 (#s04-canvas-props), Spec S04 (#s04-gallery-panel), Spec S05 (#s05-gallery-action)
 * Spec S06 (#deckcanvas-props), Spec S07 (#tugcard-visual-stack)
 * [D01] DeckManager is a subscribable store with one root.render() at mount
 * [D04] DeckCanvas reads state from store, not props
 * [D07] ResponderChainProvider wraps DeckCanvas only
 * Table T01: cycleCard, resetLayout, showSettings, showComponentGallery
 */

import React, { useCallback, useMemo, useState, useEffect, useRef, useSyncExternalStore } from "react";
import type { TugConnection } from "@/connection";
import { registerGallerySetter } from "@/action-dispatch";
import { useResponder } from "@/components/tugways/use-responder";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { Tugcard } from "@/components/tugways/tugcard";
import { DisconnectBanner } from "./disconnect-banner";
import { ComponentGallery } from "@/components/tugways/component-gallery";
import { CardFrame } from "./card-frame";
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

// ---- Gallery z-index base ----

/**
 * Z-index base for cards. Card at index i in deckState.cards gets
 * z-index CARD_ZINDEX_BASE + i. The gallery renders at GALLERY_ZINDEX
 * so it always floats above all cards.
 */
const CARD_ZINDEX_BASE = 1;
const GALLERY_ZINDEX = 1000;

// ---- DeckCanvas ----

/**
 * DeckCanvas -- plain function component (Phase 5 removes forwardRef).
 *
 * Renders the responder-chain root, the disconnect banner, the optional
 * component gallery, and one CardFrame per card in deckState.
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
  // reordering the store array only changes z-index values — React never
  // calls insertBefore to move DOM nodes. This preserves the browser's
  // pointer→click event sequence when clicking interactive elements on
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
  //             useRequiredResponderChain -> useCallback -> useState ->
  //             useResponder -> useEffect(gallery) -> useEffect(coordinator)

  // Gallery visibility state -- toggled by show-component-gallery action via
  // action-dispatch (Mac menu) and by the showComponentGallery responder action.
  const [galleryVisible, setGalleryVisible] = useState<boolean>(false);

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
      showComponentGallery: () => {
        setGalleryVisible((prev) => !prev);
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

  // Register the gallery setter with action-dispatch on mount so the
  // show-component-gallery Mac menu control frame handler can toggle this state.
  // This path remains operational alongside the responder chain action.
  useEffect(() => {
    registerGallerySetter(setGalleryVisible);
  }, []);

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

        return (
          <CardFrame
            key={cardState.id}
            cardState={cardState}
            zIndex={zIndexMap.get(cardState.id) ?? CARD_ZINDEX_BASE}
            isFocused={cardState.id === focusedCardId}
            onCardMoved={store.handleCardMoved}
            onCardClosed={store.handleCardClosed}
            onCardFocused={handleCardFocused}
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
                    onClose={() => store.handleCardClosed(cardState.id)}
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
                onClose: () => store.handleCardClosed(cardState.id),
              });
            }}
          />
        );
      })}

      {/* Gallery renders above all cards (Spec S07 higher z-index) */}
      {galleryVisible && (
        <div style={{ position: "relative", zIndex: GALLERY_ZINDEX }}>
          <ComponentGallery onClose={() => setGalleryVisible(false)} />
        </div>
      )}
    </ResponderScope>
  );
}
