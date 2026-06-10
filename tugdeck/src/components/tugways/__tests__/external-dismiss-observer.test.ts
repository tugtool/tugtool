/**
 * isOutsideOverlay — pure-logic tests for the external-dismiss containment
 * predicate. The pointerdown-listener half (`useExternalPointerdownObserver`) is
 * a DOM observer exercised by the focus app-tests; only the pure containment
 * function is unit-tested here (no DOM).
 */

import { describe, expect, test } from "bun:test";

import { isOutsideOverlay } from "../internal/external-dismiss-observer";

describe("isOutsideOverlay", () => {
  // A fake overlay root that "contains" exactly the node we declare inside.
  const inside = {} as unknown as Node;
  const outside = {} as unknown as Node;
  const overlayRoot = { contains: (n: Node | null) => n === inside };

  test("a pointerdown inside the overlay is not external", () => {
    expect(isOutsideOverlay(inside, overlayRoot)).toBe(false);
  });

  test("a pointerdown outside the overlay is external", () => {
    expect(isOutsideOverlay(outside, overlayRoot)).toBe(true);
  });

  test("a null target counts as external", () => {
    expect(isOutsideOverlay(null, overlayRoot)).toBe(true);
  });
});
