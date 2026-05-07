/**
 * `TidePickerDataSource` — composite `TugListViewDataSource` for the
 * Tide project picker. Implements [Spec S01]'s seven-kind row
 * vocabulary across three optional sections (RECENTS, SESSIONS,
 * PENDING) by enumerating from three upstream signals:
 *
 *  - `recents: ReadonlyArray<string>` — the tugbank tagged value
 *    `dev.tugtool.tide / recent-projects`.
 *  - `query: string` — the user-typed (and trimmed) project path.
 *  - `ledger: WorkspaceSnapshot` — the session-ledger snapshot for
 *    `query` from `TideSessionLedgerStore`.
 *
 * The picker form (`TideProjectPickerForm` in `tide-card.tsx`,
 * rewritten in Step 9) constructs this data source via the
 * `useTidePickerDataSource` hook and feeds it to a
 * `<TugListView dataSource={...} inline />`. The data source emits
 * the section sequence the picker renders; cell renderers (Step 8)
 * dispatch by kind.
 *
 * ## Section enumeration (per [Spec S01])
 *
 * Sections are emitted in this order, each independently optional:
 *
 *   RECENTS:
 *     - Visible when at least one recent matches `query` via
 *       `caseInsensitiveSubstring()` ([D13]) AND is not exactly
 *       equal to `query` (case-sensitive — user has typed the full
 *       path, no need to suggest it).
 *     - Empty `query` matches all recents; the matcher returns an
 *       empty `matches` array (no highlights).
 *     - Emits `header-recents` followed by one `path-recent` per
 *       qualifying recent. The `path-recent` row carries the
 *       matcher's `matches` ranges so cell renderers paint
 *       highlights without re-running the matcher.
 *
 *   SESSIONS:
 *     - Visible when `query.length > 0` AND `ledger.status ===
 *       "ready"`.
 *     - Emits `header-sessions`, then `session-new` (always
 *       present), then one `session-resume` per ledger row in the
 *       order the ledger provides them (newest-first per the
 *       `last_used_at` ordering of `list_sessions_ok`). Live rows
 *       are emitted with `row.state === "live"`; the cell renderer
 *       paints them as disabled per [Spec S01].
 *     - Footer: `forget-all` is appended after the last
 *       `session-resume` IFF at least one row has `state !==
 *       "live"` (only non-live rows are eligible for forget).
 *
 *   PENDING:
 *     - Visible when `query.length > 0` AND `ledger.status ===
 *       "pending"`.
 *     - Emits a single `loading` row.
 *     - Mutually exclusive with SESSIONS — they switch on
 *       `ledger.status`.
 *
 * `ledger.status === "idle"` and `"error"` produce no SESSIONS and
 * no PENDING. `"error"` is surfaced separately by the picker form's
 * notice banner ([D11]); the data source treats it as "no rows
 * worth showing in the body."
 *
 * ## Identity contract
 *
 * - `idForIndex(i)` is stable for a given logical row across
 *   recompositions — `recents:<path>` for `path-recent`,
 *   `session:resume:<sessionId>` for `session-resume`, and the
 *   literal kind name for the singletons (`header-recents`,
 *   `header-sessions`, `session-new`, `forget-all`, `loading`).
 *   This satisfies `TugListView`'s item-stable React key contract:
 *   a session row's id stays the same when its index shifts due to
 *   a recents change, so React reconciler matches identity across
 *   ledger ticks.
 *
 * - `getVersion()` is a monotonic counter incremented on every
 *   recompute. The version is the `useSyncExternalStore` snapshot
 *   token — `Object.is`-stable when nothing recomputed.
 *
 * ## Why a bespoke composite, not stacked `useFilteredDataSource`
 *
 * Per [D12]: recents are typically <20 items; the windowing benefit
 * of a wrapper is zero at that scale. The composite already has to
 * fan in two upstreams (recents + ledger) and emit headers/footers
 * around them; threading recents through `useFilteredDataSource`
 * adds an indirection without payoff. The wrapper remains the
 * canonical reusable pattern (see `gallery-list-view-filter`); the
 * picker's choice is a documented exception based on data shape.
 *
 * ## React glue
 *
 * `useTidePickerDataSource(recents, query, ledger)` mints a single
 * data-source instance per hook lifetime and feeds it the latest
 * inputs each render. Identity-stable inputs short-circuit
 * (no recompute, no listener notify). When inputs change, the
 * recompute is synchronous in render so `useSyncExternalStore`'s
 * snapshot read sees the new state immediately; the listener
 * notify is deferred to `useLayoutEffect` so subscriber callbacks
 * fire OUTSIDE the current render — the same pattern as
 * `useFilteredDataSource` and for the same React-correctness
 * reason.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — this data
 *    source IS such a store (`subscribe` + `getVersion`).
 *  - [L03] event-dependent registrations in `useLayoutEffect` —
 *    the deferred-notify lives there.
 *  - [L19] component authoring guide — module docstring, exported
 *    types, file-pair with the test file.
 *
 * Decisions:
 *  - tugplan-tide-picker-redesign [D02] role-flat-list — headers
 *    and footers ride the row-role contract Phase 0 introduced.
 *  - [D11] notice-outside-list — the picker notice banner does NOT
 *    appear in this data source; it renders above the list view.
 *  - [D12] picker-eager-filter — recents are filtered internally,
 *    not via `useFilteredDataSource`.
 *  - [D13] shared text matcher — recents matching uses
 *    `caseInsensitiveSubstring` from `@/lib/text-match`.
 *  - [Spec S01] row vocabulary; [Spec S03] selection invalidation
 *    (the picker's responsibility, not the data source's, but the
 *    data source's stable `idForIndex` is what makes it
 *    expressible).
 */

import { useLayoutEffect, useRef } from "react";

import type {
  TugListViewCellRole,
  TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import type { SessionRow } from "../protocol";
import { caseInsensitiveSubstring } from "./text-match";
import type { WorkspaceSnapshot } from "./tide-session-ledger-store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated union of the seven row kinds the picker emits. Each
 * variant carries exactly the data its cell renderer needs — kind is
 * the discriminant; `dataSource.rowAt(i)` gives the renderer typed
 * access without a cast at the call site.
 */
export type PickerRow =
  | { readonly kind: "header-recents" }
  | {
      readonly kind: "path-recent";
      readonly path: string;
      /**
       * Match ranges from `caseInsensitiveSubstring(query, path)` —
       * UTF-16 code unit half-open intervals identifying the
       * highlighted span of `path`. Empty array on empty `query`
       * (no filter active).
       */
      readonly matches: ReadonlyArray<readonly [number, number]>;
    }
  | { readonly kind: "header-sessions" }
  | { readonly kind: "session-new" }
  | { readonly kind: "session-resume"; readonly row: SessionRow }
  | { readonly kind: "forget-all"; readonly nonLiveCount: number }
  | { readonly kind: "loading" };

export interface PickerInputs {
  readonly recents: ReadonlyArray<string>;
  readonly query: string;
  readonly ledger: WorkspaceSnapshot;
}

// ---------------------------------------------------------------------------
// Stable id constants
// ---------------------------------------------------------------------------

const ID_HEADER_RECENTS = "header-recents";
const ID_HEADER_SESSIONS = "header-sessions";
const ID_SESSION_NEW = "session:new";
const ID_FORGET_ALL = "forget-all";
const ID_LOADING = "loading";

// ---------------------------------------------------------------------------
// TidePickerDataSource
// ---------------------------------------------------------------------------

/**
 * Composite `TugListViewDataSource` for the picker. Constructor
 * takes the initial input snapshot and computes the row sequence;
 * `setInputsWithoutNotify` updates the snapshot in place and
 * re-projects (without firing listeners — that's the hook's job).
 */
export class TidePickerDataSource implements TugListViewDataSource {
  private inputs: PickerInputs;
  private rows: PickerRow[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: PickerInputs) {
    this.inputs = inputs;
    this.recompute();
  }

  // ---- TugListViewDataSource contract ----

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    const row = this.rows[index];
    switch (row.kind) {
      case "header-recents":
        return ID_HEADER_RECENTS;
      case "path-recent":
        // Stable per path — moves through filtered indices without
        // changing identity, so React reconciler matches the same
        // component across recents reorderings.
        return `recents:${row.path}`;
      case "header-sessions":
        return ID_HEADER_SESSIONS;
      case "session-new":
        return ID_SESSION_NEW;
      case "session-resume":
        // Stable per session id. The same session keeps the same
        // cell instance even when ledger ordering shifts (ticks
        // updating last_used_at).
        return `session:resume:${row.row.session_id}`;
      case "forget-all":
        return ID_FORGET_ALL;
      case "loading":
        return ID_LOADING;
    }
  }

  kindForIndex(index: number): string {
    return this.rows[index].kind;
  }

  /**
   * Per [D02] / Phase 0: header rows return `"header"`, the
   * `forget-all` footer returns `"footer"`, everything else is the
   * default `"cell"`. The primitive uses these to set
   * `data-list-cell-role`, `tabIndex={-1}`, and to gate `onSelect`.
   */
  roleForIndex(index: number): TugListViewCellRole {
    const kind = this.rows[index].kind;
    if (kind === "header-recents" || kind === "header-sessions") {
      return "header";
    }
    if (kind === "forget-all") {
      return "footer";
    }
    return "cell";
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getVersion(): unknown {
    return this.version;
  }

  // ---- Typed access for cell renderers ----

  rowAt(index: number): PickerRow {
    return this.rows[index];
  }

  // ---- Hook-driven update API ----

  /**
   * Replace the input snapshot. If any field's identity differs from
   * the current snapshot, recompute the row sequence and bump the
   * version; otherwise no-op.
   *
   * Returns `true` when something changed (the hook's signal to fire
   * `notifyAll` from a layout effect), `false` when the call was a
   * no-op (no listeners need fire).
   *
   * Identity is the only comparison — content-equal but
   * reference-different inputs trigger a recompute. Callers
   * (`useTidePickerDataSource` + the upstream hooks
   * `useTugbankValue` / `useSessionLedger`) are expected to provide
   * identity-stable references when content is unchanged. Both
   * upstream hooks intern their snapshots so identity stability
   * holds in practice.
   */
  setInputsWithoutNotify(next: PickerInputs): boolean {
    if (
      this.inputs.recents === next.recents &&
      this.inputs.query === next.query &&
      this.inputs.ledger === next.ledger
    ) {
      return false;
    }
    this.inputs = next;
    this.recompute();
    return true;
  }

  /** Fire all subscriber listeners exactly once each. */
  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }

  // ---- Internal ----

  private recompute(): void {
    const { recents, query, ledger } = this.inputs;
    const next: PickerRow[] = [];

    // RECENTS section.
    const matchedRecents = this.matchRecents(recents, query);
    if (matchedRecents.length > 0) {
      next.push({ kind: "header-recents" });
      for (const r of matchedRecents) next.push(r);
    }

    // SESSIONS / PENDING — mutually exclusive on ledger.status, both
    // gated on a non-empty query.
    if (query.length > 0) {
      if (ledger.status === "ready") {
        next.push({ kind: "header-sessions" });
        next.push({ kind: "session-new" });
        for (const row of ledger.rows) {
          next.push({ kind: "session-resume", row });
        }
        const nonLiveCount = countNonLive(ledger.rows);
        if (nonLiveCount > 0) {
          next.push({ kind: "forget-all", nonLiveCount });
        }
      } else if (ledger.status === "pending") {
        next.push({ kind: "loading" });
      }
      // "idle" and "error" → no SESSIONS, no PENDING; the notice
      // banner ([D11]) handles the user-facing "error" surface.
    }

    this.rows = next;
    this.version += 1;
  }

  private matchRecents(
    recents: ReadonlyArray<string>,
    query: string,
  ): Array<Extract<PickerRow, { kind: "path-recent" }>> {
    const out: Array<Extract<PickerRow, { kind: "path-recent" }>> = [];
    for (const path of recents) {
      // Per [Spec S01]: exclude any recent whose path is exactly
      // equal to the query (case-sensitive byte comparison — the
      // user typed it, no need to suggest themselves).
      if (path === query) continue;
      const match = caseInsensitiveSubstring(query, path);
      if (match === null) continue;
      out.push({ kind: "path-recent", path, matches: match.matches });
    }
    return out;
  }
}

function countNonLive(rows: ReadonlyArray<SessionRow>): number {
  let n = 0;
  for (const row of rows) {
    if (row.state !== "live") n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook that mints a `TidePickerDataSource` per hook lifetime
 * and feeds it the latest `(recents, query, ledger)` snapshot each
 * render. Identity-stable inputs short-circuit (no recompute, no
 * listener notify). When inputs change, the recompute is synchronous
 * in render and the notify is deferred to `useLayoutEffect`.
 *
 * @param recents  Recent project paths from `useTugbankValue` /
 *                 `parseRecents`. Identity-stable across renders
 *                 when the underlying tugbank entry is unchanged
 *                 (per `useTugbankValue`'s parse cache).
 * @param query    The user-typed (trimmed) project path. Identity is
 *                 trivially stable for primitive strings.
 * @param ledger   The session-ledger snapshot for `query` from
 *                 `useSessionLedger`. Identity-stable when the
 *                 ledger hasn't ticked.
 *
 * @returns the data-source instance (stable across renders for this
 *          hook's lifetime).
 */
export function useTidePickerDataSource(
  recents: ReadonlyArray<string>,
  query: string,
  ledger: WorkspaceSnapshot,
): TidePickerDataSource {
  const dataSourceRef = useRef<TidePickerDataSource | null>(null);
  if (dataSourceRef.current === null) {
    dataSourceRef.current = new TidePickerDataSource({
      recents,
      query,
      ledger,
    });
  }
  const ds = dataSourceRef.current;

  // Synchronously update inputs and re-project so the render sees
  // the up-to-date row sequence.
  const didChange = ds.setInputsWithoutNotify({ recents, query, ledger });

  // Deferred notify — fires listeners outside the current render so
  // subscriber callbacks (TugListView's useSyncExternalStore-driven
  // listener) don't queue updates mid-render. Same React-correctness
  // pattern as `useFilteredDataSource`.
  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // `didChange` and `ds` are stable for this render's effect; we
    // intentionally re-evaluate every commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
