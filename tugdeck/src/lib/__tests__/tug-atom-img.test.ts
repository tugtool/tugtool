/**
 * Pure-logic tests for the `tug-atom-img` exports that don't depend on
 * the DOM. The full chip-builder (`bakeAtomChipDataUri`) is
 * DOM-dependent (it reads theme tokens via `getComputedStyle(document.body)`)
 * and is exercised through the real-app manual smoke; this file pins
 * the pure pieces consumers rely on:
 *
 *   - {@link formatAtomLabel} — basename extraction. Tool-block path
 *     chips call this with mode `"filename"` to derive the chip's
 *     label from the full path.
 *   - {@link atomHeightFor} — chip height formula used by the
 *     transcript walker's `line-height` floor.
 */

import { describe, expect, test } from "bun:test";

import {
  atomHeightFor,
  formatAtomLabel,
  TRANSCRIPT_CHIP_BASE_FONT_SIZE,
} from "../tug-atom-img";
import { EDITOR_LINE_HEIGHT } from "../editor-settings-store";

describe("formatAtomLabel — `filename` mode (basename extraction)", () => {
  test("absolute path: returns the last component", () => {
    expect(formatAtomLabel("/repo/src/main.ts", "filename")).toBe("main.ts");
  });

  test("relative path: returns the last component", () => {
    expect(formatAtomLabel("src/components/foo.tsx", "filename")).toBe(
      "foo.tsx",
    );
  });

  test("bare filename (no slash): returns the input as-is", () => {
    expect(formatAtomLabel("main.ts", "filename")).toBe("main.ts");
  });

  test("path ending in slash returns empty (last component after trailing slash)", () => {
    // The transcript / tool-block side never passes a directory path
    // — the tool inputs are always file paths — but pin the deterministic
    // behaviour of `lastIndexOf('/')` so a future regression to a
    // non-empty fallback would be observable.
    expect(formatAtomLabel("src/", "filename")).toBe("");
  });

  test("nested basename keeps its extension", () => {
    expect(
      formatAtomLabel("/Users/kocienda/notebooks/exploration.ipynb", "filename"),
    ).toBe("exploration.ipynb");
  });

  test("http URL: returns the trailing component (after query strip)", () => {
    expect(
      formatAtomLabel("https://example.com/api/v2/users?id=42", "filename"),
    ).toBe("users");
  });

  test("https URL ending in slash (homepage): returns the full URL fallback", () => {
    // The `filename` branch falls back to the full value when the
    // post-strip basename is empty (a homepage URL).
    expect(formatAtomLabel("https://example.com/", "filename")).toBe(
      "https://example.com/",
    );
  });
});

describe("atomHeightFor", () => {
  // Pure layout helper exported so the transcript walker can publish
  // a `line-height` floor that matches the chip's actual rendered
  // height. The chip fills the host line box (`round(size * lineHeight)`,
  // defaulting to the transcript's 1.6) minus a 1px inset each edge —
  // see the atom-img module — so it fits inside the natural line-box.
  test("computes height = round(size * 1.6) - 2 by default", () => {
    expect(atomHeightFor(13)).toBe(19); // round(20.8) - 2 = 21 - 2 = 19
    expect(atomHeightFor(14)).toBe(20); // round(22.4) - 2 = 22 - 2 = 20
    expect(atomHeightFor(18)).toBe(27); // round(28.8) - 2 = 29 - 2 = 27
  });

  // The whole no-hop / no-bloat scheme rests on one cross-file contract:
  // the chip must fit *inside* the natural line box on every surface that
  // bakes it. The editor bake sizes from the editor's own pinned
  // line-height, so this guards strict fit — the chip stays *under* the
  // visual row, leaving air between chips on adjacent wrapped rows of one
  // long line. If the metrics drift so the chip fills or overflows the
  // row, this fails instead of the UI regressing to touching chips.
  test("editor-sized chip fits strictly inside the editor line box at every font size (no hop, no touch)", () => {
    for (const size of [11, 12, 13, 14, 15, 16]) {
      const lineBox = size * EDITOR_LINE_HEIGHT;
      expect(atomHeightFor(size, EDITOR_LINE_HEIGHT)).toBeLessThan(lineBox);
    }
  });

  // Same contract for the transcript body, whose prose line-height is the
  // `--tugx-md-body-line-height: 1.6` token (kept in lockstep here).
  test("chip fits inside the transcript line box (no hop)", () => {
    const TRANSCRIPT_BODY_LINE_HEIGHT = 1.6; // --tugx-md-body-line-height
    const lineBox = Math.floor(
      TRANSCRIPT_CHIP_BASE_FONT_SIZE * TRANSCRIPT_BODY_LINE_HEIGHT,
    );
    expect(atomHeightFor(TRANSCRIPT_CHIP_BASE_FONT_SIZE)).toBeLessThanOrEqual(
      lineBox,
    );
  });
});
