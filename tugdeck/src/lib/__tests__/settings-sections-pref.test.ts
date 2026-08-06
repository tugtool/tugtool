/**
 * The persisted form of the Settings card's selected section.
 *
 * The contract these pin: what is stored is where the reader last was, so a
 * profile that has never stored anything opens on the first section — and an
 * id the build no longer knows reads as never-set rather than as a choice,
 * which is how a stored id retired by a later build stops steering the card.
 */

import { describe, test, expect } from "bun:test";

import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTION_IDS,
  parseSettingsSelectedSection,
} from "@/lib/settings-sections-pref";
import type { TaggedValue } from "@/lib/tugbank-client";

function tagged(value: unknown): TaggedValue {
  return { kind: "string", value };
}

describe("parseSettingsSelectedSection", () => {
  test("an absent entry is `null` — never set", () => {
    expect(parseSettingsSelectedSection(undefined)).toBeNull();
  });

  test("every known id survives", () => {
    for (const id of SETTINGS_SECTION_IDS) {
      expect(parseSettingsSelectedSection(tagged(id))).toBe(id);
    }
  });

  test("an unknown id reads as never-set, including a retired `keyboard`", () => {
    expect(parseSettingsSelectedSection(tagged("keyboard"))).toBeNull();
    expect(parseSettingsSelectedSection(tagged("nonsense"))).toBeNull();
    expect(parseSettingsSelectedSection(tagged(""))).toBeNull();
  });

  test("a non-string value reads as never-set", () => {
    expect(parseSettingsSelectedSection(tagged(null))).toBeNull();
    expect(parseSettingsSelectedSection(tagged(["general"]))).toBeNull();
    expect(parseSettingsSelectedSection(tagged(3))).toBeNull();
  });

  test("the fallback section is the first in presentation order", () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe(SETTINGS_SECTION_IDS[0]);
  });
});
