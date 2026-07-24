/**
 * snippets-data-source.ts — the `TugListView` data source for the Lens
 * **Snippets** section: one row per snippet, in document order.
 *
 * Rows come straight from `snippetsStore`'s `doc.snippets`, narrowed by the
 * band's filter query; the source recomputes when that array reference, the
 * query, or the editing id changes. There is ONE cell kind (`"snippet"`) — the
 * same row switches between its incipit-display and its in-place editor by
 * branching on the store's `editingId` inside the cell, never by changing kinds
 * (a kind change is a remount in disguise, [L26]).
 *
 * **The projection is the coordinate space.** Under a filter the row at index
 * `i` is NOT `doc.snippets[i]`, so every consumer that turns a list index into
 * a snippet must go through `rowAt` / `indexForId` here — never index the doc
 * array by a list index.
 *
 * The row being EDITED is exempt from the filter: an open editor whose text
 * stops matching mid-keystroke must not vanish out from under the caret.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — this IS such a store;
 *    the hook mints one stable instance and notifies from `useLayoutEffect`
 *    ([L03]).
 *  - [L19] component authoring — module docstring, exported types.
 *
 * @module components/lens/sections/snippets-data-source
 */

import { useLayoutEffect, useRef } from "react";

import type { TugListViewDataSource } from "@/components/tugways/tug-list-view";
import { filterAndRank } from "@/lib/text-match";
import type { Snippet } from "@/lib/snippets-doc";

export interface LensSnippetsInputs {
  readonly snippets: readonly Snippet[];
  /** The band's filter query. Empty / whitespace → every snippet. */
  readonly filterQuery: string;
  /** The snippet currently open in its editor, exempt from the filter. */
  readonly editingId: string | null;
}

export class LensSnippetsDataSource implements TugListViewDataSource {
  private inputs: LensSnippetsInputs;
  private rows: readonly Snippet[];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: LensSnippetsInputs) {
    this.inputs = inputs;
    this.rows = LensSnippetsDataSource.project(inputs);
  }

  private static project(inputs: LensSnippetsInputs): readonly Snippet[] {
    const { snippets, filterQuery, editingId } = inputs;
    if (filterQuery.trim().length === 0) return snippets;
    // Ranked best-first while filtering; the document's drag order returns the
    // moment the query clears (and reorder is disabled meanwhile, so the two
    // orders never fight).
    const ranked = filterAndRank(snippets, filterQuery, (snippet) => [snippet.text]);
    if (editingId === null || ranked.some((s) => s.id === editingId)) return ranked;
    // The row being edited is exempt from the filter, so an open editor never
    // vanishes mid-keystroke. Unranked, it leads: it is the row the user is
    // working in, and a fixed position beats being shuffled by every keystroke.
    const editing = snippets.find((s) => s.id === editingId);
    return editing === undefined ? ranked : [editing, ...ranked];
  }

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    return this.rows[index].id;
  }

  kindForIndex(): string {
    return "snippet";
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

  /** Typed row access for the cell renderer — in FILTERED coordinates. */
  rowAt(index: number): Snippet {
    return this.rows[index];
  }

  /** Index of the snippet with this id in the projection, or -1 when absent. */
  indexForId(id: string): number {
    return this.rows.findIndex((s) => s.id === id);
  }

  /** Whether a filter is narrowing the list right now. */
  isFiltering(): boolean {
    return this.inputs.filterQuery.trim().length > 0;
  }

  /** How many snippets the document holds, filter or no filter. */
  unfilteredCount(): number {
    return this.inputs.snippets.length;
  }

  setInputsWithoutNotify(next: LensSnippetsInputs): boolean {
    if (
      this.inputs.snippets === next.snippets &&
      this.inputs.filterQuery === next.filterQuery &&
      this.inputs.editingId === next.editingId
    ) {
      return false;
    }
    this.inputs = next;
    this.rows = LensSnippetsDataSource.project(next);
    this.version += 1;
    return true;
  }

  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Hook — mint a stable `LensSnippetsDataSource` and feed it the latest
 * `(snippets, filterQuery, editingId)` triple each render, notifying
 * subscribers from a layout effect.
 */
export function useLensSnippetsDataSource(
  snippets: readonly Snippet[],
  filterQuery: string,
  editingId: string | null,
): LensSnippetsDataSource {
  const ref = useRef<LensSnippetsDataSource | null>(null);
  const inputs = { snippets, filterQuery, editingId };
  if (ref.current === null) {
    ref.current = new LensSnippetsDataSource(inputs);
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
