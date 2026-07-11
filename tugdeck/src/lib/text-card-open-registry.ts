/**
 * text-card-open-registry.ts — live index of mounted Text cards, keyed
 * by card id, exposing each card's bound path and a reveal hook.
 *
 * The `open-file` action uses this for path-keyed reuse: opening a
 * path that is already bound to a Text card activates that card and
 * jumps to the requested line instead of spawning a duplicate — two
 * cards live-editing the same file would fight through the
 * filesystem watcher.
 *
 * Entries are registered by `TextCardContent` in a layout effect and
 * removed on unmount. Callbacks read live state at call time ([L07]).
 *
 * @module lib/text-card-open-registry
 */

export interface TextCardOpenEntry {
  /** The card's canonically-bound path, or null before binding. */
  getPath(): string | null;
  /**
   * True when the card has unsaved in-memory edits (manual mode). The
   * `"reuse"` open target never rebinds a dirty card — rebinding tears
   * down the buffer.
   */
  isDirty(): boolean;
  /**
   * Reveal line(s) and momentarily flash them in the theme accent —
   * caret at `line` (1-based), a fading accent wash over `line`..`endLine`
   * (or just `line`). No persistent selection.
   */
  revealLine(line: number, endLine?: number): void;
  /**
   * Rebind this card to a different file (the "reuse frontmost card"
   * open target). Flushes any pending edits to the current file first,
   * then reads `path` and reveals `line`..`endLine` (1-based) if given.
   */
  openFile(path: string, line?: number, endLine?: number): void;
}

const entries = new Map<string, TextCardOpenEntry>();

export function registerOpenTextCard(
  cardId: string,
  entry: TextCardOpenEntry,
): void {
  entries.set(cardId, entry);
}

export function unregisterOpenTextCard(cardId: string): void {
  entries.delete(cardId);
}

/** The open-file entry for `cardId`, or null when not a mounted Text card. */
export function getOpenTextCard(cardId: string): TextCardOpenEntry | null {
  return entries.get(cardId) ?? null;
}

/**
 * Find the card currently bound to `path` (exact canonical-string
 * match). Returns the card id and entry, or null.
 */
export function findTextCardByPath(
  path: string,
): { cardId: string; entry: TextCardOpenEntry } | null {
  for (const [cardId, entry] of entries) {
    if (entry.getPath() === path) return { cardId, entry };
  }
  return null;
}
