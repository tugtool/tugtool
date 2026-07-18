/**
 * lens-section-content.ts — a tiny module store tracking which Lens sections
 * currently hold navigable content.
 *
 * A section body publishes `true` while its list has at least one cursorable
 * row, `false` when empty. Two consumers read it:
 *   - each section gates its list's `focusGroup` on it, so an EMPTY list is not
 *     a focus stop (Tab skips it, no perimeter ring paints on emptiness);
 *   - `LensContent` picks the Cmd-L seed target as the first expanded section
 *     that has content, so the opening key view lands on a real item instead of
 *     an empty Sessions band.
 *
 * [L02] external store; React reads via `useSyncExternalStore`. Keyed by the
 * section's focus group so it is stable across a section body's unmount/remount
 * (a collapse toggle).
 *
 * @module components/lens/lens-section-content
 */

const hasContentByGroup = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

/** Subscribe to content changes across all sections. */
export function subscribeSectionContent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A monotonic token that bumps on every change — a `useSyncExternalStore`
 *  snapshot paired with {@link subscribeSectionContent}. */
export function getSectionContentVersion(): number {
  return version;
}

/** Whether the section authored into `focusGroup` currently has content. */
export function sectionHasContent(focusGroup: string): boolean {
  return hasContentByGroup.get(focusGroup) ?? false;
}

/** Publish whether the section authored into `focusGroup` has content. */
export function setSectionHasContent(focusGroup: string, hasContent: boolean): void {
  if (hasContentByGroup.get(focusGroup) === hasContent) return;
  hasContentByGroup.set(focusGroup, hasContent);
  version += 1;
  for (const listener of listeners) listener();
}
