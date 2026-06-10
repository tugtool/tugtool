/**
 * synthetic-escape.ts — the marker for engine-originated synthetic Escape events
 * ([P03] of the engine-owned-Escape model).
 *
 * The uncontrolled Radix `ContextMenu` has no controlled `open` prop, so its only
 * programmatic close lever is a synthesized Escape keydown. When the engine's
 * Escape ladder dismisses the context menu it synthesizes such an event and marks
 * it. Two readers consult the marker off the SAME `Event` instance:
 *
 *  - the engine's document Escape listeners early-return on a marked event — they
 *    must not re-arbitrate the event they themselves originated (else loop);
 *  - the context menu's `onEscapeKeyDown` suppressor lets a marked event THROUGH
 *    to Radix (and preventDefaults every other, user-originated Escape).
 *
 * `KeyboardEvent` constructors take no custom fields, so the marker is assigned
 * after construction; the same instance reaches every capture-phase listener and
 * Radix's `onEscapeKeyDown(event)`, so the field round-trips intact.
 */

const SYNTHETIC_ESCAPE_MARKER = "__tugEngineSyntheticEscape";

/** Stamp an engine-synthesized Escape so the engine's own listeners skip it. */
export function markSyntheticEscape(event: KeyboardEvent): void {
  (event as unknown as Record<string, unknown>)[SYNTHETIC_ESCAPE_MARKER] = true;
}

/** Whether `event` is an engine-originated synthetic Escape. */
export function isSyntheticEscape(event: Event): boolean {
  return (event as unknown as Record<string, unknown>)[SYNTHETIC_ESCAPE_MARKER] === true;
}
