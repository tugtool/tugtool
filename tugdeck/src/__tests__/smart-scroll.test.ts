/**
 * Tests for SmartScroll.
 *
 * NOTE: happy-dom has limited ResizeObserver support — it fires no resize
 * callbacks in response to DOM mutations. Tests that depend on ResizeObserver
 * firing (e.g., auto-scroll on content growth) require a real browser or a
 * more complete DOM simulation. Those behaviors are verified manually.
 *
 * What is testable here:
 *   - Initial state
 *   - scrollToBottom / disengage public API
 *   - dispose safety
 *   - Wheel handler: deltaY < 0 disengages
 *   - Scroll handler: re-engagement when scrolling down near bottom
 *   - Scroll handler: disengage when scrolling up away from bottom
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { Window } from "happy-dom";
import { SmartScroll } from "../lib/smart-scroll";

// WheelEvent is not exported to globals by the happy-dom preload — set it up
// from a fresh Window instance so dispatch tests can construct WheelEvent.
beforeAll(() => {
  if (typeof (global as unknown as Record<string, unknown>)["WheelEvent"] === "undefined") {
    const w = new Window();
    (global as unknown as Record<string, unknown>)["WheelEvent"] = (w as unknown as Record<string, unknown>)["WheelEvent"];
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal scroll container mock with configurable scroll geometry.
 * happy-dom HTMLDivElement properties like scrollTop are read-only in some
 * versions, so we use a plain object cast to HTMLElement.
 */
function makeContainer(opts: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
} = {}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollTop", {
    get: () => (el as unknown as { _scrollTop: number })._scrollTop ?? 0,
    set: (v: number) => { (el as unknown as { _scrollTop: number })._scrollTop = v; },
    configurable: true,
  });
  Object.defineProperty(el, "scrollHeight", {
    get: () => (el as unknown as { _scrollHeight: number })._scrollHeight ?? 0,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => (el as unknown as { _clientHeight: number })._clientHeight ?? 0,
    configurable: true,
  });

  const raw = el as unknown as Record<string, number>;
  raw._scrollTop = opts.scrollTop ?? 0;
  raw._scrollHeight = opts.scrollHeight ?? 500;
  raw._clientHeight = opts.clientHeight ?? 300;

  return el;
}

function makeContent(): HTMLElement {
  const el = document.createElement("div");
  // getBoundingClientRect returns zeros in happy-dom; that's fine for most tests.
  return el;
}

function dispatchWheel(el: HTMLElement, deltaY: number): void {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true });
  el.dispatchEvent(event);
}

function dispatchScroll(el: HTMLElement): void {
  const event = new Event("scroll", { bubbles: false });
  el.dispatchEvent(event);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SmartScroll", () => {
  describe("initial state", () => {
    it("isAtBottom is true on construction", () => {
      const container = makeContainer();
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });
  });

  describe("disengage()", () => {
    it("sets isAtBottom to false", () => {
      const container = makeContainer();
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.disengage();
      expect(ss.isAtBottom).toBe(false);
      ss.dispose();
    });
  });

  describe("scrollToBottom()", () => {
    it("sets isAtBottom to true", () => {
      const container = makeContainer({ scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.disengage();
      expect(ss.isAtBottom).toBe(false);
      ss.scrollToBottom();
      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });

    it("writes scrollTop to scrollHeight - clientHeight", () => {
      const container = makeContainer({ scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.scrollToBottom();
      expect(container.scrollTop).toBe(200); // 500 - 300
      ss.dispose();
    });
  });

  describe("dispose()", () => {
    it("does not throw", () => {
      const container = makeContainer();
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      expect(() => ss.dispose()).not.toThrow();
    });

    it("is safe to call multiple times", () => {
      const container = makeContainer();
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.dispose();
      expect(() => ss.dispose()).not.toThrow();
    });

    it("wheel events after dispose do not change state", () => {
      const container = makeContainer({ scrollTop: 100, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.dispose();
      dispatchWheel(container, -10);
      // After dispose the handler exits early — isAtBottom stays true
      expect(ss.isAtBottom).toBe(true);
    });

    it("scroll events after dispose do not change state", () => {
      const container = makeContainer({ scrollTop: 50, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.disengage();
      ss.dispose();
      // Simulate scrolling near bottom (scrollTop = 445 → distance from bottom = 500-300-445 = -245... use a simpler case)
      const raw = container as unknown as Record<string, number>;
      raw._scrollTop = 440; // 500 - 300 - 440 = -240, near bottom
      dispatchScroll(container);
      // Handler exits early after dispose — isAtBottom stays false
      expect(ss.isAtBottom).toBe(false);
    });
  });

  describe("wheel handler — disengage on scroll-up", () => {
    it("disengages when deltaY < 0 and scrollTop > 0", () => {
      // scrollTop > 0 means we're not at the very top, user can scroll up
      const container = makeContainer({ scrollTop: 100, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      expect(ss.isAtBottom).toBe(true);
      dispatchWheel(container, -5);
      expect(ss.isAtBottom).toBe(false);
      ss.dispose();
    });

    it("does NOT disengage when deltaY < 0 but scrollTop is 0 (already at top)", () => {
      const container = makeContainer({ scrollTop: 0, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      dispatchWheel(container, -5);
      // scrollTop === 0 means there's nowhere to scroll up — no disengage
      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });

    it("does NOT disengage when deltaY > 0 (scrolling down)", () => {
      const container = makeContainer({ scrollTop: 100, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      dispatchWheel(container, 10);
      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });

    it("does NOT disengage when deltaY === 0", () => {
      const container = makeContainer({ scrollTop: 100, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      dispatchWheel(container, 0);
      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });
  });

  describe("scroll handler — re-engagement when scrolling down near bottom", () => {
    it("re-engages when scrolling down and near bottom", () => {
      // scrollHeight=500, clientHeight=300 → max scrollTop=200
      // NEAR_BOTTOM_THRESHOLD=60 → near bottom when scrollTop >= 140
      const container = makeContainer({ scrollTop: 100, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.disengage();
      expect(ss.isAtBottom).toBe(false);

      // Simulate user scrolling down: move from 100 → 160 (within threshold)
      const raw = container as unknown as Record<string, number>;
      raw._scrollTop = 100; // set last known position
      dispatchScroll(container); // update _lastScrollTop to 100

      raw._scrollTop = 160; // now near bottom (500 - 300 - 160 = 40 <= 60)
      dispatchScroll(container);

      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });

    it("does NOT re-engage when scrolling down but still far from bottom", () => {
      const container = makeContainer({ scrollTop: 0, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);
      ss.disengage();

      const raw = container as unknown as Record<string, number>;
      raw._scrollTop = 0;
      dispatchScroll(container); // set lastScrollTop = 0

      raw._scrollTop = 50; // far from bottom (500 - 300 - 50 = 150 > 60)
      dispatchScroll(container);

      expect(ss.isAtBottom).toBe(false);
      ss.dispose();
    });
  });

  describe("scroll handler — disengage on scroll-up away from bottom", () => {
    it("disengages when scrolling up by more than 5px away from bottom", () => {
      // scrollHeight=500, clientHeight=300, start near bottom
      // "near bottom" = 500-300-scrollTop <= 60 → scrollTop >= 140
      // "not near bottom" = scrollTop < 140
      const container = makeContainer({ scrollTop: 100, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);

      const raw = container as unknown as Record<string, number>;
      raw._scrollTop = 180; // near bottom
      dispatchScroll(container); // lastScrollTop = 180, re-engages

      expect(ss.isAtBottom).toBe(true);

      raw._scrollTop = 50; // not near bottom (500-300-50=150 > 60)
      dispatchScroll(container); // scrollTop(50) < lastScrollTop(180)-5 → disengage

      expect(ss.isAtBottom).toBe(false);
      ss.dispose();
    });

    it("does NOT disengage when scroll-up is <= 5px (noise)", () => {
      const container = makeContainer({ scrollTop: 0, scrollHeight: 500, clientHeight: 300 });
      const content = makeContent();
      const ss = new SmartScroll(container, content);

      const raw = container as unknown as Record<string, number>;
      raw._scrollTop = 180;
      dispatchScroll(container); // lastScrollTop = 180, re-engage

      raw._scrollTop = 177; // only 3px up — within noise threshold
      dispatchScroll(container);

      expect(ss.isAtBottom).toBe(true);
      ss.dispose();
    });
  });

  describe("ResizeObserver — NOTE: requires real browser to verify", () => {
    it("constructs without error (ResizeObserver is present in happy-dom)", () => {
      // happy-dom provides ResizeObserver but does not fire callbacks for DOM mutations.
      // Full auto-scroll-on-content-growth behavior requires a real browser.
      const container = makeContainer();
      const content = makeContent();
      expect(() => new SmartScroll(container, content)).not.toThrow();
      // Clean up
      const ss = new SmartScroll(container, content);
      ss.dispose();
    });
  });
});
