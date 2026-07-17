/**
 * Per-route Z4B chrome manifest — pure mapping tests ([P03], Table T01).
 *
 * `routeChipKeys` is the table as data; the React wrapper that reads `useRoute`
 * and threads the chip slots is exercised by the app-test, not here (no
 * fake-DOM render).
 */
import { describe, it, expect } from "bun:test";

import { routeChipKeys } from "@/components/tugways/chrome/session-route-chrome-manifest";
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

  it("shell (`$`) shows identity · session · project · cwd · visibility", () => {
    expect(routeChipKeys("$")).toEqual([
      "identity",
      "session",
      "project",
      "cwd",
      "visibility",
    ]);
  });

  it("btw (`?`) shows identity · session · project · visibility", () => {
    expect(routeChipKeys("?")).toEqual([
      "identity",
      "session",
      "project",
      "visibility",
    ]);
  });

  it("find (`⌕`) shows session · project · find (drops identity; the search cluster replaces the model chrome)", () => {
    expect(routeChipKeys("⌕")).toEqual(["session", "project", "find"]);
  });

  it("changes (`±`) shows session · project · cwd (drops identity — a commit, not a Claude turn)", () => {
    expect(routeChipKeys("±")).toEqual(["session", "project", "cwd"]);
  });

  it("history (`↺`) mirrors the code chrome (it sends an on-record Claude turn)", () => {
    expect(routeChipKeys("↺")).toEqual([
      "identity",
      "session",
      "project",
      "mode",
      "model",
      "effort",
    ]);
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

  it("the VISIBILITY toggle appears ONLY on the shell + btw routes", () => {
    expect(routeChipKeys("$")).toContain("visibility");
    expect(routeChipKeys("?")).toContain("visibility");
    expect(routeChipKeys("❯")).not.toContain("visibility");
    expect(routeChipKeys("⌕")).not.toContain("visibility");
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
