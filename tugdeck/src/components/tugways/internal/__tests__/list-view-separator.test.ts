/**
 * list-view-separator.test.ts — pure-logic coverage for
 * `resolveRowSeparator`, the mapping from `TugListView`'s `rowSeparator`
 * prop to the divider's CSS custom-property values.
 */

import { describe, expect, test } from "bun:test";

import { resolveRowSeparator } from "../list-view-separator";

describe("resolveRowSeparator", () => {
  test('"none" resolves to null — no divider', () => {
    expect(resolveRowSeparator("none")).toBeNull();
  });

  test("omitted resolves to the hairline default with no color override", () => {
    expect(resolveRowSeparator(undefined)).toEqual({
      thickness: "1px",
      color: null,
    });
  });

  test("named thicknesses map to CSS lengths", () => {
    expect(resolveRowSeparator({ thickness: "hairline" })?.thickness).toBe("1px");
    expect(resolveRowSeparator({ thickness: "thin" })?.thickness).toBe("1.5px");
    expect(resolveRowSeparator({ thickness: "medium" })?.thickness).toBe("2px");
  });

  test("a partial object merges over the hairline default", () => {
    // color only → keeps the default hairline thickness
    expect(resolveRowSeparator({ color: "red" })).toEqual({
      thickness: "1px",
      color: "red",
    });
    // thickness only → no color override
    expect(resolveRowSeparator({ thickness: "medium" })).toEqual({
      thickness: "2px",
      color: null,
    });
  });

  test("both fields are honored together", () => {
    expect(
      resolveRowSeparator({
        thickness: "thin",
        color: "var(--tug7-element-global-border-normal-default-rest)",
      }),
    ).toEqual({
      thickness: "1.5px",
      color: "var(--tug7-element-global-border-normal-default-rest)",
    });
  });
});
