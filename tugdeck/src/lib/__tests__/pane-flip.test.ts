import { describe, expect, test } from "bun:test";

import {
  SPRING_KEYFRAME_SAMPLES,
  flipDelta,
  springKeyframes,
} from "@/lib/pane-flip";
import { dampedSpring } from "@/lib/unit-functions";

/** A rect standing in for a measured frame; only the origin is ever read. */
function rect(left: number, top: number, width = 400, height = 600): DOMRectReadOnly {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRectReadOnly;
}

/** The px pair inside a `translate(…)` keyframe value. */
function translation(frame: Keyframe): { x: number; y: number } {
  const match = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(
    String(frame.transform),
  );
  if (!match) throw new Error(`not a 2D translate: ${String(frame.transform)}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("flipDelta", () => {
  test("is the distance from the new position back to the old one", () => {
    expect(flipDelta(rect(100, 50), rect(400, 210))).toEqual({
      dx: -300,
      dy: -160,
    });
  });

  test("is zero when a frame did not move", () => {
    expect(flipDelta(rect(240, 96), rect(240, 96))).toEqual({ dx: 0, dy: 0 });
  });

  test("ignores size — an arrangement change translates, it does not resize", () => {
    const before = rect(0, 0, 400, 600);
    const after = rect(0, 0, 900, 200);
    expect(flipDelta(before, after)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("springKeyframes", () => {
  const FRAMES = springKeyframes(-300, -160);

  test("starts at the full inverse delta and ends at no transform", () => {
    expect(translation(FRAMES[0])).toEqual({ x: -300, y: -160 });
    expect(FRAMES[FRAMES.length - 1].transform).toBe("translate(0px, 0px)");
  });

  test("cuts the curve into the sampled number of intervals", () => {
    expect(FRAMES).toHaveLength(SPRING_KEYFRAME_SAMPLES + 1);
  });

  test("offsets rise strictly from 0 to 1", () => {
    expect(FRAMES[0].offset).toBe(0);
    expect(FRAMES[FRAMES.length - 1].offset).toBe(1);
    for (let i = 1; i < FRAMES.length; i += 1) {
      expect(FRAMES[i].offset as number).toBeGreaterThan(
        FRAMES[i - 1].offset as number,
      );
      expect(FRAMES[i].offset as number).toBeLessThanOrEqual(1);
    }
  });

  test("every keyframe carries only a 2D transform and its offset", () => {
    for (const frame of FRAMES) {
      expect(Object.keys(frame).sort()).toEqual(["offset", "transform"]);
      const value = String(frame.transform);
      expect(value).toMatch(/^translate\(-?[\d.]+px, -?[\d.]+px\)$/);
      expect(value).not.toMatch(/3d|translateZ|perspective|rotate|scale|matrix/i);
    }
  });

  test("traces the damped spring the deck settles on", () => {
    const spring = dampedSpring();
    for (let i = 1; i < SPRING_KEYFRAME_SAMPLES; i += 1) {
      const remaining = 1 - spring(i / SPRING_KEYFRAME_SAMPLES);
      const { x, y } = translation(FRAMES[i]);
      expect(x).toBeCloseTo(-300 * remaining, 2);
      expect(y).toBeCloseTo(-160 * remaining, 2);
    }
  });

  test("moves monotonically home — the spring never overshoots", () => {
    let previous = Infinity;
    for (const frame of FRAMES) {
      const { x } = translation(frame);
      expect(Math.abs(x)).toBeLessThanOrEqual(previous);
      previous = Math.abs(x);
    }
  });

  test("honors an explicit sample count, floored at two intervals", () => {
    expect(springKeyframes(10, 0, 4)).toHaveLength(5);
    expect(springKeyframes(10, 0, 1)).toHaveLength(3);
  });
});
