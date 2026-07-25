/**
 * `focus-reveal` — bring a keyboard-focused element into view.
 *
 * The focus engine never lets the browser scroll: every DOM focus write it
 * issues passes `{ preventScroll: true }`, because scroll-position writes
 * belong to the owning surface / SmartScroll ([D07]). That leaves a hole the
 * surfaces were each patching by hand: a keyboard move that lands the key view
 * on a stop below the fold rings an element the user cannot see.
 *
 * This module closes it with one cooperative reveal, called by the engine when
 * a KEYBOARD key view changes ({@link FocusContext.setKeyView}). It is not a
 * `scrollIntoView`: that reasons about one scrollport's geometry, fights the
 * transcript's follow-bottom pin, and happily parks its target under a stuck
 * sticky header. Instead {@link revealFocusTarget}:
 *
 *  - walks every scrollable ancestor from the target outward, innermost first,
 *    re-measuring after each write (an outer scroll moves the target);
 *  - scrolls each by the MINIMUM delta that brings the target inside — so an
 *    already-visible target costs nothing and no write is ever gratuitous;
 *  - subtracts any sticky header currently stuck over the scrollport's top
 *    band, so the target lands BELOW the header rather than under it;
 *  - leaves {@link RING_GAP_PX} of air on the leading edge, because the focus
 *    ring paints outside the border box (`--tugx-focus-ring-offset` +
 *    `--tugx-focus-ring-width`, `focus-ring.css`) and a flush landing clips it;
 *  - releases follow-bottom on any scroller that registered a
 *    {@link Scroller} façade before writing, so SmartScroll's next pin does not
 *    yank the reveal back to the live edge.
 *
 * Laws:
 *  - [L06] a scroll write is appearance: DOM only, no React state crossed.
 *  - [D07] the engine still issues no focus-driven browser scroll; this is an
 *    explicit, surface-cooperative reveal that routes through the registered
 *    `SmartScroll` façade rather than around it.
 *
 * @module components/tugways/focus-reveal
 */

import { scrollerForElement } from "./internal/scroller-context";

/**
 * Air left between the revealed target's leading edge and the scrollport (or a
 * stuck header) — the focus ring's halo plus a couple of pixels, so the ring is
 * never clipped by the edge it was just scrolled past.
 */
const RING_GAP_PX = 6;

/** Deltas under this are layout noise, not a reveal. */
const EPSILON_PX = 1;

/**
 * Scroll `el` into view in every scrollable ancestor, minimally.
 *
 * Self-gating: an element already fully visible in each of its scrollports
 * produces no writes at all, so callers may invoke it unconditionally on every
 * keyboard focus move.
 */
export function revealFocusTarget(el: HTMLElement): void {
  if (typeof window === "undefined") return;
  if (!el.isConnected) return;
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    if (!isScrollable(node)) continue;
    revealWithin(node, el);
  }
}

/** Whether `node` can scroll its overflow on either axis. */
function isScrollable(node: HTMLElement): boolean {
  const style = window.getComputedStyle(node);
  const canScrollY =
    (style.overflowY === "auto" || style.overflowY === "scroll") &&
    node.scrollHeight > node.clientHeight;
  const canScrollX =
    (style.overflowX === "auto" || style.overflowX === "scroll") &&
    node.scrollWidth > node.clientWidth;
  return canScrollY || canScrollX;
}

/** Scroll one scrollport by the minimum delta that reveals `target`. */
function revealWithin(scroller: HTMLElement, target: HTMLElement): void {
  const port = scroller.getBoundingClientRect();
  // `clientTop` / `clientLeft` are the border widths: the scrollport's content
  // box starts inside them, and `clientHeight` / `clientWidth` already exclude
  // both the borders and any classic scrollbar gutter.
  const portTop = port.top + scroller.clientTop;
  const portBottom = portTop + scroller.clientHeight;
  const portLeft = port.left + scroller.clientLeft;
  const portRight = portLeft + scroller.clientWidth;

  const rect = target.getBoundingClientRect();
  const obstructedTop = stuckHeaderBottom(scroller, target, portTop);
  const deltaY = revealDelta(
    rect.top,
    rect.bottom,
    obstructedTop + RING_GAP_PX,
    portBottom - RING_GAP_PX,
  );
  const deltaX = revealDelta(rect.left, rect.right, portLeft, portRight);

  if (Math.abs(deltaY) >= EPSILON_PX || Math.abs(deltaX) >= EPSILON_PX) {
    // Cooperative: a scroller following its live edge would re-pin over this
    // write on its next growth tick, so release the follow first.
    scrollerForElement(scroller)?.disengage("focus-reveal");
  }
  if (Math.abs(deltaY) >= EPSILON_PX) scroller.scrollTop += deltaY;
  if (Math.abs(deltaX) >= EPSILON_PX) scroller.scrollLeft += deltaX;
}

/**
 * The signed scroll delta that brings `[start, end]` inside `[low, high]`,
 * or `0` when it already is.
 *
 * A target taller than the band is aligned to `low` rather than centered: the
 * leading edge is the one the user is reading from, and it is where the ring
 * lives. Scrolling the trailing edge in never pushes the leading edge out.
 */
function revealDelta(
  start: number,
  end: number,
  low: number,
  high: number,
): number {
  if (start < low) return start - low;
  if (end > high) return Math.min(end - high, start - low);
  return 0;
}

/**
 * The bottom of the sticky header currently stuck over `scroller`'s top band,
 * or `portTop` when nothing is stuck.
 *
 * Only the target's own ancestor chain is examined (and only each ancestor's
 * direct children), which is both bounded and sufficient: a header that can
 * cover the target is by construction pinned by a box the target sits inside —
 * the transcript block's `.tool-call-header` over its `.tool-block-chrome`.
 * Nested stuck headers stack, so the deepest bottom wins.
 */
function stuckHeaderBottom(
  scroller: HTMLElement,
  target: HTMLElement,
  portTop: number,
): number {
  let bottom = portTop;
  for (
    let node = target.parentElement;
    node !== null && node !== scroller;
    node = node.parentElement
  ) {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child === target || child.contains(target)) continue;
      if (window.getComputedStyle(child).position !== "sticky") continue;
      const r = child.getBoundingClientRect();
      // Stuck over the top band: its top has been held at (or above) the band
      // while its bottom still hangs below it.
      if (r.top <= bottom + EPSILON_PX && r.bottom > bottom) bottom = r.bottom;
    }
  }
  return bottom;
}
