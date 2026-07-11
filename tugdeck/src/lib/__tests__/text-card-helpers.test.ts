/**
 * text-card-helpers.test.ts — the pure helpers behind the Text Card
 * feature: settings resolution/parsing, language identification, and the
 * two display-string helpers. Built pure specifically to be tested here
 * without a store or a rendered component.
 */

import { describe, test, expect } from "bun:test";
import type { TaggedValue } from "@/lib/tugbank-client";
import {
  DEFAULT_TEXT_CARD_SETTINGS,
  DEFAULT_TEXT_CARD_OPEN_TARGET,
  clampTabSize,
  parseTextCardSettings,
  parseTextCardDefaults,
  resolveTextCardSettings,
  type TextCardSettings,
} from "@/lib/text-card-settings";
import {
  extensionForLanguageId,
  fileExtension,
  languageIdForPath,
  languageLabelFor,
} from "@/lib/language-registry";
import { centerTruncate, TAB_TITLE_MAX } from "@/components/tugways/tug-tab-bar";
import { segmentsOf } from "@/components/chrome/card-path-menu";

const json = (value: unknown): TaggedValue => ({ kind: "json", value } as TaggedValue);

describe("clampTabSize", () => {
  test("clamps to [1,16], rounds, and defaults on non-finite", () => {
    expect(clampTabSize(4)).toBe(4);
    expect(clampTabSize(0)).toBe(1);
    expect(clampTabSize(-3)).toBe(1);
    expect(clampTabSize(99)).toBe(16);
    expect(clampTabSize(2.6)).toBe(3);
    expect(clampTabSize(NaN)).toBe(DEFAULT_TEXT_CARD_SETTINGS.tabSize);
    // Non-finite (including Infinity) falls back to the default, not the cap.
    expect(clampTabSize(Infinity)).toBe(DEFAULT_TEXT_CARD_SETTINGS.tabSize);
  });
});

describe("parseTextCardSettings", () => {
  test("null for non-json / absent entries", () => {
    expect(parseTextCardSettings(undefined)).toBeNull();
    expect(parseTextCardSettings({ kind: "string", value: "x" } as TaggedValue)).toBeNull();
    expect(parseTextCardSettings(json(null))).toBeNull();
  });

  test("fills missing fields from defaults; clamps tabSize", () => {
    const parsed = parseTextCardSettings(json({ lineWrap: true, tabSize: 999 }));
    expect(parsed).not.toBeNull();
    expect(parsed!.lineWrap).toBe(true);
    expect(parsed!.tabSize).toBe(16);
    // Untouched fields fall back to the built-in defaults.
    expect(parsed!.lineNumbers).toBe(DEFAULT_TEXT_CARD_SETTINGS.lineNumbers);
    expect(parsed!.showTabs).toBe(DEFAULT_TEXT_CARD_SETTINGS.showTabs);
  });

  test("ignores wrong-typed fields", () => {
    const parsed = parseTextCardSettings(json({ lineNumbers: "yes", tabSize: "8" }));
    expect(parsed!.lineNumbers).toBe(DEFAULT_TEXT_CARD_SETTINGS.lineNumbers);
    expect(parsed!.tabSize).toBe(DEFAULT_TEXT_CARD_SETTINGS.tabSize);
  });
});

describe("parseTextCardDefaults", () => {
  test("adds openTarget; defaults it when missing or invalid", () => {
    expect(parseTextCardDefaults(json({ openTarget: "reuse" }))!.openTarget).toBe("reuse");
    expect(parseTextCardDefaults(json({ openTarget: "newTab" }))!.openTarget).toBe("newTab");
    expect(parseTextCardDefaults(json({}))!.openTarget).toBe(DEFAULT_TEXT_CARD_OPEN_TARGET);
    expect(parseTextCardDefaults(json({ openTarget: "bogus" }))!.openTarget).toBe(
      DEFAULT_TEXT_CARD_OPEN_TARGET,
    );
    expect(parseTextCardDefaults(undefined)).toBeNull();
  });
});

describe("resolveTextCardSettings", () => {
  const persisted: TextCardSettings = { ...DEFAULT_TEXT_CARD_SETTINGS, tabSize: 2 };
  test("persisted wins; else defaults (minus openTarget); else built-in", () => {
    expect(resolveTextCardSettings(persisted, null).tabSize).toBe(2);
    const defaults = { ...DEFAULT_TEXT_CARD_SETTINGS, tabSize: 8, openTarget: "reuse" as const };
    const r = resolveTextCardSettings(null, defaults);
    expect(r.tabSize).toBe(8);
    expect("openTarget" in r).toBe(false);
    expect(resolveTextCardSettings(null, null)).toEqual(DEFAULT_TEXT_CARD_SETTINGS);
  });
});

describe("language identification", () => {
  test("fileExtension", () => {
    expect(fileExtension("/a/b/foo.TS")).toBe("ts");
    expect(fileExtension("/a/b/Makefile")).toBeNull();
    expect(fileExtension("/a/.bashrc")).toBeNull(); // leading dot = no ext
  });

  test("languageIdForPath maps extensions and aliases", () => {
    expect(languageIdForPath("/x/foo.md")).toBe("md");
    expect(languageIdForPath("/x/foo.mjs")).toBe("js"); // alias → JavaScript → js
    expect(languageIdForPath("/x/foo.htm")).toBe("html"); // alias → HTML
    expect(languageIdForPath("/x/foo.txt")).toBe("text");
    expect(languageIdForPath(null)).toBe("text");
  });

  test("extensionForLanguageId round-trips selectable ids", () => {
    expect(extensionForLanguageId("ts")).toBe("ts");
    expect(extensionForLanguageId("text")).toBeNull();
    expect(extensionForLanguageId("bogus")).toBeNull();
  });

  test("languageLabelFor", () => {
    expect(languageLabelFor("/x/foo.md")).toBe("Markdown");
    expect(languageLabelFor("/x/foo.xyz")).toBe("Plain Text");
    expect(languageLabelFor(null)).toBe("Plain Text");
  });
});

describe("centerTruncate", () => {
  test("passes short strings through", () => {
    expect(centerTruncate("short.ts", TAB_TITLE_MAX)).toBe("short.ts");
    expect(centerTruncate("x".repeat(TAB_TITLE_MAX), TAB_TITLE_MAX)).toHaveLength(TAB_TITLE_MAX);
  });
  test("middle-truncates long strings, keeping head + tail", () => {
    const s = "a-very-long-file-name-indeed.tsx";
    const out = centerTruncate(s, TAB_TITLE_MAX);
    expect(out.length).toBe(TAB_TITLE_MAX);
    expect(out).toContain("…");
    expect(out.startsWith("a-very")).toBe(true);
    expect(out.endsWith(".tsx")).toBe(true);
  });
});

describe("segmentsOf", () => {
  test("splits to innermost-first, dropping empties", () => {
    expect(segmentsOf("/Users/k/src/tug/file.md")).toEqual([
      "file.md",
      "tug",
      "src",
      "k",
      "Users",
    ]);
    expect(segmentsOf("/")).toEqual([]);
    expect(segmentsOf("solo")).toEqual(["solo"]);
  });
});
