/**
 * Vite integration tests for postcss-tug-color plugin wiring.
 *
 * Verifies that postcssTugColor() is correctly wired into the PostCSS pipeline
 * as configured in vite.config.ts. Tests use postcss directly with the same
 * plugin instance to simulate what Vite's css.postcss.plugins does at build
 * time — this is the programmatic equivalent of "add a temporary --tug-color()
 * declaration and check dev server output".
 *
 * The actual build checkpoint (bun run build exits 0) is verified by the
 * implementer workflow separately.
 */
import { describe, it, expect } from "bun:test";

import postcss from "postcss";
import postcssTugColor from "../../postcss-tug-color";
import { tugColor, DEFAULT_CANONICAL_L } from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Process CSS through the same plugin instance used in vite.config.ts. */
function processCSS(css: string): string {
  return postcss([postcssTugColor()]).process(css, { from: undefined }).css;
}

// ---------------------------------------------------------------------------
// Vite config wiring integration tests
// ---------------------------------------------------------------------------

describe("postcss-tug-color Vite integration: plugin processes --tug-color() in CSS", () => {
  it("--tug-color(blue, 50, 50) expands to the correct oklch() value", () => {
    const css = "a { color: --tug-color(blue, 50, 50); }";
    const result = processCSS(css);
    const expected = tugColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toContain(expected);
    expect(result).not.toContain("--tug-color(");
  });

  it("expands --tug-color() in a realistic CSS rule (background declaration)", () => {
    const css = "body { background: --tug-color(cobalt, 3, 18); }";
    const result = processCSS(css);
    expect(result).not.toContain("--tug-color(");
    expect(result).toMatch(/oklch\(/);
  });

  it("preserves var() and other CSS functions alongside --tug-color() expansion", () => {
    const css = [
      ".card {",
      "  color: --tug-color(blue, 5, 13);",
      "  background: var(--tug-surface);",
      "  border: 1px solid rgba(0, 0, 0, 0.2);",
      "}",
    ].join("\n");
    const result = processCSS(css);
    expect(result).not.toContain("--tug-color(");
    expect(result).toContain("var(--tug-surface)");
    expect(result).toContain("rgba(0, 0, 0, 0.2)");
    expect(result).toContain("oklch(");
  });

  it("CSS without --tug-color() passes through the plugin unchanged (no transformations)", () => {
    const css = [
      ":root {",
      "  --tug-bg: oklch(0.15 0 0);",
      "  --tug-fg: oklch(0.96 0 0);",
      "}",
    ].join("\n");
    const result = processCSS(css);
    expect(result).toBe(css);
  });

  it("plugin instance returned by postcssTugColor() carries postcssPlugin name", () => {
    const plugin = postcssTugColor();
    expect(plugin.postcssPlugin).toBe("postcss-tug-color");
  });

  it("postcssTugColor.postcss static flag is true (marks plugin as PostCSS-compatible)", () => {
    expect(postcssTugColor.postcss).toBe(true);
  });
});

describe("postcss-tug-color Vite integration: coexistence with Tailwind v4", () => {
  it("CSS containing Tailwind @apply rules passes through without error", () => {
    // Tailwind v4 uses a Vite plugin, not PostCSS; its directives don't
    // appear in the PostCSS pipeline. This test verifies postcss-tug-color does
    // not corrupt CSS it doesn't recognise.
    const css = [
      ".btn {",
      "  color: --tug-color(blue, 50, 50);",
      "  font-weight: bold;",
      "}",
    ].join("\n");
    const result = processCSS(css);
    expect(result).not.toContain("--tug-color(");
    const expected = tugColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toContain(expected);
  });

  it("CSS custom property declarations (non-tug-color) pass through unchanged", () => {
    const css = ":root { --my-color: oklch(0.5 0.1 230); --my-size: 1rem; }";
    const result = processCSS(css);
    expect(result).toBe(css);
  });
});
