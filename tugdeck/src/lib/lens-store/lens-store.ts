/**
 * `LensStore` — module-scope owner of the Lens panel's persisted
 * arrangement state (section order, per-section visibility and collapse,
 * and the preferred reopen width).
 *
 * The store is constructed lazily on first read so tests that never
 * touch the Lens pay zero cost. It:
 *   1. Hydrates from tugbank (`dev.tugtool.lens`) once the cache is
 *      available.
 *   2. Listens for live tugbank pushes on the same domain so external
 *      writes take effect immediately.
 *   3. Persists every mutation back to tugbank via PUT.
 *   4. Notifies subscribers ([L02]) — React reads via
 *      `useSyncExternalStore`.
 *
 * The Lens's live open/width geometry is NOT here — it lives in the deck
 * layout blob as anchored-pane presence + `size.width`. This store holds
 * only the section arrangement and the *reopen* width.
 *
 * Conformance:
 *   - [L02] `useSyncExternalStore`-compatible `subscribe` +
 *     `getSnapshot`; references stay stable when state is unchanged.
 *   - [L23] state survives HMR / reloads via tugbank persistence.
 *   - `feedback_no_localstorage`: no localStorage / sessionStorage.
 *
 * @module lib/lens-store/lens-store
 */

import { getTugbankClient } from "../tugbank-singleton";
import type { TaggedValue } from "../tugbank-client";
import { tugDevLogStore } from "../tug-dev-log-store/tug-dev-log-store";
import {
  createInitialState,
  reduce,
  toSnapshot,
  type LensEvent,
  type LensState,
} from "./reducer";
import {
  LENS_DOMAIN,
  LENS_KEYS,
  normalizeLensAnchorSide,
  type LensAnchorSide,
  type LensSnapshot,
} from "./types";

class LensStore {
  private _state: LensState = createInitialState();
  private readonly _listeners = new Set<() => void>();
  private _tugbankUnsub: (() => void) | null = null;
  private _initialized = false;

  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    const client = getTugbankClient();
    if (!client) return;

    this._hydrateFromTugbank();

    this._tugbankUnsub = client.onDomainChanged((domain) => {
      if (domain === LENS_DOMAIN) {
        this._hydrateFromTugbank();
      }
    });
  }

  private _hydrateFromTugbank(): void {
    const client = getTugbankClient();
    if (!client) return;
    const widthPx = readNumber(client.get(LENS_DOMAIN, LENS_KEYS.WIDTH_PX));
    const sectionOrder = migrateKinds(
      readStringArray(client.get(LENS_DOMAIN, LENS_KEYS.SECTION_ORDER)),
    );
    const hiddenSections = migrateKinds(
      readStringArray(client.get(LENS_DOMAIN, LENS_KEYS.HIDDEN_SECTIONS)),
    );
    const collapsedSections = migrateKinds(
      readStringArray(client.get(LENS_DOMAIN, LENS_KEYS.COLLAPSED_SECTIONS)),
    );
    const anchorSide = readAnchorSide(
      client.get(LENS_DOMAIN, LENS_KEYS.ANCHOR_SIDE),
    );
    this._dispatch(
      {
        type: "hydrate",
        ...(widthPx !== undefined ? { widthPx } : {}),
        ...(sectionOrder !== undefined ? { sectionOrder } : {}),
        ...(hiddenSections !== undefined ? { hiddenSections } : {}),
        ...(collapsedSections !== undefined ? { collapsedSections } : {}),
        ...(anchorSide !== undefined ? { anchorSide } : {}),
      },
      { persist: false },
    );
  }

  private _dispatch(
    event: LensEvent,
    options: { persist: boolean } = { persist: true },
  ): void {
    const prev = this._state;
    const next = reduce(prev, event);
    if (next === prev) return;
    this._state = next;
    if (options.persist) {
      this._persistDiff(prev, next);
    }
    for (const listener of this._listeners) {
      try {
        listener();
      } catch (err) {
        console.warn("[LensStore] listener error:", err);
      }
    }
  }

  private _persistDiff(prev: LensState, next: LensState): void {
    if (prev.widthPx !== next.widthPx) {
      putNumber(LENS_KEYS.WIDTH_PX, next.widthPx);
    }
    if (prev.sectionOrder !== next.sectionOrder) {
      putJson(LENS_KEYS.SECTION_ORDER, next.sectionOrder);
    }
    if (prev.hiddenSections !== next.hiddenSections) {
      putJson(LENS_KEYS.HIDDEN_SECTIONS, next.hiddenSections);
    }
    if (prev.collapsedSections !== next.collapsedSections) {
      putJson(LENS_KEYS.COLLAPSED_SECTIONS, next.collapsedSections);
    }
    if (prev.anchorSide !== next.anchorSide) {
      putString(LENS_KEYS.ANCHOR_SIDE, next.anchorSide);
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

  getSnapshot = (): LensSnapshot => {
    this._ensureInitialized();
    return toSnapshot(this._state);
  };

  /**
   * Set the preferred reopen width in pixels. Clamped to the floor in
   * the reducer; the component-side viewport ceiling is enforced before
   * this is called. Persists so a hide→show cycle restores the size.
   */
  setWidth = (widthPx: number): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_width", widthPx });
  };

  /** Replace the persisted section order. Persists. */
  setSectionOrder = (order: readonly string[]): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_section_order", order });
  };

  /** Show/hide a section by kind. Persists. */
  setHidden = (kind: string, hidden: boolean): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_hidden", kind, hidden });
  };

  /** Expand/collapse a section by kind. Persists. */
  setCollapsed = (kind: string, collapsed: boolean): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_collapsed", kind, collapsed });
  };

  /** Set the viewport edge the Lens rail pins to. Persists. */
  setAnchorSide = (side: LensAnchorSide): void => {
    this._ensureInitialized();
    this._dispatch({ type: "set_anchor_side", side });
  };

  /**
   * Test seam — dispose tugbank subscription and reset. Production never
   * tears the store down (it lives for the app's lifetime).
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

export const lensStore = new LensStore();

// ---------------------------------------------------------------------------
// Internal — tugbank value helpers
// ---------------------------------------------------------------------------

function readNumber(entry: TaggedValue | undefined): number | undefined {
  if (!entry) return undefined;
  if (
    (entry.kind === "i64" || entry.kind === "f64") &&
    typeof entry.value === "number" &&
    Number.isFinite(entry.value)
  ) {
    return entry.value;
  }
  return undefined;
}

/**
 * Section-`kind` renames applied on hydrate so a user's persisted
 * arrangement state (order / hidden / collapsed) survives a section
 * being renamed. Maps old kind → new kind; unknown kinds pass through.
 * The remapped state re-persists on the next mutation, self-healing the
 * stored value.
 */
const KIND_MIGRATIONS: Readonly<Record<string, string>> = {
  changeset: "sessions",
};

function migrateKinds(
  kinds: readonly string[] | undefined,
): readonly string[] | undefined {
  if (kinds === undefined) return undefined;
  let changed = false;
  const out = kinds.map((kind) => {
    const to = KIND_MIGRATIONS[kind];
    if (to !== undefined && to !== kind) {
      changed = true;
      return to;
    }
    return kind;
  });
  return changed ? out : kinds;
}

/**
 * Read a persisted `string[]`. A malformed entry (wrong kind, non-array,
 * or a non-string element) is rejected as `undefined` so the reducer
 * keeps the existing value — the reject-and-keep hydrate discipline.
 * A well-formed empty array is meaningful and preserved.
 */
function readStringArray(
  entry: TaggedValue | undefined,
): readonly string[] | undefined {
  if (!entry || entry.kind !== "json") return undefined;
  const v = entry.value;
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return undefined;
    out.push(x);
  }
  return out;
}

/**
 * Read the persisted anchor side. A missing or malformed entry returns
 * `undefined` so the reducer keeps the default; any present string is
 * coerced to a valid side.
 */
function readAnchorSide(
  entry: TaggedValue | undefined,
): LensAnchorSide | undefined {
  if (!entry || entry.kind !== "string" || typeof entry.value !== "string") {
    return undefined;
  }
  return normalizeLensAnchorSide(entry.value);
}

function putNumber(key: string, value: number): void {
  putRaw(key, { kind: "i64", value: Math.round(value) });
}

function putString(key: string, value: string): void {
  putRaw(key, { kind: "string", value });
}

function putJson(key: string, value: unknown): void {
  putRaw(key, { kind: "json", value });
}

interface RawTaggedBody {
  kind: string;
  value: unknown;
}

function putRaw(key: string, body: RawTaggedBody): void {
  const client = getTugbankClient();
  if (client && typeof client.setLocalValue === "function") {
    client.setLocalValue(LENS_DOMAIN, key, body as TaggedValue);
  }
  fetch(`/api/defaults/${LENS_DOMAIN}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    tugDevLogStore.warn("lens-store", `_persistDiff PUT ${key} failed`, {
      error: String(err),
    });
  });
}
