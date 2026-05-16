/**
 * Pure-logic tests for the `TugArcGauge` geometry helpers. Covers the
 * `arcPath` function — the SVG-`d`-attribute builder — across the
 * documented edge cases:
 *
 *   - `fillRatio === 0` or `sweepAngleDeg === 0` → empty string.
 *   - Effective sweep ≥ 360° → full-circle path (two semicircles).
 *   - Effective sweep > 180° → `large-arc-flag` = 1.
 *   - Effective sweep ≤ 180° → `large-arc-flag` = 0.
 *   - Negative `sweepAngleDeg` → throws.
 *   - Default "C" geometry (135° / 270°) lands start at bottom-left
 *     and end at bottom-right.
 *
 * Shared domain / role math (`computeFillRatio`, `effectiveFillRole`)
 * is already covered by the linear-gauge tests + the shared
 * `gauge-math.ts` module — those tests apply transitively here.
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_ARC_GEOMETRY,
  arcPath,
} from "@/components/tugways/tug-arc-gauge";

const CX = 50;
const CY = 50;
const R = 40;

describe("TugArcGauge — arcPath empty paths", () => {
  it("returns empty string when fillRatio is 0", () => {
    expect(arcPath(CX, CY, R, 0, 270, 0)).toBe("");
  });

  it("returns empty string when sweepAngleDeg is 0", () => {
    expect(arcPath(CX, CY, R, 0, 0, 1)).toBe("");
    expect(arcPath(CX, CY, R, 90, 0, 0.5)).toBe("");
  });
});

describe("TugArcGauge — arcPath full circle", () => {
  it("returns a two-arc full-circle path when sweep is 360 and fillRatio is 1", () => {
    const d = arcPath(CX, CY, R, 0, 360, 1);
    // Two A commands separated by a single M; full circle requires
    // splitting into two semicircles.
    expect(d.startsWith("M")).toBe(true);
    expect(d.split("A").length - 1).toBe(2);
  });

  it("returns a two-arc path when sweep is 270 and fillRatio is 1.5 (over-saturated)", () => {
    // The component clamps fillRatio upstream via `computeFillRatio`,
    // but `arcPath` is robust to ratios > 1 too — effective sweep
    // (270 * 1.5 = 405) crosses 360 and falls into the full-circle
    // branch.
    const d = arcPath(CX, CY, R, 0, 270, 1.5);
    expect(d.split("A").length - 1).toBe(2);
  });
});

describe("TugArcGauge — arcPath large-arc flag", () => {
  // SVG `A rx,ry x-rot large-flag sweep-flag x,y` — splitting an
  // aClause like "A40,40 0 0 1 50,10" on whitespace yields:
  //   parts[0] = "A40,40"   (command + radii)
  //   parts[1] = "0"        (x-axis-rotation)
  //   parts[2] = large-arc-flag (what we're asserting on)
  //   parts[3] = "1"        (sweep-flag — always 1 for clockwise)
  //   parts[4] = "x,y"      (end point)
  const LARGE_FLAG_INDEX = 2;

  it("uses large-arc-flag=0 when effective sweep is ≤ 180°", () => {
    // 270° sweep × 0.5 fill = 135° effective → small arc.
    const d = arcPath(CX, CY, R, 135, 270, 0.5);
    const parts = d.slice(d.indexOf("A")).split(/\s+/);
    expect(parts[LARGE_FLAG_INDEX]).toBe("0");
  });

  it("uses large-arc-flag=1 when effective sweep is > 180°", () => {
    // 270° sweep × 0.75 fill = 202.5° effective → large arc.
    const d = arcPath(CX, CY, R, 135, 270, 0.75);
    const parts = d.slice(d.indexOf("A")).split(/\s+/);
    expect(parts[LARGE_FLAG_INDEX]).toBe("1");
  });

  it("flips large-arc-flag exactly at the 180° boundary", () => {
    // Effective sweep = 180° exactly → still small-arc (the predicate
    // is `> 180`, strict). `360 * 0.5 = 180 ≥ 360` is false, so this
    // enters the normal arc-path branch.
    const dAt180 = arcPath(CX, CY, R, 0, 360, 0.5);
    const at180Parts = dAt180.slice(dAt180.indexOf("A")).split(/\s+/);
    expect(at180Parts[LARGE_FLAG_INDEX]).toBe("0");

    // Just over 180 → large.
    const dOver = arcPath(CX, CY, R, 0, 360, 0.501);
    const overParts = dOver.slice(dOver.indexOf("A")).split(/\s+/);
    expect(overParts[LARGE_FLAG_INDEX]).toBe("1");
  });
});

describe("TugArcGauge — arcPath start / end coordinates", () => {
  it("places the start at the correct cartesian point for the given start angle", () => {
    // 0° in SVG convention points right (+x). For radius R at center
    // (CX, CY), start point is (CX + R, CY).
    const d = arcPath(CX, CY, R, 0, 90, 0.5);
    expect(d).toContain(`M${CX + R},${CY}`);
  });

  it("places the start at the bottom-left for the default 'C' geometry (135°)", () => {
    // cos(135°) = -√2/2 ≈ -0.7071; sin(135°) = √2/2 ≈ 0.7071. So the
    // start point is (CX - R*0.7071, CY + R*0.7071) — bottom-left.
    const d = arcPath(
      CX,
      CY,
      R,
      DEFAULT_ARC_GEOMETRY.startAngleDeg,
      DEFAULT_ARC_GEOMETRY.sweepAngleDeg,
      0.5,
    );
    // Pull the M-clause off the front: "M{x},{y} A..."
    const mMatch = d.match(/^M([-\d.]+),([-\d.]+)/);
    expect(mMatch).not.toBeNull();
    const startX = Number(mMatch?.[1]);
    const startY = Number(mMatch?.[2]);
    expect(startX).toBeCloseTo(CX + R * Math.cos((135 * Math.PI) / 180), 3);
    expect(startY).toBeCloseTo(CY + R * Math.sin((135 * Math.PI) / 180), 3);
    // Sanity check: bottom-left means x < CX and y > CY.
    expect(startX).toBeLessThan(CX);
    expect(startY).toBeGreaterThan(CY);
  });

  it("places the end at the angle = start + sweep * fillRatio", () => {
    // Start 0°, sweep 180°, fill 1.0 → end at 180°, which is (CX - R, CY).
    const d = arcPath(CX, CY, R, 0, 180, 1);
    // End coords follow the A clause; format is `A r,r 0 flag 1 x,y`.
    const endMatch = d.match(/1\s+([-\d.]+),([-\d.]+)$/);
    expect(endMatch).not.toBeNull();
    expect(Number(endMatch?.[1])).toBeCloseTo(CX - R, 3);
    expect(Number(endMatch?.[2])).toBeCloseTo(CY, 3);
  });
});

describe("TugArcGauge — arcPath validation", () => {
  it("throws on negative sweepAngleDeg", () => {
    expect(() => arcPath(CX, CY, R, 0, -90, 0.5)).toThrow(
      /sweepAngleDeg .* must be >= 0/,
    );
  });

  it("accepts sweepAngleDeg of 0 without throwing (empty path)", () => {
    expect(() => arcPath(CX, CY, R, 0, 0, 0.5)).not.toThrow();
  });

  it("accepts negative angles for startAngleDeg without throwing", () => {
    // Start angle is just a position, not a magnitude — negative is fine.
    expect(() => arcPath(CX, CY, R, -45, 90, 0.5)).not.toThrow();
  });
});

describe("TugArcGauge — DEFAULT_ARC_GEOMETRY", () => {
  it("describes the 'C' sweep — start 135°, sweep 270°", () => {
    expect(DEFAULT_ARC_GEOMETRY.startAngleDeg).toBe(135);
    expect(DEFAULT_ARC_GEOMETRY.sweepAngleDeg).toBe(270);
  });

  it("leaves the bottom 90° open (from 45° to 135° in SVG terms)", () => {
    // The arc spans 135° → 135° + 270° = 405° (= 45°). The "gap"
    // covers 45° → 135° = 90°, centered on the bottom of the circle
    // (90° in SVG convention).
    const start = DEFAULT_ARC_GEOMETRY.startAngleDeg;
    const end = (start + DEFAULT_ARC_GEOMETRY.sweepAngleDeg) % 360;
    expect(end).toBe(45);
    expect(start).toBe(135);
    // Gap center = midpoint between end (45°) and start (135°) = 90° (bottom).
    expect((end + start) / 2).toBe(90);
  });
});
