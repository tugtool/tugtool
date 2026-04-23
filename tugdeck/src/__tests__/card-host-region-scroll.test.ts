/**
 * `captureRegionScrolls` / `applyRegionScrolls` tests — Step 9.
 *
 * Pins the contract of the nested-region scroll persistence helpers in
 * `card-host.tsx`:
 *
 *   - `captureRegionScrolls` walks `data-tug-scroll-key` descendants of
 *     the card root and keys their `scrollLeft` / `scrollTop` by the
 *     attribute value; returns `undefined` when there are no matches.
 *   - `applyRegionScrolls` writes the snapshot back to matching
 *     elements; extra keys without matching elements are skipped.
 *   - Round-trip preserves multiple independent regions.
 *   - Scope is the passed root, not the whole document — sibling
 *     cards in a tab-group pane cannot cross-pollinate.
 */

import "./setup-rtl";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import {
  applyRegionScrolls,
  captureRegionScrolls,
} from "@/components/chrome/card-host";
import type { RegionScrollSnapshot } from "@/layout-tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardRoot(id: string = "card-test"): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-host", "");
  el.setAttribute("data-card-id", id);
  document.body.appendChild(el);
  return el;
}

function makeScrollRegion(key: string, x: number, y: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-tug-scroll-key", key);
  // happy-dom accepts direct property assignment for scrollLeft/Top.
  Object.defineProperty(el, "scrollLeft", { value: x, writable: true, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: y, writable: true, configurable: true });
  return el;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// captureRegionScrolls
// ---------------------------------------------------------------------------

describe("captureRegionScrolls – walks the card subtree", () => {
  it("returns undefined when no keyed regions exist", () => {
    const cardRoot = makeCardRoot();
    cardRoot.appendChild(document.createElement("div"));
    expect(captureRegionScrolls(cardRoot)).toBeUndefined();
  });

  it("captures a single keyed region", () => {
    const cardRoot = makeCardRoot();
    cardRoot.appendChild(makeScrollRegion("markdown-view", 0, 42));

    expect(captureRegionScrolls(cardRoot)).toEqual({
      "markdown-view": { x: 0, y: 42 },
    });
  });

  it("captures multiple keyed regions independently", () => {
    const cardRoot = makeCardRoot();
    cardRoot.appendChild(makeScrollRegion("primary", 10, 100));
    cardRoot.appendChild(makeScrollRegion("secondary", 5, 200));

    expect(captureRegionScrolls(cardRoot)).toEqual({
      primary: { x: 10, y: 100 },
      secondary: { x: 5, y: 200 },
    });
  });

  it("ignores regions with an empty key attribute", () => {
    const cardRoot = makeCardRoot();
    const empty = document.createElement("div");
    empty.setAttribute("data-tug-scroll-key", "");
    Object.defineProperty(empty, "scrollTop", { value: 50, writable: true, configurable: true });
    cardRoot.appendChild(empty);
    cardRoot.appendChild(makeScrollRegion("valid", 0, 33));

    expect(captureRegionScrolls(cardRoot)).toEqual({
      valid: { x: 0, y: 33 },
    });
  });

  it("is scoped to the passed root — sibling card-root regions are ignored", () => {
    const cardA = makeCardRoot("card-A");
    const cardB = makeCardRoot("card-B");
    cardA.appendChild(makeScrollRegion("shared-key", 1, 10));
    cardB.appendChild(makeScrollRegion("shared-key", 99, 999));

    // Walking cardA must only see cardA's region.
    expect(captureRegionScrolls(cardA)).toEqual({
      "shared-key": { x: 1, y: 10 },
    });
    expect(captureRegionScrolls(cardB)).toEqual({
      "shared-key": { x: 99, y: 999 },
    });
  });
});

// ---------------------------------------------------------------------------
// applyRegionScrolls
// ---------------------------------------------------------------------------

describe("applyRegionScrolls – writes keyed regions", () => {
  it("writes scrollLeft/Top onto matching keyed elements", () => {
    const cardRoot = makeCardRoot();
    const el = document.createElement("div");
    el.setAttribute("data-tug-scroll-key", "markdown-view");
    cardRoot.appendChild(el);

    applyRegionScrolls(cardRoot, { "markdown-view": { x: 7, y: 21 } });

    expect(el.scrollLeft).toBe(7);
    expect(el.scrollTop).toBe(21);
  });

  it("skips keys that have no matching element", () => {
    const cardRoot = makeCardRoot();
    const el = document.createElement("div");
    el.setAttribute("data-tug-scroll-key", "primary");
    cardRoot.appendChild(el);

    expect(() =>
      applyRegionScrolls(cardRoot, {
        primary: { x: 1, y: 2 },
        "not-in-dom": { x: 99, y: 99 },
      }),
    ).not.toThrow();

    expect(el.scrollLeft).toBe(1);
    expect(el.scrollTop).toBe(2);
  });

  it("round-trips through capture → apply with multiple regions", () => {
    const sourceCard = makeCardRoot("card-source");
    sourceCard.appendChild(makeScrollRegion("a", 11, 22));
    sourceCard.appendChild(makeScrollRegion("b", 33, 44));

    const snapshot = captureRegionScrolls(sourceCard);
    expect(snapshot).not.toBeUndefined();
    if (!snapshot) return;

    const destCard = makeCardRoot("card-dest");
    const destA = document.createElement("div");
    destA.setAttribute("data-tug-scroll-key", "a");
    const destB = document.createElement("div");
    destB.setAttribute("data-tug-scroll-key", "b");
    destCard.appendChild(destA);
    destCard.appendChild(destB);

    applyRegionScrolls(destCard, snapshot);

    expect(destA.scrollLeft).toBe(11);
    expect(destA.scrollTop).toBe(22);
    expect(destB.scrollLeft).toBe(33);
    expect(destB.scrollTop).toBe(44);
  });

  it("applying an empty snapshot is a no-op", () => {
    const cardRoot = makeCardRoot();
    const el = document.createElement("div");
    el.setAttribute("data-tug-scroll-key", "x");
    Object.defineProperty(el, "scrollLeft", { value: 0, writable: true, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 0, writable: true, configurable: true });
    cardRoot.appendChild(el);

    const empty: RegionScrollSnapshot = {};
    expect(() => applyRegionScrolls(cardRoot, empty)).not.toThrow();
    expect(el.scrollLeft).toBe(0);
    expect(el.scrollTop).toBe(0);
  });
});
