/**
 * open-file-in-card.ts — the one implementation behind every
 * "open this path in a File card" entry point.
 *
 * Path-keyed reuse: a File card already bound to `path` is activated
 * (raised + focus-claimed via `transferFocusForActivation`, so the
 * keystroke/click taxonomy matches every other activation route) and
 * jumped to `line`; otherwise a new File card is created seeded with
 * the path through `addCard`'s initial-content channel, so it mounts
 * directly onto the file via the same restore path a reloaded card
 * takes.
 *
 * Callers: the `open-file` action-dispatch handler (Control frames +
 * `dispatchAction` from transcript links) and DeckCanvas's
 * `TUG_ACTIONS.OPEN_FILE` chain handler (context-menu items).
 *
 * @module lib/open-file-in-card
 */

import { transferFocusForActivation } from "@/focus-transfer";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { findFileCardByPath } from "./file-card-open-registry";

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
  store.addCard("file", {
    path,
    anchor: { line: line ?? 1, ch: 0 },
    scrollTop: 0,
  });
}
