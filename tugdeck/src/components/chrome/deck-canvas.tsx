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
 *   useEffect (tabDragCoordinator init) -> useEffect (initial focused card restore) ->
 *   useLayoutEffect (startup overlay fade-out) ->
 *   useLayoutEffect (selection highlight sync) -> useLayoutEffect (initial clip-path) ->
 *   useEffect (store subscriber for clip-path updates)
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
import { animate } from "@/components/tugways/tug-animator";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { useRequiredResponderChain } from "@/components/tugways/responder-chain-provider";
import { Tugcard } from "@/components/tugways/tug-card";
import { DisconnectBanner } from "./disconnect-banner";
import { CardFrame, updateSetAppearance } from "./card-frame";
import { getRegistration } from "@/card-registry";
import type { CardState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { tabDragCoordinator } from "@/tab-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";
import { styleInspectorBus } from "@/components/tugways/cards/style-inspector-card";

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
   * styleInspectorCardIdRef tracks the ID of the currently-open style inspector card.
   *
   * showStyleInspector reads this ref to determine whether to create a new
   * inspector card or focus the existing one ([D07] show-only semantics).
   * The onClose callback for inspector cards clears this ref so that the next
   * showStyleInspector dispatch creates a fresh inspector card.
   *
   * [D04] Show action pattern
   * [D07] Show-only semantics (never close via showStyleInspector)
   */
  const styleInspectorCardIdRef = useRef<string | null>(null);

  /**
   * containerRef: ref to the positioning wrapper div that card frames, snap guides,
   * and SVG flash elements are rendered into. Passed to updateSetAppearance for
   * initial-load clip-path and data-in-set setup. [D03, Spec S04]
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
  //             useEffect (tabDragCoordinator init) -> useEffect (initial focused card restore) ->
  //             useLayoutEffect (startup overlay fade-out) ->
  //             useLayoutEffect (selection highlight sync) -> useLayoutEffect (initial clip-path) ->
  //             useEffect (store subscriber for clip-path updates)

  // Register DeckCanvas as the root responder node.
  // Action handlers close over stable values only: refs, React state setters,
  // store instance (stable singleton), and the manager singleton.
  // DeckCanvas auto-becomes first responder on mount because parentId is null
  // and no first responder is set yet.
  const { ResponderScope } = useResponder({
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
      cycleCard: (_event: ActionEvent) => {
        const c = cardsRef.current;
        if (c.length < 2) return;
        const nextId = c[0].id; // bottom card rotates to top
        store.handleCardFocused(nextId); // z-order update (stable store method)
        setDeselected(false); // clear deselect flag (stable state setter)
        manager.makeFirstResponder(nextId); // responder chain focus
      },
      resetLayout: (_event: ActionEvent) => {
        // Phase 5 will reset card positions.
        console.log("resetLayout: stub -- not implemented until Phase 5");
      },
      showSettings: (_event: ActionEvent) => {
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
      showComponentGallery: (_event: ActionEvent) => {
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
            setDeselected(false);
            manager.makeFirstResponder(newId);
          }
        }
      },
      /**
       * showStyleInspector -- find or create the style inspector card ([D04], [D07]).
       *
       * Show-only semantics ([D07]): the inspector card is never closed by this
       * action. If an inspector card is already present (tracked via styleInspectorCardIdRef),
       * it is focused. If not, a new inspector card is created via
       * store.addCard("style-inspector") and the returned ID is stored in
       * styleInspectorCardIdRef. In both paths, makeFirstResponder is called so the
       * inspector takes responder focus immediately.
       */
      showStyleInspector: (_event: ActionEvent) => {
        const existingId = styleInspectorCardIdRef.current;
        const c = cardsRef.current;

        // Check whether the tracked inspector card still exists in the store
        const existingCard = existingId ? c.find((card) => card.id === existingId) : null;

        if (existingCard) {
          // Inspector card already exists -- focus it ([D07] show-only, never close)
          store.handleCardFocused(existingCard.id);
          setDeselected(false);
          manager.makeFirstResponder(existingCard.id);
        } else {
          // No inspector card -- create one
          const newId = store.addCard("style-inspector");
          if (newId) {
            styleInspectorCardIdRef.current = newId;
            setDeselected(false);
            manager.makeFirstResponder(newId);
          }
        }
      },
      /**
       * toggleStyleInspectorScan -- fire the styleInspectorBus toggle-scan event.
       *
       * This action is separate from showStyleInspector so that scan mode can be
       * toggled independently (e.g., via Opt+Cmd+E) without opening or focusing the
       * inspector card. Just fires the bus -- no card creation, no card focusing.
       */
      toggleStyleInspectorScan: (_event: ActionEvent) => {
        styleInspectorBus.emit("toggle-scan");
        return true;
      },
      // addTab: Add a new "hello" tab to the topmost card (last in array).
      // Reads cardsRef so the closure never goes stale. If no cards exist,
      // this is a no-op. The componentId "hello" is intentionally hardcoded
      // because it is the only registered card type in Phase 5; parameterized
      // componentId dispatch is deferred until payload support is added.
      // [D06] Add-tab action uses DeckManager + responder chain
      // [D09] Add-tab routed as DeckCanvas responder action
      addTab: (_event: ActionEvent) => {
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

  // Phase 5f: Focused card restoration after app reload ([D03]).
  //
  // On mount, read store.initialFocusedCardId (populated by the DeckManager
  // constructor from the tugbank-fetched focusedCardId). If the card still
  // exists in the deck:
  //   1. store.handleCardFocused(id) — update z-order so the card is top-most.
  //   2. setDeselected(false)        — clear the canvas deselect overlay.
  //   3. manager.makeFirstResponder(id) — route keyboard events to the card.
  // Then clear the field so this only fires once on mount.
  //
  // DeckManager cannot call makeFirstResponder directly (it is a plain class
  // without access to the responder chain). DeckCanvas has manager via
  // useRequiredResponderChain(), so focus restoration is delegated here ([D03]).
  //
  // Empty deps array: runs once on mount. store and manager are stable singletons.
  useEffect(() => {
    const focusedCardId = store.initialFocusedCardId;
    if (!focusedCardId) return;

    // Clear immediately so subsequent re-mounts (HMR, StrictMode) do not re-fire.
    store.initialFocusedCardId = undefined;

    const snapshot = store.getSnapshot();
    const cardExists = snapshot.cards.some((c) => c.id === focusedCardId);
    if (!cardExists) return;

    store.handleCardFocused(focusedCardId);
    setDeselected(false);
    manager.makeFirstResponder(focusedCardId);
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
  useLayoutEffect(() => {
    const overlay = document.getElementById("deck-startup-overlay");
    if (!overlay) return;
    const anim = animate(overlay, { opacity: [1, 0] }, {
      duration: "--tug-motion-duration-slow",
      easing: "cubic-bezier(0, 0, 0, 1)",
    });
    anim.finished.then(() => overlay.remove());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync SelectionGuard highlight state whenever the focused card changes.
  //
  // useLayoutEffect ensures the highlight swap happens before paint, so there is
  // no frame where the old card's selection shows active blue while the card is
  // visually unfocused. This single effect covers ALL focus-change paths:
  // pointer clicks (redundant with handlePointerDown's internal activateCard —
  // the second call is a no-op), keyboard shortcuts (Ctrl+`), card creation
  // (addCard), card close (focus shifts to next card), and initial restore.
  //
  // Rule 4: The appearance change is through the CSS Custom Highlight API (DOM),
  // not React state. This effect is only the trigger.
  useLayoutEffect(() => {
    if (focusedCardId) {
      selectionGuard.activateCard(focusedCardId);
    }
  }, [focusedCardId]);

  // Run updateSetAppearance once after initial mount so clip-path and data-in-set are
  // applied for any cards that are already in sets when the layout is first rendered. [D08, D03]
  useLayoutEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const canvasBounds = containerEl.getBoundingClientRect();
    updateSetAppearance(canvasBounds.width > 0 ? canvasBounds : null, containerEl);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to store mutations and update set appearance on every notification. [D03, S03]
  // This ensures clip-path and data-in-set stay current after card close, undo, and redo
  // without requiring a React re-render. The callback is a DOM side-effect (not a state
  // update), so useEffect + store.subscribe() is correct here — useSyncExternalStore is not
  // used because no React state is being read or derived. [D40 compliance]
  //
  // No gesture gating needed: updateSetAppearance now only writes clip-path and
  // data-in-set to existing elements (no DOM creation/removal), making it safe to call at
  // any time, including mid-gesture. [D05]
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
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
        * containerRef wrapper: positioning context for card frames, snap guides,
        * and SVG flash elements. Fills the full canvas area (position:absolute, inset:0).
        * The ref is used by updateSetAppearance for initial-load clip-path setup. [D03]
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
         * onClose wrapper: when the closed card matches galleryCardIdRef.current
         * or styleInspectorCardIdRef.current, clear the respective ref to null.
         * This ensures that the next showComponentGallery or showStyleInspector
         * dispatch creates a fresh card rather than looking for a card
         * that no longer exists (defense-in-depth, [D07]).
         */
        const handleClose = () => {
          if (galleryCardIdRef.current === cardState.id) {
            galleryCardIdRef.current = null;
          }
          if (styleInspectorCardIdRef.current === cardState.id) {
            styleInspectorCardIdRef.current = null;
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
              // Unified rendering path: DeckCanvas always constructs Tugcard
              // directly with all props. contentFactory provides the card-specific
              // content. This ensures every card — single-tab or multi-tab — gets
              // the same props (activeTabId, onClose, etc.) without cloneElement
              // injection or factory indirection.
              const hasMultipleTabs = cardState.tabs.length > 1;
              return (
                <Tugcard
                  cardId={cardState.id}
                  meta={registration.defaultMeta}
                  feedIds={registration.defaultFeedIds ?? []}
                  tabs={hasMultipleTabs ? cardState.tabs : undefined}
                  activeTabId={cardState.activeTabId}
                  onTabSelect={hasMultipleTabs ? (tabId) => store.setActiveTab(cardState.id, tabId) : undefined}
                  onTabClose={hasMultipleTabs ? (tabId) => store.removeTab(cardState.id, tabId) : undefined}
                  onTabAdd={hasMultipleTabs ? (cId) => store.addTab(cardState.id, cId) : undefined}
                  onClose={handleClose}
                  onDragStart={injected.onDragStart}
                  onMinSizeChange={injected.onMinSizeChange}
                  collapsed={injected.collapsed}
                  onCollapse={injected.onCollapse}
                  cardTitle={hasMultipleTabs ? cardState.title : undefined}
                  acceptedFamilies={hasMultipleTabs ? cardState.acceptsFamilies : undefined}
                >
                  {registration.contentFactory(cardState.id)}
                </Tugcard>
              );
            }}
          />
        );
      })}
      </div>
    </ResponderScope>
  );
}
