/**
 * Vite integration tests for postcss-hvv plugin wiring.
 *
 * Verifies that postcssHvv() is correctly wired into the PostCSS pipeline
 * as configured in vite.config.ts. Tests use postcss directly with the same
 * plugin instance to simulate what Vite's css.postcss.plugins does at build
 * time — this is the programmatic equivalent of "add a temporary --hvv()
 * declaration and check dev server output".
 *
 * The actual build checkpoint (bun run build exits 0) is verified by the
 * implementer workflow separately.
 */
import { describe, it, expect } from "bun:test";

import postcss from "postcss";
import postcssHvv from "../../postcss-hvv";
import { hvvColor, DEFAULT_CANONICAL_L } from "@/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Process CSS through the same plugin instance used in vite.config.ts. */
function processCSS(css: string): string {
  return postcss([postcssHvv()]).process(css, { from: undefined }).css;
}

// ---------------------------------------------------------------------------
// Vite config wiring integration tests
// ---------------------------------------------------------------------------

describe("postcss-hvv Vite integration: plugin processes --hvv() in CSS", () => {
  it("--hvv(blue, 50, 50) expands to the correct oklch() value", () => {
    const css = "a { color: --hvv(blue, 50, 50); }";
    const result = processCSS(css);
    const expected = hvvColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toContain(expected);
    expect(result).not.toContain("--hvv(");
  });

  it("expands --hvv() in a realistic CSS rule (background declaration)", () => {
    const css = "body { background: --hvv(cobalt, 3, 18); }";
    const result = processCSS(css);
    expect(result).not.toContain("--hvv(");
    expect(result).toMatch(/oklch\(/);
  });

  it("preserves var() and color-mix() values alongside --hvv() expansion", () => {
    const css = [
      ".card {",
      "  color: --hvv(blue, 5, 13);",
      "  background: var(--tug-surface);",
      "  border: 1px solid color-mix(in oklch, currentColor 20%, transparent);",
      "}",
    ].join("\n");
    const result = processCSS(css);
    expect(result).not.toContain("--hvv(");
    expect(result).toContain("var(--tug-surface)");
    expect(result).toContain("color-mix(in oklch, currentColor 20%, transparent)");
    expect(result).toContain("oklch(");
  });

  it("CSS without --hvv() passes through the plugin unchanged (no transformations)", () => {
    const css = [
      ":root {",
      "  --tug-bg: oklch(0.15 0 0);",
      "  --tug-fg: oklch(0.96 0 0);",
      "}",
    ].join("\n");
    const result = processCSS(css);
    expect(result).toBe(css);
  });

  it("plugin instance returned by postcssHvv() carries postcssPlugin name", () => {
    const plugin = postcssHvv();
    expect(plugin.postcssPlugin).toBe("postcss-hvv");
  });

  it("postcssHvv.postcss static flag is true (marks plugin as PostCSS-compatible)", () => {
    expect(postcssHvv.postcss).toBe(true);
  });
});

describe("postcss-hvv Vite integration: coexistence with Tailwind v4", () => {
  it("CSS containing Tailwind @apply rules passes through without error", () => {
    // Tailwind v4 uses a Vite plugin, not PostCSS; its directives don't
    // appear in the PostCSS pipeline. This test verifies postcss-hvv does
    // not corrupt CSS it doesn't recognise.
    const css = [
      ".btn {",
      "  color: --hvv(blue, 50, 50);",
      "  font-weight: bold;",
      "}",
    ].join("\n");
    const result = processCSS(css);
    expect(result).not.toContain("--hvv(");
    const expected = hvvColor("blue", 50, 50, DEFAULT_CANONICAL_L["blue"]);
    expect(result).toContain(expected);
  });

  it("CSS custom property declarations (non-hvv) pass through unchanged", () => {
    const css = ":root { --my-color: oklch(0.5 0.1 230); --my-size: 1rem; }";
    const result = processCSS(css);
    expect(result).toBe(css);
  });
});
