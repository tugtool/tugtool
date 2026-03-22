#!/usr/bin/env bun
/**
 * generate-tug-tokens.ts
 *
 * Generates ALL --tug-* tokens for every built-in theme recipe.
 *
 * Brio (default dark):
 *   styles/tug-base-generated.css — imported by tug-base.css via @import.
 *   Contains bare custom property declarations (2-space indent) inside
 *   the body {} context of tug-base.css.
 *
 * Non-default themes (e.g. harmony):
 *   styles/themes/<name>.css — standalone override files. Each file wraps
 *   all 373 tokens in a body {} block. When injected as a <style> element
 *   after tug-base.css, the cascade overrides all brio defaults. [D01]
 *
 * Usage:
 *   bun run scripts/generate-tug-tokens.ts
 *
 * Or via package.json:
 *   bun run generate:tokens
 *   bun run generate:control-tokens  (alias for backward compat)
 */

import path from "path";
import type { ThemeRecipe } from "../src/components/tugways/theme-engine";
import { generateThemeCSS } from "../src/theme-css-generator";

const tugdeckDir = path.resolve(import.meta.dir, "..");
const themesJsonDir = path.join(tugdeckDir, "themes");
const themesDir = path.join(tugdeckDir, "styles", "themes");

// ---------------------------------------------------------------------------
// Discover all theme JSON files via Bun's built-in glob
// ---------------------------------------------------------------------------

const glob = new Bun.Glob("*.json");
const themeFiles = (await Array.fromAsync(glob.scan({ cwd: themesJsonDir }))).sort();

if (themeFiles.length === 0) {
  console.error("[generate-tug-tokens] No theme JSON files found in", themesJsonDir);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Generate CSS for each discovered theme
// ---------------------------------------------------------------------------

for (const themeFileName of themeFiles) {
  const themeFilePath = path.join(themesJsonDir, themeFileName);
  const recipe = (await Bun.file(themeFilePath).json()) as ThemeRecipe;
  const css = generateThemeCSS(recipe);
  const tokenCount = (css.match(/--tug-/g) ?? []).length;

  if (recipe.name === "brio") {
    // Brio is the base theme — write to tug-base-generated.css
    const generatedCssPath = path.join(tugdeckDir, "styles", "tug-base-generated.css");
    await Bun.write(generatedCssPath, css);
    console.log(
      `[generate-tug-tokens] wrote ${tokenCount} tokens to ${generatedCssPath}`,
    );
  } else {
    // Non-brio themes — write to styles/themes/<name>.css
    const themeCssPath = path.join(themesDir, `${recipe.name}.css`);
    await Bun.write(themeCssPath, css);
    console.log(
      `[generate-tug-tokens] wrote ${tokenCount} tokens to ${themeCssPath}`,
    );
  }
}
