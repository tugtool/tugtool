/**
 * verify-tug-color-lossless — Prove the intensity/tone → l/c migration changes no pixels.
 *
 * The migration is only safe if every --tug-color() call expands to the IDENTICAL
 * oklch() value before and after. Because the engine itself is rewritten mid-migration,
 * this runs in two ordered modes around a saved baseline:
 *
 *   1. snapshot  (run FIRST, on the pristine tree, current i/t engine)
 *        Expands every target CSS file through the live postcss-tug-color plugin and
 *        records the ordered list of resulting oklch(...) tokens per file into
 *        scripts/.tug-color-baseline.json.
 *
 *   2. check     (run LAST, after the converter + new l/c engine have landed)
 *        Re-expands the migrated CSS through the (now l/c) plugin and asserts the
 *        ordered oklch token list matches the baseline exactly, file by file, site
 *        by site. Any drift prints the first mismatch and exits non-zero.
 *
 * Usage:
 *   bun run scripts/verify-tug-color-lossless.ts snapshot
 *   bun run scripts/verify-tug-color-lossless.ts check
 */

import fs from "fs";
import path from "path";
import postcss from "postcss";
import tugColorPlugin from "../postcss-tug-color";

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".tug-color-baseline.json");

const TARGET_FILES = [
  "styles/themes/aria.css",
  "styles/themes/bravura.css",
  "styles/themes/brio.css",
  "styles/themes/harmony.css",
  "styles/themes/nocturne.css",
  "styles/themes/vivace.css",
  "styles/tug.css",
  "src/components/tugways/tug-code.css",
  "src/components/tugways/tug-data.css",
  "src/components/tugways/tug-dialog.css",
  "src/components/tugways/tug-dock.css",
];

/**
 * Normalize an oklch token for pixel-equality comparison: when chroma is 0 the hue
 * angle does not affect the rendered color, so zero it. (The i/t engine emitted a
 * leftover hue on zero-chroma colors; the l/c form collapses them to gray.)
 */
function normalizeOklch(tok: string): string {
  const m = tok.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(\/\s*[\d.]+)?\s*\)/);
  if (!m) return tok;
  const [, L, C, h, alpha] = m;
  const hue = parseFloat(C) === 0 ? "0" : h;
  return `oklch(${L} ${C} ${hue}${alpha ? ` ${alpha.replace(/\s+/g, " ")}` : ""})`;
}

/** Expand a CSS file through the plugin and return every oklch(...) token in source order. */
async function expandOklch(rel: string): Promise<string[]> {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf-8");
  const out = await postcss([tugColorPlugin()]).process(src, { from: abs });
  const tokens: string[] = [];
  // Walk declaration values in document order so the token list is stable.
  out.root.walkDecls((decl) => {
    const m = decl.value.match(/oklch\([^)]*\)/g);
    if (m) tokens.push(...m.map(normalizeOklch));
  });
  return tokens;
}

async function snapshot() {
  const data: Record<string, string[]> = {};
  for (const rel of TARGET_FILES) {
    data[rel] = await expandOklch(rel);
  }
  fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2), "utf-8");
  const total = Object.values(data).reduce((n, a) => n + a.length, 0);
  console.log(`Baseline written: ${TARGET_FILES.length} files, ${total} oklch tokens → ${path.relative(ROOT, BASELINE)}`);
}

async function check() {
  if (!fs.existsSync(BASELINE)) {
    console.error("No baseline found. Run `snapshot` on the pristine tree first.");
    process.exit(1);
  }
  const base: Record<string, string[]> = JSON.parse(fs.readFileSync(BASELINE, "utf-8"));
  let failures = 0;
  let checked = 0;
  for (const rel of TARGET_FILES) {
    const now = await expandOklch(rel);
    // Baseline was captured pre-normalization; normalize it the same way here.
    const before = (base[rel] ?? []).map(normalizeOklch);
    if (now.length !== before.length) {
      console.error(`✗ ${rel}: token count ${before.length} → ${now.length}`);
      failures++;
      continue;
    }
    for (let i = 0; i < now.length; i++) {
      checked++;
      if (now[i] !== before[i]) {
        console.error(`✗ ${rel} [#${i}]: ${before[i]}  →  ${now[i]}`);
        failures++;
        if (failures > 20) {
          console.error("… more than 20 mismatches, stopping.");
          process.exit(1);
        }
      }
    }
  }
  if (failures === 0) {
    console.log(`✓ Lossless: ${checked} oklch tokens identical across ${TARGET_FILES.length} files.`);
  } else {
    console.error(`\n${failures} mismatch(es) — migration is NOT lossless.`);
    process.exit(1);
  }
}

const mode = process.argv[2];
if (mode === "snapshot") {
  void snapshot();
} else if (mode === "check") {
  void check();
} else {
  console.error("Usage: verify-tug-color-lossless.ts <snapshot|check>");
  process.exit(1);
}
