/**
 * The persisted form of the Settings card's collapsed sections.
 *
 * The contract these pin: what is stored is what the reader collapsed, so a
 * profile that has never stored anything opens with everything expanded — and
 * "collapsed nothing" stays distinguishable from "never set", since only the
 * latter may fall back to a default. Ids the build no longer knows are dropped
 * on the way in, which is how a profile written when the keymap configurator
 * still lived in Settings stops carrying a `"keyboard"` entry.
 */

import { describe, test, expect } from "bun:test";

import {
  DEFAULT_SETTINGS_COLLAPSED,
  SETTINGS_SECTION_IDS,
  normalizeSettingsCollapsedSections,
  parseSettingsCollapsedSections,
} from "@/lib/settings-sections-pref";
import type { TaggedValue } from "@/lib/tugbank-client";

function tagged(value: unknown): TaggedValue {
  return { kind: "json", value };
}

describe("parseSettingsCollapsedSections", () => {
  test("an absent entry is `null` — never set, not empty", () => {
    expect(parseSettingsCollapsedSections(undefined)).toBeNull();
  });

  test("an empty array is an empty set, distinct from absent", () => {
    const parsed = parseSettingsCollapsedSections(tagged([]));
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual([]);
  });

  test("known ids survive", () => {
    expect(parseSettingsCollapsedSections(tagged(["app"]))).toEqual(["app"]);
    expect(
      parseSettingsCollapsedSections(tagged(["sessionCard", "general"])),
    ).toEqual(["general", "sessionCard"]);
  });

  test("the stored order does not matter — section order does", () => {
    expect(
      parseSettingsCollapsedSections(tagged(["app", "textCard", "general"])),
    ).toEqual(["general", "textCard", "app"]);
  });

  test("unknown ids are dropped, including a stale `keyboard`", () => {
    expect(
      parseSettingsCollapsedSections(tagged(["keyboard", "app"])),
    ).toEqual(["app"]);
    expect(parseSettingsCollapsedSections(tagged(["keyboard"]))).toEqual([]);
    expect(parseSettingsCollapsedSections(tagged(["nonsense"]))).toEqual([]);
  });

  test("a non-array value reads as never-set rather than as empty", () => {
    expect(parseSettingsCollapsedSections(tagged("app"))).toBeNull();
    expect(parseSettingsCollapsedSections(tagged(null))).toBeNull();
    expect(parseSettingsCollapsedSections(tagged(7))).toBeNull();
  });
});

describe("the collapsed set round-trips through storage", () => {
  test("what normalize writes is what parse reads back", () => {
    for (const collapsed of [
      [],
      ["app"],
      ["general", "app"],
      [...SETTINGS_SECTION_IDS],
    ]) {
      const stored = normalizeSettingsCollapsedSections(collapsed);
      expect(parseSettingsCollapsedSections(tagged(stored))).toEqual(stored);
    }
  });

  test("normalize drops what parse would have dropped", () => {
    expect(normalizeSettingsCollapsedSections(["keyboard", "app"])).toEqual([
      "app",
    ]);
  });

  test("every section collapsed is a representable state", () => {
    const all = normalizeSettingsCollapsedSections([...SETTINGS_SECTION_IDS]);
    expect(all).toEqual([...SETTINGS_SECTION_IDS]);
  });
});

describe("the default arrangement", () => {
  test("nothing is collapsed, so every section is expanded on a fresh profile", () => {
    expect(DEFAULT_SETTINGS_COLLAPSED).toEqual([]);
  });
});
