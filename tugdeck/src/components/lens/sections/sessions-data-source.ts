/**
 * sessions-data-source.ts — the `TugListView` data source for the Lens
 * **Sessions** section: one row per open session card, deduped by
 * `tugSessionId` in binding order.
 *
 * The rows are derived from `cardSessionBindingStore`'s snapshot (a stable
 * `Map` until a bind/unbind), so the source recomputes only when that
 * reference changes. Cells query `rowAt(index)` for the bound card and
 * session; per-row labels, phase, pulse, and sparkline are resolved in the
 * cell from their own stores.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — this IS such a store
 *    (`subscribe` + `getVersion`); the hook mints one stable instance per
 *    lifetime and notifies from `useLayoutEffect` ([L03]).
 *  - [L19] component authoring — module docstring, exported types.
 *
 * @module components/lens/sections/sessions-data-source
 */

import { useLayoutEffect, useRef } from "react";

import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";
import type { CardSessionBinding } from "@/lib/card-session-binding-store";
import { sessionCardTitleOverride } from "@/lib/session-card-title";
import { sessionNameStore } from "@/lib/session-name-store";
import { sessionTagStore } from "@/lib/session-tag-store";
import { filterAndRank } from "@/lib/text-match";

/** One monitor row: a session and the card it is bound to. */
export interface MonitorRow {
  readonly cardId: string;
  readonly tugSessionId: string;
  readonly projectDir: string;
}

/**
 * One row per open session binding, deduped by `tugSessionId` — the first card
 * bound to a session wins the row.
 *
 * Row order: the user's persisted `order` (by `tugSessionId`) first, in that
 * order; sessions absent from `order` (newly bound) keep their binding order
 * and follow AFTER the ordered set — a new session lands at the bottom without
 * disturbing the arrangement. Stale ids in `order` (closed sessions) are simply
 * never matched. An empty/absent `order` yields plain binding order.
 */
export function buildSessionRows(
  bindings: ReadonlyMap<string, CardSessionBinding>,
  order?: readonly string[],
): MonitorRow[] {
  const rows: MonitorRow[] = [];
  const seen = new Set<string>();
  for (const [cardId, binding] of bindings) {
    if (seen.has(binding.tugSessionId)) continue;
    seen.add(binding.tugSessionId);
    rows.push({
      cardId,
      tugSessionId: binding.tugSessionId,
      projectDir: binding.projectDir,
    });
  }
  if (order === undefined || order.length === 0) return rows;
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  // Stable sort: ranked ids by rank; unranked (new) sessions keep their binding
  // order (their pre-sort index) and sort last (rank = +Infinity).
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const ra = rank.get(a.row.tugSessionId) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(b.row.tugSessionId) ?? Number.POSITIVE_INFINITY;
      return ra !== rb ? ra - rb : a.i - b.i;
    })
    .map((x) => x.row);
}

/**
 * The label a row displays — the same string the cell renders, so a filter term
 * matches what the user can actually read (project leaf + the session's name or
 * tag). The branch is omitted: it is per-cell git state the data source has no
 * business fetching, and it is not part of the row's identity.
 */
export function sessionRowLabel(row: MonitorRow): string {
  return sessionCardTitleOverride(
    row.projectDir,
    sessionNameStore.getName(row.tugSessionId),
    sessionTagStore.getTag(row.tugSessionId),
    null,
  );
}

export interface LensSessionsInputs {
  readonly bindings: ReadonlyMap<string, CardSessionBinding>;
  readonly order: readonly string[];
  /** The band's filter query. Empty / whitespace → every row. */
  readonly filterQuery: string;
  /**
   * Version tokens for the name / tag stores the labels are built from. Labels
   * are read at recompute time, so a name or tag arriving late must re-run the
   * projection — these are how the section says "they changed".
   */
  readonly nameVersion: unknown;
  readonly tagVersion: unknown;
}

export class LensSessionsDataSource implements TugListViewDataSource {
  private inputs: LensSessionsInputs;
  private rows: MonitorRow[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: LensSessionsInputs) {
    this.inputs = inputs;
    this.recompute();
  }

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    return this.rows[index].tugSessionId;
  }

  kindForIndex(): string {
    return "session";
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
  rowAt(index: number): MonitorRow {
    return this.rows[index];
  }

  /** Index of the row with this session id, or -1 when absent. */
  indexForId(tugSessionId: string): number {
    return this.rows.findIndex((r) => r.tugSessionId === tugSessionId);
  }

  setInputsWithoutNotify(next: LensSessionsInputs): boolean {
    if (
      this.inputs.bindings === next.bindings &&
      this.inputs.order === next.order &&
      this.inputs.filterQuery === next.filterQuery &&
      this.inputs.nameVersion === next.nameVersion &&
      this.inputs.tagVersion === next.tagVersion
    ) {
      return false;
    }
    this.inputs = next;
    this.recompute();
    return true;
  }

  /** Whether a filter is narrowing the list right now. */
  isFiltering(): boolean {
    return this.inputs.filterQuery.trim().length > 0;
  }

  /** How many session rows exist, filter or no filter. */
  unfilteredCount(): number {
    return buildSessionRows(this.inputs.bindings, this.inputs.order).length;
  }

  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }

  /** The current display order of session ids — the reorder hook's `getVisibleOrder`. */
  visibleOrder(): string[] {
    return this.rows.map((r) => r.tugSessionId);
  }

  private recompute(): void {
    const rows = buildSessionRows(this.inputs.bindings, this.inputs.order);
    // Ranked best-first while filtering; the user's persisted arrangement
    // returns the moment the query clears (and reorder is disabled meanwhile,
    // so the two orders never fight).
    this.rows = [
      ...filterAndRank(rows, this.inputs.filterQuery, (row) => [
        sessionRowLabel(row),
      ]),
    ];
    this.version += 1;
  }
}

/**
 * Hook — mint a stable `LensSessionsDataSource` and feed it the latest
 * bindings snapshot, persisted row `order`, and filter query each render,
 * notifying subscribers from a layout effect when any of them changes.
 */
export function useLensSessionsDataSource(
  inputs: LensSessionsInputs,
): LensSessionsDataSource {
  const ref = useRef<LensSessionsDataSource | null>(null);
  if (ref.current === null) {
    ref.current = new LensSessionsDataSource(inputs);
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify(inputs);

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
