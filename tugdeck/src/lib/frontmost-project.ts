/**
 * frontmost-project.ts — the project the frontmost card belongs to.
 *
 * Open Quickly searches (and gates on) the project of the card the user is
 * looking at: the focused pane's active card. Its session binding carries
 * the `projectDir` (the absolute workspace root — FILETREE indexes paths
 * relative to it) and the `workspaceKey` (which scopes the FILETREE feed).
 * When the frontmost card has no binding (no project open), the result is
 * `null` and Open Quickly is disabled.
 *
 * @module lib/frontmost-project
 */

import { getDeckStore } from "./deck-store-registry";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "./card-session-binding-store";

/**
 * The session binding of the focused pane's active card, or `null` when
 * the deck has no panes or that card isn't bound to a project. "Focused"
 * is the topmost pane in z-order — the last entry — matching
 * `projectDeckState`.
 */
export function frontmostProjectBinding(): CardSessionBinding | null {
  const store = getDeckStore();
  if (store === null) return null;
  const { panes } = store.getSnapshot();
  if (panes.length === 0) return null;
  const focused = panes[panes.length - 1];
  return cardSessionBindingStore.getBinding(focused.activeCardId) ?? null;
}
