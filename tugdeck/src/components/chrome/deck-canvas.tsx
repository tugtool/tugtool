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
 *          onCardClosed / onStackActivated are removed. DeckCanvasProps now
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
import type { CardStackState } from "@/layout-tree";
import { useDeckManager } from "@/deck-manager-context";
import { cardDragCoordinator } from "@/card-drag-coordinator";
import { selectionGuard } from "@/components/tugways/selection-guard";

// ---- DeckCanvasProps (Spec S04) ----

/**
 * DeckCanvasProps after Phase 5a2 migration (Spec S04).
 *
 * deckState, onCardMoved, onCardClosed, and onStackActivated are removed --
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
  const stacks = deckState.stacks;
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
    stacks.forEach((stack, i) => map.set(stack.id, CARD_ZINDEX_BASE + i));
    const sorted = [...stacks].sort((a, b) => a.id.localeCompare(b.id));
    return { sortedStacks: sorted, zIndexMap: map };
  }, [stacks]);

  // Build a cardId → hostStackId map so `CardContentHost` can look up its
  // host stack without re-scanning the stacks array on every render.
  const hostStackIdByCardId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of stacks) {
      for (const cid of s.cardIds) map.set(cid, s.id);
    }
    return map;
  }, [stacks]);

  // ---------------------------------------------------------------------------
  // Visual focus
  // ---------------------------------------------------------------------------
  // Focus is derived from z-order: the last stack in the array is the focused
  // stack, and its activeCardId is the focused card. A `deselected` flag
  // allows explicitly clearing focus (canvas click) without changing z-order.

  const [deselected, setDeselected] = useState(false);

  const focusedStackId = deselected
    ? null
    : stacks.length > 0
      ? stacks[stacks.length - 1].id
      : null;

  // ---------------------------------------------------------------------------
  // Refs for cycleCard closure (registered once on mount via useResponder)
  // ---------------------------------------------------------------------------
  // cycleCard is captured at mount time and never re-registered. All mutable
  // state it accesses must be via refs or stable values.

  const stacksRef = useRef<readonly CardStackState[]>(stacks);
  stacksRef.current = stacks;

  /**
   * galleryStackIdRef tracks the ID of the stack that currently hosts the
   * gallery card.
   *
   * showComponentGallery reads this ref to determine whether to create a new
   * gallery card or focus the existing one ([D07] show-only semantics). The
   * onClose callback for the gallery stack clears this ref so the next
   * showComponentGallery dispatch creates a fresh gallery stack.
   */
  const galleryStackIdRef = useRef<string | null>(null);

  /**
   * containerRef: ref to the positioning wrapper div that card frames and snap guides
   * are rendered into. [D03, Spec S04]
   */
  const containerRef = useRef<HTMLDivElement | null>(null);

  // StackFrame's pointerdown fires with a stack id. Activation/focus
  // operate on a **card** id, so resolve the stack's current
  // `activeCardId` and drive both z-order and the lifecycle from it.
  // `focusCard` bumps the host stack to the top of the stacks array
  // (z-index) and persists `focusedCardId` for reload restoration;
  // `activateCard` fires will/didActivate through the lifecycle.
  // The order is z-order first, lifecycle second — observers reading
  // `getSnapshot()` in their callback see the stack already promoted.
  const handleStackActivate = useCallback(
    (stackId: string) => {
      const stack = store.getSnapshot().stacks.find((s) => s.id === stackId);
      if (!stack) return;
      const cardId = stack.activeCardId;
      store.focusCard(cardId);
      store.activateCard(cardId);
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
        const s = stacksRef.current;
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
        const existingStackId = galleryStackIdRef.current;
        const s = stacksRef.current;

        // Check whether the tracked gallery stack still exists in the store.
        const existingStack = existingStackId
          ? s.find((stack) => stack.id === existingStackId)
          : null;

        if (existingStack) {
          // Gallery stack already exists -- activate its active card
          // ([D07] show-only, never close).
          store.activateCard(existingStack.activeCardId);
        } else {
          // No gallery stack -- create one and activate the seeded card.
          const newCardId = store.addCard("gallery-buttons");
          if (newCardId) {
            const snapshot = store.getSnapshot();
            const hostStack = snapshot.stacks.find((st) =>
              st.cardIds.includes(newCardId),
            );
            if (hostStack) galleryStackIdRef.current = hostStack.id;
            store.activateCard(newCardId);
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
        const s = stacksRef.current;
        if (s.length === 0) return;
        const activeStackId = s[s.length - 1].id; // topmost stack
        store.addCardToStack(activeStackId, "hello");
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
      {/* StackFrames: one per stack in deckState.stacks.
          Rendered in stable ID order (no DOM reordering on focus change).
          Z-index from store array position (first = lowest). Stacks whose
          active card's componentId is unregistered are skipped with a
          warning. */}
      {sortedStacks.map((stackState) => {
        const cardsById = new Map(cards.map((c) => [c.id, c]));
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
         * galleryStackIdRef.current, clear the ref to null so the next
         * showComponentGallery dispatch creates a fresh gallery stack.
         */
        const handleClose = () => {
          if (galleryStackIdRef.current === stackState.id) {
            galleryStackIdRef.current = null;
          }
          store.handleCardClosed(stackState.id);
        };

        const stackCards = stackState.cardIds
          .map((cid) => cardsById.get(cid))
          .filter((c): c is NonNullable<typeof c> => c !== undefined);
        const hasMultipleCards = stackCards.length > 1;

        return (
          <StackFrame
            key={stackState.id}
            stackState={stackState}
            sizePolicy={getSizePolicy(componentId)}
            zIndex={zIndexMap.get(stackState.id) ?? CARD_ZINDEX_BASE}
            isFocused={stackState.id === focusedStackId}
            onCardMoved={store.handleStackMoved}
            onCardClosed={handleClose}
            onStackActivated={handleStackActivate}
            onCardCollapsed={(id) => store.toggleStackCollapse(id)}
            onCardMerged={(sourceStackId, targetStackId, insertIndex) => {
              // Resolve the active card id from the source stack at commit time.
              const snapshot = store.getSnapshot();
              const sourceStack = snapshot.stacks.find(
                (s) => s.id === sourceStackId,
              );
              if (!sourceStack) return;
              store.moveCardToStack(
                sourceStackId,
                sourceStack.activeCardId,
                targetStackId,
                insertIndex,
              );
            }}
            activeCardId={stackState.activeCardId}
            renderContent={(injected) => {
              return (
                <Tugcard
                  stackId={stackState.id}
                  meta={registration.defaultMeta}
                  feedIds={registration.defaultFeedIds ?? []}
                  cards={hasMultipleCards ? stackCards : undefined}
                  activeCardId={stackState.activeCardId}
                  onClose={handleClose}
                  onDragStart={injected.onDragStart}
                  onMinSizeChange={injected.onMinSizeChange}
                  collapsed={injected.collapsed}
                  onCollapse={injected.onCollapse}
                  cardTitle={hasMultipleCards ? stackState.title : undefined}
                  acceptedFamilies={
                    hasMultipleCards ? stackState.acceptsFamilies : undefined
                  }
                >
                  {null}
                </Tugcard>
              );
            }}
          />
        );
      })}

      {/* Flat card-content list: every card is mounted exactly once and
          routes its DOM via portal into its host stack's content div. React
          keys by cardId so React preserves component identity when a card
          moves between stacks (detach / merge). Non-active cards render
          with `display: none` so they stay alive without affecting layout.
          Content factories and contexts live in CardContentHost; see
          card-content-host.tsx. */}
      {cards.map((card) => {
        const hostStackId = hostStackIdByCardId.get(card.id);
        if (!hostStackId) return null;
        const hostStack = stacks.find((s) => s.id === hostStackId);
        return (
          <CardContentHost
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
