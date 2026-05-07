/**
 * pane-scrim-registry tests.
 *
 * Pins the invariants the registry exists to enforce:
 *
 *   1. `increment` sets `data-scrim="on"` on the chrome only when the
 *      count crosses 0 → 1; subsequent increments are silent.
 *   2. `decrement` removes `data-scrim` only when the count drops to 0.
 *   3. Per-element isolation: incrementing on chrome A does not toggle
 *      chrome B's attribute. Each pane's scrim is independent.
 *   4. Idempotence: `increment(null)`, `decrement(null)`, and
 *      `decrement` on an unknown / zero-count element are no-ops and
 *      do not throw.
 *   5. Test-only `_getCountForTests` mirrors the internal count so
 *      assertions can verify ref-count math directly.
 *
 * No bun:test mocks here — the registry's only outputs are the
 * attribute on the chrome and the (test-only) count getter, both
 * directly observable.
 */
import "../../__tests__/setup-rtl";

import { describe, expect, test } from "bun:test";

import * as paneScrimRegistry from "@/lib/pane-scrim-registry";

function makeChrome(): HTMLElement {
  const el = document.createElement("div");
  el.className = "tug-pane-chrome";
  return el;
}

describe("pane-scrim-registry", () => {
  describe("increment", () => {
    test("first increment sets data-scrim=\"on\"", () => {
      const chrome = makeChrome();
      paneScrimRegistry.increment(chrome);
      expect(chrome.getAttribute("data-scrim")).toBe("on");
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(1);
    });

    test("subsequent increments raise the count without re-setting the attribute", () => {
      const chrome = makeChrome();
      paneScrimRegistry.increment(chrome);
      paneScrimRegistry.increment(chrome);
      paneScrimRegistry.increment(chrome);
      // Attribute is still "on" but the count tracks all consumers.
      expect(chrome.getAttribute("data-scrim")).toBe("on");
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(3);
    });

    test("null target is a no-op", () => {
      // No throw, no DOM mutation. The hook's standalone fallback
      // depends on this so consumers can call show()/hide() without
      // gating themselves.
      expect(() => paneScrimRegistry.increment(null)).not.toThrow();
    });
  });

  describe("decrement", () => {
    test("decrement to zero removes the attribute", () => {
      const chrome = makeChrome();
      paneScrimRegistry.increment(chrome);
      paneScrimRegistry.decrement(chrome);
      expect(chrome.hasAttribute("data-scrim")).toBe(false);
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(0);
    });

    test("decrement above zero leaves the attribute on", () => {
      const chrome = makeChrome();
      paneScrimRegistry.increment(chrome);
      paneScrimRegistry.increment(chrome);
      paneScrimRegistry.decrement(chrome);
      // Two consumers showed; one hid; the other consumer is still up,
      // so the scrim must remain visible.
      expect(chrome.getAttribute("data-scrim")).toBe("on");
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(1);
    });

    test("decrement on unknown element is a no-op", () => {
      // Stale cleanup (e.g. an unmount effect that races a fresh
      // registration during HMR) MUST NOT toggle the attribute or
      // throw. The registry treats unknown elements as zero-count.
      const chrome = makeChrome();
      chrome.setAttribute("data-scrim", "on");
      paneScrimRegistry.decrement(chrome);
      // No recorded count → no change.
      expect(chrome.getAttribute("data-scrim")).toBe("on");
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(0);
    });

    test("decrement at zero is a no-op", () => {
      const chrome = makeChrome();
      paneScrimRegistry.increment(chrome);
      paneScrimRegistry.decrement(chrome);
      // Already at zero. Another decrement should not turn the count
      // negative or re-mutate the (already cleared) attribute.
      paneScrimRegistry.decrement(chrome);
      expect(chrome.hasAttribute("data-scrim")).toBe(false);
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(0);
    });

    test("null target is a no-op", () => {
      expect(() => paneScrimRegistry.decrement(null)).not.toThrow();
    });
  });

  describe("per-chrome isolation", () => {
    test("incrementing chrome A leaves chrome B untouched", () => {
      const a = makeChrome();
      const b = makeChrome();
      paneScrimRegistry.increment(a);
      expect(a.getAttribute("data-scrim")).toBe("on");
      expect(b.hasAttribute("data-scrim")).toBe(false);
      expect(paneScrimRegistry._getCountForTests(a)).toBe(1);
      expect(paneScrimRegistry._getCountForTests(b)).toBe(0);
    });

    test("decrementing chrome A does not clear chrome B's attribute", () => {
      const a = makeChrome();
      const b = makeChrome();
      paneScrimRegistry.increment(a);
      paneScrimRegistry.increment(b);
      paneScrimRegistry.decrement(a);
      expect(a.hasAttribute("data-scrim")).toBe(false);
      expect(b.getAttribute("data-scrim")).toBe("on");
    });
  });

  describe("balanced pair invariant", () => {
    test("interleaved show/hide across two consumers nets to zero", () => {
      const chrome = makeChrome();
      // Consumer 1 shows.
      paneScrimRegistry.increment(chrome);
      // Consumer 2 shows.
      paneScrimRegistry.increment(chrome);
      // Consumer 1 hides.
      paneScrimRegistry.decrement(chrome);
      // Still on — consumer 2 is up.
      expect(chrome.getAttribute("data-scrim")).toBe("on");
      // Consumer 2 hides.
      paneScrimRegistry.decrement(chrome);
      expect(chrome.hasAttribute("data-scrim")).toBe(false);
      expect(paneScrimRegistry._getCountForTests(chrome)).toBe(0);
    });
  });
});
