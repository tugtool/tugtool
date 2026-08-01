/**
 * open-file-in-card.ts — the one implementation behind every
 * "open this path" entry point.
 *
 * The path's kind decides the card family: text goes to a Text card, and
 * everything `file-kinds.ts` classifies as viewable (images, PDFs) goes to a
 * read-only `file-view` card. Branching here means every producer — ⌘O, Open
 * Recent, Open Quickly, Finder, transcript links, context menus — inherits the
 * routing without knowing it exists. Both families share the reuse and
 * open-target semantics below; a viewer just has no lines to reveal and is
 * never dirty.
 *
 * Path-keyed reuse: a Text card already bound to `path` is activated
 * (raised + focus-claimed via `transferFocusForActivation`, so the
 * keystroke/click taxonomy matches every other activation route) and
 * jumped to `line`. Otherwise the deck-wide `openTarget` default
 * decides:
 *   - `"reuse"`  — rebinds the frontmost Text card to the path
 *     (BBEdit's single-window model);
 *   - `"newTab"` — adds a new Text tab to the frontmost Text card's
 *     pane, seeded with the path;
 *   - `"new"` (the default) — creates a fresh Text card seeded with the
 *     path through `addCard`'s initial-content channel.
 * Both card-creating paths mount directly onto the file via the same
 * restore path a reloaded card takes. When the deck has no Text card
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
  TEXT_CARD_DEFAULTS_DOMAIN,
  TEXT_CARD_DEFAULTS_KEY,
  TEXT_CARD_SAVE_MODE_KEY,
  DEFAULT_TEXT_CARD_OPEN_TARGET,
  parseTextCardDefaults,
  parseSaveMode,
  type TextCardOpenTarget,
} from "./text-card-settings";
import type { SaveMode } from "./text-card-store";
import {
  findTextCardByPath,
  getOpenTextCard,
} from "./text-card-open-registry";
import {
  findFileViewCardByPath,
  getOpenFileViewCard,
} from "./file-view-open-registry";
import { isViewableFile } from "./file-kinds";
import { noteRecentDocument } from "./recent-documents";

/** Read the deck-wide open-target default straight from the tugbank cache. */
function readOpenTarget(): TextCardOpenTarget {
  const client = getTugbankClient();
  if (client === null) return DEFAULT_TEXT_CARD_OPEN_TARGET;
  const defaults = parseTextCardDefaults(
    client.get(TEXT_CARD_DEFAULTS_DOMAIN, TEXT_CARD_DEFAULTS_KEY),
  );
  return defaults?.openTarget ?? DEFAULT_TEXT_CARD_OPEN_TARGET;
}

/**
 * Read the deck-wide save-mode default straight from the tugbank cache
 * — the mode a newly mounted Text card adopts. Missing → the
 * shipping default ({@link parseSaveMode}). No settings UI exposes it.
 */
export function readSaveMode(): SaveMode {
  const client = getTugbankClient();
  return parseSaveMode(
    client?.get(TEXT_CARD_DEFAULTS_DOMAIN, TEXT_CARD_SAVE_MODE_KEY),
  );
}

/**
 * The frontmost mounted card of `componentId` (id + host pane id), or null
 * when the deck has none. "Frontmost" = the visible (active) card of the
 * highest-z pane that shows one; panes are ordered back-to-front, so the
 * last entry is topmost.
 */
function findFrontmostCard(
  store: IDeckManagerStore,
  componentId: string,
): { cardId: string; paneId: string } | null {
  const state = store.getSnapshot();
  const matchingIds = new Set(
    state.cards.filter((c) => c.componentId === componentId).map((c) => c.id),
  );
  if (matchingIds.size === 0) return null;
  // Prefer the pane's visible card, top pane first.
  for (let i = state.panes.length - 1; i >= 0; i--) {
    const pane = state.panes[i];
    if (matchingIds.has(pane.activeCardId)) {
      return { cardId: pane.activeCardId, paneId: pane.id };
    }
  }
  // No matching card is its pane's active card — take any, top pane first.
  for (let i = state.panes.length - 1; i >= 0; i--) {
    const pane = state.panes[i];
    for (const cid of pane.cardIds) {
      if (matchingIds.has(cid)) return { cardId: cid, paneId: pane.id };
    }
  }
  return null;
}

/**
 * Open a viewable file (image, PDF) in a read-only `file-view` card. Mirrors
 * the Text path: reuse the card already bound to `path`, else honor the
 * deck-wide open target against the frontmost viewer, else a fresh card.
 * `line` has no meaning for a viewer, so the reveal channel is absent.
 */
function openFileInViewerCard(store: IDeckManagerStore, path: string): void {
  const existing = findFileViewCardByPath(path);
  if (existing) {
    transferFocusForActivation({
      outgoingCardId: store.getFirstResponderCardId(),
      incomingCardId: existing.cardId,
      store,
      commitMutation: () => store.activateCard(existing.cardId),
    });
    return;
  }

  const target = readOpenTarget();
  const seed = { path };

  if (target !== "new") {
    const frontmost = findFrontmostCard(store, "file-view");
    if (frontmost !== null) {
      if (target === "reuse") {
        // A viewer is never dirty, so the Text path's dirty guard has no
        // analogue here — rebinding only swaps which bytes are on screen.
        const entry = getOpenFileViewCard(frontmost.cardId);
        if (entry !== null) {
          transferFocusForActivation({
            outgoingCardId: store.getFirstResponderCardId(),
            incomingCardId: frontmost.cardId,
            store,
            commitMutation: () => store.activateCard(frontmost.cardId),
          });
          entry.openFile(path);
          return;
        }
      } else {
        // "newTab": a new viewer tab in the frontmost viewer's pane. As on
        // the Text path, activate explicitly when the target pane sits
        // behind another, so the file doesn't open in a background pane.
        const outgoing = store.getFirstResponderCardId();
        const newId = store.addCardToPane(frontmost.paneId, "file-view", seed);
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

  // Same save-before-activation discipline as the Text fall-through: the
  // surface that dispatched this open — the Lens Files list, say — must save
  // its focus bag before `addCard` activates the new card ([L23]).
  const outgoing = store.getFirstResponderCardId();
  if (outgoing !== null) store.invokeSaveCallback(outgoing);
  store.addCard("file-view", seed);
}

export function openFileInCard(
  store: IDeckManagerStore,
  path: string,
  line?: number,
  endLine?: number,
): void {
  // Every real open flows through here — record it for Open Recent
  // before the card work, so drops / Open Quickly / menu all feed it.
  // Viewed files belong in Open Recent too, so this runs for every kind.
  noteRecentDocument(path);

  // The one place a path's kind decides which card family it lands in.
  if (isViewableFile(path)) {
    openFileInViewerCard(store, path);
    return;
  }

  const existing = findTextCardByPath(path);
  if (existing) {
    transferFocusForActivation({
      outgoingCardId: store.getFirstResponderCardId(),
      incomingCardId: existing.cardId,
      store,
      commitMutation: () => store.activateCard(existing.cardId),
    });
    if (line !== undefined) {
      existing.entry.revealLine(line, endLine);
    }
    return;
  }

  // No card holds this exact path. The deck default decides where it
  // lands; reuse / newTab fall through to a fresh card when the deck has
  // no Text card yet. A `line` seeds a one-time reveal + flash of the
  // touched passage once the fresh card binds the file.
  const target = readOpenTarget();
  const seed = {
    path,
    revealOnOpen: line === undefined ? undefined : { line, endLine },
    scrollTop: 0,
  };

  if (target !== "new") {
    const frontmost = findFrontmostCard(store, "text");
    if (frontmost !== null) {
      if (target === "reuse") {
        const entry = getOpenTextCard(frontmost.cardId);
        // Never rebind a dirty card — rebinding tears down its buffer and
        // prompting mid-open is hostile; fall through to a fresh card.
        if (entry !== null && !entry.isDirty()) {
          transferFocusForActivation({
            outgoingCardId: store.getFirstResponderCardId(),
            incomingCardId: frontmost.cardId,
            store,
            commitMutation: () => store.activateCard(frontmost.cardId),
          });
          entry.openFile(path, line, endLine);
          return;
        }
      } else {
        // "newTab": a new Text tab in the frontmost Text card's pane,
        // seeded with the path (becomes the pane's active card).
        // `addCardToPane` only flips the deck's first responder when its
        // pane is already the active one; when the target pane sits
        // behind another (e.g. a Session card on top), activate the new card
        // explicitly so it raises + focuses like `new` / `reuse` do —
        // otherwise the file opens invisibly in a background pane.
        const outgoing = store.getFirstResponderCardId();
        const newId = store.addCardToPane(frontmost.paneId, "text", seed);
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

  // Save the outgoing card's focus bag before the new card claims focus.
  // `addCard` activates the fresh card directly (no `transferFocusForActivation`
  // to run the outgoing save the reuse / newTab / existing paths get), so
  // without this the previously-focused surface — e.g. the Lens Text Files list
  // that dispatched this open — loses its saved keyboard key view, and a later
  // Cmd-L back into it falls to default-focus (wrong section, no ring) instead
  // of restoring the row the user was on ([L23] save-before-activation).
  const outgoing = store.getFirstResponderCardId();
  if (outgoing !== null) store.invokeSaveCallback(outgoing);
  store.addCard("text", seed);
}
