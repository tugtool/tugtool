/**
 * `TugDevPanelStore` — module-scope owner of the dev inspector
 * panel's visibility + selection state.
 *
 * The store is constructed lazily on first read so tests that never
 * touch the panel pay zero cost. It:
 *   1. Hydrates from tugbank (`dev.tugtool.dev-panel`) once the cache
 *      is available.
 *   2. Listens for live tugbank pushes on the same domain so external
 *      writes (e.g. `tugbank write`) take effect immediately.
 *   3. Persists every mutation back to tugbank via PUT.
 *   4. Notifies subscribers ([L02]) — React reads via
 *      `useSyncExternalStore`.
 *
 * Lifecycle integration with `DeckManager`: when a card disappears,
 * the deck manager wrapper calls `notifyCardGone(cardId)` so the
 * store clears its selection if the gone card matches.
 *
 * Conformance:
 *   - [L02] `useSyncExternalStore`-compatible `subscribe` +
 *     `getSnapshot`; references stay stable when state is unchanged.
 *   - [L23] state survives HMR / reloads via tugbank persistence.
 *   - `feedback_no_localstorage`: no localStorage / sessionStorage.
 *
 * @module lib/tug-dev-panel-store/tug-dev-panel-store
 */

import { getTugbankClient } from "../tugbank-singleton";
import type { TaggedValue } from "../tugbank-client";
import {
  createInitialState,
  reduce,
  toSnapshot,
  type TugDevPanelEvent,
  type TugDevPanelState,
} from "./reducer";
import {
  DEV_PANEL_DOMAIN,
  VALID_DEV_PANEL_TABS,
  type TugDevPanelSnapshot,
  type TugDevPanelTabId,
} from "./types";
import { tugDevLogStore } from "../tug-dev-log-store/tug-dev-log-store";

/** Re-export so callers that already imported the domain from the
 * store module keep working — the canonical export now lives in
 * `./types` (see file there for the circular-import rationale). */
export { DEV_PANEL_DOMAIN };

/** Individual key names within the domain. */
export const DEV_PANEL_KEYS = {
  OPEN: "open",
  ACTIVE_TAB: "activeTab",
  SELECTED_CARD_ID: "selectedCardId",
  WIDTH_PX: "widthPx",
} as const;

class TugDevPanelStore {
  private _state: TugDevPanelState = createInitialState();
  private readonly _listeners = new Set<() => void>();
  private _tugbankUnsub: (() => void) | null = null;
  private _initialized = false;

  /**
   * Lazy init — runs the first time anything reads from the store.
   * Hydrates from tugbank if the client is available; subscribes to
   * domain pushes for live external updates.
   */
  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    const client = getTugbankClient();
    if (!client) return;

    // Initial hydrate — read what's in the cache right now.
    this._hydrateFromTugbank();

    // Live updates — re-hydrate when this domain changes.
    this._tugbankUnsub = client.onDomainChanged((domain) => {
      if (domain === DEV_PANEL_DOMAIN) {
        this._hydrateFromTugbank();
      }
    });
  }

  private _hydrateFromTugbank(): void {
    const client = getTugbankClient();
    if (!client) return;
    const open = readBool(client.get(DEV_PANEL_DOMAIN, DEV_PANEL_KEYS.OPEN));
    const activeTab = readString(
      client.get(DEV_PANEL_DOMAIN, DEV_PANEL_KEYS.ACTIVE_TAB),
    );
    const selectedCardId = readNullableString(
      client.get(DEV_PANEL_DOMAIN, DEV_PANEL_KEYS.SELECTED_CARD_ID),
    );
    const widthPx = readNumber(
      client.get(DEV_PANEL_DOMAIN, DEV_PANEL_KEYS.WIDTH_PX),
    );
    this._dispatch(
      {
        type: "hydrate",
        ...(open !== undefined ? { open } : {}),
        ...(activeTab !== undefined ? { activeTab } : {}),
        ...(selectedCardId !== undefined ? { selectedCardId } : {}),
        ...(widthPx !== undefined ? { widthPx } : {}),
      },
      { persist: false },
    );
  }

  private _dispatch(
    event: TugDevPanelEvent,
    options: { persist: boolean } = { persist: true },
  ): void {
    const prev = this._state;
    const next = reduce(prev, event);
    if (next === prev) {
      return;
    }
    this._state = next;
    if (options.persist) {
      this._persistDiff(prev, next);
    }
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (err) {
        console.warn("[TugDevPanelStore] listener error:", err);
      }
    }
  }

  private _persistDiff(prev: TugDevPanelState, next: TugDevPanelState): void {
    if (prev.open !== next.open) {
      putBool(DEV_PANEL_KEYS.OPEN, next.open);
    }
    if (prev.activeTab !== next.activeTab) {
      putString(DEV_PANEL_KEYS.ACTIVE_TAB, next.activeTab);
    }
    if (prev.selectedCardId !== next.selectedCardId) {
      putNullableString(DEV_PANEL_KEYS.SELECTED_CARD_ID, next.selectedCardId);
    }
    if (prev.widthPx !== next.widthPx) {
      putNumber(DEV_PANEL_KEYS.WIDTH_PX, next.widthPx);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this._ensureInitialized();
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): TugDevPanelSnapshot => {
    this._ensureInitialized();
    return toSnapshot(this._state);
  };

  /** Toggle the panel's visibility. Fired by the Swift Developer menu. */
  toggle = (): void => {
    this._ensureInitialized();
    this._dispatch({ type: "toggle" });
  };

  /** Explicit open/close — useful for tests and programmatic close. */
  setOpen = (open: boolean): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_open", open });
  };

  /** Switch the active inspector tab. */
  selectTab = (tab: TugDevPanelTabId): void => {
    this._ensureInitialized();
    this._dispatch({ type: "select_tab", tab });
  };

  /** Set the card whose inspector is shown. `null` clears the selection. */
  selectCard = (cardId: string | null): void => {
    this._ensureInitialized();
    this._dispatch({ type: "select_card", cardId });
  };

  /**
   * Set the panel width in pixels. Driven by the left-edge drag
   * handle. Clamped to the floor in the reducer; the component-side
   * viewport ceiling is enforced before this is called. Persists to
   * tugbank so reopens restore the preferred size.
   */
  setWidth = (widthPx: number): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_width", widthPx });
  };

  /**
   * Notify the store that a card has been closed. Clears the
   * selection only when the gone card matches.
   *
   * Wired up at app boot via a `DeckManager.subscribe` callback so
   * the store stays in sync without the panel having to mount.
   */
  notifyCardGone = (cardId: string): void => {
    this._ensureInitialized();
    this._dispatch({ type: "card_gone", cardId }, { persist: true });
  };

  /**
   * Test seam — dispose tugbank subscription. Production never tears
   * the store down (it lives for the app's lifetime).
   * @internal
   */
  _disposeForTest(): void {
    if (this._tugbankUnsub) {
      this._tugbankUnsub();
      this._tugbankUnsub = null;
    }
    this._listeners.clear();
    this._state = createInitialState();
    this._initialized = false;
  }
}

export const tugDevPanelStore = new TugDevPanelStore();

// ---------------------------------------------------------------------------
// Internal — tugbank value helpers
// ---------------------------------------------------------------------------

function readBool(entry: TaggedValue | undefined): boolean | undefined {
  if (!entry || entry.kind !== "bool") return undefined;
  return typeof entry.value === "boolean" ? entry.value : undefined;
}

function readString(entry: TaggedValue | undefined): string | undefined {
  if (!entry || entry.kind !== "string") return undefined;
  return typeof entry.value === "string" ? entry.value : undefined;
}

function readNumber(entry: TaggedValue | undefined): number | undefined {
  if (!entry) return undefined;
  // tugbank exposes numeric values as `kind: "i64"` (integers) or
  // `kind: "f64"` (floats). Tolerate either; widthPx is integer in
  // practice but the kind isn't load-bearing for our reads.
  if (
    (entry.kind === "i64" || entry.kind === "f64") &&
    typeof entry.value === "number" &&
    Number.isFinite(entry.value)
  ) {
    return entry.value;
  }
  return undefined;
}

function readNullableString(
  entry: TaggedValue | undefined,
): string | null | undefined {
  if (!entry) return undefined;
  if (entry.kind === "string" && typeof entry.value === "string") {
    return entry.value;
  }
  // Stored explicitly-null selection is represented as `kind: "null"` —
  // tolerate `kind: "string"` with empty value too for robustness.
  if (entry.kind === "null") return null;
  return undefined;
}

function putBool(key: string, value: boolean): void {
  putRaw(key, { kind: "bool", value });
}

function putString(key: string, value: string): void {
  putRaw(key, { kind: "string", value });
}

function putNumber(key: string, value: number): void {
  putRaw(key, { kind: "i64", value: Math.round(value) });
}

function putNullableString(key: string, value: string | null): void {
  if (value === null) {
    putRaw(key, { kind: "null", value: null });
  } else {
    putRaw(key, { kind: "string", value });
  }
}

interface RawTaggedBody {
  kind: string;
  value: unknown;
}

function putRaw(key: string, body: RawTaggedBody): void {
  // Optimistic local update so the next getSnapshot reflects the new
  // value even before the PUT round-trips. Guarded against partial
  // mocks (some test fixtures stub `getTugbankClient` with a minimal
  // bag that lacks `setLocalValue` — the optimization is non-essential
  // and we'd rather degrade quietly than crash).
  const client = getTugbankClient();
  if (client && typeof client.setLocalValue === "function") {
    client.setLocalValue(DEV_PANEL_DOMAIN, key, body as TaggedValue);
  }
  fetch(`/api/defaults/${DEV_PANEL_DOMAIN}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    tugDevLogStore.warn(
      "tugdevpanel",
      `_persistDiff PUT ${key} failed`,
      { error: String(err) },
    );
  });
}

/**
 * Exported for tests: the set of valid tab ids. Re-exported here so
 * tests can import via the store module without reaching into the
 * types module separately.
 */
export { VALID_DEV_PANEL_TABS };
