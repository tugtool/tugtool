/**
 * lens-section-content.ts — a tiny module store tracking what each Lens section
 * currently holds.
 *
 * A section body publishes two facts about itself, and they are deliberately
 * different questions:
 *
 *   - `navigable` — at least one cursorable row RIGHT NOW, after the filter.
 *     Each section gates its list's `focusGroup` on it, so an empty list is not
 *     a focus stop (Tab skips it, no perimeter ring paints on emptiness), and
 *     `LensContent` picks the Cmd-L seed target as the first expanded section
 *     that has it, so the opening key view lands on a real item.
 *   - `populated` — at least one item BEFORE the filter: whether the section
 *     has anything to filter at all. The band disables its filter field when
 *     this is false. It must never be read off the filtered count: a query that
 *     matches nothing would then disable the very field holding it, and the
 *     only way back would be gone ([R02]).
 *
 * A section filtered to zero is therefore `navigable: false, populated: true` —
 * out of the keyboard walk, filter field still live.
 *
 * [L02] external store; React reads via `useSyncExternalStore`. Keyed by the
 * section's focus group so it is stable across a section body's unmount/remount
 * (a collapse toggle).
 *
 * @module components/lens/lens-section-content
 */

/** What a section currently holds. See the module docstring. */
export interface LensSectionContent {
  /** At least one cursorable row after the filter. */
  navigable: boolean;
  /** At least one item before the filter. */
  populated: boolean;
}

const EMPTY: LensSectionContent = { navigable: false, populated: false };

const contentByGroup = new Map<string, LensSectionContent>();
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

/** Whether the section authored into `focusGroup` shows a cursorable row. */
export function sectionHasContent(focusGroup: string): boolean {
  return (contentByGroup.get(focusGroup) ?? EMPTY).navigable;
}

/** Whether the section authored into `focusGroup` holds any item at all,
 *  filter or no filter. */
export function sectionIsPopulated(focusGroup: string): boolean {
  return (contentByGroup.get(focusGroup) ?? EMPTY).populated;
}

/** Publish what the section authored into `focusGroup` holds. */
export function setSectionContent(
  focusGroup: string,
  content: LensSectionContent,
): void {
  const prev = contentByGroup.get(focusGroup) ?? EMPTY;
  if (
    prev.navigable === content.navigable &&
    prev.populated === content.populated
  ) {
    return;
  }
  contentByGroup.set(focusGroup, content);
  version += 1;
  for (const listener of listeners) listener();
}
