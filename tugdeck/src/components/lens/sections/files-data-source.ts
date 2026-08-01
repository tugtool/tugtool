/**
 * files-data-source.ts — the `TugListView` data source for the Lens **Files**
 * section: the open file cards, editable and viewable alike. Recently-open
 * files are no longer listed here — they reach the user through the section
 * header's recents menu.
 *
 * Rows:
 *  - `"text-open"` — one per mounted Text card (`componentId === "text"`).
 *    The bound path and unsaved mark come from the text-card open registry.
 *  - `"view-open"` — one per mounted viewer card (`componentId ===
 *    "file-view"`). The bound path comes from the viewer open registry; a
 *    viewer is read-only, so it never carries an unsaved mark.
 *
 * Both kinds share the row shape, the ordering, and the disambiguators —
 * the section presents open files as one list regardless of which card
 * family holds them. `id = "open:<cardId>"` for either.
 *
 * Laws:
 *  - [L02] external state via `useSyncExternalStore` — this IS such a store,
 *    fed the deck snapshot; the hook notifies from `useLayoutEffect` ([L03]).
 *  - [L19] component authoring — module docstring, exported types.
 *
 * @module components/lens/sections/files-data-source
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
import {
  getOpenFileViewCard,
  getOpenFileViewCardsVersion,
  subscribeOpenFileViewCards,
} from "@/lib/file-view-open-registry";

/** Which card family a row's file is open in. */
export type FilesRowKind = "text-open" | "view-open";

export type FilesRow = {
  readonly kind: FilesRowKind;
  readonly cardId: string;
  readonly path: string | null;
  readonly title: string;
  /** The card wears its unsaved-changes mark (manual mode, dirty buffer); the
   *  row paints the same dot after the filename. */
  readonly unsaved: boolean;
  /** The shortest trailing directory run that tells this row apart from the
   *  other open files sharing its filename (`"roadmap"`, `"tugcast/src"`), or
   *  `null` when the filename is already unique. */
  readonly disambiguator: string | null;
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

/** The abbreviated full path a row shows on hover (`~/src/proj/a.txt`). */
export function displayPath(path: string): string {
  const dir = dirname(path);
  const shown = dir.length > 0 ? displayDir(dir) : "";
  return shown.length > 0 ? `${shown}/${basename(path)}` : basename(path);
}

/**
 * Fill in each row's {@link FilesRow.disambiguator}: `null` when the
 * filename is unique among the open files, otherwise the **shortest trailing
 * directory run** that separates this row from the others sharing its name —
 * one segment where one is enough (`roadmap` vs `Desktop`), more only where the
 * near directories also match (`tugcast/src` vs `tugbank/src`). Two files with
 * the same name in the same directory cannot happen, so the walk always
 * terminates at the abbreviated full directory.
 *
 * Pure over the row list; the caller runs it on the UNFILTERED set so a row's
 * suffix does not appear and vanish as the filter narrows the list.
 */
export function assignDisambiguators(
  rows: readonly FilesRow[],
): FilesRow[] {
  const byTitle = new Map<string, FilesRow[]>();
  for (const row of rows) {
    const group = byTitle.get(row.title);
    if (group === undefined) byTitle.set(row.title, [row]);
    else group.push(row);
  }
  return rows.map((row) => {
    const group = byTitle.get(row.title) ?? [];
    if (group.length < 2 || row.path === null) {
      return { ...row, disambiguator: null };
    }
    const segments = (path: string): string[] =>
      displayDir(dirname(path))
        .split("/")
        .filter((s) => s !== "");
    const mine = segments(row.path);
    const others: string[][] = [];
    for (const other of group) {
      if (other === row || other.path === null) continue;
      others.push(segments(other.path));
    }
    for (let k = 1; k <= mine.length; k += 1) {
      const tail = mine.slice(mine.length - k).join("/");
      const clashes = others.some(
        (segs) => segs.slice(segs.length - k).join("/") === tail,
      );
      if (!clashes) return { ...row, disambiguator: tail };
    }
    return { ...row, disambiguator: mine.length > 0 ? mine.join("/") : null };
  });
}

interface FilesInputs {
  readonly deck: DeckState | null;
  /** The user's persisted row order, by card id. Empty → deck-card order. */
  readonly order: readonly string[];
  /** Bumps when a card in either open registry registers / unregisters /
   *  binds its path, so the rows recompute against the newly-resolved
   *  open-card paths. */
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

/** Resolve an open viewer card's bound path. Default reads the viewer open
 *  registry. */
export type OpenViewCardPathResolver = (cardId: string) => string | null;

const registryViewPathResolver: OpenViewCardPathResolver = (cardId) =>
  getOpenFileViewCard(cardId)?.getPath() ?? null;

/**
 * Build the row list from the deck snapshot: one row per open file card, Text
 * or viewer. Pure over its resolvers — the bound path of each open Text card
 * comes through `resolvePath`, its untitled name through `resolveDisplayName`,
 * its unsaved mark through `resolveUnsaved`, and a viewer card's path through
 * `resolveViewPath` (defaults: the two open registries, re-read on every
 * recompute), so a test can inject its own. A bound card titles from the path
 * basename; an unbound Text card titles from its buffer name (`"Untitled"`).
 * A viewer is read-only, so its row never carries an unsaved mark.
 *
 * Row order: the user's persisted `order` (by card id) first, in that order;
 * cards absent from it keep deck-card order and follow AFTER the ordered set,
 * so a newly opened file lands at the bottom without disturbing the
 * arrangement. Stale ids (closed cards) are never matched. An empty / absent
 * `order` yields plain deck-card order — the same rule the Sessions rows take.
 */
export function buildFilesRows(
  inputs: Pick<FilesInputs, "deck"> & { readonly order?: readonly string[] },
  resolvePath: OpenCardPathResolver = registryPathResolver,
  resolveDisplayName: OpenCardDisplayNameResolver = registryDisplayNameResolver,
  resolveUnsaved: OpenCardUnsavedResolver = registryUnsavedResolver,
  resolveViewPath: OpenViewCardPathResolver = registryViewPathResolver,
): FilesRow[] {
  const rows: FilesRow[] = [];
  const cards = inputs.deck?.cards ?? [];
  for (const card of cards) {
    if (card.componentId === "text") {
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
        disambiguator: null,
      });
    } else if (card.componentId === "file-view") {
      const path = resolveViewPath(card.id);
      rows.push({
        kind: "view-open",
        cardId: card.id,
        path,
        title: path !== null ? basename(path) : card.title || "File",
        unsaved: false,
        disambiguator: null,
      });
    }
  }
  const order = inputs.order;
  const ordered =
    order === undefined || order.length === 0
      ? rows
      : (() => {
          const rank = new Map<string, number>();
          order.forEach((id, i) => rank.set(id, i));
          // Stable sort: ranked ids by rank; unranked (newly opened) cards keep
          // their deck order (their pre-sort index) and sort last.
          return rows
            .map((row, i) => ({ row, i }))
            .sort((a, b) => {
              const ra = rank.get(a.row.cardId) ?? Number.POSITIVE_INFINITY;
              const rb = rank.get(b.row.cardId) ?? Number.POSITIVE_INFINITY;
              return ra !== rb ? ra - rb : a.i - b.i;
            })
            .map((x) => x.row);
        })();
  return assignDisambiguators(ordered);
}

export class LensFilesDataSource implements TugListViewDataSource {
  private inputs: FilesInputs;
  private rows: FilesRow[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(inputs: FilesInputs) {
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
  rowAt(index: number): FilesRow {
    return this.rows[index];
  }

  setInputsWithoutNotify(next: FilesInputs): boolean {
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

  /** How many open file cards there are, filter or no filter. */
  unfilteredCount(): number {
    return buildFilesRows(this.inputs).length;
  }

  private recompute(): void {
    const rows = buildFilesRows(this.inputs);
    // A row matches on its filename and on the directory AS DISPLAYED (`~/src`,
    // not `/Users/name/src`) — the row shows the directory on hover and, when
    // its name is ambiguous, as the trailing run beside the filename, so both
    // are things the user can see and type. Only the filename paints highlight
    // marks. Ranked best-first while filtering; deck-card order returns when
    // the query clears.
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
 * `LensFilesDataSource`, notifying from a layout effect.
 */
export function useLensFilesDataSource(
  filterQuery: string,
  order: readonly string[],
): LensFilesDataSource {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? NOOP_SUBSCRIBE,
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  // Recompute when a card binds / rebinds its path, so a just-opened file is
  // titled the instant its card resolves. Both families feed the list, so
  // both registries are watched; their versions sum into one input, which
  // changes whenever either side moves.
  const textVersion = useSyncExternalStore(
    subscribeOpenTextCards,
    getOpenTextCardsVersion,
    getOpenTextCardsVersion,
  );
  const viewVersion = useSyncExternalStore(
    subscribeOpenFileViewCards,
    getOpenFileViewCardsVersion,
    getOpenFileViewCardsVersion,
  );
  const registryVersion = textVersion + viewVersion;

  const ref = useRef<LensFilesDataSource | null>(null);
  const inputs = { deck, order, registryVersion, filterQuery };
  if (ref.current === null) {
    ref.current = new LensFilesDataSource(inputs);
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
