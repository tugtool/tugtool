/**
 * CardServicesStore — module-scope owner of per-card service bags.
 *
 * The Tide card needs a `CodeSessionStore`, an `EditorSettingsStore`,
 * and a couple of feed-store stacks. These have side effects on
 * construction (FeedStore subscribes to the wire, CodeSessionStore
 * registers an `onClose` on the connection). They cannot be created
 * during render and must outlive transient React effect re-runs.
 *
 * Earlier the lifecycle lived inside `useTideCardServices` as
 * `useState<services>` populated by a `useLayoutEffect` keyed on the
 * binding. That violated [L02] (no `useEffect` copying external state
 * into React state) and produced a class of bugs where services tore
 * themselves down on a binding-field update, sent a stray
 * `close_session` frame to the supervisor, and remounted the picker
 * mid-conversation.
 *
 * This store is the structure-zone source of truth ([L24]). It
 * subscribes to `cardSessionBindingStore` *once* at module init,
 * constructs services when a binding for a `cardId` appears, and
 * disposes services when the binding for that `cardId` disappears.
 * React reads the resulting map via `useSyncExternalStore` ([L02]) —
 * services have a stable identity across React re-renders for the
 * lifetime of the binding.
 *
 * The wire `close_session` frame is **not** sent from this store: it
 * is sent explicitly by the deck-canvas when the user closes a card
 * (see `closeCard` below). The store reacts to the resulting binding
 * clear and disposes; the resume-failed unbind path clears the
 * binding without going through `closeCard`, so no spurious close
 * frame is sent to a supervisor session that has already torn down.
 */

import { CodeSessionStore } from "./code-session-store";
import { EditorSettingsStore } from "./editor-settings-store";
import { SessionMetadataStore } from "./session-metadata-store";
import { FileTreeStore } from "./filetree-store";
import { FeedStore, type FeedStoreFilter } from "./feed-store";
import { FeedId } from "../protocol";
import type { CompletionProvider } from "./tug-text-engine";
import { getConnection } from "./connection-singleton";
import { getTugbankClient } from "./tugbank-singleton";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "./card-session-binding-store";
import { sendCloseSession } from "./session-lifecycle";
import {
  readTideRecentProjects,
  insertTideRecentProject,
  putTideRecentProjects,
} from "../settings-api";
import type { DeckManager } from "../deck-manager";

export interface CardServices {
  readonly codeSessionStore: CodeSessionStore;
  readonly editorStore: EditorSettingsStore;
  readonly sessionMetadataStore: SessionMetadataStore;
  readonly sessionMetadataFeedStore: FeedStore;
  readonly fileTreeStore: FileTreeStore;
  readonly fileTreeFeedStore: FeedStore;
  /**
   * The `@` file-completion provider. Captured once at construction
   * because each call to `FileTreeStore.getFileCompletionProvider()`
   * creates a new closure with its own dedup state — re-deriving it
   * per render would break query deduplication.
   */
  readonly fileCompletionProvider: CompletionProvider;
}

class CardServicesStore {
  private readonly _services = new Map<string, CardServices>();
  private readonly _listeners = new Set<() => void>();
  private _bindingUnsub: (() => void) | null = null;
  private _deckUnsub: (() => void) | null = null;
  private _knownCardIds = new Set<string>();
  private _initialized = false;

  /**
   * Subscribe to `cardSessionBindingStore` and reconcile once. Called
   * the first time anything reads from the store. Module-scope state
   * is created lazily so tests that don't construct any cards don't
   * pay for a wire connection or background subscriptions.
   */
  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;
    this._bindingUnsub = cardSessionBindingStore.subscribe(() => {
      this._reconcile();
    });
    this._reconcile();
  }

  /**
   * Wire the store to a `DeckManager` so it can detect card-removal
   * events and send `close_session` for any binding the removed card
   * holds. Called once from `main.tsx` after the deck-manager is
   * constructed. The deck-manager is the source of truth for
   * "card present in layout" — when a card transitions from
   * present → absent, this store reacts (per [L24]: structure-zone
   * stores observe layout changes that affect their own state).
   *
   * Without this wire, the wire `close_session` frame would have to
   * be sent by the deck-canvas's user-close handler — but that
   * makes the deck know about a tide-specific store, violating [L10]
   * (one responsibility per layer). With this wire, the deck-canvas
   * stays card-type-agnostic.
   */
  attachDeckManager(deckManager: DeckManager): void {
    if (this._deckUnsub) {
      this._deckUnsub();
      this._deckUnsub = null;
    }
    // Seed the known set with whatever the deck currently has so the
    // first diff doesn't fire "removed" for cards that were already
    // present at attach time.
    this._knownCardIds = new Set(
      deckManager.getSnapshot().cards.map((c) => c.id),
    );
    this._deckUnsub = deckManager.subscribe(() => {
      const current = new Set(
        deckManager.getSnapshot().cards.map((c) => c.id),
      );
      // Diff: any cardId that was known last time but isn't present
      // now has been removed by the deck. If that card holds a
      // binding, send `close_session` for it; the binding clear
      // triggers `_reconcile`'s dispose path.
      for (const id of this._knownCardIds) {
        if (!current.has(id)) {
          this._closeCardInternal(id);
        }
      }
      this._knownCardIds = current;
    });
  }

  /**
   * Diff `cardSessionBindingStore`'s current state against the
   * services map. Construct services for new bindings; dispose
   * services for vanished bindings. Notify React subscribers if
   * either map changed.
   */
  private _reconcile(): void {
    const bindings = cardSessionBindingStore.getSnapshot();
    let changed = false;

    // Construct for new bindings.
    for (const [cardId, binding] of bindings) {
      if (this._services.has(cardId)) continue;
      const services = this._construct(cardId, binding);
      if (services) {
        this._services.set(cardId, services);
        changed = true;
      }
    }

    // Dispose for vanished bindings.
    for (const cardId of [...this._services.keys()]) {
      if (bindings.has(cardId)) continue;
      this._dispose(cardId);
      changed = true;
    }

    if (changed) {
      for (const l of this._listeners) l();
    }
  }

  private _construct(cardId: string, binding: CardSessionBinding): CardServices | null {
    const connection = getConnection();
    if (!connection) {
      console.warn(
        "CardServicesStore: connection unavailable for cardId",
        cardId,
      );
      return null;
    }

    const codeSessionStore = new CodeSessionStore({
      conn: connection,
      tugSessionId: binding.tugSessionId,
    });
    const editorStore = new EditorSettingsStore();

    // Filter by workspace_key for feeds that carry it. SESSION_METADATA
    // does not carry workspace_key on the wire, so it stays unfiltered.
    // The workspace_key is set on the binding when the supervisor acks
    // and does not change for the lifetime of this services bag —
    // re-binds (close + reopen) get a fresh services bag.
    const workspaceFilter: FeedStoreFilter = (_feedId, decoded) =>
      typeof decoded === "object" &&
      decoded !== null &&
      "workspace_key" in decoded &&
      (decoded as { workspace_key: unknown }).workspace_key === binding.workspaceKey;

    const sessionMetadataFeedStore = new FeedStore(
      connection,
      [FeedId.SESSION_METADATA],
    );
    const sessionMetadataStore = new SessionMetadataStore(
      sessionMetadataFeedStore,
      FeedId.SESSION_METADATA,
    );

    const fileTreeFeedStore = new FeedStore(
      connection,
      [FeedId.FILETREE],
      undefined,
      workspaceFilter,
    );
    const fileTreeStore = new FileTreeStore(fileTreeFeedStore, FeedId.FILETREE);
    const fileCompletionProvider = fileTreeStore.getFileCompletionProvider();

    // Bind success → prepend this card's project path to the tide
    // recent-projects list (dedup, cap). Done here rather than in a
    // React effect so the side effect is co-located with services
    // construction; running it on every dep change of a React effect
    // would multiply-write the same path.
    const tugbank = getTugbankClient();
    if (tugbank) {
      const current = readTideRecentProjects(tugbank);
      const updated = insertTideRecentProject(current, binding.projectDir);
      if (updated[0] !== current[0] || updated.length !== current.length) {
        putTideRecentProjects(updated);
      }
    }

    return {
      codeSessionStore,
      editorStore,
      sessionMetadataStore,
      sessionMetadataFeedStore,
      fileTreeStore,
      fileTreeFeedStore,
      fileCompletionProvider,
    };
  }

  private _dispose(cardId: string): void {
    const services = this._services.get(cardId);
    if (!services) return;
    this._services.delete(cardId);
    services.codeSessionStore.dispose();
    services.sessionMetadataStore.dispose();
    services.sessionMetadataFeedStore.dispose();
    services.fileTreeStore.dispose();
    services.fileTreeFeedStore.dispose();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Subscribe to "any cardId's services entry changed" notifications.
   * Used by `useSyncExternalStore` in `useTideCardServices`.
   */
  subscribe = (listener: () => void): (() => void) => {
    this._ensureInitialized();
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /**
   * Read services for `cardId`, or `null` if no binding exists yet.
   * Called by `useSyncExternalStore`'s snapshot getter — must be
   * synchronous and reference-stable for unchanged values (the same
   * reference is returned across reads until `_reconcile` mutates the
   * map).
   */
  getServices = (cardId: string): CardServices | null => {
    this._ensureInitialized();
    return this._services.get(cardId) ?? null;
  };

  /**
   * Send `close_session` for the card's binding (if any), which
   * clears the binding and triggers `_reconcile` to dispose services.
   * Internal to the store — fired automatically when the deck-manager
   * removes a card (see `attachDeckManager`). The resume-failed
   * unbind path bypasses this: it clears the binding directly so no
   * close frame is sent to a supervisor session that has already
   * torn down.
   */
  private _closeCardInternal(cardId: string): void {
    const binding = cardSessionBindingStore.getBinding(cardId);
    if (!binding) return;
    const conn = getConnection();
    if (!conn) {
      // No connection means no wire frame to send. Clear locally so
      // the services bag is disposed and the card unbinds cleanly.
      cardSessionBindingStore.clearBinding(cardId);
      return;
    }
    sendCloseSession(conn, cardId, binding.tugSessionId);
  }

  /**
   * Test seam — exposes `_closeCardInternal` so unit tests can
   * directly assert the close behavior without spinning up a
   * real `DeckManager`. NOT for production use; the deck-manager
   * subscription is the only path that should fire close in
   * production.
   * @internal
   */
  closeCardForTest(cardId: string): void {
    this._closeCardInternal(cardId);
  }
}

export const cardServicesStore = new CardServicesStore();
