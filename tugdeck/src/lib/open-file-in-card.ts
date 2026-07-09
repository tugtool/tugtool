/**
 * open-file-in-card.ts — the one implementation behind every
 * "open this path in a File card" entry point.
 *
 * Path-keyed reuse: a File card already bound to `path` is activated
 * (raised + focus-claimed via `transferFocusForActivation`, so the
 * keystroke/click taxonomy matches every other activation route) and
 * jumped to `line`. Otherwise the deck-wide `openTarget` default
 * decides:
 *   - `"reuse"`  — rebinds the frontmost File card to the path
 *     (BBEdit's single-window model);
 *   - `"newTab"` — adds a new File tab to the frontmost File card's
 *     pane, seeded with the path;
 *   - `"new"` (the default) — creates a fresh File card seeded with the
 *     path through `addCard`'s initial-content channel.
 * Both card-creating paths mount directly onto the file via the same
 * restore path a reloaded card takes. When the deck has no File card
 * yet, `reuse`/`newTab` fall through to `new`.
 *
 * Callers: the `open-file` action-dispatch handler (Control frames +
 * `dispatchAction` from transcript links) and DeckCanvas's
 * `TUG_ACTIONS.OPEN_FILE` chain handler (context-menu items).
 *
 * @module lib/open-file-in-card
 */

import { transferFocusForActivation } from "@/focus-transfer";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { getTugbankClient } from "./tugbank-singleton";
import {
  FILE_EDITOR_DEFAULTS_DOMAIN,
  FILE_EDITOR_DEFAULTS_KEY,
  FILE_EDITOR_SAVE_MODE_KEY,
  DEFAULT_FILE_EDITOR_OPEN_TARGET,
  parseFileEditorDefaults,
  parseSaveMode,
  type FileEditorOpenTarget,
} from "./file-editor-settings";
import type { SaveMode } from "./file-editor-store";
import {
  findFileCardByPath,
  getOpenFileCard,
} from "./file-card-open-registry";

/** Read the deck-wide open-target default straight from the tugbank cache. */
function readOpenTarget(): FileEditorOpenTarget {
  const client = getTugbankClient();
  if (client === null) return DEFAULT_FILE_EDITOR_OPEN_TARGET;
  const defaults = parseFileEditorDefaults(
    client.get(FILE_EDITOR_DEFAULTS_DOMAIN, FILE_EDITOR_DEFAULTS_KEY),
  );
  return defaults?.openTarget ?? DEFAULT_FILE_EDITOR_OPEN_TARGET;
}

/**
 * Read the deck-wide save-mode default straight from the tugbank cache
 * — the mode a newly mounted File card adopts. Missing → the
 * shipping default ({@link parseSaveMode}). No settings UI exposes it.
 */
export function readSaveMode(): SaveMode {
  const client = getTugbankClient();
  return parseSaveMode(
    client?.get(FILE_EDITOR_DEFAULTS_DOMAIN, FILE_EDITOR_SAVE_MODE_KEY),
  );
}

/**
 * The frontmost mounted File card (id + host pane id), or null when the
 * deck has none. "Frontmost" = the visible (active) card of the
 * highest-z pane that shows a File card; panes are ordered
 * back-to-front, so the last entry is topmost.
 */
function findFrontmostFileCard(
  store: IDeckManagerStore,
): { cardId: string; paneId: string } | null {
  const state = store.getSnapshot();
  const fileCardIds = new Set(
    state.cards.filter((c) => c.componentId === "file").map((c) => c.id),
  );
  if (fileCardIds.size === 0) return null;
  // Prefer the pane's visible card, top pane first.
  for (let i = state.panes.length - 1; i >= 0; i--) {
    const pane = state.panes[i];
    if (fileCardIds.has(pane.activeCardId)) {
      return { cardId: pane.activeCardId, paneId: pane.id };
    }
  }
  // No File card is its pane's active card — take any, top pane first.
  for (let i = state.panes.length - 1; i >= 0; i--) {
    const pane = state.panes[i];
    for (const cid of pane.cardIds) {
      if (fileCardIds.has(cid)) return { cardId: cid, paneId: pane.id };
    }
  }
  return null;
}

export function openFileInCard(
  store: IDeckManagerStore,
  path: string,
  line?: number,
): void {
  const existing = findFileCardByPath(path);
  if (existing) {
    transferFocusForActivation({
      outgoingCardId: store.getFirstResponderCardId(),
      incomingCardId: existing.cardId,
      store,
      commitMutation: () => store.activateCard(existing.cardId),
    });
    if (line !== undefined) {
      existing.entry.revealLine(line);
    }
    return;
  }

  // No card holds this exact path. The deck default decides where it
  // lands; reuse / newTab fall through to a fresh card when the deck has
  // no File card yet.
  const target = readOpenTarget();
  const seed = { path, anchor: { line: line ?? 1, ch: 0 }, scrollTop: 0 };

  if (target !== "new") {
    const frontmost = findFrontmostFileCard(store);
    if (frontmost !== null) {
      if (target === "reuse") {
        const entry = getOpenFileCard(frontmost.cardId);
        // Never rebind a dirty card — rebinding tears down its buffer and
        // prompting mid-open is hostile; fall through to a fresh card.
        if (entry !== null && !entry.isDirty()) {
          transferFocusForActivation({
            outgoingCardId: store.getFirstResponderCardId(),
            incomingCardId: frontmost.cardId,
            store,
            commitMutation: () => store.activateCard(frontmost.cardId),
          });
          entry.openFile(path, line);
          return;
        }
      } else {
        // "newTab": a new File tab in the frontmost File card's pane,
        // seeded with the path (becomes the pane's active card).
        // `addCardToPane` only flips the deck's first responder when its
        // pane is already the active one; when the target pane sits
        // behind another (e.g. a Dev card on top), activate the new card
        // explicitly so it raises + focuses like `new` / `reuse` do —
        // otherwise the file opens invisibly in a background pane.
        const outgoing = store.getFirstResponderCardId();
        const newId = store.addCardToPane(frontmost.paneId, "file", seed);
        if (newId !== null) {
          if (store.getFirstResponderCardId() !== newId) {
            transferFocusForActivation({
              outgoingCardId: outgoing,
              incomingCardId: newId,
              store,
              commitMutation: () => store.activateCard(newId),
            });
          }
          return;
        }
      }
    }
  }

  store.addCard("file", seed);
}
