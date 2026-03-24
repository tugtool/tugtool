/**
 * Generate theme override CSS from a theme JSON file.
 *
 * Usage: bun run scripts/generate-theme-override.ts <theme-json-path> <output-css-path>
 *
 * Runs as a subprocess so vite.config.ts doesn't need to require() theme-engine
 * (which would make the entire recipe chain a config dependency, causing Vite to
 * auto-restart the server on recipe file edits).
 *
 * Also writes a JSON sidecar file at <output-css-path>.formulas.json containing
 * the DerivationFormulas, mode, and themeName for the GET /__themes/formulas endpoint.
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

// Write formulas sidecar for the GET /__themes/formulas endpoint.
try {
  const themeOutput = deriveTheme(parsed as ThemeSpec);
  const themeName = (parsed as ThemeSpec).name || path.basename(jsonPath, ".json");

  // Extract source expressions from the recipe file.
  // The recipe file path is determined from the mode in the theme spec.
  const sources: Record<string, string> = {};
  try {
    const recipeMode = (parsed as ThemeSpec).mode;
    const recipePath = path.resolve(path.dirname(outputPath), "..", "src", "components", "tugways", "recipes", `${recipeMode}.ts`);
    const recipeContent = fs.readFileSync(recipePath, "utf-8");
    // Extract all formula field assignments.
    // Match lines like: `  fieldName: expression,` or `  fieldName: expression`
    // Regex: capture field name and RHS expression text.
    const assignmentRegex = /^\s*(\w+)\s*:\s*(.+?)[\s,]*$/gm;
    let match: RegExpExecArray | null;
    while ((match = assignmentRegex.exec(recipeContent)) !== null) {
      const field = match[1];
      const rhs = match[2].trim().replace(/,\s*$/, "");
      if (field && rhs) {
        // Only record if this field appears in the formulas output
        if (Object.prototype.hasOwnProperty.call(themeOutput.formulas, field)) {
          sources[field] = rhs;
        }
      }
    }
  } catch {
    // Recipe source extraction failed — sources will be empty, fields will be read-only.
  }

  const formulasJson = JSON.stringify({
    formulas: themeOutput.formulas,
    sources,
    mode: (parsed as ThemeSpec).mode,
    themeName,
  });
  fs.writeFileSync(outputPath + ".formulas.json", formulasJson, "utf-8");
} catch {
  // Formulas sidecar write failed — inspector will show without formula section.
}
