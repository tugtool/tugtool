/**
 * Generate theme override CSS from a theme JSON file.
 *
 * Usage: bun run scripts/generate-theme-override.ts <theme-json-path> <output-css-path>
 *
 * Runs as a subprocess so vite.config.ts doesn't need to require() theme-engine
 * (which would make the entire recipe chain a config dependency, causing Vite to
 * auto-restart the server on recipe file edits).
 *
 * Outputs a JSON object to stdout with { formulas, mode, themeName } for the
 * GET /__themes/formulas endpoint. The caller (vite.config.ts) captures this
 * to populate formulasCache.
 */

import { generateThemeCSS } from "../src/theme-css-generator";
import { deriveTheme } from "../src/components/tugways/theme-engine";
import type { ThemeSpec } from "../src/components/tugways/theme-engine";
import * as fs from "fs";
import * as path from "path";

const [jsonPath, outputPath] = process.argv.slice(2);

if (!jsonPath || !outputPath) {
  console.error("Usage: generate-theme-override.ts <theme-json-path> <output-css-path>");
  process.exit(1);
}

const raw = fs.readFileSync(jsonPath, "utf-8");
let parsed = JSON.parse(raw) as ThemeSpec & { mode: unknown };

// Legacy migration guard: detect old format where mode is a stringified JSON blob.
if (typeof parsed.mode === "string" && (parsed.mode as string).startsWith("{")) {
  let unwrapped: ThemeSpec;
  try {
    unwrapped = JSON.parse(parsed.mode as string) as ThemeSpec;
  } catch {
    console.error(`Theme has corrupt recipe data in ${jsonPath}`);
    process.exit(1);
  }
  // Rewrite file in canonical format (best-effort).
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(unwrapped, null, 2), "utf-8");
  } catch {
    // Rewrite failed — theme still works for this session.
  }
  parsed = unwrapped as typeof parsed;
}

const css = generateThemeCSS(parsed as ThemeSpec);
fs.writeFileSync(outputPath, css, "utf-8");

// Output formulas JSON to stdout for the caller (vite.config.ts) to populate formulasCache.
try {
  const themeOutput = deriveTheme(parsed as ThemeSpec);
  const themeName = (parsed as ThemeSpec).name || path.basename(jsonPath, ".json");
  const formulasJson = JSON.stringify({
    formulas: themeOutput.formulas,
    mode: (parsed as ThemeSpec).mode,
    themeName,
  });
  process.stdout.write(formulasJson + "\n");
} catch {
  // Formulas output failed — caller will leave formulasCache null.
}
