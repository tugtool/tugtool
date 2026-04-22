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
 * `useCardPropertyStore`, `useCardDirtyState`, and `useCardFeedStore`.
 * The harness itself owns only the cross-cutting wiring:
 * `hostContentEl` / `hostCardRootEl` registry lookups, the per-card
 * `saveCurrentCardState` closure, persistence-callback registration,
 * the `registerSaveCallback(cardId, …)` binding into DeckManager, the
 * card-level responder that routes `SET_PROPERTY`, and the
 * context-provider tree wrapping the content factory.
 *
 * ## Restoration
 *
 * Restoration is trigger-driven, not React-dep-gated. Two deterministic
 * moments drive the two slices:
 *
 *   1. **Content restore** fires inside `registerPersistenceCallbacks`,
 *      synchronously when the child content component calls
 *      `register(callbacks)` from its own `useLayoutEffect`. The child's
 *      mount moment *is* the trigger: there is no effect dep array to
 *      re-evaluate, no version counter, no ref gate. For bags that
 *      carry content, the harness installs an `onContentReady` callback
 *      (applies scroll/selection once the child re-renders with
 *      restored state) and calls `onRestore(bag.content)`.
 *   2. **Scroll / selection restore** lives in a `useLayoutEffect`
 *      keyed on `[cardId, hostStackId, hostContentEl]`. It fires when
 *      the host element appears or changes (cross-pane move, pane
 *      re-registration). For content-less bags, this is the only
 *      restore path. For bags with content, this provides a best-effort
 *      pre-commit apply; `onContentReady` re-applies the correct clamp
 *      after the child commits. Both applications are idempotent.
 *
 * Neither path uses `persistenceCallbacksRef` as a dep — refs do not
 * trigger re-renders, and a dep array is not how we coordinate. The
 * trigger is the store callsite (register, or host-element change).
 *
 * @module components/chrome/card-host
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { CardDataProvider } from "../tugways/hooks/use-card-data";
import { CardPropertyContext } from "../tugways/hooks/use-property-store";
import { useCardPropertyStore } from "../tugways/hooks/use-card-property-store";
import { useCardFeedStore } from "../tugways/hooks/use-card-feed-store";
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

  // Refs for the latest `hostContentEl` and `hostStackId` so closures
  // installed in `registerPersistenceCallbacks` (onContentReady) read
  // current values at fire time, not mount-time captures. L07.
  const hostContentElRef = useRef<HTMLDivElement | null>(null);
  hostContentElRef.current = hostContentEl;
  const hostStackIdRef = useRef(hostStackId);
  hostStackIdRef.current = hostStackId;

  // Content restore is imperative and trigger-driven. The trigger is the
  // child calling `register(callbacks)` — its own `useLayoutEffect` is
  // the deterministic moment content restoration is safe. We do not gate
  // restore behind a React dep array because the prerequisites (host
  // element available, child registered) can arrive in any order and
  // React's reconciler is not the authority on "ready." This callback
  // owns only the content branch; scroll/selection live in the effect
  // below (keyed on host-element availability) and in the child-driven
  // `onContentReady` for the with-content case. L11, L22, L23.
  const registerPersistenceCallbacks = useCallback(
    (callbacks: CardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;

      const bag = store.getCardState(cardId);
      if (!bag || bag.content === undefined) return;
      // `callbacks.restorePendingRef` is absent on the no-op cleanup pair
      // installed by `useCardPersistence`'s cleanup. Skip that re-entry.
      if (callbacks.restorePendingRef === undefined) return;

      // Install onContentReady so scroll/selection are applied after the
      // child commits restored content — at that point the content's
      // dimensions are valid and scroll clamps correctly.
      callbacks.onContentReady = () => {
        const el = hostContentElRef.current;
        if (el) {
          if (bag.scroll !== undefined) {
            el.scrollLeft = bag.scroll.x;
            el.scrollTop = bag.scroll.y;
          }
          if (el.style.visibility === "hidden") {
            el.style.visibility = "";
          }
        }
        if (bag.selection != null) {
          selectionGuard.restoreSelection(
            hostStackIdRef.current,
            bag.selection,
          );
        }
      };
      // Pre-hide the host to mask the pre-restore scroll position while
      // the child re-renders with restored content.
      if (hostContentElRef.current && bag.scroll !== undefined) {
        hostContentElRef.current.style.visibility = "hidden";
      }

      callbacks.restorePendingRef.current = true;
      callbacks.onRestore(bag.content);
    },
    [cardId, store],
  );

  // Scroll / selection restore: triggered by `hostContentEl` becoming
  // available. Fires idempotently whenever the host element changes
  // (mount, cross-pane move, pane re-registration).
  //
  // **Scroll** applies regardless of content-case: for a no-content bag
  // this is the only restore path; for a with-content bag this is a
  // best-effort apply before the child commits, and `onContentReady`
  // re-applies the correct clamp after content renders.
  //
  // **Selection** applies ONLY in the no-content case here. For the
  // with-content case, `selectionGuard`'s `pathToNode` resolver needs
  // the child's restored DOM to exist before offsets can resolve — so
  // selection restoration rides `onContentReady` (sole owner) and this
  // effect skips it. Attempting selection restore here when content
  // will shortly re-render would fail to resolve (pre-commit DOM), or
  // worse, apply to a transient node and get clobbered by the
  // child's re-render. L22, L23.
  useLayoutEffect(() => {
    if (!hostContentEl) return;
    const bag = store.getCardState(cardId);
    if (!bag) return;
    if (bag.scroll !== undefined) {
      hostContentEl.scrollLeft = bag.scroll.x;
      hostContentEl.scrollTop = bag.scroll.y;
    }
    if (bag.content === undefined && bag.selection != null) {
      selectionGuard.restoreSelection(hostStackId, bag.selection);
    }
  }, [cardId, hostStackId, hostContentEl, store]);

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
