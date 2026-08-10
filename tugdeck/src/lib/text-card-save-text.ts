/**
 * text-card-save-text.ts — the one wording for a Text card's save state.
 *
 * This used to live inside the card's bottom status bar, which was the only
 * surface that said it. It now rides the card's document masthead instead —
 * the third line under the filename and the path — and it lives here so the
 * string is a pure function of the store's facts rather than a detail of
 * whichever surface happens to render it.
 *
 * @module lib/text-card-save-text
 */

import type { FileConflict, FileSaveState, SaveMode } from "./text-card-store";

/**
 * Save-state copy. Automatic mode is the saveless live-autosave wording
 * ("Saving…" / "Unsaved" / "Saved"); manual mode is the classic document
 * wording ("Saving…" / "Edited" / "Saved"), and an unresolved external
 * change displaces both — a buffer whose file changed under it has nothing
 * useful to say about when it was last written.
 */
export function saveText(
  saveMode: SaveMode,
  saveState: FileSaveState,
  conflict: FileConflict | null,
  lastSavedAt: number | null,
): string {
  if (saveMode === "manual" && conflict !== null) {
    return conflict.reason === "missing" ? "File deleted" : "File changed";
  }
  if (saveState === "writing") return "Saving…";
  if (saveState === "editing") return saveMode === "manual" ? "Edited" : "Unsaved";
  if (lastSavedAt === null) return "Saved";
  return `Saved: ${new Date(lastSavedAt).toLocaleTimeString()}`;
}
