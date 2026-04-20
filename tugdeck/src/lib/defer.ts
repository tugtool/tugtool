/**
 * defer.ts — scheduling primitives for escaping the current browser
 * event context.
 *
 * These wrap low-level timer / animation-frame idioms in names that
 * express WHEN the callback should run in terms the caller cares
 * about, not which JS API is used to get there.
 */

/**
 * Schedule `fn` to run on the next macrotask.
 *
 * Use when the callback must run **after** the current browser
 * gesture fully completes — e.g., after pointerdown, mousedown,
 * mouseup, and click have all dispatched and the browser has
 * finalized gesture-scoped decisions like focus-locks from
 * `preventDefault()` on mousedown.
 *
 * `queueMicrotask` is NOT a substitute. Microtasks drain between
 * individual events within the same pointer gesture, so focus
 * changes or other DOM work performed from a microtask are still
 * subject to the browser's gesture-end focus-revert behavior.
 * `setTimeout(fn, 0)` queues a new macrotask, which runs after the
 * gesture's events and their microtask checkpoints have all drained.
 *
 * In tests, flush pending deferred callbacks with
 * `await new Promise(r => setTimeout(r, 0))`.
 *
 * Implementation note: `setTimeout(fn, 0)` is the JS idiom for
 * "next macrotask." Browsers clamp the delay (first call: often
 * 0–4ms; nested timers: minimum 4ms per HTML spec). The clamp is
 * effectively invisible to humans.
 */
export function deferToNextMacrotask(fn: () => void): void {
  setTimeout(fn, 0);
}
