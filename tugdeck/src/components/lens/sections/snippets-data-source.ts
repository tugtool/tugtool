/**
 * snippets-data-source.ts — the `TugListView` data source for the Lens
 * **Snippets** section: one row per snippet, in document order.
 *
 * Rows come straight from `snippetsStore`'s `doc.snippets`; the source
 * recomputes only when that array reference changes. There is ONE cell kind
 * (`"snippet"`) — the same row switches between its incipit-display and its
 * in-place editor by branching on the store's `editingId` inside the cell,
 * never by changing kinds (a kind change is a remount in disguise, [L26]).
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
import type { Snippet } from "@/lib/snippets-doc";

export class LensSnippetsDataSource implements TugListViewDataSource {
  private snippets: readonly Snippet[];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(snippets: readonly Snippet[]) {
    this.snippets = snippets;
  }

  numberOfItems(): number {
    return this.snippets.length;
  }

  idForIndex(index: number): string {
    return this.snippets[index].id;
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

  /** Typed row access for the cell renderer. */
  rowAt(index: number): Snippet {
    return this.snippets[index];
  }

  /** Index of the snippet with this id, or -1 when absent. */
  indexForId(id: string): number {
    return this.snippets.findIndex((s) => s.id === id);
  }

  setInputsWithoutNotify(next: readonly Snippet[]): boolean {
    if (this.snippets === next) return false;
    this.snippets = next;
    this.version += 1;
    return true;
  }

  notifyAll(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Hook — mint a stable `LensSnippetsDataSource` and feed it the latest
 * `doc.snippets` array each render, notifying subscribers from a layout
 * effect.
 */
export function useLensSnippetsDataSource(
  snippets: readonly Snippet[],
): LensSnippetsDataSource {
  const ref = useRef<LensSnippetsDataSource | null>(null);
  if (ref.current === null) {
    ref.current = new LensSnippetsDataSource(snippets);
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify(snippets);

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
