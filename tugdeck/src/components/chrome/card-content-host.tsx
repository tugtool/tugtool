/**
 * CardContentHost — renders a card's content component and owns the
 * per-card-content state (PropertyStore registration, persistence
 * callbacks, dirty/auto-save, per-card save callback, content-restore
 * effect, scroll/selection listeners, FeedStore subscriptions).
 *
 * The component lives at the deck level in the React tree; its DOM output
 * is portaled into the host stack's content `<div>` via `CardPortal`, so
 * React-tree position (and therefore identity) is stable across cross-stack
 * moves — the mechanism that preserves tide card sessions across detach /
 * merge / stack-to-stack moves.
 *
 * Render shape: wraps `registration.contentFactory(cardId)` in the four
 * per-content context providers (`TugcardDataProvider`,
 * `TugcardPropertyContext`, `TugcardPersistenceContext`,
 * `TugcardDirtyContext`) plus a re-bridged `TugcardPortalContext`
 * (looked up from `stack-root-registry`) and a responder scope keyed by
 * the card's id so `setProperty` dispatches via `sendToTarget(cardId, ...)`
 * resolve here.
 *
 * @module components/chrome/card-content-host
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { TugcardDataProvider } from "../tugways/hooks/use-tugcard-data";
import { TugcardPropertyContext } from "../tugways/hooks/use-property-store";
import { TugcardPersistenceContext, type TugcardPersistenceCallbacks } from "../tugways/use-tugcard-persistence";
import { TugcardDirtyContext, TugcardPortalContext } from "../tugways/tug-card";
import { useResponder } from "../tugways/use-responder";
import type { ActionEvent } from "../tugways/responder-chain";
import { TUG_ACTIONS } from "../tugways/action-vocabulary";
import { useDeckManager } from "../../deck-manager-context";
import { selectionGuard } from "../tugways/selection-guard";
import type { SavedSelection } from "../tugways/selection-guard";
import { getRegistration, presentWorkspaceKey } from "../../card-registry";
import { FeedStore, type FeedStoreFilter } from "../../lib/feed-store";
import { getConnection } from "../../lib/connection-singleton";
import { useCardWorkspaceKey } from "../tugways/hooks/use-card-workspace-key";
import type { PropertyStore } from "../tugways/property-store";
import type { TabStateBag } from "../../layout-tree";
import * as cardContentRegistry from "./card-content-registry";
import * as stackRootRegistry from "./stack-root-registry";
import { CardPortal } from "./card-portal";

const AUTO_SAVE_DEBOUNCE_MS = 1000;

export interface CardContentHostProps {
  /** Stable identity of this tab (aka the card's content identity). */
  tabId: string;
  /** The card currently hosting this tab. Used to locate the content element and for the workspace binding. */
  hostCardId: string;
  /** The registry componentId that produces this tab's content via `contentFactory`. */
  componentId: string;
  /**
   * Whether this tab is the active tab within its host card. When false, the
   * content mounts and stays alive but is hidden via `display: none` so that
   * identity (React state, session connections, scroll position) survives
   * across tab switches and cross-card moves. Defaults to `true`; callers
   * that render all tabs concurrently (DeckCanvas after Piece 1.iii) pass
   * the correct flag.
   */
  isActive?: boolean;
}

/**
 * Look up the host card's content element from the registry, reactively:
 * re-fires when the element is registered, replaced, or unregistered.
 */
function useHostContentElement(hostCardId: string): HTMLDivElement | null {
  return useSyncExternalStore(
    (cb) => cardContentRegistry.subscribe(hostCardId, cb),
    () => cardContentRegistry.getElement(hostCardId),
    () => null,
  );
}

/**
 * Look up the host stack's root element from the stack-root-registry,
 * reactively. Used to bridge `TugcardPortalContext` — card content needs
 * access to its host stack's root `<div>` for sheets and tooltips that
 * portal into it, and CardContentHost cannot consume the provider
 * directly because it lives outside Tugcard's React tree.
 */
function useHostStackRootElement(hostCardId: string): HTMLDivElement | null {
  return useSyncExternalStore(
    (cb) => stackRootRegistry.subscribe(hostCardId, cb),
    () => stackRootRegistry.getElement(hostCardId),
    () => null,
  );
}

export function CardContentHost({ tabId, hostCardId, componentId, isActive = true }: CardContentHostProps): React.ReactElement | null {
  const store = useDeckManager();
  const registration = getRegistration(componentId);
  const hostContentEl = useHostContentElement(hostCardId);
  const hostCardRootEl = useHostStackRootElement(hostCardId);

  // ---- PropertyStore registration ----
  //
  // The card content's PropertyStore is held in a ref and consumed by the
  // tab-level responder's `setProperty` handler below. No registry
  // indirection — sendToTarget(cardId) resolves to this responder directly.
  const propertyStoreRef = useRef<PropertyStore | null>(null);
  const registerPropertyStore = useCallback(
    (ps: PropertyStore) => {
      propertyStoreRef.current = ps;
    },
    [],
  );

  // ---- Persistence callbacks ----
  const persistenceCallbacksRef = useRef<TugcardPersistenceCallbacks | null>(null);
  const registerPersistenceCallbacks = useCallback(
    (callbacks: TugcardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;
    },
    [],
  );

  // ---- saveCurrentTabState (keyed by our tabId) ----
  //
  // Written fresh every render so closures captured by registered callbacks
  // never go stale — mirrors the pattern Tugcard used before this lift.
  const saveCurrentTabStateRef = useRef<() => void>(() => {});
  saveCurrentTabStateRef.current = () => {
    const contentEl = hostContentEl;
    const scroll = contentEl
      ? { x: contentEl.scrollLeft, y: contentEl.scrollTop }
      : undefined;

    const selection = selectionGuard.saveSelection(hostCardId);
    const content = persistenceCallbacksRef.current?.onSave();

    const bag: TabStateBag = {
      ...(scroll !== undefined ? { scroll } : {}),
      ...(selection !== null ? { selection } : {}),
      ...(content !== undefined ? { content } : {}),
    };

    store.setTabState(tabId, bag);
  };

  // ---- Register save callback keyed by tabId ----
  useLayoutEffect(() => {
    store.registerSaveCallback(tabId, () => saveCurrentTabStateRef.current());
    return () => {
      store.unregisterSaveCallback(tabId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, store]);

  // ---- Auto-save debounce ----
  const autoSaveTimerRef = useRef<number | null>(null);
  const markDirty = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      saveCurrentTabStateRef.current();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }, []);

  // ---- Scroll + selectionchange listeners (on host card's content element) ----
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

  // ---- Content restore on mount (replicates Tugcard's former restore path) ----
  const pendingScrollRef = useRef<{ x: number; y: number } | null>(null);
  const pendingSelectionRef = useRef<SavedSelection | null>(null);
  useLayoutEffect(() => {
    const bag = store.getTabState(tabId);
    if (!bag || (bag.scroll === undefined && bag.selection == null && bag.content === undefined)) return;

    const contentEl = hostContentEl;

    const hasPersistence =
      persistenceCallbacksRef.current !== null &&
      persistenceCallbacksRef.current.restorePendingRef !== undefined &&
      bag.content !== undefined;

    if (hasPersistence) {
      pendingScrollRef.current = bag.scroll ?? null;
      pendingSelectionRef.current = bag.selection ?? null;

      let didHide = false;
      if (contentEl && bag.scroll !== undefined) {
        contentEl.style.visibility = "hidden";
        didHide = true;
      }

      persistenceCallbacksRef.current!.onContentReady = () => {
        if (contentEl && pendingScrollRef.current !== null) {
          contentEl.scrollLeft = pendingScrollRef.current.x;
          contentEl.scrollTop = pendingScrollRef.current.y;
        }
        if (didHide && contentEl) {
          contentEl.style.visibility = "";
        }
        if (pendingSelectionRef.current != null) {
          selectionGuard.restoreSelection(hostCardId, pendingSelectionRef.current);
        }
        pendingScrollRef.current = null;
        pendingSelectionRef.current = null;
      };

      persistenceCallbacksRef.current!.restorePendingRef!.current = true;
      persistenceCallbacksRef.current!.onRestore(bag.content!);

      return () => {
        if (persistenceCallbacksRef.current?.restorePendingRef) {
          persistenceCallbacksRef.current.restorePendingRef.current = false;
        }
        pendingScrollRef.current = null;
        pendingSelectionRef.current = null;
        if (didHide && contentEl) {
          contentEl.style.visibility = "";
        }
      };
    } else {
      if (contentEl && bag.scroll !== undefined) {
        contentEl.scrollLeft = bag.scroll.x;
        contentEl.scrollTop = bag.scroll.y;
      }
      if (bag.selection != null) {
        selectionGuard.restoreSelection(hostCardId, bag.selection);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, hostCardId]);

  // ---- Feed store (per componentId's feedIds, filtered by workspace) ----
  const feedIds = useMemo(() => registration?.defaultFeedIds ?? [], [registration]);
  const workspaceKey = useCardWorkspaceKey(hostCardId);
  const workspaceFilter: FeedStoreFilter = useMemo(
    () =>
      workspaceKey
        ? (_feedId, decoded) =>
            typeof decoded === "object" &&
            decoded !== null &&
            "workspace_key" in decoded &&
            (decoded as { workspace_key: unknown }).workspace_key === workspaceKey
        : presentWorkspaceKey,
    [workspaceKey],
  );

  const feedStoreRef = useRef<FeedStore | null>(null);
  if (feedStoreRef.current === null && feedIds.length > 0) {
    const conn = getConnection();
    if (conn !== null) {
      feedStoreRef.current = new FeedStore(conn, feedIds, undefined, workspaceFilter);
    }
  }

  useEffect(() => {
    feedStoreRef.current?.setFilter(workspaceFilter);
  }, [workspaceFilter]);

  const noopSubscribe = useRef((_listener: () => void) => () => {}).current;
  const emptyMapRef = useRef(new Map<number, unknown>());
  const emptySnapshot = useRef(() => emptyMapRef.current).current;

  const feedData = useSyncExternalStore(
    feedStoreRef.current?.subscribe ?? noopSubscribe,
    feedStoreRef.current?.getSnapshot ?? emptySnapshot,
  );

  useEffect(() => {
    return () => {
      feedStoreRef.current?.dispose();
      feedStoreRef.current = null;
    };
  }, []);

  const feedsReady = feedIds.length === 0 || feedData.size > 0;

  // ---- Tab-level responder (handles setProperty routed by tabId) ----
  //
  // Gallery cards (observable-props) dispatch `setProperty` via
  // `manager.sendToTarget(cardId, ...)`, where `cardId` is the stable id
  // passed to their `contentFactory` — which, post-Piece 1.iii, is
  // `tabId`. Register a responder with id=tabId here so those dispatches
  // resolve to this host and write through to the content's PropertyStore.
  const { ResponderScope, responderRef } = useResponder({
    id: tabId,
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
  // card's `tugcard-content` div. The portal's stable-slot pattern preserves
  // identity when the portal re-roots to a different host card — the
  // mechanism that keeps tide card sessions alive across detach/merge.
  //
  // Non-active tabs within a card are hidden via `display: none` on the
  // wrapper so all tabs remain mounted (identity survives tab switches too)
  // without affecting layout.
  return (
    <CardPortal hostCardId={hostCardId}>
      <div
        ref={responderRef}
        data-card-content-host
        data-tab-id={tabId}
        style={{
          display: isActive ? "contents" : "none",
        }}
      >
        <TugcardPortalContext value={hostCardRootEl}>
          <ResponderScope>
            <TugcardDataProvider feedData={feedData}>
              <TugcardPropertyContext value={registerPropertyStore}>
                <TugcardPersistenceContext value={registerPersistenceCallbacks}>
                  <TugcardDirtyContext value={markDirty}>
                    {feedsReady ? (
                      // Pass `tabId` as the stable identity for content.
                      // Consumers (tide, gallery observable-props) key their
                      // per-content state (session bindings, property stores,
                      // responder target ids) off this value. `tabId` survives
                      // detach/merge; `hostCardId` changes when the tab moves
                      // between stacks.
                      registration.contentFactory(tabId)
                    ) : (
                      <div className="tugcard-loading" data-testid="tugcard-loading">
                        Loading...
                      </div>
                    )}
                  </TugcardDirtyContext>
                </TugcardPersistenceContext>
              </TugcardPropertyContext>
            </TugcardDataProvider>
          </ResponderScope>
        </TugcardPortalContext>
      </div>
    </CardPortal>
  );
}
