/**
 * `TugThinkingIndicator` -- unit tests for the pure label helpers
 * (`thinkingIndicatorLabelText` + `thinkingIndicatorLabelVisible`)
 * and the default-label constant.
 *
 * The component's render path (TugAnimator group chain, mid-cycle
 * toggle behavior) is exercised downstream via HMR + the gallery
 * card per the no-fake-DOM testing convention.
 */

import { describe, expect, test } from "bun:test";

import {
  TUG_THINKING_INDICATOR_DEFAULT_LABEL,
  thinkingIndicatorLabelText,
  thinkingIndicatorLabelVisible,
  thinkingIndicatorTransformOrigin,
} from "../tug-thinking-indicator";

describe("thinkingIndicatorLabelText", () => {
  test("returns the consumer override verbatim", () => {
    expect(thinkingIndicatorLabelText("Working…")).toBe("Working…");
  });

  test("returns the default when no override is supplied", () => {
    expect(thinkingIndicatorLabelText()).toBe(
      TUG_THINKING_INDICATOR_DEFAULT_LABEL,
    );
  });

  test("returns the default for explicit undefined", () => {
    expect(thinkingIndicatorLabelText(undefined)).toBe(
      TUG_THINKING_INDICATOR_DEFAULT_LABEL,
    );
  });

  test("returns an empty string verbatim if the consumer passes one", () => {
    // An empty string is a deliberate value — not equivalent to
    // omitting the prop. The component must respect it.
    expect(thinkingIndicatorLabelText("")).toBe("");
  });
});

describe("thinkingIndicatorLabelVisible", () => {
  test("returns true for labelPosition='right'", () => {
    expect(thinkingIndicatorLabelVisible("right")).toBe(true);
  });

  test("returns true for labelPosition='left'", () => {
    expect(thinkingIndicatorLabelVisible("left")).toBe(true);
  });

  test("returns false for labelPosition='hidden'", () => {
    expect(thinkingIndicatorLabelVisible("hidden")).toBe(false);
  });
});

describe("TUG_THINKING_INDICATOR_DEFAULT_LABEL", () => {
  test("is the canonical 'Thinking…' string", () => {
    // Pinned because the constant is part of the component's
    // public surface — consumers that want to compare against the
    // default rather than recompute it import this symbol.
    expect(TUG_THINKING_INDICATOR_DEFAULT_LABEL).toBe("Thinking…");
  });
});

describe("thinkingIndicatorTransformOrigin", () => {
  test("top-only shrinks from the top down → origin: center bottom", () => {
    expect(thinkingIndicatorTransformOrigin(true, false)).toBe("center bottom");
  });

  test("bottom-only shrinks from the bottom up → origin: center top", () => {
    expect(thinkingIndicatorTransformOrigin(false, true)).toBe("center top");
  });

  test("both directions shrink toward the middle → origin: center center", () => {
    expect(thinkingIndicatorTransformOrigin(true, true)).toBe("center center");
  });

  test("neither flag set falls back to center bottom", () => {
    // Fallback exists so the indicator never lands in a state
    // where transform-origin is ambiguous; consumers that want no
    // motion at all set shrinkTo to 1 (opacity-only) rather than
    // unchecking both direction flags.
    expect(thinkingIndicatorTransformOrigin(false, false)).toBe("center bottom");
  });
});
