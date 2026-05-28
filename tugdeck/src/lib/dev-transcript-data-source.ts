/**
 * `DevTranscriptDataSource` — adapter that surfaces a `CodeSessionStore`
 * snapshot as a `TugListViewDataSource`.
 *
 * Row contract — three cell kinds, variable rows per turn:
 *
 *   - `user`  — emitted iff the turn's `messages[0]?.kind === "user_message"`.
 *               Carries the user submission's text + timestamp. Wake
 *               turns (which have no `user_message` Message at head)
 *               naturally produce no user row.
 *   - `assistant` — emitted once per turn (committed or in-flight). The
 *               renderer iterates `turn.messages` (or `activeTurn.messages`
 *               for in-flight) and dispatches each Message kind to
 *               its inline surface (`assistant_text` →
 *               `TugMarkdownBlock`; `assistant_thinking` →
 *               `DevThinkingBlock`; `tool_use` → tool block;
 *               `system_note` → subdued note row when Step 8 lands).
 *   - `ghost` — one per `queuedSends` entry, painted at the foot for
 *               the QUEUED_NEXT_TURN overlay.
 *
 * Index layout (with `n = transcript.length`,
 * `a = activeTurn`, `q = queuedSends.length`):
 *
 *   indices 0..k-1       committed turns, variable per turn (1 row for
 *                        a wake turn, 2 rows for a normal turn).
 *   indices k..k+m-1     in-flight turn rows (only when a !== null).
 *                        Same variable shape: 1 row for a wake, 2 for
 *                        a normal turn.
 *   indices k+m..k+m+q-1 ghost rows.
 *
 * **Single `"assistant"` kind, zero remounts per turn.** Earlier revisions
 * split the assistant row into `"code-streaming"` and `"code-committed"`
 * with a corresponding two-entry `cellRenderers` map. That split
 * forced React to swap component types at every `turn_complete`,
 * unmounting the cell wrapper and tearing down its `TugMarkdownBlock`
 * subtree — manifesting as a user-visible scroll jump because
 * `scrollHeight` collapsed below `clientHeight` for a frame and the
 * browser silently clamped `scrollTop` to 0. The unified kind plus a
 * stable per-turn `turnKey` (generated at `handleSend`, copied onto
 * `TurnEntry` at `handleTurnComplete`) gives the React reconciler an
 * identical key + identical component type on either side of
 * `turn_complete`, so the cell wrapper survives unchanged.
 *
 * The adapter does *not* hold its own subscription against the
 * `CodeSessionStore`; `subscribe` proxies straight through, and reads
 * always go through `codeSessionStore.getSnapshot()` (memoized between
 * dispatches per [L02], [D11]). `getVersion()` returns the snapshot
 * reference, which is `Object.is`-stable between non-mutating
 * dispatches and changes identity on every reducer tick.
 *
 * Cell renderers downstream call `rowAt(index)` to read the typed row
 * payload without round-tripping through the snapshot themselves.
 *
 * Laws / decisions:
 *  - [L02] data source enters React via `useSyncExternalStore` only;
 *    the adapter exposes the `subscribe` / `getVersion` shape that
 *    contract requires.
 *  - [L23] preserves user-visible state (scroll position AND content)
 *    across what was previously a teardown event. The cell wrapper
 *    now survives every transition within a turn's life — the
 *    in-flight → committed boundary (in-session, [L26]) AND the
 *    cold-boot rehydration boundary (cross-session).
 *  - [L26] mount identity stable across the in-flight → committed
 *    transition: the React key (`${turnKey}-assistant`), the rendered
 *    component (`AssistantTurnCell`), and the renderer lambda in
 *    `cellRenderers` are all byte-identical across the boundary.
 *    L23 falls out of L26 here — preserved mount identity is
 *    upstream of preserved state.
 *  - [D02] single-section flat list; flat indices, no `IndexPath`.
 *  - [D07] sequence-substrate row decisions are driven by the presence
 *    (or absence) of a `user_message` Message at the head of
 *    `turn.messages` / `activeTurn.messages` — the [D06] empty-text
 *    sentinel retires.
 */

import { useEffect, useMemo } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  ActiveTurnSnapshot,
  CodeSessionSnapshot,
  QueuedSend,
  TurnEntry,
  UserMessage,
} from "@/lib/code-session-store";
import { deriveContextWindows } from "@/lib/code-session-store/end-state";
import type { ContextWindowStep } from "@/lib/code-session-store/end-state";
import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Kinds the transcript adapter emits, matched against the
 * `cellRenderers` map the Dev card registers.
 *
 * **One kind per row identity** ([L26]). The assistant row uses a
 * single `"assistant"` kind for its entire life — both while streaming and
 * after commit. Earlier revisions split the row into `"code-streaming"`
 * and `"code-committed"`, but that forced the `cellRenderers` map to
 * hold two separate entries for what is structurally one row. With two
 * entries, a future maintainer writing two inline lambdas — perfectly
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
 *
 * `"ghost"` is a third kind, and — unlike a `code-*` split — a sound
 * one: a ghost row is a *standalone* row (one queued send, no turn
 * pair), a genuinely distinct identity, not one row's life split in
 * two. It never morphs in place into a `user` / `assistant` row: when a
 * queued send flushes, its ghost row (keyed `${turnKey}-ghost`)
 * unmounts and the in-flight pair (keyed `${turnKey}-user` / `-assistant`)
 * mounts — a real queued -> sent transition, correctly a remount.
 */
export type DevTranscriptCellKind = "user" | "assistant" | "ghost";

/**
 * Typed row descriptor returned by `rowAt(index)`. Cell renderers
 * narrow on `kind` and read the matching payload field — `turn` for
 * any committed row (`user` or `assistant`), `activeTurn` for any in-flight
 * row. The unified `"assistant"` kind covers both in-flight and committed
 * assistant rows; the renderer distinguishes the two by
 * `row.turn !== undefined`.
 */
export interface DevRowDescriptor {
  kind: DevTranscriptCellKind;
  /** Set for every committed row (`user` and `assistant`). */
  turn?: TurnEntry;
  /**
   * The committed turn's signed per-turn token count — `window(N) −
   * window(N−1)` from the transcript window-walk (`deriveContextWindows`),
   * with zero-usage carry-forward. Set on every committed row; the Z1B
   * asst-half renders it (the user half ignores it). `undefined` for
   * in-flight rows. Negative at a `/compact` turn.
   */
  perTurnTokens?: number;
  /**
   * Set for every in-flight row (`user` and `assistant`). Carries the
   * substrate's `ActiveTurnSnapshot` so the cell can read the live
   * Message sequence + the user submission (when present) without
   * a second snapshot read.
   */
  activeTurn?: ActiveTurnSnapshot;
  /** Set for a `ghost` row only — the queued send it paints. */
  queued?: QueuedSend;
  /**
   * Stable per-turn React-key seed. Present on every row (committed,
   * in-flight, or ghost). The unified `AssistantTurnCell` derives its
   * per-Message streaming paths from this key plus each Message's
   * `messageKey`. Crucially, the value is byte-identical across the
   * inflight → committed transition (the reducer copies it from
   * `pendingTurn` onto `TurnEntry`), so the cell's children observe
   * the same PropertyStore paths forever — no streaming-subscription
   * re-init, no DOM reset, no `scrollHeight` collapse.
   */
  turnKey: string;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

/**
 * True iff `turn.messages` (or `activeTurn.messages`) opens with a
 * `user_message` Message. The substrate's wake discriminator under
 * [D07] — wake turns naturally don't open with one; normal user turns
 * always do.
 */
function turnHasUserMessage(turn: TurnEntry): boolean {
  return turn.messages[0]?.kind === "user_message";
}

/**
 * In-flight analogue of {@link turnHasUserMessage}.
 */
function activeTurnHasUserMessage(active: ActiveTurnSnapshot | null): boolean {
  if (active === null) return false;
  return active.messages[0]?.kind === "user_message";
}

/**
 * Read the opening `user_message` Message of a turn (committed) or
 * an active turn — `undefined` when none is present (a wake).
 */
function readUserMessage(
  messages: ReadonlyArray<TurnEntry["messages"][number]>,
): UserMessage | undefined {
  const head = messages[0];
  if (head !== undefined && head.kind === "user_message") return head;
  return undefined;
}

/**
 * Precomputed row layout for one snapshot. The data source memoizes
 * this per snapshot identity ({@link DevTranscriptDataSource.layout})
 * so per-`rowAt` calls don't re-walk the transcript.
 *
 * Rows per turn:
 *  - Turn with a `user_message` head → 2 rows (user + assistant).
 *  - Turn without (wake) → 1 row (assistant only).
 *  - Each queued send → 1 ghost row.
 */
export interface RowLayout {
  /** Total number of rows the data source exposes for this snapshot. */
  totalRows: number;
  /**
   * For each turnIndex, the flat row index where that turn's first
   * (and possibly only) row lives. For a normal turn, the user row is
   * at `turnStartRow[turnIndex]` and the assistant row at
   * `turnStartRow[turnIndex] + 1`. For a wake turn, the single
   * assistant row is at `turnStartRow[turnIndex]`.
   */
  turnStartRow: ReadonlyArray<number>;
  /**
   * Parallel to {@link turnStartRow}: true if the turn opens with a
   * `user_message` Message (2 rows), false if not (wake, 1 row).
   */
  turnHasUserPerTurn: ReadonlyArray<boolean>;
  /** Flat row index where the in-flight pair (or wake row) starts; -1 if no in-flight. */
  activeStartRow: number;
  /** True when the in-flight turn opens with a `user_message` Message. */
  activeHasUser: boolean;
  /** Flat row index where ghost rows start; equals {@link totalRows} when there are no ghosts. */
  ghostStartRow: number;
}

/**
 * Build the {@link RowLayout} for `snap`. Pure function — exported
 * for unit-test reuse. Walks `snap.transcript` once, summing per-turn
 * row counts; then accounts for the in-flight turn and the ghost rows.
 */
export function buildRowLayout(snap: CodeSessionSnapshot): RowLayout {
  const transcript = snap.transcript;
  const turnStartRow: number[] = new Array(transcript.length);
  const turnHasUserPerTurn: boolean[] = new Array(transcript.length);
  let cursor = 0;
  for (let i = 0; i < transcript.length; i++) {
    turnStartRow[i] = cursor;
    const hasUser = turnHasUserMessage(transcript[i]);
    turnHasUserPerTurn[i] = hasUser;
    cursor += hasUser ? 2 : 1;
  }
  const active = snap.activeTurn;
  const activeHasUser = activeTurnHasUserMessage(active);
  let activeStartRow = -1;
  if (active !== null) {
    activeStartRow = cursor;
    cursor += activeHasUser ? 2 : 1;
  }
  const ghostStartRow = cursor;
  cursor += snap.queuedSends.length;
  return {
    totalRows: cursor,
    turnStartRow,
    turnHasUserPerTurn,
    activeStartRow,
    activeHasUser,
    ghostStartRow,
  };
}

// ---------------------------------------------------------------------------
// Index-layout helpers
// ---------------------------------------------------------------------------

/**
 * List-view row index of committed turn `turnIndex`'s **user** row.
 * Callers MUST first gate on whether the turn has a user row
 * (`transcript[turnIndex].messages[0]?.kind === "user_message"`) — a
 * wake turn has no user row to point at.
 *
 * Walks the transcript prefix to sum row counts contributed by
 * preceding turns (variable per turn under [D07]).
 *
 * The transcript renders each row's `#NNNN` sequence badge as
 * `rowIndex + 1`.
 */
export function userRowIndexForTurn(
  turnIndex: number,
  transcript: ReadonlyArray<TurnEntry>,
): number {
  if (turnIndex < 0 || turnIndex >= transcript.length) return -1;
  let cursor = 0;
  for (let i = 0; i < turnIndex; i++) {
    cursor += turnHasUserMessage(transcript[i]) ? 2 : 1;
  }
  return cursor;
}

/**
 * List-view row index of committed turn `turnIndex`'s **assistant**
 * (`assistant`) row. For a normal turn this is the user row's immediate
 * successor (`turnStartRow + 1`); for a wake turn (no user row) this
 * IS the turn's only row (`turnStartRow`). Either way the assistant
 * row exists for every committed turn.
 */
export function assistantRowIndexForTurn(
  turnIndex: number,
  transcript: ReadonlyArray<TurnEntry>,
): number {
  if (turnIndex < 0 || turnIndex >= transcript.length) return -1;
  let cursor = 0;
  for (let i = 0; i < turnIndex; i++) {
    cursor += turnHasUserMessage(transcript[i]) ? 2 : 1;
  }
  return turnHasUserMessage(transcript[turnIndex]) ? cursor + 1 : cursor;
}

/**
 * Locate which committed turn (and which half) a flat row index
 * belongs to, using the precomputed {@link RowLayout}. Caller must
 * have already ruled out ghost rows and in-flight rows.
 */
function locateCommittedRow(
  index: number,
  layout: RowLayout,
): { turnIndex: number; isAssistantRow: boolean } {
  // Binary search for the largest `turnIndex` with `turnStartRow[i]
  // <= index`. The arrays are short (one entry per turn — single-
  // digit-thousands at most), but binary search is O(log n) instead
  // of O(n) per `rowAt` call, and `rowAt` runs once per visible row
  // per render, so a long transcript on a fast scroll benefits from
  // the lower asymptotic.
  let lo = 0;
  let hi = layout.turnStartRow.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (layout.turnStartRow[mid] <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const turnIndex = lo;
  const hasUser = layout.turnHasUserPerTurn[turnIndex];
  // Wake turn: the single row IS the assistant row. Normal turn:
  // assistant row is offset+1.
  const isAssistantRow = hasUser
    ? index > layout.turnStartRow[turnIndex]
    : true;
  return { turnIndex, isAssistantRow };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Class-shaped adapter so consumers (and cell renderers) can narrow the
 * `TugListViewDataSource` generic parameter to `DevTranscriptDataSource`
 * and call `rowAt(index)` without casting — mirrors the gallery card's
 * pattern.
 */
export class DevTranscriptDataSource implements TugListViewDataSource {
  constructor(private readonly _codeSessionStore: CodeSessionStore) {}

  /**
   * Memo of the transcript window-walk, keyed by snapshot identity.
   * `rowAt` is called once per visible row per render; recomputing the
   * O(turns) walk on every call would be O(rows × turns) of pointless
   * churn (plus a fresh `cost[]` allocation each time). The snapshot
   * reference is `Object.is`-stable between dispatches, so caching on
   * it recomputes exactly once per change and shares the result
   * across every `rowAt` call in the same render.
   */
  private _windowsMemo: {
    snapshot: CodeSessionSnapshot;
    windows: ReadonlyArray<ContextWindowStep>;
  } | null = null;

  /**
   * Memo of the per-snapshot {@link RowLayout}. Same reference-stability
   * contract as `_windowsMemo`: recomputed exactly once per snapshot
   * identity.
   */
  private _layoutMemo: {
    snapshot: CodeSessionSnapshot;
    layout: RowLayout;
  } | null = null;

  /**
   * The per-turn context-window walk for `snap`, computed once per
   * snapshot and reused. See {@link _windowsMemo}.
   */
  private contextWindows(
    snap: CodeSessionSnapshot,
  ): ReadonlyArray<ContextWindowStep> {
    if (this._windowsMemo !== null && this._windowsMemo.snapshot === snap) {
      return this._windowsMemo.windows;
    }
    const windows = deriveContextWindows(
      snap.transcript.map((t) => t.cost),
      snap.sessionInitTokens ?? 0,
    );
    this._windowsMemo = { snapshot: snap, windows };
    return windows;
  }

  /**
   * The {@link RowLayout} for `snap`, computed once per snapshot and
   * reused. See {@link _layoutMemo}.
   */
  private layout(snap: CodeSessionSnapshot): RowLayout {
    if (this._layoutMemo !== null && this._layoutMemo.snapshot === snap) {
      return this._layoutMemo.layout;
    }
    const layout = buildRowLayout(snap);
    this._layoutMemo = { snapshot: snap, layout };
    return layout;
  }

  /**
   * Total number of rows the data source exposes for the current
   * snapshot. Variable per turn — wake turns occupy a single row
   * (just the `assistant` row, no user row), normal turns
   * occupy two. See {@link RowLayout} for the per-turn shape.
   */
  numberOfItems(): number {
    return this.layout(this._codeSessionStore.getSnapshot()).totalRows;
  }

  /**
   * Stable React-key seed per the id-stability protocol:
   *
   *  - Normal committed pair: `${turnKey}-user` at the turn's first
   *    row, `${turnKey}-assistant` at the next.
   *  - Wake committed turn: `${turnKey}-assistant` at the turn's single
   *    row. The `${turnKey}-user` key is **never minted** for a wake
   *    turn — there is no user row to key. Minting it anyway would
   *    leave the cell wrapper's React identity tied to a key with no
   *    rendered counterpart, breaking the [L26] mount-survival
   *    invariant for any future state where the wake's row position
   *    shifts (e.g., a new turn committing above it).
   *  - In-flight (normal): `${turnKey}-user` at `activeStartRow`,
   *    `${turnKey}-assistant` at `activeStartRow + 1`.
   *  - In-flight wake: `${turnKey}-assistant` at `activeStartRow` only.
   *  - Ghost rows: `${turnKey}-ghost`, distinct from `-user`/`-assistant`
   *    so a queued send flushing into an in-flight pair is a clean
   *    unmount + mount (a real transition, not the seamless
   *    inflight → committed one).
   *
   * `turnKey` is generated once at `handleSend` or `handleWakeStarted`
   * and copied unchanged onto `TurnEntry` at `handleTurnComplete` —
   * so the in-flight pair's id is byte-identical to the committed
   * pair's id for the same turn. React sees the same key + the same
   * component type (the cellRenderers map holds one entry for the
   * unified `"assistant"` kind), so the cell wrapper survives the
   * inflight → committed transition with no unmount.
   *
   * `msgId` is the wire-correlation identifier and is intentionally
   * NOT used here: it isn't assigned until the first streaming frame
   * lands, which is mid-turn, so any id derived from it would change
   * during the turn and trigger a remount.
   */
  idForIndex(index: number): string {
    const snap = this._codeSessionStore.getSnapshot();
    const layout = this.layout(snap);

    // Ghost row — one queued send.
    if (index >= layout.ghostStartRow) {
      return `${snap.queuedSends[index - layout.ghostStartRow].turnKey}-ghost`;
    }

    // In-flight turn rows.
    if (
      layout.activeStartRow >= 0 &&
      index >= layout.activeStartRow &&
      index < layout.ghostStartRow
    ) {
      const active = snap.activeTurn!;
      if (!layout.activeHasUser) {
        // Wake in-flight: single `${turnKey}-assistant` row, no `-user` minted.
        return `${active.turnKey}-assistant`;
      }
      return index === layout.activeStartRow
        ? `${active.turnKey}-user`
        : `${active.turnKey}-assistant`;
    }

    // Committed turn — find which turn this row belongs to.
    const { turnIndex, isAssistantRow } = locateCommittedRow(index, layout);
    const turn = snap.transcript[turnIndex];
    return isAssistantRow ? `${turn.turnKey}-assistant` : `${turn.turnKey}-user`;
  }

  /**
   * Cell-renderer kind. Three values:
   *  - `"user"` for the user-half row of a normal committed/in-flight
   *    turn. Never returned for a wake turn (which has no user row).
   *  - `"assistant"` for every assistant row, in-flight or committed,
   *    wake or normal. Unified kind across all assistant phases per
   *    [L26] (eliminates the lambda-identity trap that would otherwise
   *    re-mount the cell wrapper at `turn_complete`).
   *  - `"ghost"` for each queued-send row.
   */
  kindForIndex(index: number): DevTranscriptCellKind {
    const snap = this._codeSessionStore.getSnapshot();
    const layout = this.layout(snap);

    if (index >= layout.ghostStartRow) return "ghost";

    if (
      layout.activeStartRow >= 0 &&
      index >= layout.activeStartRow &&
      index < layout.ghostStartRow
    ) {
      if (!layout.activeHasUser) return "assistant";
      return index === layout.activeStartRow ? "user" : "assistant";
    }

    const { isAssistantRow } = locateCommittedRow(index, layout);
    return isAssistantRow ? "assistant" : "user";
  }

  /**
   * Typed row descriptor for `index`. Cell renderers call this from
   * inside `useSyncExternalStore`-bound props rather than peeking at
   * the snapshot themselves so the adapter remains the single seam
   * between `CodeSessionStore` and the list view.
   *
   * Wake turns produce a single `{kind:"assistant", turn, ...}` descriptor —
   * no separate user-row descriptor exists.
   */
  rowAt(index: number): DevRowDescriptor {
    const snap = this._codeSessionStore.getSnapshot();
    const layout = this.layout(snap);

    // Ghost row.
    if (index >= layout.ghostStartRow) {
      const queued = snap.queuedSends[index - layout.ghostStartRow];
      return { kind: "ghost", queued, turnKey: queued.turnKey };
    }

    // In-flight turn rows.
    if (
      layout.activeStartRow >= 0 &&
      index >= layout.activeStartRow &&
      index < layout.ghostStartRow
    ) {
      const active = snap.activeTurn!;
      if (!layout.activeHasUser) {
        // Wake — single assistant row.
        return { kind: "assistant", activeTurn: active, turnKey: active.turnKey };
      }
      if (index === layout.activeStartRow) {
        return { kind: "user", activeTurn: active, turnKey: active.turnKey };
      }
      return { kind: "assistant", activeTurn: active, turnKey: active.turnKey };
    }

    // Committed turn.
    const { turnIndex, isAssistantRow } = locateCommittedRow(index, layout);
    const turn = snap.transcript[turnIndex];
    // Signed per-turn token delta from the transcript window-walk —
    // window(N) − window(N−1), carry-forward over any zero-usage turn.
    const windows = this.contextWindows(snap);
    return {
      kind: isAssistantRow ? "assistant" : "user",
      turn,
      perTurnTokens: windows[turnIndex]?.perTurn,
      turnKey: turn.turnKey,
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
// Re-exports for consumers that need to read a Message head
// ---------------------------------------------------------------------------

export { readUserMessage };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Construct a `DevTranscriptDataSource` bound to `codeSessionStore` and
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
export function useDevTranscriptDataSource(
  codeSessionStore: CodeSessionStore,
): DevTranscriptDataSource {
  const adapter = useMemo(
    () => new DevTranscriptDataSource(codeSessionStore),
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
