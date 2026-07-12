/**
 * Per-route Z4B chrome manifest — pure mapping tests ([P03], Table T01).
 *
 * `routeChipKeys` is the table as data; the React wrapper that reads `useRoute`
 * and threads the chip slots is exercised by the app-test, not here (no
 * fake-DOM render).
 */
import { describe, it, expect } from "bun:test";

import { routeChipKeys } from "@/components/tugways/chrome/dev-route-chrome-manifest";
import { formatPathChipText } from "@/components/tugways/chrome/path-chip-format";

describe("routeChipKeys — Table T01", () => {
  it("code (`❯`) shows identity · session · project · mode · model · effort", () => {
    expect(routeChipKeys("❯")).toEqual([
      "identity",
      "session",
      "project",
      "mode",
      "model",
      "effort",
    ]);
  });

  it("shell (`$`) shows identity · project · cwd (no Claude-session chips)", () => {
    expect(routeChipKeys("$")).toEqual(["identity", "project", "cwd"]);
  });

  it("btw (`?`) shows identity · session · project", () => {
    expect(routeChipKeys("?")).toEqual(["identity", "session", "project"]);
  });

  it("find (`⌕`) shows project · find (drops identity; the search cluster replaces the session chips)", () => {
    expect(routeChipKeys("⌕")).toEqual(["project", "find"]);
  });

  it("identity always leads (never unmounts across a flip)", () => {
    for (const route of ["❯", "$", "?", null, "weird"]) {
      expect(routeChipKeys(route)[0]).toBe("identity");
    }
  });

  it("an unknown / null route falls back to the code set", () => {
    expect(routeChipKeys(null)).toEqual(routeChipKeys("❯"));
    expect(routeChipKeys("xyz")).toEqual(routeChipKeys("❯"));
  });

  it("mode/model/effort appear ONLY on code; cwd ONLY on shell", () => {
    expect(routeChipKeys("$")).not.toContain("mode");
    expect(routeChipKeys("?")).not.toContain("mode");
    expect(routeChipKeys("❯")).not.toContain("cwd");
    expect(routeChipKeys("?")).not.toContain("cwd");
  });

  it("the find cluster appears ONLY on the find route", () => {
    for (const route of ["❯", "$", "?", null, "weird"]) {
      expect(routeChipKeys(route)).not.toContain("find");
    }
  });
});

describe("formatPathChipText — cwd/project chip face", () => {
  it("short paths show verbatim", () => {
    expect(formatPathChipText("/tmp")).toBe("/tmp");
  });

  it("a long path collapses to its leaf directory", () => {
    expect(formatPathChipText("/Users/someone/src/tugtool")).toBe("tugtool");
  });

  it("a long leaf mid-truncates with an ellipsis", () => {
    // 20-char leaf, max 16 → keep 15 (head 8, tail 7) around an ellipsis.
    expect(formatPathChipText("/a/averylongleafname12345")).toBe(
      "averylon…me12345",
    );
  });

  it("a trailing slash doesn't confuse the leaf extraction", () => {
    expect(formatPathChipText("/Users/someone/src/tugtool/")).toBe("tugtool");
  });
});
