/**
 * Pure-logic tests for `FieldRow`'s formatter helper. The component
 * itself is a thin presentational shell; the formatter is the
 * interesting part — number / boolean / null / undefined / object
 * shapes all need to render unambiguously.
 *
 * Per project rule [feedback_no_happy_dom_tests], no fake-DOM render
 * tests. The component's appearance is exercised by the live app.
 */

import { describe, it, expect } from "bun:test";

import { formatFieldValue } from "@/components/tug-dev-panel/field-row";

describe("FieldRow — formatFieldValue", () => {
  it("renders null and undefined as literal strings", () => {
    expect(formatFieldValue(null)).toBe("null");
    expect(formatFieldValue(undefined)).toBe("undefined");
  });

  it("renders integers and floats with full precision", () => {
    expect(formatFieldValue(0)).toBe("0");
    expect(formatFieldValue(42)).toBe("42");
    expect(formatFieldValue(-3)).toBe("-3");
    expect(formatFieldValue(0.045)).toBe("0.045");
  });

  it("renders NaN and infinity legibly", () => {
    expect(formatFieldValue(Number.NaN)).toBe("NaN");
    expect(formatFieldValue(Number.POSITIVE_INFINITY)).toBe("+∞");
    expect(formatFieldValue(Number.NEGATIVE_INFINITY)).toBe("−∞");
  });

  it("renders booleans as 'true' / 'false'", () => {
    expect(formatFieldValue(true)).toBe("true");
    expect(formatFieldValue(false)).toBe("false");
  });

  it("renders strings as-is", () => {
    expect(formatFieldValue("idle")).toBe("idle");
    expect(formatFieldValue("")).toBe("");
  });

  it("renders objects + arrays via JSON.stringify", () => {
    expect(formatFieldValue({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(formatFieldValue([1, 2, 3])).toBe("[1,2,3]");
  });
});
