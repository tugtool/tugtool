/**
 * untitled-naming.ts — session-scoped numbering for untitled File-card
 * buffers.
 *
 * A new untitled document (File ▸ New Text File) gets the next number in
 * a run that starts fresh at each app launch: `Untitled`, `Untitled-2`,
 * `Untitled-3`, … The number is allocated once, at creation, and rides
 * the card's bag ({@link FileCardBagContent.untitledNumber}) so it stays
 * stable across re-renders and a Developer ▸ Reload restore.
 *
 * The counter lives in module scope, so a true page load (app launch,
 * hard reload) resets the run to 1 — the "starting from the launch of the
 * app" behaviour the user asked for. To keep a hard reload from handing a
 * fresh card a number a restored card already wears, restore calls
 * {@link reserveUntitledNumber} to raise the floor past any replayed
 * number before the next allocation.
 *
 * @module lib/untitled-naming
 */

/** Highest number handed out (or reserved) so far this session. */
let counter = 0;

/**
 * Allocate the next untitled number (1, 2, 3, …). Monotonic within a
 * session; resets to 1 on the next app launch.
 */
export function allocateUntitledNumber(): number {
  counter += 1;
  return counter;
}

/**
 * Raise the allocation floor so a later {@link allocateUntitledNumber}
 * never reissues `n`. Called on restore, when a card replays a number
 * that was allocated in a previous session run.
 */
export function reserveUntitledNumber(n: number): void {
  if (n > counter) counter = n;
}

/**
 * The card title for untitled number `n`: `Untitled` for the first,
 * `Untitled-2`, `Untitled-3`, … thereafter. A missing/invalid number
 * degrades to the bare `Untitled` (the gallery's debug button and any
 * legacy bag with no number).
 */
export function formatUntitledName(n: number | null | undefined): string {
  return n !== null && n !== undefined && n > 1 ? `Untitled-${n}` : "Untitled";
}
