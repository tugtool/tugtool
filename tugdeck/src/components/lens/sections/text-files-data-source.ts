/**
 * text-files-data-source.ts — the `TugListView` data source for the Lens
 * **Text Files** section: the open Text cards. Recently-open files are no
 * longer listed here — they reach the user through the section header's
 * recents menu.
 *
 * Rows:
 *  - `"text-open"` — one per mounted Text card (`componentId === "text"`), in
 *    deck-card order. `id = "open:<cardId>"`; the bound path comes from the
 *    text-card open registry.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — this IS such a store,
 *    fed the deck snapshot; the hook notifies from `useLayoutEffect` ([L03]).
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
import { filterAndRank } from "@/lib/text-match";
import {
  getOpenTextCard,
  getOpenTextCardsVersion,
  subscribeOpenTextCards,
} from "@/lib/text-card-open-registry";

export type TextFilesRow = {
  readonly kind: "text-open";
  readonly cardId: string;
  readonly path: string | null;
  readonly title: string;
  /** The card wears its unsaved-changes mark (manual mode, dirty buffer); the
   *  row paints the same dot after the filename. */
  readonly unsaved: boolean;
};

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

/**
 * Abbreviate a macOS home prefix (`/Users/<name>`) to `~` for display. It lives
 * beside `basename` rather than in the section so the data source can match on
 * exactly the string the row shows — typing `~/src` finds the row, and the
 * highlight offsets land on the rendered characters.
 */
export function displayDir(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

interface TextFilesInputs {
  readonly deck: DeckState | null;
  /** The user's persisted row order, by card id. Empty → deck-card order. */
  readonly order: readonly string[];
  /** Bumps when a Text card registers / unregisters / binds its path, so the
   *  rows recompute against the newly-resolved open-card paths. */
  readonly registryVersion: number;
  /** The band's filter query. Empty / whitespace → every row. */
  readonly filterQuery: string;
}

/** Resolve an open Text card's bound path. Default reads the open registry. */
export type OpenCardPathResolver = (cardId: string) => string | null;

const registryPathResolver: OpenCardPathResolver = (cardId) =>
  getOpenTextCard(cardId)?.getPath() ?? null;

/** Resolve an open Text card's display name — the buffer's untitled name
 *  (`"Untitled"`, `"Untitled-2"`, …) for a path-less card. Default reads the
 *  open registry. */
export type OpenCardDisplayNameResolver = (cardId: string) => string | null;

const registryDisplayNameResolver: OpenCardDisplayNameResolver = (cardId) =>
  getOpenTextCard(cardId)?.getDisplayName() ?? null;

/** Resolve whether an open Text card wears its unsaved-changes mark. Default
 *  reads the open registry. */
export type OpenCardUnsavedResolver = (cardId: string) => boolean;

const registryUnsavedResolver: OpenCardUnsavedResolver = (cardId) =>
  getOpenTextCard(cardId)?.hasUnsavedMark() ?? false;

/**
 * Build the row list from the deck snapshot: one row per open Text card. Pure
 * over its resolvers — the bound path of each open card comes through
 * `resolvePath`, its untitled name through `resolveDisplayName`, and its
 * unsaved mark through `resolveUnsaved` (defaults: the open registry, re-read
 * on every recompute), so a test can inject its own. A bound card titles from
 * the path basename; an unbound one titles from its buffer name
 * (`"Untitled"`).
 *
 * Row order: the user's persisted `order` (by card id) first, in that order;
 * cards absent from it keep deck-card order and follow AFTER the ordered set,
 * so a newly opened file lands at the bottom without disturbing the
 * arrangement. Stale ids (closed cards) are never matched. An empty / absent
 * `order` yields plain deck-card order — the same rule the Sessions rows take.
 */
export function buildTextFilesRows(
  inputs: Pick<TextFilesInputs, "deck"> & { readonly order?: readonly string[] },
  resolvePath: OpenCardPathResolver = registryPathResolver,
  resolveDisplayName: OpenCardDisplayNameResolver = registryDisplayNameResolver,
  resolveUnsaved: OpenCardUnsavedResolver = registryUnsavedResolver,
): TextFilesRow[] {
  const rows: TextFilesRow[] = [];
  const cards = inputs.deck?.cards ?? [];
  for (const card of cards) {
    if (card.componentId !== "text") continue;
    const path = resolvePath(card.id);
    const title =
      path !== null
        ? basename(path)
        : resolveDisplayName(card.id) ?? (card.title || "Untitled");
    rows.push({
      kind: "text-open",
      cardId: card.id,
      path,
      title,
      unsaved: resolveUnsaved(card.id),
    });
  }
  const order = inputs.order;
  if (order === undefined || order.length === 0) return rows;
  const rank = new Map<string, number>();
  order.forEach((id, i) => rank.set(id, i));
  // Stable sort: ranked ids by rank; unranked (newly opened) cards keep their
  // deck order (their pre-sort index) and sort last.
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const ra = rank.get(a.row.cardId) ?? Number.POSITIVE_INFINITY;
      const rb = rank.get(b.row.cardId) ?? Number.POSITIVE_INFINITY;
      return ra !== rb ? ra - rb : a.i - b.i;
    })
    .map((x) => x.row);
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
    return `open:${this.rows[index].cardId}`;
  }

  kindForIndex(index: number): string {
    return this.rows[index].kind;
  }

  roleForIndex(_index: number): TugListViewCellRole {
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

  /** Typed row access for the cell renderer. */
  rowAt(index: number): TextFilesRow {
    return this.rows[index];
  }

  setInputsWithoutNotify(next: TextFilesInputs): boolean {
    if (
      this.inputs.deck === next.deck &&
      this.inputs.order === next.order &&
      this.inputs.registryVersion === next.registryVersion &&
      this.inputs.filterQuery === next.filterQuery
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

  /** Whether a filter is narrowing the list right now. */
  isFiltering(): boolean {
    return this.inputs.filterQuery.trim().length > 0;
  }

  /** The current display order of card ids — the reorder hook's `getVisibleOrder`. */
  visibleOrder(): string[] {
    return this.rows.map((r) => r.cardId);
  }

  /** How many open Text cards there are, filter or no filter. */
  unfilteredCount(): number {
    return buildTextFilesRows(this.inputs).length;
  }

  private recompute(): void {
    const rows = buildTextFilesRows(this.inputs);
    // A row matches on its filename and on the directory AS DISPLAYED (`~/src`,
    // not `/Users/name/src`) — the same strings the row shows. Ranked
    // best-first while filtering; deck-card order returns when the query
    // clears.
    this.rows = [
      ...filterAndRank(rows, this.inputs.filterQuery, (row) => [
        row.title,
        row.path !== null ? displayDir(dirname(row.path)) : null,
      ]),
    ];
    this.version += 1;
  }
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Hook — read the deck snapshot (an [L02] store) and feed a stable
 * `LensTextFilesDataSource`, notifying from a layout effect.
 */
export function useLensTextFilesDataSource(
  filterQuery: string,
  order: readonly string[],
): LensTextFilesDataSource {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? NOOP_SUBSCRIBE,
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  // Recompute when a Text card binds / rebinds its path, so a just-opened
  // file is titled the instant its card resolves.
  const registryVersion = useSyncExternalStore(
    subscribeOpenTextCards,
    getOpenTextCardsVersion,
    getOpenTextCardsVersion,
  );

  const ref = useRef<LensTextFilesDataSource | null>(null);
  const inputs = { deck, order, registryVersion, filterQuery };
  if (ref.current === null) {
    ref.current = new LensTextFilesDataSource(inputs);
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
