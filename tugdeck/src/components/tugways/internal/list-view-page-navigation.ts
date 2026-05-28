/**
 * list-view-page-navigation — pure entry-paging selection for `TugListView`.
 *
 * Internal building block — app code uses `TugListView`'s
 * `pageByEntry` prop instead.
 *
 * Each list-view cell is one navigable *entry*. When the consumer
 * opts in via `pageByEntry`, PageUp / PageDown — and the macOS
 * Opt+ArrowUp / Opt+ArrowDown aliases — step the scroller exactly one
 * entry at a time. In the Dev transcript both halves of a turn (the
 * user message and the assistant response) are separate cells, so
 * paging visits every one of them.
 *
 * This is an *entry* pager, not an *entry-in-view* pager. PageDown
 * advances to the next entry and pins its TOP flush to the viewport
 * top — even when that entry is already partly or fully on screen.
 * PageUp is the mirror. So a press always moves the view by one whole
 * entry; it never skips an entry just because it happened to be
 * visible.
 *
 * This module is the SELECTION half: given every cell's top edge it
 * picks the target entry. The actual scroll is the browser's
 * `Element.scrollIntoView` (via `SmartScroll.scrollToElement`), which
 * aligns the chosen cell's top exactly flush with the viewport top.
 *
 * Why geometry comes from DOM rects, not the height index. The list
 * view's `HeightIndex` sums per-cell measured heights — but the
 * scroll content also carries `row-gap` between cells and the
 * `::before` / `::after` breathing-room pseudo-elements, none of
 * which is part of any cell's box, so none of which the height index
 * can see. A target computed from height sums drifts by one
 * `row-gap` per entry, compounding down the list. Real cell rects
 * (`getBoundingClientRect`) are the only faithful source, so the
 * caller reads them and this module works in that space.
 *
 * Coordinate space: each `cellTops[i]` is entry `i`'s top edge
 * measured down from the scrollport's top edge. `0` means the entry
 * is flush at the top; a negative value means the entry has scrolled
 * off the top; a positive value means it sits below the top edge.
 *
 * Pure: no React, no DOM.
 */

/**
 * Sub-pixel tolerance (CSS px). An entry top within this band of the
 * viewport top counts as flush AT it — so a flush entry is treated as
 * the current top entry (not as "scrolled past"), and PageUp from a
 * flush entry steps to the previous entry rather than snapping to the
 * one already at the top. Also absorbs fractional `getBounding
 * ClientRect` values.
 */
const EDGE_EPS_PX = 2;

/** Direction of a page-navigation keypress. */
export type PageNavigationDirection = "up" | "down";

export interface PageNavigationInput {
  /** `"up"` for PageUp / Opt+ArrowUp, `"down"` for PageDown / Opt+ArrowDown. */
  direction: PageNavigationDirection;
  /**
   * Each entry's top edge, measured down from the viewport's top edge,
   * in data-source index order. `cellTops.length` is the entry count;
   * the result's `index` indexes back into it.
   */
  cellTops: readonly number[];
}

export type PageNavigationResult =
  /** Scroll the entry at `index` so its top is flush with the viewport top. */
  | { kind: "cell"; index: number }
  /**
   * Jump to the live bottom and (re-)engage follow-bottom. Returned
   * for a PageDown that is already on the last entry — composes with
   * the auto-follow-bottom discipline.
   */
  | { kind: "bottom" }
  /** Already at the relevant edge — the keypress is a no-op. */
  | { kind: "none" };

/**
 * Resolve a PageUp / PageDown keypress to a target entry. See the
 * module header for the model. The caller owns the follow-bottom
 * policy: a `"cell"` outcome for `direction: "up"` should disengage
 * follow-bottom (the user is navigating away from the live edge); a
 * `"bottom"` outcome should re-engage it.
 */
export function computePageNavigation(
  input: PageNavigationInput,
): PageNavigationResult {
  const { direction, cellTops } = input;
  if (cellTops.length === 0) return { kind: "none" };
  const lastIndex = cellTops.length - 1;

  // The entry currently at the top of the viewport: the last entry
  // whose top has reached or passed the viewport top. When none have
  // (the viewport sits in the breathing room above the first entry)
  // the first entry is the current one. `cellTops` is monotonic
  // increasing, so the qualifying entries form a prefix.
  let current = 0;
  for (let i = 0; i <= lastIndex; i += 1) {
    if (cellTops[i] <= EDGE_EPS_PX) current = i;
    else break;
  }

  if (direction === "down") {
    // Advance one entry. Already on the last entry ⇒ jump to the live
    // bottom (re-engages follow-bottom, composes with Sub-step I).
    if (current >= lastIndex) return { kind: "bottom" };
    return { kind: "cell", index: current + 1 };
  }

  // direction === "up". When the viewport is mid-entry the first
  // PageUp snaps the current entry's top up; when the current entry
  // is already flush at the top it steps to the previous entry.
  const target = cellTops[current] < -EDGE_EPS_PX ? current : current - 1;
  return target < 0 ? { kind: "none" } : { kind: "cell", index: target };
}
