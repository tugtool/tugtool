import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const BASE_CSS = path.join(ROOT, "styles", "tug-base-generated.css");
const THEMES_DIR = path.join(ROOT, "styles", "themes");
const OUT_FILE = path.join(ROOT, "src", "generated", "tug-token-names.ts");

function collectCssFiles(): string[] {
  const files: string[] = [BASE_CSS];
  for (const name of fs.readdirSync(THEMES_DIR)) {
    if (name.endsWith(".css")) {
      files.push(path.join(THEMES_DIR, name));
    }
  }
  return files;
}

function extractTokenNames(cssText: string): string[] {
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, " ");
  const matches = withoutComments.matchAll(/--tug-[a-z0-9-]+(?=\s*:)/g);
  const names: string[] = [];
  for (const match of matches) {
    names.push(match[0]);
  }
  return names;
}

function main(): void {
  const all = new Set<string>();
  for (const file of collectCssFiles()) {
    const text = fs.readFileSync(file, "utf-8");
    for (const name of extractTokenNames(text)) {
      all.add(name);
    }
  }
  const names = [...all].sort();
  const out = [
    "/**",
    " * tug-token-names.ts — GENERATED token inventory for Theme Accessibility.",
    " * Source scan: styles/tug-base-generated.css + styles/themes/*.css",
    " */",
    "",
    "export const TUG_TOKEN_NAMES: readonly string[] = [",
    ...names.map((name) => `  \"${name}\",`),
    "];",
    "",
  ].join("\n");
  fs.writeFileSync(OUT_FILE, out, "utf-8");
  // eslint-disable-next-line no-console
  console.log(`Generated ${names.length} --tug-* names -> ${path.relative(ROOT, OUT_FILE)}`);
}

main();
