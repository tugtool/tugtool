/**
 * open-file-in-card.ts — the one implementation behind every
 * "open this path in a Text card" entry point.
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
 * The frontmost mounted Text card (id + host pane id), or null when the
 * deck has none. "Frontmost" = the visible (active) card of the
 * highest-z pane that shows a Text card; panes are ordered
 * back-to-front, so the last entry is topmost.
 */
function findFrontmostTextCard(
  store: IDeckManagerStore,
): { cardId: string; paneId: string } | null {
  const state = store.getSnapshot();
  const textCardIds = new Set(
    state.cards.filter((c) => c.componentId === "text").map((c) => c.id),
  );
  if (textCardIds.size === 0) return null;
  // Prefer the pane's visible card, top pane first.
  for (let i = state.panes.length - 1; i >= 0; i--) {
    const pane = state.panes[i];
    if (textCardIds.has(pane.activeCardId)) {
      return { cardId: pane.activeCardId, paneId: pane.id };
    }
  }
  // No Text card is its pane's active card — take any, top pane first.
  for (let i = state.panes.length - 1; i >= 0; i--) {
    const pane = state.panes[i];
    for (const cid of pane.cardIds) {
      if (textCardIds.has(cid)) return { cardId: cid, paneId: pane.id };
    }
  }
  return null;
}

export function openFileInCard(
  store: IDeckManagerStore,
  path: string,
  line?: number,
): void {
  // Every real open flows through here — record it for Open Recent
  // before the card work, so drops / Open Quickly / menu all feed it.
  noteRecentDocument(path);

  const existing = findTextCardByPath(path);
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
  // no Text card yet.
  const target = readOpenTarget();
  const seed = { path, anchor: { line: line ?? 1, ch: 0 }, scrollTop: 0 };

  if (target !== "new") {
    const frontmost = findFrontmostTextCard(store);
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
          entry.openFile(path, line);
          return;
        }
      } else {
        // "newTab": a new Text tab in the frontmost Text card's pane,
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
