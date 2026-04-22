/**
 * CardHost — renders a card's content component and owns the
 * per-card state (PropertyStore registration, persistence callbacks,
 * dirty/auto-save, per-card save callback, content-restore effect,
 * scroll/selection listeners, FeedStore subscriptions).
 *
 * The component lives at the deck level in the React tree; its DOM output
 * is portaled into the host pane's content `<div>` via `CardPortal`, so
 * React-tree position (and therefore identity) is stable across cross-pane
 * moves — the mechanism that preserves tide card sessions across detach /
 * merge / pane-to-pane moves.
 *
 * Render shape: wraps `registration.contentFactory(cardId)` in the four
 * per-content context providers (`CardDataProvider`,
 * `CardPropertyContext`, `CardPersistenceContext`,
 * `CardDirtyContext`) plus a re-bridged `TugPanePortalContext`
 * (looked up from `pane-root-registry`) and a responder scope keyed by
 * the card's id so `setProperty` dispatches via `sendToTarget(cardId, ...)`
 * resolve here.
 *
 * @module components/chrome/card-host
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { CardDataProvider } from "../tugways/hooks/use-card-data";
import { CardPropertyContext } from "../tugways/hooks/use-property-store";
import { useCardPropertyStore } from "../tugways/hooks/use-card-property-store";
import { useCardFeedStore } from "../tugways/hooks/use-card-feed-store";
import { useCardContentRestore } from "../tugways/hooks/use-card-content-restore";
import { CardPersistenceContext, type CardPersistenceCallbacks } from "../tugways/use-card-persistence";
import { CardDirtyContext, TugPanePortalContext } from "./tug-pane";
import { useResponder } from "../tugways/use-responder";
import type { ActionEvent } from "../tugways/responder-chain";
import { TUG_ACTIONS } from "../tugways/action-vocabulary";
import { useDeckManager } from "../../deck-manager-context";
import { selectionGuard } from "../tugways/selection-guard";
import { getRegistration } from "../../card-registry";
import type { CardStateBag } from "../../layout-tree";
import * as paneContentRegistry from "./pane-content-registry";
import * as paneRootRegistry from "./pane-root-registry";
import { CardPortal } from "./card-portal";

const AUTO_SAVE_DEBOUNCE_MS = 1000;

export interface CardHostProps {
  /** Stable identity of this card — survives cross-pane moves. */
  cardId: string;
  /** The pane currently hosting this card. Used to locate the content element and for the workspace binding. */
  hostStackId: string;
  /** The registry componentId that produces this card's content via `contentFactory`. */
  componentId: string;
  /**
   * Whether this card is the active card within its host pane. When false,
   * the content mounts and stays alive but is hidden via `display: none` so
   * that identity (React state, session connections, scroll position)
   * survives across card switches and cross-pane moves. Defaults to `true`.
   */
  isActive?: boolean;
}

/**
 * Look up the host pane's content element from the registry, reactively:
 * re-fires when the element is registered, replaced, or unregistered.
 */
function useHostContentElement(hostStackId: string): HTMLDivElement | null {
  return useSyncExternalStore(
    (cb) => paneContentRegistry.subscribe(hostStackId, cb),
    () => paneContentRegistry.getElement(hostStackId),
    () => null,
  );
}

/**
 * Look up the host pane's root element from `pane-root-registry`,
 * reactively. Used to bridge `TugPanePortalContext` — card content needs
 * access to its host pane's root `<div>` for sheets and tooltips that
 * portal into it, and CardHost cannot consume the provider
 * directly because it lives outside the pane's React tree.
 */
function useHostStackRootElement(hostStackId: string): HTMLDivElement | null {
  return useSyncExternalStore(
    (cb) => paneRootRegistry.subscribe(hostStackId, cb),
    () => paneRootRegistry.getElement(hostStackId),
    () => null,
  );
}

export function CardHost({ cardId, hostStackId, componentId, isActive = true }: CardHostProps): React.ReactElement | null {
  const store = useDeckManager();
  const registration = getRegistration(componentId);
  const hostContentEl = useHostContentElement(hostStackId);
  const hostCardRootEl = useHostStackRootElement(hostStackId);

  // ---- PropertyStore registration ----
  //
  // The card content's PropertyStore is held in a ref and consumed by the
  // card-level responder's `setProperty` handler below. No registry
  // indirection — sendToTarget(cardId) resolves to this responder directly.
  const { register: registerPropertyStore, ref: propertyStoreRef } = useCardPropertyStore();

  // ---- Persistence callbacks ----
  const persistenceCallbacksRef = useRef<CardPersistenceCallbacks | null>(null);
  const registerPersistenceCallbacks = useCallback(
    (callbacks: CardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;
    },
    [],
  );

  // ---- saveCurrentCardState (keyed by our cardId) ----
  //
  // Written fresh every render so closures captured by registered callbacks
  // never go stale.
  const saveCurrentCardStateRef = useRef<() => void>(() => {});
  saveCurrentCardStateRef.current = () => {
    const contentEl = hostContentEl;
    const scroll = contentEl
      ? { x: contentEl.scrollLeft, y: contentEl.scrollTop }
      : undefined;

    const selection = selectionGuard.saveSelection(hostStackId);
    const content = persistenceCallbacksRef.current?.onSave();

    const bag: CardStateBag = {
      ...(scroll !== undefined ? { scroll } : {}),
      ...(selection !== null ? { selection } : {}),
      ...(content !== undefined ? { content } : {}),
    };

    store.setCardState(cardId, bag);
  };

  // ---- Register save callback keyed by cardId ----
  useLayoutEffect(() => {
    store.registerSaveCallback(cardId, () => saveCurrentCardStateRef.current());
    return () => {
      store.unregisterSaveCallback(cardId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, store]);

  // ---- Auto-save debounce ----
  const autoSaveTimerRef = useRef<number | null>(null);
  const markDirty = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveCurrentCardStateRef.current();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, []);

  // ---- Scroll + selectionchange listeners (on host stack's content element) ----
  useEffect(() => {
    const contentEl = hostContentEl;
    if (!contentEl) return;

    const handleScroll = () => markDirty();
    contentEl.addEventListener("scroll", handleScroll, { passive: true });

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const anchor = sel.anchorNode;
      if (anchor && contentEl.contains(anchor)) {
        markDirty();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      contentEl.removeEventListener("scroll", handleScroll);
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [hostContentEl, markDirty]);

  // ---- Content restore on mount ----
  useCardContentRestore({
    cardId,
    hostStackId,
    hostContentEl,
    persistenceCallbacksRef,
  });

  // ---- Feed store (per componentId's feedIds, filtered by workspace) ----
  const feedIds = useMemo(() => registration?.defaultFeedIds ?? [], [registration]);
  const feedData = useCardFeedStore(hostStackId, feedIds);
  const feedsReady = feedIds.length === 0 || feedData.size > 0;

  // ---- Card-level responder (handles setProperty routed by cardId) ----
  //
  // Gallery cards (observable-props) dispatch `setProperty` via
  // `manager.sendToTarget(cardId, ...)`, where `cardId` is the stable id
  // passed to their `contentFactory`. Register a responder with id=cardId
  // here so those dispatches resolve to this host and write through to the
  // content's PropertyStore.
  // CardHost is rendered at the deck level in the React tree
  // (flat `cards.map` in DeckCanvas) and portaled into its host window's
  // content div via CardPortal. Without an explicit parentId override
  // the responder node's parent would follow the React tree — pointing
  // at `deck-canvas` rather than at the host window's card responder — and
  // the chain walk from `firstResponderId = cardId` would skip every
  // window-level card handler. Passing `parentId: hostStackId` re-parents the
  // chain to match the portaled DOM layout so `NEXT_TAB` /
  // `PREVIOUS_TAB` / `CLOSE` / `JUMP_TO_TAB` reach the window's `TugPane` responder and
  // `FOCUS_PROMPT` finds a `kind="card"` node via `getKeyCard`.
  const { ResponderScope, responderRef } = useResponder({
    id: cardId,
    parentId: hostStackId,
    actions: {
      [TUG_ACTIONS.SET_PROPERTY]: (event: ActionEvent) => {
        const ps = propertyStoreRef.current;
        if (!ps) return;
        const payload = event.value as
          | { path: string; value: unknown; source?: string }
          | undefined;
        if (!payload || typeof payload.path !== "string") return;
        ps.set(payload.path, payload.value, payload.source ?? "inspector");
      },
    },
  });

  // ---- Render ----
  if (!registration) {
    return null;
  }

  // DOM output routes through `CardPortal` so children land inside the host
  // pane's `tug-pane-content` div. The portal's stable-slot pattern preserves
  // identity when the portal re-roots to a different host pane — the
  // mechanism that keeps tide card sessions alive across detach/merge.
  //
  // Non-active cards within a pane are hidden via `display: none` on the
  // wrapper so every card remains mounted (identity survives card switches
  // too) without affecting layout.
  return (
    <CardPortal hostStackId={hostStackId}>
      <div
        ref={responderRef}
        data-card-host
        data-card-id={cardId}
        style={{
          display: isActive ? "contents" : "none",
        }}
      >
        <TugPanePortalContext value={hostCardRootEl}>
          <ResponderScope>
            <CardDataProvider feedData={feedData}>
              <CardPropertyContext value={registerPropertyStore}>
                <CardPersistenceContext value={registerPersistenceCallbacks}>
                  <CardDirtyContext value={markDirty}>
                    {feedsReady ? (
                      // Pass `cardId` as the stable identity for content.
                      // Consumers (tide, gallery observable-props) key their
                      // per-content state (session bindings, property stores,
                      // responder target ids) off this value. `cardId` survives
                      // detach/merge; `hostStackId` changes when the card moves
                      // between windows.
                      registration.contentFactory(cardId)
                    ) : (
                      <div className="tug-pane-loading" data-testid="tug-pane-loading">
                        Loading...
                      </div>
                    )}
                  </CardDirtyContext>
                </CardPersistenceContext>
              </CardPropertyContext>
            </CardDataProvider>
          </ResponderScope>
        </TugPanePortalContext>
      </div>
    </CardPortal>
  );
}
