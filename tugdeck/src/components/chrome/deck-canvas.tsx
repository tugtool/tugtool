/**
 * DeckCanvas -- canvas shell with responder chain support and TugWindow rendering
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
 *          DeckManager via props. Maps deckState.windows to TugWindow components.
 *          For each window, looks up the active card's registry entry for chrome metadata.
 *          Cards with unregistered componentIds are skipped (warning logged).
 *          Z-index by array position: first card = lowest, last card = highest.
 *          forwardRef / DeckCanvasHandle removed -- DeckManager drives via props.
 *
 * Phase 5a2 (Spec S04, [D01], [D04]):
 *          DeckCanvas reads deckState via useSyncExternalStore from the
 *          DeckManagerContext store. Props deckState / onCardMoved /
 *          onStackClosed / onStackActivated are removed. DeckCanvasProps now
 *          contains only `connection`. The store variable is named `store`
 *          (not `manager`) to avoid collision with the existing `manager`
 *          variable used for the ResponderChainManager via
 *          useRequiredResponderChain().
 *
 * Phase 5b3 (Step 6, [D05], [D06], [D07]):
 *          Floating ComponentGallery panel removed. showComponentGallery
 *          now walks the live snapshot for a `gallery-buttons` card, looks
 *          up its host stack, and activates it; if no gallery card exists,
 *          it creates one via `store.addCard("gallery-buttons")`. Show-only
 *          semantics: the gallery is never closed by showComponentGallery.
 *          The Mac menu show-component-gallery action dispatches through
 *          the responder chain manager.
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
import { TugWindow } from "./tug-window";
import { CardHost } from "./card-host";
import { getRegistration, getSizePolicy } from "@/card-registry";
import type { TugWindowState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { cardDragCoordinator } from "@/card-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";

// ---- DeckCanvasProps (Spec S04) ----

/**
 * DeckCanvasProps after Phase 5a2 migration (Spec S04).
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
 * DeckCanvas -- plain function component (Phase 5 removes forwardRef).
 *
 * Renders the responder-chain root and one TugWindow per entry in deckState.windows.
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
  const windows = deckState.windows;
  const cards = deckState.cards;

  // ---------------------------------------------------------------------------
  // Stable render order
  // ---------------------------------------------------------------------------
  // Stacks are rendered in a stable order (sorted by ID) so that focusCard
  // reordering the store array only changes z-index values -- React never
  // calls insertBefore to move DOM nodes. This preserves the browser's
  // pointer->click event sequence when clicking interactive elements on
  // unfocused stacks (the synchronous onStackActivated on pointerdown updates
  // z-index before click fires, so the stack is already focused).
  //
  // Z-index comes from each stack's position in the *store* array (focus
  // order), not from the stable render order.

  const { sortedStacks, zIndexMap } = useMemo(() => {
    const map = new Map<string, number>();
    windows.forEach((win, i) => map.set(win.id, CARD_ZINDEX_BASE + i));
    const sorted = [...windows].sort((a, b) => a.id.localeCompare(b.id));
    return { sortedStacks: sorted, zIndexMap: map };
  }, [windows]);

  // Build a cardId → hostStackId map so `CardHost` can look up its
  // host stack without re-scanning the stacks array on every render.
  const hostStackIdByCardId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of windows) {
      for (const cid of s.cardIds) map.set(cid, s.id);
    }
    return map;
  }, [windows]);

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
  // Focus is derived from z-order: the last stack in the array is the focused
  // stack, and its activeCardId is the focused card. A `deselected` flag
  // allows explicitly clearing focus (canvas click) without changing z-order.

  const [deselected, setDeselected] = useState(false);

  const focusedStackId = deselected
    ? null
    : windows.length > 0
      ? windows[windows.length - 1].id
      : null;

  // ---------------------------------------------------------------------------
  // Refs for cycleCard closure (registered once on mount via useResponder)
  // ---------------------------------------------------------------------------
  // cycleCard is captured at mount time and never re-registered. All mutable
  // state it accesses must be via refs or stable values.

  const windowsRef = useRef<readonly TugWindowState[]>(windows);
  windowsRef.current = windows;

  /**
   * containerRef: ref to the positioning wrapper div that card frames and snap guides
   * are rendered into. [D03, Spec S04]
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  // TugWindow's pointerdown fires with a window id. Resolve the window's
  // current `activeCardId` and route through `activateCard` — under the
  // 11.6.1b composite-bit model `_setFirstResponder` handles z-order
  // bumping, `activeWindowId` commit, focused-card persistence, and
  // lifecycle events atomically. A preceding `focusCard(cardId)` would
  // pre-mutate `activeWindowId`, making `_setFirstResponder` see a
  // same-bit call and short-circuit the will/didActivate events —
  // breaking prompt focus when clicking back to a previously-active
  // card.
  const handleStackActivate = useCallback(
    (windowId: string) => {
      const win = store.getSnapshot().windows.find((s) => s.id === windowId);
      if (!win) return;
      store.activateCard(win.activeCardId);
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
        const s = windowsRef.current;
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
          ? snapshot.windows.find((st) => st.cardIds.includes(galleryCard.id))
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
      // add-card-to-active-window: Add a new "hello" card to the active window
      // (last in array). Reads cardsRef so the closure never goes stale.
      // If no cards exist, this is a no-op. The componentId "hello" is
      // intentionally hardcoded because it is the only registered card
      // type in Phase 5; parameterized componentId dispatch is deferred
      // until payload support is added.
      // [D06] Add-tab action uses DeckManager + responder chain
      // [D09] Add-tab routed as DeckCanvas responder action
      [TUG_ACTIONS.ADD_CARD_TO_ACTIVE_WINDOW]: (_event: ActionEvent) => {
        const s = windowsRef.current;
        if (s.length === 0) return;
        const activeWindowId = s[s.length - 1].id; // topmost window (z-order)
        store.addCardToWindow(activeWindowId, "hello");
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
    const cardExists = snapshot.cards.some(
      (c) => c.id === focusedCardId,
    );
    if (!cardExists) return;

    // On mount, route through `activateCard` — `_setFirstResponder`
    // treats the layout blob's `activeWindowId` as the pre-existing
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
      {/* TugWindows: one per window in deckState.windows.
          Rendered in stable ID order (no DOM reordering on focus change).
          Z-index from store array position (first = lowest). Windows whose
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
          store.handleWindowClosed(stackState.id);
        };

        const stackCards = stackState.cardIds
          .map((cid) => cardsById.get(cid))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        const hasMultipleCards = stackCards.length > 1;

        return (
          <TugWindow
            key={stackState.id}
            stackState={stackState}
            meta={registration.defaultMeta}
            sizePolicy={getSizePolicy(componentId)}
            zIndex={zIndexMap.get(stackState.id) ?? CARD_ZINDEX_BASE}
            isFocused={stackState.id === focusedStackId}
            onCardMoved={store.handleWindowMoved}
            onClose={handleClose}
            onStackActivated={handleStackActivate}
            onCardCollapsed={(id) => store.toggleWindowCollapse(id)}
            onCardMerged={(sourceStackId, targetStackId, insertIndex) => {
              // Resolve the active card id from the source stack at commit time.
              const snapshot = store.getSnapshot();
              const sourceStack = snapshot.windows.find(
                (s) => s.id === sourceStackId,
              );
              if (!sourceStack) return;
              store.moveCardToWindow(
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
        const hostStack = windows.find((s) => s.id === hostStackId);
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
      </div>
    </ResponderScope>
  );
}
