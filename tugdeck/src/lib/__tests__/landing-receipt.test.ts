/**
 * landing-receipt — the Tug-Dash trailer parser the History join badge reads.
 */

import { describe, expect, test } from "bun:test";

import { dashNameFromTrailer } from "@/lib/landing-receipt";

describe("dashNameFromTrailer", () => {
  test("reads the dash short name from a tugdash ref", () => {
    expect(dashNameFromTrailer("tugdash/snippets onto main")).toBe("snippets");
    expect(dashNameFromTrailer("tugdash/fix-join")).toBe("fix-join");
    expect(dashNameFromTrailer("  tugdash/x onto main  ")).toBe("x");
  });

  test("returns null when the value carries no dash ref", () => {
    expect(dashNameFromTrailer(undefined)).toBeNull();
    expect(dashNameFromTrailer(null)).toBeNull();
    expect(dashNameFromTrailer("")).toBeNull();
    expect(dashNameFromTrailer("main")).toBeNull();
    expect(dashNameFromTrailer("tugdash/")).toBeNull();
  });
});
