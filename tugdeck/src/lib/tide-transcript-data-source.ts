/**
 * `TideTranscriptDataSource` — adapter that surfaces a `CodeSessionStore`
 * snapshot as a `TugListViewDataSource`. Each committed turn becomes two
 * adjacent rows (`user`, `code`); the in-flight turn — if present —
 * appends another two rows (also `user`, `code`) at the end.
 *
 * Index layout (with `n = transcript.length`, `f = inflightUserMessage`,
 * `q = queuedSends.length`):
 *
 *   indices 0..2n-1     committed turns, alternating user / code.
 *   indices 2n..2n+1    in-flight pair (only when f !== null).
 *   the trailing q rows ghost rows — one per queued send, in submit
 *                       order — when q > 0 (the QUEUED_NEXT_TURN
 *                       overlay; see {@link TideTranscriptCellKind}).
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
  QueuedSend,
  TurnEntry,
} from "@/lib/code-session-store";
import { deriveContextWindows } from "@/lib/code-session-store/end-state";
import type { ContextWindowStep } from "@/lib/code-session-store/end-state";
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
 *
 * `"ghost"` is a third kind, and — unlike a `code-*` split — a sound
 * one: a ghost row is a *standalone* row (one queued send, no turn
 * pair), a genuinely distinct identity, not one row's life split in
 * two. It never morphs in place into a `user` / `code` row: when a
 * queued send flushes, its ghost row (keyed `${turnKey}-ghost`)
 * unmounts and the in-flight pair (keyed `${turnKey}-user` / `-code`)
 * mounts — a real queued -> sent transition, correctly a remount.
 */
export type TideTranscriptCellKind = "user" | "code" | "ghost";

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
  /** Set for a `ghost` row only — the queued send it paints. */
  queued?: QueuedSend;
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
// Wake-detection predicates
// ---------------------------------------------------------------------------

/**
 * True iff the committed `turn` is a wake bracket's commit, recognized
 * by the empty-text user-message sentinel from [D01] / Step 4. The wake
 * has no user submission to render — the marker is a placeholder
 * created by `handleWakeStarted` to carry the wake's `turnKey` and
 * `submitAt` through the bracket. Consumers (this data source, the
 * transcript renderer) treat such turns as **single-row entries**:
 * only the assistant `code` row exists; no `user` row is emitted.
 *
 * Definition is intentionally narrow — `text === "" && atoms.length
 * === 0`. A genuine user submission with empty text (impossible today;
 * the prompt-entry guards against empty submits) but a non-empty atoms
 * array would still render as a normal user row. The contract is
 * pinned at [D01]: the marker is BOTH empty text AND empty atoms.
 *
 * See `roadmap/tugplan-tide-session-wake.md` [D06] / [Q05] for the
 * orphan-assistant rationale, and Step 12 for the data-source-layer
 * fix this predicate gates.
 */
export function isWakeTurn(turn: TurnEntry): boolean {
  return turn.userMessage.text === "" && turn.userMessage.attachments.length === 0;
}

/**
 * In-flight analogue of {@link isWakeTurn} — true iff `inflight` is
 * the wake's empty-text marker (the active wake bracket has set
 * `pendingUserMessage` to `{text:"", atoms:[]}` per
 * [#spec-wake-started-state-reset]). Used by the data-source layout
 * to emit ONE in-flight row (the streaming `code` row) rather than
 * TWO when a wake turn is in flight.
 *
 * Returns false when `inflight === null` — there's no in-flight turn
 * at all, wake or otherwise.
 */
export function isWakeInflight(
  inflight: CodeSessionSnapshot["inflightUserMessage"],
): boolean {
  if (inflight === null) return false;
  return inflight.text === "" && inflight.atoms.length === 0;
}

// ---------------------------------------------------------------------------
// Layout — per-snapshot precomputed table mapping flat row index → turn
// ---------------------------------------------------------------------------

/**
 * Precomputed row layout for one snapshot. The data source memoizes
 * this per snapshot identity ({@link TideTranscriptDataSource.layout})
 * so per-`rowAt` calls don't re-walk the transcript.
 *
 * **Rows per turn is variable**, per [D06]:
 *   - Normal committed turn → 2 rows (user, code).
 *   - Wake committed turn ({@link isWakeTurn}) → 1 row (code only).
 *   - Normal in-flight pair → 2 rows.
 *   - Wake in-flight ({@link isWakeInflight}) → 1 row.
 *   - Each queued send → 1 ghost row.
 *
 * The flat index math therefore can't be `turnIndex * 2` — callers
 * must look up `turnStartRow[turnIndex]` and consult
 * `isWakePerTurn[turnIndex]` to compute the user/code offset.
 *
 * Reference-stable: the layout is recomputed only when the snapshot's
 * identity changes (memoization in {@link TideTranscriptDataSource}),
 * so consumers reading the layout repeatedly within one render get
 * the same arrays back ([L02] `Object.is` stability for downstream
 * `useSyncExternalStore` consumers).
 */
export interface RowLayout {
  /** Total number of rows the data source exposes for this snapshot. */
  totalRows: number;
  /**
   * For each turnIndex, the flat row index where that turn's first
   * (and possibly only) row lives. For a non-wake turn, the user row
   * is at `turnStartRow[turnIndex]` and the code row at
   * `turnStartRow[turnIndex] + 1`. For a wake turn, the single code
   * row is at `turnStartRow[turnIndex]`.
   */
  turnStartRow: ReadonlyArray<number>;
  /** Parallel to {@link turnStartRow}: true if the turn is a wake (1 row), false if normal (2). */
  isWakePerTurn: ReadonlyArray<boolean>;
  /** Flat row index where the in-flight pair (or wake row) starts; -1 if no in-flight. */
  inflightStartRow: number;
  /** True when the in-flight is a wake (1 row); false when normal (2). */
  inflightIsWake: boolean;
  /** Flat row index where ghost rows start; equals {@link totalRows} when there are no ghosts. */
  ghostStartRow: number;
}

/**
 * Build the {@link RowLayout} for `snap`. Pure function — exported
 * for unit-test reuse. Walks `snap.transcript` once, summing per-turn
 * row counts; then accounts for the in-flight pair and the ghost rows.
 */
export function buildRowLayout(snap: CodeSessionSnapshot): RowLayout {
  const transcript = snap.transcript;
  const turnStartRow: number[] = new Array(transcript.length);
  const isWakePerTurn: boolean[] = new Array(transcript.length);
  let cursor = 0;
  for (let i = 0; i < transcript.length; i++) {
    turnStartRow[i] = cursor;
    const wake = isWakeTurn(transcript[i]);
    isWakePerTurn[i] = wake;
    cursor += wake ? 1 : 2;
  }
  const inflight = snap.inflightUserMessage;
  const inflightIsWake = isWakeInflight(inflight);
  let inflightStartRow = -1;
  if (inflight !== null) {
    inflightStartRow = cursor;
    cursor += inflightIsWake ? 1 : 2;
  }
  const ghostStartRow = cursor;
  cursor += snap.queuedSends.length;
  return {
    totalRows: cursor,
    turnStartRow,
    isWakePerTurn,
    inflightStartRow,
    inflightIsWake,
    ghostStartRow,
  };
}

// ---------------------------------------------------------------------------
// Index-layout helpers
// ---------------------------------------------------------------------------

/**
 * List-view row index of committed turn `turnIndex`'s **user** row,
 * or `-1` if the turn is a wake (which has no user row — see [D06]).
 *
 * Callers (the Z2 telemetry popovers' scroll-to-row buttons) must
 * check `>= 0` before passing the result to scroll machinery — a
 * wake turn has nothing to scroll the user-half pointer to. The
 * symmetric {@link assistantRowIndexForTurn} always returns a valid
 * index (the assistant row exists for every turn).
 *
 * The signature changed from `(turnIndex)` to `(turnIndex, transcript)`
 * in Slice 1c-a: with variable rows-per-turn, the flat index can no
 * longer be derived from `turnIndex` alone — the helper must walk the
 * transcript prefix to sum the row count contributed by preceding
 * turns. Callers iterating `snapshot.transcript` already have the
 * array, so threading it through is free.
 *
 * The transcript renders each row's `#NNNN` sequence badge as
 * `rowIndex + 1`.
 */
export function userRowIndexForTurn(
  turnIndex: number,
  transcript: ReadonlyArray<TurnEntry>,
): number {
  if (turnIndex < 0 || turnIndex >= transcript.length) return -1;
  if (isWakeTurn(transcript[turnIndex])) return -1;
  let cursor = 0;
  for (let i = 0; i < turnIndex; i++) {
    cursor += isWakeTurn(transcript[i]) ? 1 : 2;
  }
  return cursor;
}

/**
 * List-view row index of committed turn `turnIndex`'s **assistant**
 * (`code`) row. For a normal turn this is the user row's immediate
 * successor (`turnStartRow + 1`); for a wake turn (no user row) this
 * IS the turn's only row (`turnStartRow`). Either way the assistant
 * row exists for every committed turn.
 *
 * See {@link userRowIndexForTurn} for the signature change in Slice
 * 1c-a (now takes `transcript` to walk the variable rows-per-turn
 * prefix).
 */
export function assistantRowIndexForTurn(
  turnIndex: number,
  transcript: ReadonlyArray<TurnEntry>,
): number {
  if (turnIndex < 0 || turnIndex >= transcript.length) return -1;
  let cursor = 0;
  for (let i = 0; i < turnIndex; i++) {
    cursor += isWakeTurn(transcript[i]) ? 1 : 2;
  }
  // Wake turns have a single row AT cursor; non-wake have a code row
  // at cursor+1.
  return isWakeTurn(transcript[turnIndex]) ? cursor : cursor + 1;
}

/**
 * Locate which committed turn (and which half) a flat row index
 * belongs to, using the precomputed {@link RowLayout}. Caller must
 * have already ruled out ghost rows and in-flight rows (i.e., this is
 * only valid for `index < layout.inflightStartRow` when an in-flight
 * exists, or `index < layout.ghostStartRow` when not).
 *
 * Returns `{turnIndex, isWakeRow, isAssistantHalf}` where:
 *  - `turnIndex` is the index into `snap.transcript`.
 *  - `isWakeRow` is true if the turn is a wake (single row; the row
 *    IS the assistant row, no user row to disambiguate).
 *  - `isAssistantHalf` is true for the `code` row of a non-wake turn
 *    (the second of the two rows). Meaningless when `isWakeRow` is
 *    true — the caller should branch on `isWakeRow` first.
 */
function locateCommittedRow(
  index: number,
  layout: RowLayout,
): { turnIndex: number; isWakeRow: boolean; isAssistantHalf: boolean } {
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
  const isWakeRow = layout.isWakePerTurn[turnIndex];
  const isAssistantHalf = isWakeRow
    ? true
    : index > layout.turnStartRow[turnIndex];
  return { turnIndex, isWakeRow, isAssistantHalf };
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
   * identity. Every public method below reads the layout instead of
   * doing inline index math; the variable rows-per-turn shape (wake
   * turns = 1 row, normal = 2) demands a precomputed table.
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
   * (just the assistant `code` row, no user row), normal turns
   * occupy two. See {@link RowLayout} for the per-turn shape.
   */
  numberOfItems(): number {
    return this.layout(this._codeSessionStore.getSnapshot()).totalRows;
  }

  /**
   * Stable React-key seed per the id-stability protocol:
   *
   *  - Non-wake committed pair: `${turnKey}-user` at the turn's first
   *    row, `${turnKey}-code` at the next.
   *  - Wake committed turn: `${turnKey}-code` at the turn's single
   *    row. The `${turnKey}-user` key is **never minted** for a wake
   *    turn — there is no user row to key. Minting it anyway would
   *    leave the cell wrapper's React identity tied to a key with no
   *    rendered counterpart, breaking the [L26] mount-survival
   *    invariant for any future state where the wake's row position
   *    shifts (e.g., a new turn committing above it).
   *  - In-flight pair (normal): `${turnKey}-user` at `inflightStartRow`,
   *    `${turnKey}-code` at `inflightStartRow + 1`.
   *  - In-flight wake: `${turnKey}-code` at `inflightStartRow` only.
   *  - Ghost rows: `${turnKey}-ghost`, distinct from `-user`/`-code`
   *    so a queued send flushing into an in-flight pair is a clean
   *    unmount + mount (a real transition, not the seamless
   *    inflight → committed one).
   *
   * `turnKey` is generated once at `handleSend` or `handleWakeStarted`
   * and copied unchanged onto `TurnEntry` at `handleTurnComplete` —
   * so the in-flight pair's id is byte-identical to the committed
   * pair's id for the same turn. React sees the same key + the same
   * component type (the cellRenderers map holds one entry for the
   * unified `"code"` kind), so the cell wrapper survives the
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

    // In-flight pair (or wake row).
    if (
      layout.inflightStartRow >= 0 &&
      index >= layout.inflightStartRow &&
      index < layout.ghostStartRow
    ) {
      const inflight = snap.inflightUserMessage!;
      // Wake in-flight: single `${turnKey}-code` row, no `-user` minted.
      if (layout.inflightIsWake) {
        return `${inflight.turnKey}-code`;
      }
      return index === layout.inflightStartRow
        ? `${inflight.turnKey}-user`
        : `${inflight.turnKey}-code`;
    }

    // Committed turn — find which turn this row belongs to.
    const { turnIndex, isWakeRow, isAssistantHalf } = locateCommittedRow(
      index,
      layout,
    );
    const turn = snap.transcript[turnIndex];
    // Wake committed turn: single `${turnKey}-code` row, no `-user`.
    if (isWakeRow) {
      return `${turn.turnKey}-code`;
    }
    return isAssistantHalf
      ? `${turn.turnKey}-code`
      : `${turn.turnKey}-user`;
  }

  /**
   * Cell-renderer kind. Three values:
   *  - `"user"` for the user-half row of a normal committed/in-flight
   *    pair. **Never returned for a wake turn** (which has no user
   *    row — see [D06]).
   *  - `"code"` for every assistant row, in-flight or committed,
   *    wake or normal. Unified kind across all assistant phases per
   *    [L26] (eliminates the lambda-identity trap that would otherwise
   *    re-mount the cell wrapper at `turn_complete`).
   *  - `"ghost"` for each queued-send row.
   */
  kindForIndex(index: number): TideTranscriptCellKind {
    const snap = this._codeSessionStore.getSnapshot();
    const layout = this.layout(snap);

    if (index >= layout.ghostStartRow) return "ghost";

    if (
      layout.inflightStartRow >= 0 &&
      index >= layout.inflightStartRow &&
      index < layout.ghostStartRow
    ) {
      if (layout.inflightIsWake) return "code";
      return index === layout.inflightStartRow ? "user" : "code";
    }

    const { isWakeRow, isAssistantHalf } = locateCommittedRow(index, layout);
    if (isWakeRow) return "code";
    return isAssistantHalf ? "code" : "user";
  }

  /**
   * Typed row descriptor for `index`. Cell renderers call this from
   * inside `useSyncExternalStore`-bound props rather than peeking at
   * the snapshot themselves so the adapter remains the single seam
   * between `CodeSessionStore` and the list view.
   *
   * Wake turns produce a single `{kind:"code", turn, perTurnTokens,
   * turnKey}` descriptor — no separate user-row descriptor exists.
   */
  rowAt(index: number): TideRowDescriptor {
    const snap = this._codeSessionStore.getSnapshot();
    const layout = this.layout(snap);

    // Ghost row.
    if (index >= layout.ghostStartRow) {
      const queued = snap.queuedSends[index - layout.ghostStartRow];
      return { kind: "ghost", queued, turnKey: queued.turnKey };
    }

    // In-flight pair (or wake row).
    if (
      layout.inflightStartRow >= 0 &&
      index >= layout.inflightStartRow &&
      index < layout.ghostStartRow
    ) {
      const inflight = snap.inflightUserMessage!;
      if (layout.inflightIsWake) {
        // Streaming wake's assistant row — no `turn` payload yet, no
        // `inflight` payload (the empty-text marker is not a user
        // submission worth surfacing).
        return { kind: "code", turnKey: inflight.turnKey };
      }
      if (index === layout.inflightStartRow) {
        return { kind: "user", inflight, turnKey: inflight.turnKey };
      }
      return { kind: "code", turnKey: inflight.turnKey };
    }

    // Committed turn.
    const { turnIndex, isWakeRow, isAssistantHalf } = locateCommittedRow(
      index,
      layout,
    );
    const turn = snap.transcript[turnIndex];
    // Signed per-turn token delta from the transcript window-walk —
    // window(N) − window(N−1), carry-forward over any zero-usage turn.
    // The walk needs the whole transcript: a single turn's `cost`
    // can't yield its delta (the prior turn may be a zero-usage turn,
    // whose window is the one before IT). Memoized per snapshot — see
    // {@link contextWindows}.
    const windows = this.contextWindows(snap);
    return {
      kind: isWakeRow || isAssistantHalf ? "code" : "user",
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
