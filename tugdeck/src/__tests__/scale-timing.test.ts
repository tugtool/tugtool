/**
 * Unit tests for scale-timing.ts JS helpers.
 *
 * Tests getTugScale, getTugTiming, and isTugMotionEnabled by setting inline
 * CSS custom properties on document.documentElement and verifying the helpers
 * read them correctly.
 *
 * initMotionObserver is not unit-tested here because it depends on
 * window.matchMedia, which is not implemented in happy-dom. Its behavior is
 * verified visually via the gallery Scale & Timing tab.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach } from "bun:test";
import { getTugScale, getTugTiming, isTugMotionEnabled } from "@/components/tugways/scale-timing";

// ---------------------------------------------------------------------------
// getTugScale
// ---------------------------------------------------------------------------

describe("getTugScale", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--tug-scale");
  });

  it("returns 1 when --tug-scale is not set", () => {
    expect(getTugScale()).toBe(1);
  });

  it("returns 1 when --tug-scale is set to 1", () => {
    document.documentElement.style.setProperty("--tug-scale", " 1");
    expect(getTugScale()).toBe(1);
  });

  it("returns 1.25 when --tug-scale is set to 1.25", () => {
    document.documentElement.style.setProperty("--tug-scale", " 1.25");
    expect(getTugScale()).toBe(1.25);
  });

  it("returns 2 when --tug-scale is set to 2", () => {
    document.documentElement.style.setProperty("--tug-scale", " 2");
    expect(getTugScale()).toBe(2);
  });

  it("returns 1 when --tug-scale is set to an invalid value", () => {
    document.documentElement.style.setProperty("--tug-scale", " not-a-number");
    expect(getTugScale()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTugTiming
// ---------------------------------------------------------------------------

describe("getTugTiming", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--tug-timing");
  });

  it("returns 1 when --tug-timing is not set", () => {
    expect(getTugTiming()).toBe(1);
  });

  it("returns 5 when --tug-timing is set to 5", () => {
    document.documentElement.style.setProperty("--tug-timing", " 5");
    expect(getTugTiming()).toBe(5);
  });

  it("returns 0.1 when --tug-timing is set to 0.1", () => {
    document.documentElement.style.setProperty("--tug-timing", " 0.1");
    expect(getTugTiming()).toBeCloseTo(0.1);
  });

  it("returns 1 when --tug-timing is set to an invalid value", () => {
    document.documentElement.style.setProperty("--tug-timing", " bad");
    expect(getTugTiming()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isTugMotionEnabled
// ---------------------------------------------------------------------------

describe("isTugMotionEnabled", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--tug-motion");
  });

  it("returns true when --tug-motion is not set", () => {
    expect(isTugMotionEnabled()).toBe(true);
  });

  it("returns true when --tug-motion is 1", () => {
    document.documentElement.style.setProperty("--tug-motion", " 1");
    expect(isTugMotionEnabled()).toBe(true);
  });

  it("returns false when --tug-motion is 0", () => {
    document.documentElement.style.setProperty("--tug-motion", " 0");
    expect(isTugMotionEnabled()).toBe(false);
  });

  it("returns true when --tug-motion is an invalid value (defaults to enabled)", () => {
    document.documentElement.style.setProperty("--tug-motion", " bad");
    expect(isTugMotionEnabled()).toBe(true);
  });
});
