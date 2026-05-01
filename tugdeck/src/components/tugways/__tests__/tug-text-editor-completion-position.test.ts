/**
 * tug-text-editor-completion-position.test.ts —
 * Pure-function unit tests for the typeahead popup's viewport-coord
 * position math.
 *
 * The painter's read-phase (`view.requestMeasure`) collects:
 *   - `anchorCoords`: viewport-relative trigger-character rect
 *   - `popupWidth` / `popupHeight`: measured from the rendered popup
 *   - `viewportWidth` / `viewportHeight`: window inner dimensions
 *   - `direction`: caller-provided "up" / "down" hint
 *
 * The write-phase delegates the math to `computeCompletionPosition`.
 * That function is pure — easy to test against synthetic inputs.
 *
 * Tests cover:
 *   - Null anchor returns null top/left.
 *   - Down-direction default opens below when there is enough room.
 *   - Down-direction opens upward when below is tighter than above.
 *   - Up-direction opens upward when there is enough room above.
 *   - Up-direction falls back to below when above is tight and below
 *     has more room.
 *   - Horizontal clamp keeps the popup inside the viewport at the
 *     left edge (anchor.left < margin) and right edge (anchor.left +
 *     popupWidth > viewportWidth - margin).
 *   - Degenerate case where popup is wider than the viewport.
 */

import { describe, expect, test } from "bun:test";

import { computeCompletionPosition } from "../tug-text-editor";

const VIEWPORT_W = 800;
const VIEWPORT_H = 600;
const POPUP_W = 200;
const POPUP_H = 100;

describe("computeCompletionPosition", () => {
  test("null anchorCoords returns null top/left and the caller's preferred direction", () => {
    const out = computeCompletionPosition({
      anchorCoords: null,
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "down",
    });
    expect(out.top).toBeNull();
    expect(out.left).toBeNull();
    expect(out.opensDown).toBe(true);
  });

  test("direction=down opens below when there is enough room below", () => {
    const out = computeCompletionPosition({
      anchorCoords: { left: 100, top: 100, bottom: 120 },
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "down",
    });
    expect(out.opensDown).toBe(true);
    expect(out.left).toBe(100);
    // Down: anchor.bottom + GAP. GAP=4.
    expect(out.top).toBe(124);
  });

  test("direction=down opens upward when below is tight and above has more space", () => {
    // Anchor near the bottom of the viewport. Space below: ~30px;
    // space above: ~570px. With popupHeight 100, space below (30) <
    // popupHeight (100), and space below (30) < space above (570),
    // so direction=down's predicate `below >= height || below >= above`
    // is false → flip up.
    const out = computeCompletionPosition({
      anchorCoords: { left: 100, top: 560, bottom: 580 },
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "down",
    });
    expect(out.opensDown).toBe(false);
    expect(out.left).toBe(100);
    // Up: anchor.top - GAP - popupHeight. 560 - 4 - 100 = 456.
    expect(out.top).toBe(456);
  });

  test("direction=up opens upward when there is enough room above", () => {
    const out = computeCompletionPosition({
      anchorCoords: { left: 100, top: 400, bottom: 420 },
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "up",
    });
    // direction=up's predicate inverts: useDown iff above < height &&
    // below > above. Above=392 (≥ 100), so the condition fails → opens up.
    expect(out.opensDown).toBe(false);
    expect(out.top).toBe(296); // 400 - 4 - 100
  });

  test("direction=up falls back to below when above is tight and below has more room", () => {
    // Anchor near top: space above=10, space below=560. direction=up's
    // predicate: useDown iff above < height (10 < 100) AND below >
    // above (560 > 10) → true → opens down.
    const out = computeCompletionPosition({
      anchorCoords: { left: 100, top: 18, bottom: 38 },
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "up",
    });
    expect(out.opensDown).toBe(true);
    expect(out.top).toBe(42); // 38 + 4
  });

  test("horizontal clamp at the left edge: anchor.left < margin", () => {
    const out = computeCompletionPosition({
      anchorCoords: { left: 2, top: 100, bottom: 120 },
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "down",
    });
    // POPUP_VIEWPORT_MARGIN = 8.
    expect(out.left).toBe(8);
  });

  test("horizontal clamp at the right edge: anchor.left + popupWidth would overflow", () => {
    // anchor.left=700, popupWidth=200, viewportWidth=800, margin=8.
    // Natural left=700; max=800-200-8=592. Clamped to 592.
    const out = computeCompletionPosition({
      anchorCoords: { left: 700, top: 100, bottom: 120 },
      popupWidth: POPUP_W,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "down",
    });
    expect(out.left).toBe(592);
  });

  test("degenerate case: popup wider than viewport falls back to left margin", () => {
    // popup=900, viewport=800, margin=8. min=8, max would be -108
    // — Math.max(8, -108)=8 — so left is clamped to the margin.
    const out = computeCompletionPosition({
      anchorCoords: { left: 100, top: 100, bottom: 120 },
      popupWidth: 900,
      popupHeight: POPUP_H,
      viewportWidth: VIEWPORT_W,
      viewportHeight: VIEWPORT_H,
      direction: "down",
    });
    expect(out.left).toBe(8);
  });
});
