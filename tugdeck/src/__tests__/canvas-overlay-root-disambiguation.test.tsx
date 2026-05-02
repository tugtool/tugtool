/**
 * canvas-overlay-root-disambiguation.test.tsx — disambiguation invariant.
 *
 * Per `tugplan-tide-overlay-framework.md` [D01] (#mental-model), the
 * canvas overlay root no longer carries `data-tug-focus="refuse"`.
 * The pane-focus-controller's "skip canvas-overlay click" check now
 * keys on `[data-slot="tug-canvas-overlay-root"]` directly. This test
 * pins that disambiguation: a rendered `<CanvasOverlayRoot />` (and
 * any descendant) must not match `closest('[data-tug-focus="refuse"]')`,
 * but must match `closest('[data-slot="tug-canvas-overlay-root"]')`.
 *
 * Happy-dom scope per the project's testing rule: pure component
 * markup assertion, no focus/selection/event-ordering across renders.
 */
import "./setup-rtl";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render, cleanup } from "@testing-library/react";

import { CanvasOverlayRoot } from "@/components/chrome/canvas-overlay-root";
import * as canvasOverlayRegistry from "@/lib/canvas-overlay-registry";

beforeEach(() => {
  canvasOverlayRegistry._resetForTests();
});

afterEach(() => {
  cleanup();
  canvasOverlayRegistry._resetForTests();
});

describe("CanvasOverlayRoot — focus-discipline disambiguation", () => {
  test("rendered root does not carry data-tug-focus", () => {
    const { container } = render(<CanvasOverlayRoot />);
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-canvas-overlay-root"]',
    );
    expect(root).not.toBeNull();
    expect(root?.hasAttribute("data-tug-focus")).toBe(false);
  });

  test("a descendant of the root does not match closest('[data-tug-focus=\"refuse\"]')", () => {
    const { container } = render(<CanvasOverlayRoot />);
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-canvas-overlay-root"]',
    );
    expect(root).not.toBeNull();
    if (!root) return;

    // Synthesize a descendant the way a portaled popup would land
    // inside the overlay root at runtime.
    const descendant = document.createElement("div");
    descendant.textContent = "portaled-content";
    root.appendChild(descendant);

    expect(descendant.closest('[data-tug-focus="refuse"]')).toBeNull();
    expect(descendant.closest('[data-slot="tug-canvas-overlay-root"]')).toBe(
      root,
    );
  });

  test("a descendant that itself carries data-tug-focus=refuse is unaffected", () => {
    // Sanity check: the disambiguation only removes the marker from
    // the root itself; descendants that legitimately carry the
    // attribute (e.g., a TugButton inside a portaled popup) keep
    // their button-class semantics.
    const { container } = render(<CanvasOverlayRoot />);
    const root = container.querySelector<HTMLElement>(
      '[data-slot="tug-canvas-overlay-root"]',
    );
    expect(root).not.toBeNull();
    if (!root) return;

    const button = document.createElement("button");
    button.setAttribute("data-tug-focus", "refuse");
    root.appendChild(button);

    expect(button.closest('[data-tug-focus="refuse"]')).toBe(button);
  });
});
