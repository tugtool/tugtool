/**
 * `enhanceTable` — DOM-walks a markdown block container after its
 * `innerHTML` is set and applies post-parse affordances to every
 * `<table>` produced by pulldown-cmark / DOMPurify.
 *
 * **Tier 0 (this file, ship-first).** Wraps each bare `<table>` in a
 * `<div class="tugx-md-table-scroll">` so the CSS layer can pin
 * `<thead>` with `position: sticky` against the wrapper's scroll
 * origin. The wrapper is the layout container the sticky algorithm
 * needs; without it sticky has nothing to stick *inside of*. The CSS
 * (in `tug-markdown-view.css`) also paints zebra striping on
 * `tbody tr:nth-child(even)` once the wrapper is in place.
 *
 * Tier 1 (later) will extend this same module with a click-driven
 * vanilla-JS sort enhancer. Sort state lives in DOM attributes on
 * the `<table>` element (no React state, no module-level map), and
 * the enhancer re-attaches per delta as the markdown reconciler
 * wipes and rebuilds its subtree. The two tiers share this file so
 * the markdown pipeline calls a single `enhanceTable(el)` after
 * `innerHTML = ...` and gets the full table experience.
 *
 * Idempotent: a `<table>` already marked with
 * `data-tugx-table-enhanced="true"` is skipped on re-walks. The
 * mark is placed *on the inner `<table>`* (not the wrapper) so the
 * existing-DOM check survives even if a future enhancer moves the
 * wrapper around.
 *
 * No listener cleanup is needed — when the parent block element is
 * replaced (`el.innerHTML = ...` write, or the windowing engine's
 * prune step), the table and any listeners it carries are detached
 * and garbage-collected together.
 *
 * Laws:
 *  - [L01] no `root.render()` — pure DOM mutation, no React mount.
 *  - [L06] appearance through DOM/CSS, not React state. The scroll
 *    region is a real layout container; the visual effects (sticky
 *    header, zebra striping) are all CSS.
 *  - [L19] file pair (this `.ts` + a sibling test file once Tier 1
 *    lands), module docstring, exported function.
 *
 * @module lib/markdown/enhance-table
 */

const ENHANCED_ATTR = "data-tugx-table-enhanced";
const SCROLL_WRAPPER_CLASS = "tugx-md-table-scroll";

/**
 * Walk every `<table>` in `container` and apply the markdown-table
 * affordances described in the module docstring. Skips tables that
 * have already been enhanced.
 *
 * Safe to call on any container — if there are no tables, the walk
 * is a single `querySelectorAll` that finds zero matches.
 */
export function enhanceTable(container: HTMLElement): void {
  const tables = container.querySelectorAll<HTMLTableElement>(
    `table:not([${ENHANCED_ATTR}])`,
  );
  for (const table of tables) {
    table.setAttribute(ENHANCED_ATTR, "true");
    wrapInScrollRegion(table);
  }
}

/**
 * Wrap a `<table>` in `<div class="tugx-md-table-scroll">` if it
 * isn't already inside one. The wrapper is the sticky-scroll origin
 * for `position: sticky` on `<thead>`.
 *
 * Exported for tests.
 */
export function wrapInScrollRegion(table: HTMLTableElement): void {
  const parent = table.parentElement;
  if (parent === null) return;
  if (parent.classList.contains(SCROLL_WRAPPER_CLASS)) return;
  const wrapper = document.createElement("div");
  wrapper.className = SCROLL_WRAPPER_CLASS;
  parent.insertBefore(wrapper, table);
  wrapper.appendChild(table);
}
