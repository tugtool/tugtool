/**
 * TabContentHost — renders a tab's content component and owns the
 * per-tab-content state that Tugcard used to own when Tugcard was both
 * card chrome and tab content in one component.
 *
 * Owns:
 *   - `PropertyStore` registration (published to the tab-property-store-registry
 *     so the card-level `setProperty` responder can resolve it by hostCardId).
 *   - `TugcardPersistenceCallbacks` registration (save/restore bag delegates).
 *   - `TugcardDirtyContext` markDirty + debounced auto-save timer.
 *   - Per-tab save callback registered on DeckManager keyed by `tabId`.
 *   - Scroll + selectionchange listeners on the host card's content element
 *     (looked up from `card-content-registry`).
 *   - Content restore `useLayoutEffect`: reads the per-tab bag and applies
 *     scroll/selection/content on mount.
 *   - `FeedStore` subscribed to `feedIds` from the component registration,
 *     with the card's workspace filter applied via `useCardWorkspaceKey`.
 *
 * Does NOT own (retained by Tugcard):
 *   - SelectionGuard boundary registration — keyed by `cardId`, coupled to
 *     the lifecycle delegate system which activates by cardId.
 *   - Card-level responder (close, tab-nav, select-tab, etc.).
 *   - Title bar / tab bar chrome.
 *
 * Render shape: wraps the content factory's output in the four per-content
 * context providers (`TugcardDataProvider`, `TugcardPropertyContext`,
 * `TugcardPersistenceContext`, `TugcardDirtyContext`), returning a plain
 * fragment so the host card's content area can wrap or portal it.
 *
 * Lifecycle:
 *   - Mounts when the active tab of a card changes to `tabId` (or when the
 *     card first appears with this tab active). Unmounts on tab switch away
 *     (Piece 1.ii) or when this tab is removed entirely (Piece 1.iii, once
 *     TabContentHost lives at the deck level with one per tab).
 *
 * @module components/chrome/tab-content-host
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { TugcardDataProvider } from "../tugways/hooks/use-tugcard-data";
import { TugcardPropertyContext } from "../tugways/hooks/use-property-store";
import { TugcardPersistenceContext, type TugcardPersistenceCallbacks } from "../tugways/use-tugcard-persistence";
import { TugcardDirtyContext } from "../tugways/tug-card";
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
import * as tabPropertyStoreRegistry from "./tab-property-store-registry";

const AUTO_SAVE_DEBOUNCE_MS = 1000;

export interface TabContentHostProps {
  /** Stable identity of this tab (aka the card's content identity). */
  tabId: string;
  /** The card currently hosting this tab. Used to locate the content element and for the workspace binding. */
  hostCardId: string;
  /** The registry componentId that produces this tab's content via `contentFactory`. */
  componentId: string;
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

export function TabContentHost({ tabId, hostCardId, componentId }: TabContentHostProps): React.ReactElement | null {
  const store = useDeckManager();
  const registration = getRegistration(componentId);
  const hostContentEl = useHostContentElement(hostCardId);

  // ---- PropertyStore registration ----
  const propertyStoreRef = useRef<PropertyStore | null>(null);
  const registerPropertyStore = useCallback(
    (ps: PropertyStore) => {
      propertyStoreRef.current = ps;
      tabPropertyStoreRegistry.register(hostCardId, ps);
    },
    [hostCardId],
  );

  // Publish/unpublish on mount/unmount so the card-level setProperty responder
  // can resolve the PropertyStore by hostCardId (see tug-card.tsx).
  useLayoutEffect(() => {
    const ps = propertyStoreRef.current;
    if (ps) tabPropertyStoreRegistry.register(hostCardId, ps);
    return () => {
      tabPropertyStoreRegistry.unregister(hostCardId);
    };
  }, [hostCardId]);

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

  // ---- Render ----
  if (!registration) {
    return null;
  }

  return (
    <TugcardDataProvider feedData={feedData}>
      <TugcardPropertyContext value={registerPropertyStore}>
        <TugcardPersistenceContext value={registerPersistenceCallbacks}>
          <TugcardDirtyContext value={markDirty}>
            {feedsReady ? (
              registration.contentFactory(hostCardId)
            ) : (
              <div className="tugcard-loading" data-testid="tugcard-loading">
                Loading...
              </div>
            )}
          </TugcardDirtyContext>
        </TugcardPersistenceContext>
      </TugcardPropertyContext>
    </TugcardDataProvider>
  );
}
