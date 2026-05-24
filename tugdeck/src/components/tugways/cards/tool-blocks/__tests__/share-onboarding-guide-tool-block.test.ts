/**
 * Pure-logic tests for `ShareOnboardingGuideToolBlock`'s wire-
 * narrowing + tool-name composition + URL-extraction helpers, plus
 * the dispatch registration pin (`shareonboardingguide` →
 * `ShareOnboardingGuideToolBlock`).
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 *
 * @module components/tugways/cards/tool-blocks/__tests__/share-onboarding-guide-tool-block
 */

import { describe, expect, test } from "bun:test";

import {
  ShareOnboardingGuideToolBlock,
  composeShareOnboardingGuideToolName,
  extractShareLink,
  narrowShareOnboardingGuideInput,
} from "../share-onboarding-guide-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowShareOnboardingGuideInput
// ---------------------------------------------------------------------------

describe("narrowShareOnboardingGuideInput", () => {
  test("keeps known modes", () => {
    for (const mode of ["check", "update", "create", "delete"] as const) {
      expect(narrowShareOnboardingGuideInput({ mode })).toEqual({
        mode,
        short_code: undefined,
      });
    }
  });

  test("keeps short_code when non-empty string", () => {
    expect(
      narrowShareOnboardingGuideInput({ mode: "update", short_code: "abc123" }),
    ).toEqual({ mode: "update", short_code: "abc123" });
  });

  test("drops empty-string short_code (treated as absent)", () => {
    expect(
      narrowShareOnboardingGuideInput({ mode: "check", short_code: "" }),
    ).toEqual({ mode: "check", short_code: undefined });
  });

  test("drops unrecognised mode silently — reads neutrally", () => {
    expect(narrowShareOnboardingGuideInput({ mode: "foo" })).toEqual({
      mode: undefined,
      short_code: undefined,
    });
  });

  test("returns {} for non-object input", () => {
    expect(narrowShareOnboardingGuideInput(null)).toEqual({});
    expect(narrowShareOnboardingGuideInput([])).toEqual({});
    expect(narrowShareOnboardingGuideInput("string")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// composeShareOnboardingGuideToolName
// ---------------------------------------------------------------------------

describe("composeShareOnboardingGuideToolName", () => {
  test("with mode → `Share Onboarding Guide · <mode>`", () => {
    expect(composeShareOnboardingGuideToolName("check")).toBe(
      "Share Onboarding Guide · check",
    );
    expect(composeShareOnboardingGuideToolName("update")).toBe(
      "Share Onboarding Guide · update",
    );
    expect(composeShareOnboardingGuideToolName("create")).toBe(
      "Share Onboarding Guide · create",
    );
    expect(composeShareOnboardingGuideToolName("delete")).toBe(
      "Share Onboarding Guide · delete",
    );
  });

  test("undefined mode → bare `Share Onboarding Guide`", () => {
    expect(composeShareOnboardingGuideToolName(undefined)).toBe(
      "Share Onboarding Guide",
    );
  });
});

// ---------------------------------------------------------------------------
// extractShareLink
// ---------------------------------------------------------------------------

describe("extractShareLink", () => {
  test("extracts an http URL from result text", () => {
    expect(
      extractShareLink("Found existing guide: http://claude.ai/code/onboarding/abc"),
    ).toBe("http://claude.ai/code/onboarding/abc");
  });

  test("extracts an https URL from result text", () => {
    expect(
      extractShareLink("Created: https://claude.ai/code/onboarding/xyz789"),
    ).toBe("https://claude.ai/code/onboarding/xyz789");
  });

  test("returns the first URL when multiple are present", () => {
    expect(
      extractShareLink(
        "https://primary.example/a and https://secondary.example/b",
      ),
    ).toBe("https://primary.example/a");
  });

  test("returns null when no URL is present", () => {
    expect(extractShareLink("Deleted")).toBeNull();
    expect(extractShareLink("Error: not found")).toBeNull();
  });

  test("returns null for absent / empty text", () => {
    expect(extractShareLink(undefined)).toBeNull();
    expect(extractShareLink("")).toBeNull();
  });

  test("stops at whitespace / closing paren — doesn't slurp trailing prose", () => {
    expect(
      extractShareLink("(see https://claude.ai/code/onboarding/abc for details)"),
    ).toBe("https://claude.ai/code/onboarding/abc");
  });
});

// ---------------------------------------------------------------------------
// Dispatch registration
// ---------------------------------------------------------------------------

describe("dispatch registration", () => {
  test("`shareonboardingguide` maps to the bespoke wrapper", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("shareonboardingguide")).toBe(
      ShareOnboardingGuideToolBlock,
    );
  });
});
