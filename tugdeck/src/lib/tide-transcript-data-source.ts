/**
 * `TideTranscriptDataSource` — adapter that surfaces a `CodeSessionStore`
 * snapshot as a `TugListViewDataSource`. Each committed turn becomes two
 * adjacent rows (`user`, `code-committed`); the in-flight turn — if
 * present — appends another two rows (`user`, `code-streaming`) at the
 * end.
 *
 * Index layout (with `n = transcript.length`, `f = inflightUserMessage`):
 *
 *   indices 0..2n-1   committed turns, alternating user / code-committed.
 *   indices 2n..2n+1  in-flight pair (only when f !== null).
 *
 * The adapter does *not* hold its own subscription against the
 * `CodeSessionStore`; `subscribe` proxies straight through, and reads
 * always go through `codeSessionStore.getSnapshot()` (memoized between
 * dispatches per [L02], [D11]). `getVersion()` returns the snapshot
 * reference, which is `Object.is`-stable between non-mutating
 * dispatches and changes identity on every reducer tick.
 *
 * Cell renderers downstream call `rowAt(index)` to read the typed row
 * payload without round-tripping through the snapshot themselves; the
 * `TideRowDescriptor` shape mirrors the kind layout so a renderer can
 * narrow on `kind` and reach the right field.
 *
 * Laws / decisions:
 *  - [L02] data source enters React via `useSyncExternalStore` only;
 *    the adapter exposes the `subscribe` / `getVersion` shape that
 *    contract requires. The hook in this module wires the adapter
 *    construction to the store reference; the *list view* calls
 *    `useSyncExternalStore` against the adapter's contract.
 *  - [D02] single-section flat list; flat indices, no `IndexPath`.
 *  - [D04] cell-reuse via item-keyed mount/unmount; the id-stability
 *    protocol below produces stable React keys across the in-flight
 *    → committed transition with at most one remount per turn.
 *  - [D06] streaming cells observe the streaming source directly; the
 *    `code-streaming` cell renderer (Step 11) reads
 *    `codeSessionStore.streamingDocument` itself rather than going
 *    through the data source on each delta.
 *  - [D10] `inflightUserMessage` lives on the snapshot; the adapter
 *    reads it from there to mint the in-flight pair.
 */

import { useEffect, useMemo } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  CodeSessionSnapshot,
  TurnEntry,
} from "@/lib/code-session-store";
import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The kinds the transcript adapter emits. Matched by the cell renderers
 * the Tide card registers in Step 11.
 */
export type TideTranscriptCellKind = "user" | "code-committed" | "code-streaming";

/**
 * Typed row descriptor returned by `rowAt(index)`. Cell renderers narrow
 * on `kind` and read the matching payload field — `turn` for committed
 * rows, `inflight` for the in-flight `user` row, neither for the
 * in-flight `code-streaming` row (which observes the streaming document
 * directly per [D06]).
 */
export interface TideRowDescriptor {
  kind: TideTranscriptCellKind;
  /** Set for `user` (committed) and `code-committed` rows. */
  turn?: TurnEntry;
  /** Set for the in-flight `user` row only. */
  inflight?: CodeSessionSnapshot["inflightUserMessage"];
}

/**
 * Sentinel used as the seed prefix for the in-flight pair before
 * `activeMsgId` is assigned (i.e. between `send` and the first
 * `assistant_text` delta). Exported for tests and for the `tide-card`
 * renderer that wants to assert on the seed-transition contract.
 */
export const INFLIGHT_ID_SEED = "inflight";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Class-shaped adapter so consumers (and cell renderers) can narrow the
 * `TugListViewDataSource` generic parameter to `TideTranscriptDataSource`
 * and call `rowAt(index)` without casting — mirrors the gallery card's
 * pattern.
 */
export class TideTranscriptDataSource implements TugListViewDataSource {
  constructor(private readonly _codeSessionStore: CodeSessionStore) {}

  /**
   * `transcript.length * 2 + (inflightUserMessage ? 2 : 0)`. The in-flight
   * pair (when present) occupies the last two indices; committed turns
   * occupy indices 0..2n-1 in transcript order.
   */
  numberOfItems(): number {
    const snap = this._codeSessionStore.getSnapshot();
    return snap.transcript.length * 2 + (snap.inflightUserMessage !== null ? 2 : 0);
  }

  /**
   * Stable id per the id-stability protocol (see module docstring and
   * [Step 10] of `tugplan-tug-list-view.md`):
   *
   *  - Committed pair at offset `2k`/`2k+1`: `${msgId}-user` /
   *    `${msgId}-code` where `msgId = transcript[k].msgId`.
   *  - In-flight pair (last two indices when `inflightUserMessage !==
   *    null`): `${seed}-user` / `${seed}-code`, where `seed` is
   *    `activeMsgId` if set, else the literal `"inflight"`.
   *
   * The seed transition (from `"inflight"` to the real `activeMsgId`)
   * happens once per turn at the awaiting-first-token → streaming
   * boundary; it is the only id change a turn experiences. On
   * `turn_complete(success)` the in-flight pair disappears and the
   * matching committed pair appears with the same `${msgId}-...` ids,
   * so the React reconciler matches the cells (the wrapper key stays
   * stable; only the cell renderer underneath swaps because the kind
   * changes from `code-streaming` to `code-committed`).
   */
  idForIndex(index: number): string {
    const snap = this._codeSessionStore.getSnapshot();
    const committedCount = snap.transcript.length;
    const inflight = snap.inflightUserMessage;

    if (inflight !== null && index >= committedCount * 2) {
      const seed = snap.activeMsgId ?? INFLIGHT_ID_SEED;
      return index === committedCount * 2 ? `${seed}-user` : `${seed}-code`;
    }

    const turn = snap.transcript[Math.floor(index / 2)];
    return index % 2 === 0 ? `${turn.msgId}-user` : `${turn.msgId}-code`;
  }

  /**
   * Cell-renderer kind. Even committed indices are `"user"`, odd
   * committed indices are `"code-committed"`. The in-flight pair (when
   * present) is `"user"` then `"code-streaming"`.
   */
  kindForIndex(index: number): TideTranscriptCellKind {
    const snap = this._codeSessionStore.getSnapshot();
    const committedCount = snap.transcript.length;
    const inflight = snap.inflightUserMessage;

    if (inflight !== null && index >= committedCount * 2) {
      return index === committedCount * 2 ? "user" : "code-streaming";
    }

    return index % 2 === 0 ? "user" : "code-committed";
  }

  /**
   * Typed row descriptor for `index`. Cell renderers call this from
   * inside `useSyncExternalStore`-bound props rather than peeking at
   * the snapshot themselves so the adapter remains the single seam
   * between `CodeSessionStore` and the list view.
   */
  rowAt(index: number): TideRowDescriptor {
    const snap = this._codeSessionStore.getSnapshot();
    const committedCount = snap.transcript.length;
    const inflight = snap.inflightUserMessage;

    if (inflight !== null && index >= committedCount * 2) {
      if (index === committedCount * 2) {
        return { kind: "user", inflight };
      }
      return { kind: "code-streaming" };
    }

    const turn = snap.transcript[Math.floor(index / 2)];
    return {
      kind: index % 2 === 0 ? "user" : "code-committed",
      turn,
    };
  }

  /**
   * Proxies straight to the underlying store. The list view's
   * `useSyncExternalStore` consumes this; on every reducer dispatch
   * the listener fires, the list view re-reads `getVersion()`, and
   * because that returns a fresh snapshot reference React rerenders.
   */
  subscribe(listener: () => void): () => void {
    return this._codeSessionStore.subscribe(listener);
  }

  /**
   * Returns the current `CodeSessionStore` snapshot. The reference is
   * `Object.is`-stable across non-mutating dispatches (per
   * `CodeSessionStore.getSnapshot`'s memoization contract) and changes
   * identity on every state-changing dispatch — exactly the shape
   * `TugListViewDataSource.getVersion` expects.
   */
  getVersion(): CodeSessionSnapshot {
    return this._codeSessionStore.getSnapshot();
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Construct a `TideTranscriptDataSource` bound to `codeSessionStore` and
 * keep its identity stable across renders so React's `useSyncExternalStore`
 * machinery in the list view doesn't churn its subscription on every
 * parent rerender.
 *
 * The adapter itself holds no resources of its own — it proxies into the
 * store on every call — so disposal is a no-op today. The `useEffect`
 * cleanup is in place so the contract reads correctly: each store gets
 * exactly one adapter per consumer mount, and a swap to a new store
 * yields a fresh adapter.
 */
export function useTideTranscriptDataSource(
  codeSessionStore: CodeSessionStore,
): TideTranscriptDataSource {
  const adapter = useMemo(
    () => new TideTranscriptDataSource(codeSessionStore),
    [codeSessionStore],
  );

  useEffect(() => {
    // No-op disposal today; the hook owns the lifecycle so a future
    // adapter that does hold resources (e.g. memoized derived state)
    // has the seam already in place.
    return () => {};
  }, [adapter]);

  return adapter;
}
