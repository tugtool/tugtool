/**
 * Tests for tug-validate — numeric validation utilities.
 *
 * Covers:
 * - clamp — basic clamping, no-op, boundaries, negatives, NaN
 * - snapToStep — integer steps, fractional steps, rounding direction, base offset, FP epsilon
 * - coerceNumber — valid/invalid inputs, edge cases
 * - validateNumericInput — full pipeline composition
 */
import { describe, it, expect } from "bun:test";
import { clamp, snapToStep, coerceNumber, validateNumericInput } from "../lib/tug-validate";

// ---------------------------------------------------------------------------
// 1. clamp
// ---------------------------------------------------------------------------

describe("clamp", () => {
  it("clamps value above max to max", () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("clamps value below min to min", () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });

  it("returns value unchanged when already in range", () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it("returns min when value equals min (boundary)", () => {
    expect(clamp(0, 0, 100)).toBe(0);
  });

  it("returns max when value equals max (boundary)", () => {
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it("handles negative ranges", () => {
    expect(clamp(-50, -100, -10)).toBe(-50);
    expect(clamp(-5, -100, -10)).toBe(-10);
    expect(clamp(-150, -100, -10)).toBe(-100);
  });

  it("returns min for NaN value", () => {
    expect(clamp(NaN, 0, 100)).toBe(0);
  });

  it("handles min equal to max", () => {
    expect(clamp(42, 5, 5)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. snapToStep
// ---------------------------------------------------------------------------

describe("snapToStep", () => {
  it("snaps to nearest step of 5 (round down)", () => {
    expect(snapToStep(7, 5)).toBe(5);
  });

  it("snaps to nearest step of 5 (round up)", () => {
    expect(snapToStep(8, 5)).toBe(10);
  });

  it("snaps to step of 10", () => {
    expect(snapToStep(37, 10)).toBe(40);
    expect(snapToStep(33, 10)).toBe(30);
  });

  it("snaps to step of 25", () => {
    expect(snapToStep(60, 25)).toBe(50);
    expect(snapToStep(65, 25)).toBe(75);
  });

  it("snaps to fractional step of 0.1", () => {
    expect(snapToStep(0.37, 0.1)).toBe(0.4);
    expect(snapToStep(0.32, 0.1)).toBe(0.3);
  });

  it("snaps to fractional step of 0.25", () => {
    // 0.6 is closer to 0.5 (distance 0.1) than to 0.75 (distance 0.15)
    expect(snapToStep(0.6, 0.25)).toBe(0.5);
    // 0.4 is closer to 0.5 (distance 0.1) than to 0.25 (distance 0.15)
    expect(snapToStep(0.4, 0.25)).toBe(0.5);
    // 0.3 is closer to 0.25 (distance 0.05) than to 0.5 (distance 0.2)
    expect(snapToStep(0.3, 0.25)).toBe(0.25);
    // 0.7 is closer to 0.75 (distance 0.05) than to 0.5 (distance 0.2)
    expect(snapToStep(0.7, 0.25)).toBe(0.75);
  });

  it("already on a step boundary returns unchanged", () => {
    expect(snapToStep(10, 5)).toBe(10);
    expect(snapToStep(0.5, 0.25)).toBe(0.5);
  });

  it("respects min (base) offset for integer steps", () => {
    expect(snapToStep(13, 5, 1)).toBe(11);
    expect(snapToStep(14, 5, 1)).toBe(16);
  });

  it("handles min = 0 explicitly (same as default)", () => {
    expect(snapToStep(7, 5, 0)).toBe(5);
    expect(snapToStep(8, 5, 0)).toBe(10);
  });

  it("floating-point epsilon: snapToStep(0.1 + 0.2, 0.1) === 0.3", () => {
    expect(snapToStep(0.1 + 0.2, 0.1)).toBe(0.3);
  });

  it("floating-point epsilon: snapToStep(1.005, 0.01) === 1.01", () => {
    expect(snapToStep(1.005, 0.01)).toBe(1.01);
  });

  it("step of 1 returns nearest integer", () => {
    expect(snapToStep(3.7, 1)).toBe(4);
    expect(snapToStep(3.2, 1)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. coerceNumber
// ---------------------------------------------------------------------------

describe("coerceNumber", () => {
  it("parses valid integer", () => {
    expect(coerceNumber("42")).toBe(42);
  });

  it("parses valid negative integer", () => {
    expect(coerceNumber("-42")).toBe(-42);
  });

  it("parses valid float", () => {
    expect(coerceNumber("3.14")).toBe(3.14);
  });

  it("parses negative float", () => {
    expect(coerceNumber("-1.5")).toBe(-1.5);
  });

  it("parses zero", () => {
    expect(coerceNumber("0")).toBe(0);
  });

  it("parses zero as float", () => {
    expect(coerceNumber("0.0")).toBe(0);
  });

  it("returns null for empty string", () => {
    expect(coerceNumber("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(coerceNumber("   ")).toBeNull();
    expect(coerceNumber("\t")).toBeNull();
  });

  it("returns null for alphabetic input", () => {
    expect(coerceNumber("abc")).toBeNull();
  });

  it("returns null for trailing garbage — '42abc'", () => {
    expect(coerceNumber("42abc")).toBeNull();
  });

  it("returns null for leading garbage — 'abc42'", () => {
    expect(coerceNumber("abc42")).toBeNull();
  });

  it("returns null for string 'NaN'", () => {
    expect(coerceNumber("NaN")).toBeNull();
  });

  it("parses 'Infinity' as Infinity", () => {
    expect(coerceNumber("Infinity")).toBe(Infinity);
  });

  it("parses '-Infinity' as -Infinity", () => {
    expect(coerceNumber("-Infinity")).toBe(-Infinity);
  });

  it("trims leading and trailing whitespace before parsing", () => {
    expect(coerceNumber("  42  ")).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 4. validateNumericInput
// ---------------------------------------------------------------------------

describe("validateNumericInput", () => {
  it("returns parsed value when in range and no step", () => {
    expect(validateNumericInput("50", { min: 0, max: 100 })).toBe(50);
  });

  it("clamps value above max", () => {
    expect(validateNumericInput("150", { min: 0, max: 100 })).toBe(100);
  });

  it("clamps value below min", () => {
    expect(validateNumericInput("-10", { min: 0, max: 100 })).toBe(0);
  });

  it("snaps to step after clamping", () => {
    expect(validateNumericInput("37", { min: 0, max: 100, step: 10 })).toBe(40);
  });

  it("clamps then snaps: out-of-range with step", () => {
    expect(validateNumericInput("150", { min: 0, max: 100, step: 5 })).toBe(100);
  });

  it("returns null for empty string", () => {
    expect(validateNumericInput("", { min: 0, max: 100 })).toBeNull();
  });

  it("returns null for whitespace", () => {
    expect(validateNumericInput("   ", { min: 0, max: 100 })).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(validateNumericInput("abc", { min: 0, max: 100 })).toBeNull();
  });

  it("returns null for trailing garbage", () => {
    expect(validateNumericInput("42abc", { min: 0, max: 100 })).toBeNull();
  });

  it("handles min boundary", () => {
    expect(validateNumericInput("0", { min: 0, max: 100 })).toBe(0);
  });

  it("handles max boundary", () => {
    expect(validateNumericInput("100", { min: 0, max: 100 })).toBe(100);
  });

  it("snaps fractional step", () => {
    expect(validateNumericInput("0.37", { min: 0, max: 1, step: 0.1 })).toBeCloseTo(0.4, 10);
  });

  it("skips snapping when step is omitted", () => {
    expect(validateNumericInput("37", { min: 0, max: 100 })).toBe(37);
  });

  it("handles negative range", () => {
    expect(validateNumericInput("-50", { min: -100, max: -10 })).toBe(-50);
  });

  it("clamps to negative min", () => {
    expect(validateNumericInput("-150", { min: -100, max: -10 })).toBe(-100);
  });

  it("handles floating-point epsilon in pipeline", () => {
    const input = String(0.1 + 0.2);
    expect(validateNumericInput(input, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  });
});
