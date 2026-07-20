/**
 * Dev picker — data source for the Sessions list.
 *
 * `SessionsDataSource` enumerates session-choice rows for the currently-typed
 * project path: `session-new` plus one `session-resume` per ledger row, in
 * newest-first order. When the path is empty, or the ledger is pending / idle /
 * errored, the data source emits zero rows; the picker form renders a
 * placeholder div in the empty state. The Trash-all button (visibility gated on
 * `nonLiveCount() > 0`) is rendered by the picker form OUTSIDE the list view.
 *
 * The recent project paths are no longer a separate list — they seed the path
 * field's own combo-box dropdown (see `session-card.tsx`), so this module owns
 * just the one data source now.
 *
 * The data source exposes the standard `TugListViewDataSource` surface plus a
 * typed `rowAt(i)` accessor for cells, driven by a hook that mints a stable
 * instance per hook lifetime, absorbs identity-stable inputs as no-ops,
 * recomputes synchronously in render, and notifies subscribers via
 * `useLayoutEffect` (the same pattern as `useFilteredDataSource`).
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — the data source is such
 *    a store (`subscribe` + `getVersion`).
 *  - [L03] event-dependent registrations in `useLayoutEffect` — the
 *    deferred-notify lives there.
 *  - [L19] component authoring guide — module docstring, exported types.
 *
 * Decisions:
 *  - tugplan-session-picker-redesign [D02] role-flat-list, [D11]
 *    notice-outside-list.
 */

import { useLayoutEffect, useRef } from "react";

import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";
import type { SessionRow } from "../protocol";
import { matchesTagQuery } from "./session-tag";
import type { WorkspaceSnapshot } from "./session-ledger-store";

// ---------------------------------------------------------------------------
// Public row types
// ---------------------------------------------------------------------------

/**
 * Sessions-list row kinds. The picker form's selection state
 * resolves submission to one of these rows per [Spec S02].
 */
export type SessionsRow =
  | { readonly kind: "session-new" }
  | { readonly kind: "session-resume"; readonly row: SessionRow }
  | { readonly kind: "loading" };

// ---------------------------------------------------------------------------
// SessionsDataSource
// ---------------------------------------------------------------------------

interface SessionsInputs {
  readonly query: string;
  readonly ledger: WorkspaceSnapshot;
  /**
   * Optional tag/name/prompt filter (the `/resume` overlay's search field).
   * Empty string → no filtering (the full-card project picker's behavior). When
   * non-empty, only `session-resume` rows matching {@link matchesTagQuery} are
   * shown and `session-new` is dropped, so a non-matching query yields an empty
   * list that fires no spawn. Optional — absent / empty is the full-card
   * project picker's unfiltered behavior.
   */
  readonly tagFilter?: string;
}

/**
 * Data source for the Sessions list.
 *
 *  - Empty path → zero rows. The picker form renders a "type or
 *    select a project path" placeholder.
 *  - Path + ledger pending → one `loading` row.
 *  - Path + ledger ready → `session-new` + one `session-resume` per
 *    ledger row in newest-first order. The Trash-all button
 *    (rendered by the picker form below the list view) reads
 *    `nonLiveCount()` to decide visibility.
 *  - Path + ledger idle / error → zero rows. The notice banner
 *    surfaces the error per [D11]; the picker form may render a
 *    placeholder for the idle case.
 */
export class SessionsDataSource implements TugListViewDataSource {
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

  /**
   * A session is *enabled* (pickable) unless it is held by a live
   * process the user can't resume into from here: live in another Tug
   * card (`state === "live"`) or in use by an external terminal app
   * (`terminal_live !== null`). The `TugListView` skips disabled rows
   * during arrow navigation and refuses click / Space-Enter selection
   * on them, so these "Live in another card" / "In use in a terminal"
   * rows stay visible-for-context but unpickable. `session-new` and the
   * `loading` placeholder are always enabled (the latter is never
   * actually cursorable — it's the sole row while pending). Mirrors the
   * `disabled` appearance derived in `SessionResumeCell`.
   */
  enabledForIndex(index: number): boolean {
    const row = this.rows[index];
    if (row.kind !== "session-resume") return true;
    return row.row.state !== "live" && row.row.terminal_live === null;
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
   * Count of non-live ledger rows that are visible in the picker. Used by
   * the picker form to gate the visibility of the Trash-all button.
   * Returns 0 when the ledger is not in `ready` status. Mirrors the
   * `recompute` visibility filter (content by file_size OR turn_count)
   * for non-live rows so the count agrees with what the user sees in the
   * SESSIONS list.
   */
  nonLiveCount(): number {
    const { ledger } = this.inputs;
    if (ledger.status !== "ready") return 0;
    let n = 0;
    for (const row of ledger.rows) {
      if (row.state === "live") continue;
      if ((row.file_size ?? 0) > 0 || row.turn_count > 0) n += 1;
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

  /**
   * Whether the queried `projectDir` is a directory that exists on the
   * tugcast host. `undefined` until the `list_sessions_ok` settle
   * carries the check; the picker form disables Open on an explicit
   * `false`.
   */
  dirExists(): boolean | undefined {
    return this.inputs.ledger.dirExists;
  }

  setInputsWithoutNotify(next: SessionsInputs): boolean {
    if (
      this.inputs.query === next.query &&
      this.inputs.ledger === next.ledger &&
      this.inputs.tagFilter === next.tagFilter
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
    const tagFilter = this.inputs.tagFilter ?? "";
    const filtering = tagFilter.trim().length > 0;
    const next: SessionsRow[] = [];
    if (query.length > 0) {
      if (ledger.status === "ready") {
        // The "New session" row is a spawn affordance, not a searchable
        // session; hide it while a filter is active so a non-match is truly
        // empty and fires nothing.
        if (!filtering) next.push({ kind: "session-new" });
        for (const row of ledger.rows) {
          if (filtering && !matchesTagQuery(row, tagFilter)) continue;
          // Visibility is decoupled from the (canonically strict) turn
          // count so a real session never vanishes because its count is
          // low ([P09]/[R06]). A row is shown when it has resumable
          // content by ANY signal: on-disk JSONL bytes (`file_size > 0`,
          // the count-independent content signal for scanned external
          // rows — `null` for tug/live rows and `session_updated`
          // pushes), a canonical turn (`turn_count > 0`, the live truth
          // for tug rows), or a currently-live process. Only a truly
          // empty row — no bytes, no turn, not live (an opened-and-closed
          // card with nothing in it) — is hidden.
          if (
            (row.file_size ?? 0) <= 0 &&
            row.turn_count === 0 &&
            row.state !== "live"
          ) {
            continue;
          }
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
 * Hook — mint a stable `SessionsDataSource` per hook lifetime
 * and feed it the latest `(query, ledger)` snapshot each render.
 */
export function useSessionsDataSource(
  query: string,
  ledger: WorkspaceSnapshot,
  tagFilter = "",
): SessionsDataSource {
  const ref = useRef<SessionsDataSource | null>(null);
  if (ref.current === null) {
    ref.current = new SessionsDataSource({ query, ledger, tagFilter });
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify({ query, ledger, tagFilter });

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
