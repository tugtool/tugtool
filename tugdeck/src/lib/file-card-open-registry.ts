/**
 * file-card-open-registry.ts — live index of mounted File cards, keyed
 * by card id, exposing each card's bound path and a reveal hook.
 *
 * The `open-file` action uses this for path-keyed reuse: opening a
 * path that is already bound to a File card activates that card and
 * jumps to the requested line instead of spawning a duplicate — two
 * cards live-editing the same file would fight through the
 * filesystem watcher.
 *
 * Entries are registered by `FileCardContent` in a layout effect and
 * removed on unmount. Callbacks read live state at call time ([L07]).
 *
 * @module lib/file-card-open-registry
 */

export interface FileCardOpenEntry {
  /** The card's canonically-bound path, or null before binding. */
  getPath(): string | null;
  /**
   * True when the card has unsaved in-memory edits (manual mode). The
   * `"reuse"` open target never rebinds a dirty card — rebinding tears
   * down the buffer ([P11]).
   */
  isDirty(): boolean;
  /** Move the cursor to `line` (1-based) and center it. */
  revealLine(line: number): void;
  /**
   * Rebind this card to a different file (the "reuse frontmost card"
   * open target). Flushes any pending edits to the current file first,
   * then reads `path` and reveals `line` (1-based) if given.
   */
  openFile(path: string, line?: number): void;
}

const entries = new Map<string, FileCardOpenEntry>();

export function registerOpenFileCard(
  cardId: string,
  entry: FileCardOpenEntry,
): void {
  entries.set(cardId, entry);
}

export function unregisterOpenFileCard(cardId: string): void {
  entries.delete(cardId);
}

/** The open-file entry for `cardId`, or null when not a mounted File card. */
export function getOpenFileCard(cardId: string): FileCardOpenEntry | null {
  return entries.get(cardId) ?? null;
}

/**
 * Find the card currently bound to `path` (exact canonical-string
 * match). Returns the card id and entry, or null.
 */
export function findFileCardByPath(
  path: string,
): { cardId: string; entry: FileCardOpenEntry } | null {
  for (const [cardId, entry] of entries) {
    if (entry.getPath() === path) return { cardId, entry };
  }
  return null;
}
