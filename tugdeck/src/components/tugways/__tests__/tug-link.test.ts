/**
 * tug-link.test.ts — pure-logic coverage for `TugLink`'s exported
 * `resolveLinkAttrs` resolver.
 *
 * `TugLink` is a thin presentational anchor wrapper. Its only
 * branching logic is the `external` → `target` / `rel` attribute
 * pair derivation; the visible styling is pure CSS. Pinning the
 * resolver here locks the safe-default contract (an `external`
 * link always gets `rel="noopener noreferrer"` unless the caller
 * explicitly overrides) so a future refactor can't quietly drop
 * the safety on the most-common path.
 *
 * @module components/tugways/__tests__/tug-link
 */

import { describe, expect, test } from "bun:test";

import { resolveLinkAttrs } from "../tug-link";

describe("resolveLinkAttrs", () => {
  test("external=true with no overrides → target=_blank + safe rel", () => {
    expect(resolveLinkAttrs(true, undefined, undefined)).toEqual({
      target: "_blank",
      rel: "noopener noreferrer",
    });
  });

  test("external=false with no overrides → both undefined", () => {
    expect(resolveLinkAttrs(false, undefined, undefined)).toEqual({
      target: undefined,
      rel: undefined,
    });
  });

  test("caller-supplied target wins over external default", () => {
    expect(resolveLinkAttrs(true, "_self", undefined)).toEqual({
      target: "_self",
      rel: "noopener noreferrer",
    });
  });

  test("caller-supplied rel wins over external default", () => {
    expect(resolveLinkAttrs(true, undefined, "next")).toEqual({
      target: "_blank",
      rel: "next",
    });
  });

  test("caller-supplied target + rel both win", () => {
    expect(resolveLinkAttrs(true, "_self", "next")).toEqual({
      target: "_self",
      rel: "next",
    });
  });

  test("caller-supplied target on internal link is preserved", () => {
    expect(resolveLinkAttrs(false, "_parent", undefined)).toEqual({
      target: "_parent",
      rel: undefined,
    });
  });
});
