/**
 * Pure-logic tests for `ImageBlock`'s exported helpers.
 *
 * `ImageBlock` is a thin React shell over `<img>` plus a
 * portal-mounted overlay; its visible behaviour *is* the lazy-load
 * attribute, the status-driven placeholder, and the click-to-zoom
 * overlay (all DOM-driven). The exported pure helper:
 *
 *  - `composeImageErrorCaption(src, alt)` — caption text shown on
 *    failed load. Prefers `alt`; falls back to `src` when alt is
 *    empty / whitespace.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests. The render-time
 * behaviour is verified in the gallery card under both themes.
 */

import { describe, expect, test } from "bun:test";

import { composeImageErrorCaption } from "../image-block";

describe("composeImageErrorCaption", () => {
  test("prefers alt text when present", () => {
    expect(
      composeImageErrorCaption("https://example.com/mona.jpg", "Mona Lisa"),
    ).toBe("Mona Lisa");
  });

  test("falls back to the src URL when alt is empty", () => {
    expect(composeImageErrorCaption("https://example.com/x.png", "")).toBe(
      "https://example.com/x.png",
    );
    expect(
      composeImageErrorCaption("https://example.com/x.png", undefined),
    ).toBe("https://example.com/x.png");
  });

  test("falls back to the src URL when alt is whitespace-only", () => {
    expect(composeImageErrorCaption("https://example.com/x.png", "   ")).toBe(
      "https://example.com/x.png",
    );
  });
});
