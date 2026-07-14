/**
 * diff-card-open-registry.ts — live index of mounted Diff cards, keyed by
 * card id, exposing each card's descriptor key and a re-point hook.
 *
 * `open-diff` uses this for descriptor-keyed reuse ([P20]): opening a
 * descriptor already shown by a Diff card activates that card instead of
 * spawning a duplicate — the mirror of `text-card-open-registry.ts`'s
 * path-keyed reuse.
 *
 * Entries are registered by `DiffCardContent` in a layout effect and removed
 * on unmount. Callbacks read live state at call time.
 *
 * @module lib/diff-card-open-registry
 */

import type { DiffDescriptor } from "./git-diff-store";

export interface DiffCardOpenEntry {
  /** The card's current descriptor key (`diffDescriptorKey`), or null. */
  getKey(): string | null;
  /** Re-point this card at a new descriptor (fires a fresh request). */
  setDescriptor(descriptor: DiffDescriptor): void;
}

const entries = new Map<string, DiffCardOpenEntry>();

export function registerOpenDiffCard(cardId: string, entry: DiffCardOpenEntry): void {
  entries.set(cardId, entry);
}

export function unregisterOpenDiffCard(cardId: string): void {
  entries.delete(cardId);
}

/** The Diff card currently showing `key`, or null. */
export function findDiffCardByKey(
  key: string,
): { cardId: string; entry: DiffCardOpenEntry } | null {
  for (const [cardId, entry] of entries) {
    if (entry.getKey() === key) return { cardId, entry };
  }
  return null;
}
