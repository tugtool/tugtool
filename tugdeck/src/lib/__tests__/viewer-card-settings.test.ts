/**
 * The stored form of the viewer card's image and PDF settings.
 *
 * The contracts these pin:
 *
 *  1. A stored blob is untrusted. Every field falls back to the built-in
 *     value on its own, so one bad field cannot take the rest of a reader's
 *     settings with it — and a value outside the type's small set (a scaling
 *     of "cover", a page mode a later build retired) is refused rather than
 *     written through into a component prop.
 *  2. Absent is not the same as default. A wholly missing entry parses to
 *     `null` — "this card has nothing of its own" — which is the fact
 *     `resolve` needs to prefer the deck-wide defaults. A parser that
 *     returned the built-ins here would pin every card to them at first
 *     read and the deck defaults would never apply to anything.
 *  3. Per-card beats deck-wide beats built-in, in that order and no other.
 */

import { describe, test, expect } from "bun:test";

import {
  DEFAULT_IMAGE_CARD_SETTINGS,
  formatByteSize,
  parseImageCardSettings,
  resolveImageCardSettings,
  type ImageCardSettings,
} from "@/lib/image-card-settings";
import {
  DEFAULT_PDF_CARD_SETTINGS,
  clampPageGap,
  openingZoomToPdfZoom,
  parsePdfCardSettings,
  resolvePdfCardSettings,
  type PdfCardSettings,
} from "@/lib/pdf-card-settings";
import type { TaggedValue } from "@/lib/tugbank-client";

function json(value: unknown): TaggedValue {
  return { kind: "json", value };
}

describe("parseImageCardSettings", () => {
  test("an absent or non-json entry is `null`, not the defaults", () => {
    expect(parseImageCardSettings(undefined)).toBeNull();
    expect(parseImageCardSettings({ kind: "string", value: "fit" })).toBeNull();
    expect(parseImageCardSettings({ kind: "json", value: null })).toBeNull();
  });

  test("a full blob round-trips", () => {
    const stored: ImageCardSettings = {
      scaling: "actual",
      background: "black",
      smoothing: false,
      showInfo: true,
    };
    expect(parseImageCardSettings(json(stored))).toEqual(stored);
  });

  test("each field falls back on its own", () => {
    const parsed = parseImageCardSettings(
      json({ scaling: "fill", background: "not-a-ground", smoothing: "yes" }),
    );
    expect(parsed?.scaling).toBe("fill");
    expect(parsed?.background).toBe(DEFAULT_IMAGE_CARD_SETTINGS.background);
    expect(parsed?.smoothing).toBe(DEFAULT_IMAGE_CARD_SETTINGS.smoothing);
    expect(parsed?.showInfo).toBe(DEFAULT_IMAGE_CARD_SETTINGS.showInfo);
  });
});

describe("resolveImageCardSettings", () => {
  const defaults: ImageCardSettings = {
    scaling: "fill",
    background: "white",
    smoothing: false,
    showInfo: true,
  };
  const persisted: ImageCardSettings = {
    scaling: "actual",
    background: "black",
    smoothing: true,
    showInfo: false,
  };

  test("the card's own values win outright", () => {
    expect(resolveImageCardSettings(persisted, defaults)).toEqual(persisted);
  });

  test("with nothing of its own, a card takes the deck defaults", () => {
    expect(resolveImageCardSettings(null, defaults)).toEqual(defaults);
  });

  test("with neither, the built-ins — as a copy, never the shared object", () => {
    const resolved = resolveImageCardSettings(null, null);
    expect(resolved).toEqual(DEFAULT_IMAGE_CARD_SETTINGS);
    expect(resolved).not.toBe(DEFAULT_IMAGE_CARD_SETTINGS);
  });
});

describe("formatByteSize", () => {
  test("bytes below a kilobyte are counted", () => {
    expect(formatByteSize(0)).toBe("0 bytes");
    expect(formatByteSize(999)).toBe("999 bytes");
  });

  test("decimal units, matching the Finder", () => {
    expect(formatByteSize(1000)).toBe("1.0 KB");
    expect(formatByteSize(24733)).toBe("25 KB");
    expect(formatByteSize(9_400_000)).toBe("9.4 MB");
    expect(formatByteSize(24_000_000)).toBe("24 MB");
  });

  test("a size that is not a size prints nothing", () => {
    expect(formatByteSize(Number.NaN)).toBe("");
    expect(formatByteSize(-1)).toBe("");
  });
});

describe("parsePdfCardSettings", () => {
  test("an absent entry is `null`", () => {
    expect(parsePdfCardSettings(undefined)).toBeNull();
  });

  test("a full blob round-trips", () => {
    const stored: PdfCardSettings = {
      pageMode: "two",
      openingZoom: "fit-page",
      pageGap: 24,
      invertInDark: true,
    };
    expect(parsePdfCardSettings(json(stored))).toEqual(stored);
  });

  test("an unknown mode or zoom falls back rather than reaching the surface", () => {
    const parsed = parsePdfCardSettings(
      json({ pageMode: "spiral", openingZoom: 1.37, pageGap: 12 }),
    );
    expect(parsed?.pageMode).toBe(DEFAULT_PDF_CARD_SETTINGS.pageMode);
    expect(parsed?.openingZoom).toBe(DEFAULT_PDF_CARD_SETTINGS.openingZoom);
  });

  test("a stored gap is clamped, not trusted", () => {
    expect(parsePdfCardSettings(json({ pageGap: 5000 }))?.pageGap).toBe(64);
    expect(parsePdfCardSettings(json({ pageGap: -20 }))?.pageGap).toBe(0);
  });
});

describe("clampPageGap", () => {
  test("rounds and bounds; a non-number is the default", () => {
    expect(clampPageGap(11.4)).toBe(11);
    expect(clampPageGap(-3)).toBe(0);
    expect(clampPageGap(1000)).toBe(64);
    expect(clampPageGap(Number.NaN)).toBe(DEFAULT_PDF_CARD_SETTINGS.pageGap);
  });
});

describe("openingZoomToPdfZoom", () => {
  test("the two fits pass through; actual size is the number 1", () => {
    expect(openingZoomToPdfZoom("fit-width")).toBe("fit-width");
    expect(openingZoomToPdfZoom("fit-page")).toBe("fit-page");
    expect(openingZoomToPdfZoom("actual")).toBe(1);
  });
});

describe("resolvePdfCardSettings", () => {
  test("per-card, then deck-wide, then built-in", () => {
    const defaults: PdfCardSettings = {
      pageMode: "single",
      openingZoom: "fit-page",
      pageGap: 4,
      invertInDark: true,
    };
    const persisted: PdfCardSettings = {
      pageMode: "two",
      openingZoom: "actual",
      pageGap: 32,
      invertInDark: false,
    };
    expect(resolvePdfCardSettings(persisted, defaults)).toEqual(persisted);
    expect(resolvePdfCardSettings(null, defaults)).toEqual(defaults);
    expect(resolvePdfCardSettings(null, null)).toEqual(DEFAULT_PDF_CARD_SETTINGS);
  });

  test("the built-in page gap is the spacing the surface always used", () => {
    // If this ever diverges from `PDF_SPACING.gap`, every already-open
    // document shifts the first time the preference ships.
    expect(DEFAULT_PDF_CARD_SETTINGS.pageGap).toBe(12);
  });
});
