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

interface TextFilesInputs {
  readonly deck: DeckState | null;
  /** Bumps when a Text card registers / unregisters / binds its path, so the
   *  rows recompute against the newly-resolved open-card paths. */
  readonly registryVersion: number;
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

/**
 * Build the row list from the deck snapshot: one row per open Text card, in
 * deck-card order. Pure over `(inputs, resolvePath, resolveDisplayName)` — the
 * bound path of each open card comes through `resolvePath` and its untitled
 * name through `resolveDisplayName` (defaults: the open registry, re-read on
 * every recompute), so a test can inject its own. A bound card titles from the
 * path basename; an unbound one titles from its buffer name (`"Untitled"`).
 */
export function buildTextFilesRows(
  inputs: Pick<TextFilesInputs, "deck">,
  resolvePath: OpenCardPathResolver = registryPathResolver,
  resolveDisplayName: OpenCardDisplayNameResolver = registryDisplayNameResolver,
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
    rows.push({ kind: "text-open", cardId: card.id, path, title });
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
      this.inputs.registryVersion === next.registryVersion
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
    this.rows = buildTextFilesRows(this.inputs);
    this.version += 1;
  }
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Hook — read the deck snapshot (an [L02] store) and feed a stable
 * `LensTextFilesDataSource`, notifying from a layout effect.
 */
export function useLensTextFilesDataSource(): LensTextFilesDataSource {
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
  if (ref.current === null) {
    ref.current = new LensTextFilesDataSource({ deck, registryVersion });
  }
  const ds = ref.current;
  const didChange = ds.setInputsWithoutNotify({ deck, registryVersion });

  useLayoutEffect(() => {
    if (didChange) ds.notifyAll();
    // didChange is captured per render; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  return ds;
}
