/**
 * Pane-scrim registry — per-pane-chrome ref-counted scrim toggle.
 *
 * Each `.tug-pane-chrome` element owns a built-in scrim layer (rendered
 * inside the chrome by `TugPane`). Modal-class consumers (sheets, future
 * modal surfaces) request the scrim via the `useTugPaneScrim()` hook,
 * which calls into this registry. The registry keeps a count per chrome
 * so simultaneous consumers (e.g. a sheet plus a future loading scrim
 * sharing the same chrome) compose without fighting over the attribute:
 * the first `increment` sets `data-scrim="on"`, the matching last
 * `decrement` removes it.
 *
 * The registry is module-level (not React state). It is appearance-zone
 * infrastructure that lives outside the React render tree — the count
 * drives a single DOM attribute, which CSS picks up to fade the scrim
 * in [L06]. Consumers do not need to observe the count; they only call
 * `increment` / `decrement` and let CSS render the result.
 *
 * ## Why `WeakMap`
 *
 * Chrome elements are owned by their `TugPane`. When a pane unmounts,
 * its chrome element is removed from the DOM and eligible for GC. A
 * `WeakMap` lets the count entry be reclaimed automatically — no leak,
 * no manual cleanup hook on the registry side. The registry has no
 * subscribe / iterate / getSize APIs because consumers do not need them
 * (the only observable effect is the attribute on the chrome itself).
 *
 * ## Idempotence
 *
 * `increment(null)` and `decrement(null)` are no-ops. This matters
 * because the hook returns no-op callbacks when no chrome is in scope
 * (standalone preview / test mounts) but a caller may still invoke them
 * unconditionally; null gates inside the registry mean callers do not
 * have to gate themselves.
 *
 * `decrement(el)` on an element with no recorded count (never
 * incremented, or already at zero) is a no-op too. This is the
 * load-bearing protection against double-decrements during HMR or
 * during a React effect cleanup that races a fresh `useLayoutEffect`
 * registration on the same chrome.
 *
 * @module lib/pane-scrim-registry
 */

const SCRIM_ATTR = "data-scrim";
const SCRIM_ON = "on";

const counts = new WeakMap<HTMLElement, number>();

/**
 * Increment the scrim count on `chromeEl`. When the count crosses
 * `0 → 1`, the chrome's `data-scrim="on"` attribute is set, which the
 * pane's CSS uses to fade the scrim in. `null` is a no-op so callers
 * (including the standalone-fallback path of `useTugPaneScrim`) can
 * call this unconditionally.
 */
export function increment(chromeEl: HTMLElement | null): void {
  if (!chromeEl) return;
  const next = (counts.get(chromeEl) ?? 0) + 1;
  counts.set(chromeEl, next);
  if (next === 1) {
    chromeEl.setAttribute(SCRIM_ATTR, SCRIM_ON);
  }
}

/**
 * Decrement the scrim count on `chromeEl`. When the count drops to
 * zero, the chrome's `data-scrim` attribute is removed. `null`,
 * unknown elements, and elements at zero are no-ops.
 */
export function decrement(chromeEl: HTMLElement | null): void {
  if (!chromeEl) return;
  const current = counts.get(chromeEl);
  if (current === undefined || current === 0) return;
  const next = current - 1;
  if (next === 0) {
    counts.delete(chromeEl);
    chromeEl.removeAttribute(SCRIM_ATTR);
  } else {
    counts.set(chromeEl, next);
  }
}

/**
 * Test-only: read the current scrim count on `chromeEl`. Returns 0 when
 * the element has no recorded count. Production code reads the
 * attribute on the DOM element directly — this is for unit tests that
 * want to verify ref-count math without inspecting the attribute.
 */
export function _getCountForTests(chromeEl: HTMLElement): number {
  return counts.get(chromeEl) ?? 0;
}
