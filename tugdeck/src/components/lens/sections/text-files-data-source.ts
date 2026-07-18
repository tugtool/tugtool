/**
 * text-files-data-source.ts — the `TugListView` data source for the Lens
 * **Text Files** section: the open Text cards, then (when any exist) a
 * "Recent" header divider and the recently-open files that are not currently
 * open.
 *
 * Rows:
 *  - `"text-open"` — one per mounted Text card (`componentId === "text"`), in
 *    deck-card order. `id = "open:<cardId>"`; the bound path comes from the
 *    text-card open registry.
 *  - `"text-recents-header"` — an inert `"header"`-role divider, present only
 *    when there is at least one recent to show.
 *  - `"text-recent"` — one per recent-documents MRU path that is not the path
 *    of any open card. `id = "recent:<path>"`.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — this IS such a store,
 *    fed the deck snapshot + the recent-documents snapshot; the hook notifies
 *    from `useLayoutEffect` ([L03]).
 *  - [L19] component authoring — module docstring, exported types.
 *
 * @module components/lens/sections/text-files-data-source
 */

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type {
  TugListViewCellRole,
  TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import type { DeckState } from "@/layout-tree";
import { getDeckStore } from "@/lib/deck-store-registry";
import { getOpenTextCard } from "@/lib/text-card-open-registry";
import {
  getReachableRecentDocumentsSnapshot,
  subscribeRecentDocuments,
} from "@/lib/recent-documents";

export type TextFilesRow =
  | { readonly kind: "text-open"; readonly cardId: string; readonly path: string | null; readonly title: string }
  | { readonly kind: "text-recents-header" }
  | { readonly kind: "text-recent"; readonly path: string };

/** The trailing filename of a path (`/a/b/c.txt` → `c.txt`). */
export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

/** The directory portion of a path (`/a/b/c.txt` → `/a/b`), or "" at root. */
export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "";
}

interface TextFilesInputs {
  readonly deck: DeckState | null;
  readonly recents: readonly string[];
}

/** Resolve an open Text card's bound path. Default reads the open registry. */
export type OpenCardPathResolver = (cardId: string) => string | null;

const registryPathResolver: OpenCardPathResolver = (cardId) =>
  getOpenTextCard(cardId)?.getPath() ?? null;

/**
 * Build the row list from the deck snapshot + the recents MRU. Open Text cards
 * first, then — only if any recent survives the open-path filter — a header and
 * the surviving recents. Pure over `(inputs, resolvePath)`: the bound path of
 * each open card comes through `resolvePath` (default: the open registry, not
 * React state; re-read on every recompute), so a test can inject its own.
 */
export function buildTextFilesRows(
  inputs: TextFilesInputs,
  resolvePath: OpenCardPathResolver = registryPathResolver,
): TextFilesRow[] {
  const rows: TextFilesRow[] = [];
  const openPaths = new Set<string>();
  const cards = inputs.deck?.cards ?? [];
  for (const card of cards) {
    if (card.componentId !== "text") continue;
    const path = resolvePath(card.id);
    if (path !== null) openPaths.add(path);
    const title = path !== null ? basename(path) : card.title || "Untitled";
    rows.push({ kind: "text-open", cardId: card.id, path, title });
  }
  const recents = inputs.recents.filter((p) => !openPaths.has(p));
  if (recents.length > 0) {
    rows.push({ kind: "text-recents-header" });
    for (const path of recents) rows.push({ kind: "text-recent", path });
  }
  return rows;
}

export class LensTextFilesDataSource implements TugListViewDataSource {
  private inputs: TextFilesInputs;
  private rows: TextFilesRow[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: TextFilesInputs) {
    this.inputs = inputs;
    this.recompute();
  }

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    const row = this.rows[index];
    switch (row.kind) {
      case "text-open":
        return `open:${row.cardId}`;
      case "text-recents-header":
        return "recents-header";
      case "text-recent":
        return `recent:${row.path}`;
    }
  }

  kindForIndex(index: number): string {
    return this.rows[index].kind;
  }

  roleForIndex(index: number): TugListViewCellRole {
    return this.rows[index].kind === "text-recents-header" ? "header" : "cell";
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
  rowAt(index: number): TextFilesRow {
    return this.rows[index];
  }

  setInputsWithoutNotify(next: TextFilesInputs): boolean {
    if (this.inputs.deck === next.deck && this.inputs.recents === next.recents) {
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
    this.rows = buildTextFilesRows(this.inputs);
    this.version += 1;
  }
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Hook — read the deck snapshot + recents snapshot (both [L02] stores) and
 * feed a stable `LensTextFilesDataSource`, notifying from a layout effect.
 */
export function useLensTextFilesDataSource(): LensTextFilesDataSource {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? NOOP_SUBSCRIBE,
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  // The REACHABLE projection: paths the existence probe reported gone are
  // excluded — a row the user cannot open is never listed.
  const recents = useSyncExternalStore(
    subscribeRecentDocuments,
    getReachableRecentDocumentsSnapshot,
    getReachableRecentDocumentsSnapshot,
  );

  const ref = useRef<LensTextFilesDataSource | null>(null);
  if (ref.current === null) {
    ref.current = new LensTextFilesDataSource({ deck, recents });
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify({ deck, recents });

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
