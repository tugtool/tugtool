/**
 * CardHost — wiring harness for a card's per-content state.
 *
 * CardHost lives at the deck level in the React tree; its DOM output
 * portals into the host pane's content `<div>` via `CardPortal`, so
 * React-tree position (and therefore identity) stays stable across
 * cross-pane moves — the mechanism that preserves tide card sessions
 * across detach / merge / pane-to-pane moves.
 *
 * Per-concern state is delegated to hooks under `tugways/hooks/`:
 * `useCardPropertyStore`, `useCardDirtyState`, `useCardContentRestore`,
 * and `useCardFeedStore`. The harness itself owns only the cross-cutting
 * wiring: `hostContentEl` / `hostCardRootEl` registry lookups, the
 * per-card `saveCurrentCardState` closure, persistence-callback
 * registration, the `registerSaveCallback(cardId, …)` binding into
 * DeckManager, the card-level responder that routes `SET_PROPERTY`, and
 * the context-provider tree wrapping the content factory.
 *
 * ## Hook call order
 *
 * The hooks fire their effects in call-order. The current pinned order
 * (which matches pre-extraction behavior) is:
 *
 *   1. harness `useLayoutEffect` — `registerSaveCallback(cardId, …)` so
 *      DeckManager's save path finds us before any save fires.
 *   2. `useCardDirtyState` — installs scroll + `selectionchange`
 *      listeners that call `markDirty`.
 *   3. `useCardContentRestore` — mount-time restore of scroll / selection
 *      / content payload; may install `onContentReady` on the
 *      persistence callbacks, which the child fires via its own
 *      `useLayoutEffect`.
 *   4. `useCardFeedStore` — subscribes to FeedStore frames.
 *
 * `useCardPropertyStore` is call-order-irrelevant for effects (it
 * returns a ref + a stable `register` fn only); its only constraint is
 * that it runs before the responder factory below reads its ref.
 *
 * Future hooks insert **after** `useCardFeedStore` unless they must run
 * before content-restore (in which case insert between steps 1 and 3).
 *
 * @module components/chrome/card-host
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { CardDataProvider } from "../tugways/hooks/use-card-data";
import { CardPropertyContext } from "../tugways/hooks/use-property-store";
import { useCardPropertyStore } from "../tugways/hooks/use-card-property-store";
import { useCardFeedStore } from "../tugways/hooks/use-card-feed-store";
import { useCardContentRestore } from "../tugways/hooks/use-card-content-restore";
import { useCardDirtyState } from "../tugways/hooks/use-card-dirty-state";
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

  const { register: registerPropertyStore, ref: propertyStoreRef } = useCardPropertyStore();

  const persistenceCallbacksRef = useRef<CardPersistenceCallbacks | null>(null);
  const registerPersistenceCallbacks = useCallback(
    (callbacks: CardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;
    },
    [],
  );

  // Rewritten every render so closures registered below read the latest
  // `hostContentEl` / `hostStackId` / `cardId` without stale capture.
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

  // Step 1 of the pinned hook order (see module header).
  useLayoutEffect(() => {
    store.registerSaveCallback(cardId, () => saveCurrentCardStateRef.current());
    return () => {
      store.unregisterSaveCallback(cardId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, store]);

  const markDirty = useCardDirtyState({
    hostContentEl,
    saveRef: saveCurrentCardStateRef,
  });

  useCardContentRestore({
    cardId,
    hostStackId,
    hostContentEl,
    persistenceCallbacksRef,
  });

  const feedIds = useMemo(() => registration?.defaultFeedIds ?? [], [registration]);
  const feedData = useCardFeedStore(hostStackId, feedIds);
  const feedsReady = feedIds.length === 0 || feedData.size > 0;

  // Card-level responder for `SET_PROPERTY` dispatched via
  // `manager.sendToTarget(cardId, …)`. `parentId: hostStackId` re-parents
  // the chain to the portaled DOM layout — without the override the
  // responder's parent would follow the React tree (pointing at
  // `deck-canvas`) and the chain walk from `firstResponderId = cardId`
  // would skip every pane-level handler.
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

  // `CardPortal` routes DOM output into the host pane's content div and
  // preserves identity across re-root. Non-active cards are hidden with
  // `display: none` so identity survives card switches without layout impact.
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
                      // `cardId` is the stable identity content factories key
                      // their per-card state off; it survives detach/merge
                      // whereas `hostStackId` changes on cross-pane moves.
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
