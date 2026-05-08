/**
 * Tide picker — data sources for the master/detail list views.
 *
 * The picker is a vertical master/detail layout: a Recents list
 * (master, always visible) above a Sessions list (detail, always
 * visible). Each list has its own `TugListView` and its own data
 * source, both kept simple and focused.
 *
 *  - `TideRecentsDataSource` enumerates recent project paths in the
 *    order tugbank provides them (most-recently-used first). Every
 *    recent always appears — clicking one fills the input and marks
 *    that recent as selected (computed from `currentPath ===
 *    recent.path` in the cell), but the list itself never shrinks
 *    in response to user interaction. When the user types a query
 *    that's a substring of a recent's path, the matcher's match
 *    ranges still flow through to the cell so the path renders with
 *    `<mark>` highlights — narrowing-by-highlight, not narrowing-by-
 *    elision.
 *
 *  - `TideSessionsDataSource` enumerates session-choice rows for the
 *    currently-typed project path: `session-new` plus one
 *    `session-resume` per ledger row, in newest-first order. When
 *    the path is empty, or the ledger is pending / idle / errored,
 *    the data source emits zero rows; the picker form renders a
 *    placeholder div in the empty state. The Forget-all button
 *    (visibility gated on `nonLiveCount() > 0`) is rendered by the
 *    picker form OUTSIDE the list view.
 *
 * Both data sources expose the standard `TugListViewDataSource`
 * surface plus a typed `rowAt(i)` accessor for cells. Both are
 * driven by hooks that mint a stable instance per hook lifetime,
 * absorb identity-stable inputs as no-ops, recompute synchronously
 * in render, and notify subscribers via `useLayoutEffect` (the
 * same pattern as `useFilteredDataSource`).
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — both data
 *    sources are such stores (`subscribe` + `getVersion`).
 *  - [L03] event-dependent registrations in `useLayoutEffect` — the
 *    deferred-notify lives there.
 *  - [L19] component authoring guide — module docstring, exported
 *    types, file-pair with the test file.
 *
 * Decisions:
 *  - tugplan-tide-picker-redesign [D02] role-flat-list, [D11]
 *    notice-outside-list, [D13] shared-text-matcher.
 *  - Master/detail vertical: both lists always visible; clicking a
 *    recent neither hides recents nor obstructs the sessions list.
 *    Driven by user feedback after seeing Step 9's first iteration.
 *  - Single-list-per-section: separate data sources keep each list
 *    view's enumeration straightforward (no role-driven section
 *    dividers; no hidden visibility predicates).
 */

import { useLayoutEffect, useRef } from "react";

import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";
import type { SessionRow } from "../protocol";
import { caseInsensitiveSubstring } from "./text-match";
import type { WorkspaceSnapshot } from "./tide-session-ledger-store";

// ---------------------------------------------------------------------------
// Public row types
// ---------------------------------------------------------------------------

/**
 * Recents-list row kind. Each recent path is one row; the matcher's
 * `matches` ranges (UTF-16 half-open intervals) drive `<mark>`
 * highlights in the cell when the user has typed a substring.
 */
export interface RecentsRow {
  readonly kind: "path-recent";
  readonly path: string;
  readonly matches: ReadonlyArray<readonly [number, number]>;
}

/**
 * Sessions-list row kinds. The picker form's selection state
 * resolves submission to one of these rows per [Spec S02].
 */
export type SessionsRow =
  | { readonly kind: "session-new" }
  | { readonly kind: "session-resume"; readonly row: SessionRow }
  | { readonly kind: "loading" };

// ---------------------------------------------------------------------------
// TideRecentsDataSource
// ---------------------------------------------------------------------------

interface RecentsInputs {
  readonly recents: ReadonlyArray<string>;
  readonly query: string;
}

/**
 * Data source for the Recents list. Always emits all recents (no
 * filtering); attaches `caseInsensitiveSubstring(query, path)`
 * highlight ranges per row when the typed query is a substring of
 * the path.
 */
export class TideRecentsDataSource implements TugListViewDataSource {
  private inputs: RecentsInputs;
  private rows: RecentsRow[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: RecentsInputs) {
    this.inputs = inputs;
    this.recompute();
  }

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    return `recents:${this.rows[index].path}`;
  }

  kindForIndex(index: number): string {
    return this.rows[index].kind;
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

  /** Typed row access for the cell renderer. */
  rowAt(index: number): RecentsRow {
    return this.rows[index];
  }

  /**
   * Replace the input snapshot. Identity-equal short-circuits
   * (no recompute, no listener notify). Returns `true` when
   * recompute fired so the hook's `useLayoutEffect` can call
   * `notifyAll()` outside the current render.
   */
  setInputsWithoutNotify(next: RecentsInputs): boolean {
    if (
      this.inputs.recents === next.recents &&
      this.inputs.query === next.query
    ) {
      return false;
    }
    this.inputs = next;
    this.recompute();
    return true;
  }

  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }

  private recompute(): void {
    const { recents, query } = this.inputs;
    const next: RecentsRow[] = [];
    for (const path of recents) {
      // Match-range attachment: returns null on no match, which we
      // treat as "no highlights" (empty matches array). The cell
      // still renders the path; highlights are decorative.
      const match = caseInsensitiveSubstring(query, path);
      const matches = match?.matches ?? [];
      next.push({ kind: "path-recent", path, matches });
    }
    this.rows = next;
    this.version += 1;
  }
}

/**
 * Hook — mint a stable `TideRecentsDataSource` per hook lifetime
 * and feed it the latest `(recents, query)` snapshot each render.
 */
export function useTideRecentsDataSource(
  recents: ReadonlyArray<string>,
  query: string,
): TideRecentsDataSource {
  const ref = useRef<TideRecentsDataSource | null>(null);
  if (ref.current === null) {
    ref.current = new TideRecentsDataSource({ recents, query });
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify({ recents, query });

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}

// ---------------------------------------------------------------------------
// TideSessionsDataSource
// ---------------------------------------------------------------------------

interface SessionsInputs {
  readonly query: string;
  readonly ledger: WorkspaceSnapshot;
}

/**
 * Data source for the Sessions list.
 *
 *  - Empty path → zero rows. The picker form renders a "type or
 *    select a project path" placeholder.
 *  - Path + ledger pending → one `loading` row.
 *  - Path + ledger ready → `session-new` + one `session-resume` per
 *    ledger row in newest-first order. The Forget-all button
 *    (rendered by the picker form below the list view) reads
 *    `nonLiveCount()` to decide visibility.
 *  - Path + ledger idle / error → zero rows. The notice banner
 *    surfaces the error per [D11]; the picker form may render a
 *    placeholder for the idle case.
 */
export class TideSessionsDataSource implements TugListViewDataSource {
  private inputs: SessionsInputs;
  private rows: SessionsRow[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: SessionsInputs) {
    this.inputs = inputs;
    this.recompute();
  }

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    const row = this.rows[index];
    switch (row.kind) {
      case "session-new":
        return "session:new";
      case "session-resume":
        return `session:resume:${row.row.session_id}`;
      case "loading":
        return "loading";
    }
  }

  kindForIndex(index: number): string {
    return this.rows[index].kind;
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

  rowAt(index: number): SessionsRow {
    return this.rows[index];
  }

  /**
   * Count of non-live ledger rows that are visible in the picker
   * (turn_count > 0). Used by the picker form to gate the visibility
   * of the Forget-all button. Returns 0 when the ledger is not in
   * `ready` status. Mirrors the `recompute` filter so the count
   * agrees with what the user sees in the SESSIONS list.
   */
  nonLiveCount(): number {
    const { ledger } = this.inputs;
    if (ledger.status !== "ready") return 0;
    let n = 0;
    for (const row of ledger.rows) {
      if (row.state !== "live" && row.turn_count > 0) n += 1;
    }
    return n;
  }

  /** Whether `query.length > 0` AND `ledger.status === "ready"`. */
  isReady(): boolean {
    return (
      this.inputs.query.length > 0 && this.inputs.ledger.status === "ready"
    );
  }

  /** Whether `query.length > 0` AND `ledger.status === "pending"`. */
  isPending(): boolean {
    return (
      this.inputs.query.length > 0 && this.inputs.ledger.status === "pending"
    );
  }

  setInputsWithoutNotify(next: SessionsInputs): boolean {
    if (
      this.inputs.query === next.query &&
      this.inputs.ledger === next.ledger
    ) {
      return false;
    }
    this.inputs = next;
    this.recompute();
    return true;
  }

  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }

  private recompute(): void {
    const { query, ledger } = this.inputs;
    const next: SessionsRow[] = [];
    if (query.length > 0) {
      if (ledger.status === "ready") {
        next.push({ kind: "session-new" });
        for (const row of ledger.rows) {
          // Hide empty sessions (turn_count === 0) regardless of
          // state. Closed-with-zero is just a card that opened and
          // closed without a prompt — equivalent to "New session"
          // and offers nothing to resume. Live-with-zero is a card
          // open elsewhere with nothing in it; surfacing it as a
          // disabled "live" row would be noise. Failed-with-zero
          // never had a turn to resume; the originating card
          // surfaces the failure via lastError, no need for a
          // duplicate ghost row in the picker.
          if (row.turn_count === 0) continue;
          next.push({ kind: "session-resume", row });
        }
      } else if (ledger.status === "pending") {
        next.push({ kind: "loading" });
      }
      // "idle" and "error" → zero rows; the form's placeholder
      // ("type or select…") and the notice banner cover those.
    }
    this.rows = next;
    this.version += 1;
  }
}

/**
 * Hook — mint a stable `TideSessionsDataSource` per hook lifetime
 * and feed it the latest `(query, ledger)` snapshot each render.
 */
export function useTideSessionsDataSource(
  query: string,
  ledger: WorkspaceSnapshot,
): TideSessionsDataSource {
  const ref = useRef<TideSessionsDataSource | null>(null);
  if (ref.current === null) {
    ref.current = new TideSessionsDataSource({ query, ledger });
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify({ query, ledger });

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
