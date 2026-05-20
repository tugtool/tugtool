/**
 * `TideTranscriptDataSource` — adapter that surfaces a `CodeSessionStore`
 * snapshot as a `TugListViewDataSource`. Each committed turn becomes two
 * adjacent rows (`user`, `code`); the in-flight turn — if present —
 * appends another two rows (also `user`, `code`) at the end.
 *
 * Index layout (with `n = transcript.length`, `f = inflightUserMessage`):
 *
 *   indices 0..2n-1   committed turns, alternating user / code.
 *   indices 2n..2n+1  in-flight pair (only when f !== null).
 *
 * **Single `"code"` kind, zero remounts per turn.** Earlier revisions
 * split the assistant row into `"code-streaming"` and `"code-committed"`
 * with a corresponding two-entry `cellRenderers` map in the consumer.
 * That split forced React to swap component types at every
 * `turn_complete`, unmounting the cell wrapper and tearing down its
 * `TugMarkdownBlock` subtree — manifesting as a user-visible scroll
 * jump because `scrollHeight` collapsed below `clientHeight` for a
 * frame and the browser silently clamped `scrollTop` to 0. The
 * unified kind plus a stable per-turn `turnKey` (generated at
 * `handleSend`, copied onto `TurnEntry` at `handleTurnComplete`)
 * gives the React reconciler an identical key + identical component
 * type on either side of `turn_complete`, so the cell wrapper
 * survives unchanged. See {@link TideTranscriptCellKind} for the
 * trap class the unification eliminates.
 *
 * The adapter does *not* hold its own subscription against the
 * `CodeSessionStore`; `subscribe` proxies straight through, and reads
 * always go through `codeSessionStore.getSnapshot()` (memoized between
 * dispatches per [L02], [D11]). `getVersion()` returns the snapshot
 * reference, which is `Object.is`-stable between non-mutating
 * dispatches and changes identity on every reducer tick.
 *
 * Cell renderers downstream call `rowAt(index)` to read the typed row
 * payload without round-tripping through the snapshot themselves. The
 * row descriptor exposes `turnKey` on every `"code"` row so the
 * consumer can derive its per-turn streaming PropertyStore paths
 * (`turn.${turnKey}.assistant` / `.thinking` / `.tools`). After
 * `turn_complete` those paths retain their final values forever (no
 * subsequent turn writes to them), so the same streaming subscription
 * the cell opened during in-flight continues to surface the right
 * content after commit — without prop changes, without remounts.
 *
 * Laws / decisions:
 *  - [L02] data source enters React via `useSyncExternalStore` only;
 *    the adapter exposes the `subscribe` / `getVersion` shape that
 *    contract requires.
 *  - [L23] preserves user-visible state (scroll position AND content)
 *    across what was previously a teardown event. The cell wrapper
 *    now survives every transition within a turn's life — the
 *    in-flight → committed boundary (in-session, [L26]) AND the
 *    cold-boot rehydration boundary (cross-session). Cold-boot
 *    works because the reducer writes per-turn paths during replay
 *    with the same write-inflight effect it emits during live
 *    turns, so the post-L26 single-subscription render contract
 *    has data to surface on the first render after restore. The
 *    write-side symmetry is the live↔replay parity in
 *    `code-session-store/reducer.ts`'s text and tool handlers; see
 *    [Step 18.9] in `roadmap/tide-assistant-rendering.md`.
 *  - [L26] mount identity stable across the in-flight → committed
 *    transition: the React key (`${turnKey}-code`), the rendered
 *    component (`CodeRowCell`), and the renderer lambda in
 *    `cellRenderers` are all byte-identical across the boundary.
 *    L23 falls out of L26 here — preserved mount identity is
 *    upstream of preserved state.
 *  - [D02] single-section flat list; flat indices, no `IndexPath`.
 *  - [D06] streaming cells observe the streaming source directly;
 *    the consumer reads `codeSessionStore.streamingDocument`
 *    against the per-turn paths derived from `row.turnKey`.
 *  - [D10] `inflightUserMessage` lives on the snapshot; the adapter
 *    reads it from there to mint the in-flight pair (and pull out
 *    the `turnKey` for id minting).
 */

import { useEffect, useMemo } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  CodeSessionSnapshot,
  TurnEntry,
} from "@/lib/code-session-store";
import { deriveContextWindows } from "@/lib/code-session-store/end-state";
import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Kinds the transcript adapter emits, matched against the
 * `cellRenderers` map the Tide card registers.
 *
 * **One kind per row identity** ([L26]). The assistant row uses a
 * single `"code"` kind for its entire life — both while streaming
 * and after commit. Earlier revisions split the row into
 * `"code-streaming"` and `"code-committed"`, but that forced the
 * `cellRenderers` map to hold two separate entries for what is
 * structurally one row. With two entries, a future maintainer writing
 * `"code-streaming": (p) => <Renderer {...p}/>` and `"code-committed":
 * (p) => <Renderer {...p}/>` as two inline lambdas — perfectly
 * idiomatic React — silently re-introduces a scroll-jump-to-top
 * regression: each kind resolves to a different function identity,
 * which is an L26 violation on the renderer-reference axis, so React
 * unmounts the cell wrapper at the `turn_complete` boundary even
 * though it should survive intact. The unified kind eliminates that
 * class of bug at the source: the map literally cannot hold two
 * entries because the row only reports one kind. The render component
 * branches on row payload presence (`row.turn !== undefined` ⇒
 * committed) for the small chrome differences that genuinely vary
 * by phase.
 */
export type TideTranscriptCellKind = "user" | "code";

/**
 * Typed row descriptor returned by `rowAt(index)`. Cell renderers
 * narrow on `kind` and read the matching payload field — `turn` for
 * any committed row (`user` or `code`), `inflight` for the in-flight
 * `user` row, neither for the in-flight `code` row (which observes
 * the streaming document directly per [D06] via per-turn paths
 * derived from `turnKey`). The unified `"code"` kind covers both
 * in-flight and committed assistant rows; the renderer distinguishes
 * the two by `row.turn !== undefined`.
 */
export interface TideRowDescriptor {
  kind: TideTranscriptCellKind;
  /** Set for every committed row (`user` and `code`). */
  turn?: TurnEntry;
  /**
   * The committed turn's signed per-turn token count — `window(N) −
   * window(N−1)` from the transcript window-walk (`deriveContextWindows`),
   * with zero-usage carry-forward. Set on every committed row; the Z1B
   * asst-half renders it (the user half ignores it). `undefined` for
   * in-flight rows. Negative at a `/compact` turn.
   */
  perTurnTokens?: number;
  /** Set for the in-flight `user` row only. */
  inflight?: CodeSessionSnapshot["inflightUserMessage"];
  /**
   * Stable per-turn React-key seed. Present on every `code-*` row
   * (both inflight and committed). The unified `CodeRowCell`
   * derives its per-turn streaming paths from this key:
   * `turn.${turnKey}.{assistant|thinking|tools}`. Crucially, the
   * value is byte-identical across the inflight → committed
   * transition (the reducer copies it from `pendingUserMessage` onto
   * `TurnEntry`), so the cell's `TugMarkdownBlock` etc. observe the
   * same PropertyStore path forever — no streaming-subscription
   * re-init, no DOM reset, no `scrollHeight` collapse.
   */
  turnKey?: string;
}

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
   * Stable React-key seed per the id-stability protocol:
   *
   *  - In-flight pair (last two indices when `inflightUserMessage !==
   *    null`): `${turnKey}-user` / `${turnKey}-code`, with `turnKey`
   *    from `inflightUserMessage.turnKey`.
   *  - Committed pair at offset `2k`/`2k+1`: `${turnKey}-user` /
   *    `${turnKey}-code` with `turnKey` from `transcript[k].turnKey`.
   *
   * `turnKey` is generated once at `handleSend` and copied unchanged
   * onto `TurnEntry` at `handleTurnComplete` — so the in-flight pair's
   * id is byte-identical to the committed pair's id for the same
   * turn. React sees the same key + the same component type (the
   * cellRenderers map holds one entry for the unified `"code"` kind),
   * so the cell wrapper survives the inflight → committed transition
   * with no unmount.
   *
   * `msgId` is the wire-correlation identifier and is intentionally
   * NOT used here: it isn't assigned until the first streaming frame
   * lands, which is mid-turn, so any id derived from it would change
   * during the turn and trigger a remount.
   */
  idForIndex(index: number): string {
    const snap = this._codeSessionStore.getSnapshot();
    const committedCount = snap.transcript.length;
    const inflight = snap.inflightUserMessage;

    // Use the per-turn React-key seed (`turnKey`) for both the
    // in-flight and committed pair. `turnKey` is generated at
    // `handleSend` on the `pendingUserMessage` and preserved through
    // `handleTurnComplete` onto `TurnEntry.turnKey`, so the key is
    // byte-identical across the inflight → committed transition.
    // React reconciliation matches the cell wrapper — same key, same
    // (unified) component type, same DOM identity, no unmount, no
    // `scrollHeight` collapse, no silent browser `scrollTop` clamp.
    if (inflight !== null && index >= committedCount * 2) {
      return index === committedCount * 2
        ? `${inflight.turnKey}-user`
        : `${inflight.turnKey}-code`;
    }

    const turn = snap.transcript[Math.floor(index / 2)];
    return index % 2 === 0 ? `${turn.turnKey}-user` : `${turn.turnKey}-code`;
  }

  /**
   * Cell-renderer kind. Even indices are `"user"`, odd indices are
   * `"code"` — regardless of whether the pair is committed or
   * in-flight. The unified `"code"` kind is what lets the
   * `cellRenderers` map hold a single entry for the assistant row,
   * which is what prevents the kind-flip-driven cell-wrapper
   * unmount that caused the scroll-jump-to-top regression. See
   * {@link TideTranscriptCellKind}.
   */
  kindForIndex(index: number): TideTranscriptCellKind {
    // Single `"code"` kind for the assistant row, regardless of
    // streaming/committed state — see {@link TideTranscriptCellKind}
    // for the rationale (the unified kind eliminates the lambda-
    // identity trap in `cellRenderers` that would otherwise re-mount
    // the cell wrapper at `turn_complete`). The render component
    // distinguishes phases via row payload presence, not via kind.
    return index % 2 === 0 ? "user" : "code";
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
        return { kind: "user", inflight, turnKey: inflight.turnKey };
      }
      // Streaming assistant row — no `turn` payload yet; presence of
      // `turn` is the cell's signal for committed-vs-streaming.
      return { kind: "code", turnKey: inflight.turnKey };
    }

    const turnIndex = Math.floor(index / 2);
    const turn = snap.transcript[turnIndex];
    // Signed per-turn token delta from the transcript window-walk —
    // window(N) − window(N−1), carry-forward over any zero-usage turn.
    // The walk needs the whole transcript: a single turn's `cost`
    // can't yield its delta (the prior turn may be a zero-usage turn,
    // whose window is the one before IT).
    const windows = deriveContextWindows(
      snap.transcript.map((t) => t.cost),
      snap.sessionInitTokens ?? 0,
    );
    return {
      kind: index % 2 === 0 ? "user" : "code",
      turn,
      perTurnTokens: windows[turnIndex]?.perTurn,
      turnKey: turn?.turnKey,
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
