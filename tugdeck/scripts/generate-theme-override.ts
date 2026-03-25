/**
 * Generate theme override CSS from a theme JSON file.
 *
 * Usage: bun run scripts/generate-theme-override.ts <theme-json-path> <output-css-path>
 *
 * Runs as a subprocess so vite.config.ts doesn't need to require() theme-engine
 * (which would make the entire recipe chain a config dependency, causing Vite to
 * auto-restart the server on recipe file edits).
 */

import { generateThemeCSS } from "../src/theme-css-generator";
import { deriveTheme } from "../src/components/tugways/theme-engine";
import type { ThemeSpec } from "../src/components/tugways/theme-engine";
import * as fs from "fs";

const [jsonPath, outputPath] = process.argv.slice(2);

if (!jsonPath || !outputPath) {
  console.error("Usage: generate-theme-override.ts <theme-json-path> <output-css-path>");
  process.exit(1);
}

const raw = fs.readFileSync(jsonPath, "utf-8");
const spec = JSON.parse(raw) as ThemeSpec;

const css = generateThemeCSS(spec);
fs.writeFileSync(outputPath, css, "utf-8");

// Output canvas params as JSON to stdout for the activate endpoint.
const output = deriveTheme(spec);
const result = {
  theme: spec.name ?? "",
  canvasParams: {
    hue: spec.surface.canvas.hue,
    tone: output.formulas.surfaceCanvasTone,
    intensity: output.formulas.surfaceCanvasIntensity,
  },
};
process.stdout.write(JSON.stringify(result));
