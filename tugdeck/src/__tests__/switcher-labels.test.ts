/**
 * switcherLabels unit tests — the Open Quickly directory switcher's menu text.
 *
 * Tests cover:
 * - a unique leaf keeps the short label
 * - colliding leaves grow parent segments until distinct
 * - only the colliding entries pay for disambiguation
 * - a three-way collision resolves each entry independently
 * - collisions that need more than one extra segment keep growing
 * - trailing slashes and identical paths do not change the answer
 */

import { describe, test, expect } from "bun:test";
import { switcherLabels } from "../components/chrome/open-quickly-overlay";

describe("switcherLabels", () => {
  test("unique leaves keep their short labels", () => {
    expect(switcherLabels(["/Users/x/tug", "/Users/x/src/tugtool"])).toEqual([
      "tug",
      "tugtool",
    ]);
  });

  test("colliding leaves grow one parent segment", () => {
    expect(switcherLabels(["/Users/x/a/proj", "/Users/x/c/proj"])).toEqual([
      "a/proj",
      "c/proj",
    ]);
  });

  test("only the colliding entries are disambiguated", () => {
    expect(
      switcherLabels(["/Users/x/tug", "/Users/x/a/proj", "/Users/x/c/proj"]),
    ).toEqual(["tug", "a/proj", "c/proj"]);
  });

  test("a three-way collision resolves every entry", () => {
    expect(
      switcherLabels(["/w/a/proj", "/w/b/proj", "/w/c/proj"]),
    ).toEqual(["a/proj", "b/proj", "c/proj"]);
  });

  test("labels keep growing when one extra segment is not enough", () => {
    // Both end in `src/tugtool`; the difference is two levels up.
    expect(
      switcherLabels(["/Users/x/src/tugtool", "/Volumes/w/src/tugtool"]),
    ).toEqual(["x/src/tugtool", "w/src/tugtool"]);
  });

  test("a trailing slash does not change the label", () => {
    expect(switcherLabels(["/Users/x/tug/", "/Users/x/code"])).toEqual([
      "tug",
      "code",
    ]);
  });

  test("genuinely identical paths fall back to the full path", () => {
    // The caller dedupes by canonical path, so this should not arise — but a
    // label helper that silently returned two identical short labels would
    // hide exactly the bug it exists to prevent.
    expect(switcherLabels(["/w/proj", "/w/proj"])).toEqual([
      "/w/proj",
      "/w/proj",
    ]);
  });

  test("an empty list is an empty list", () => {
    expect(switcherLabels([])).toEqual([]);
  });
});
