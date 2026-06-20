/**
 * duet-core.ts — shared Key/Accent re-hue transform.
 *
 * Single source of truth for classifying a theme's selection/action axis (Key)
 * and affordance axis (Accent) tokens and re-hueing them on the TugColor model.
 * Used by:
 *   - scripts/apply-duet.ts (CLI)
 *   - the dev-server POST /__duet/apply endpoint (vite.config.ts), driven by the
 *     gallery-color-duet workshop card's Apply button
 *
 * Re-hue is always computed from a clean BASELINE recipe (the original per-theme
 * intensities/tones, captured in styles/themes/duet-baseline.json) so applying
 * repeatedly with new hues/scales never compounds — each apply is absolute.
 */

import { HUE_FAMILIES, TUG_COLOR_PRESETS } from "./src/components/tugways/palette-engine";

const CHROMATIC = new Set(Object.keys(HUE_FAMILIES));

export interface DuetSeed {
  keyHue: string;
  keyScale: number;
  /** Tone (lightness) offset added to every Key rung's tone, clamped 0–100. */
  keyToneShift?: number;
  accentHue: string;
  accentScale: number;
  /** Tone (lightness) offset added to every Accent rung's tone, clamped 0–100. */
  accentToneShift?: number;
}

/** Tokens excluded from any re-hue (signals, neutral tint, on-fill text, incidental). */
function isExcluded(name: string): boolean {
  return (
    name.includes("selection-text") ||
    name.includes("plain-inactive") ||
    name.includes("demoted-danger") ||
    name.includes("demoted-data") ||
    name.includes("demoted-agent") ||
    name.includes("-atom-") ||
    name.includes("ansi") ||
    name.includes("-option-") ||
    name.includes("confirmed") ||
    name.includes("inspector") ||
    name.includes("preview") ||
    name.includes("snap") ||
    name.includes("findmatch")
  );
}

/** Key = the selection / primary-action axis. */
function isKey(name: string): boolean {
  if (
    name.includes("selection-primary-normal-plain-rest") ||
    name.includes("selection-primary-normal-selected-rest") ||
    name.includes("selection-primary-normal-selected-hover") ||
    name.includes("selection-primary-normal-quiet-rest") ||
    name.includes("selection-primary-normal-quiet-hover") ||
    name.includes("selection-primary-normal-quiet-strong") ||
    name.includes("selection-primary-demoted-action")
  ) return true;
  if (name.includes("-tone-") && name.includes("-active-rest")) return true;
  if (name.includes("text-normal-link-rest") || name.includes("text-normal-link-hover")) return true;
  if (name.includes("-action-")) return true;
  if (name.includes("toggle-") && (name.includes("-on-") || name.includes("-active-"))) return true;
  if (name.includes("-normal-highlighted") || name.includes("-normal-selected")) return true;
  if (name.includes("slider-fill-normal-range")) return true;
  if (name.includes("field-border-normal-plain-active")) return true;
  if (name.includes("-drop") && !name.includes("stroke")) return true;
  return false;
}

/** Accent = the affordance axis. */
function isAccent(name: string): boolean {
  if (name.includes("-accent")) return true;
  if (name.includes("highlight-stroke-normal-drop")) return true;
  if (name.includes("shadow-normal-flash")) return true;
  if (name.includes("highlight-primary-normal-flash")) return true;
  return false;
}

export type DuetRole = "key" | "accent" | null;

/** Classify a token name into its duet role (or null = leave alone). */
export function classifyRole(name: string): DuetRole {
  if (isExcluded(name)) return null;
  if (isKey(name)) return "key";
  if (isAccent(name)) return "accent";
  return null;
}

interface Parsed { i: number; t: number; a: number | null; }

/** Parse the inner of `--tug-color(...)`; returns null for achromatic / unknown hues. */
function parseTugColor(inner: string): Parsed | null {
  const parts = inner.split(",").map((s) => s.trim());
  const head = parts[0];
  let i = 50;
  let t = 50;
  let a: number | null = null;
  const segs = head.split("-");
  const hue = segs[0];
  for (let k = 1; k < segs.length; k++) {
    const preset = TUG_COLOR_PRESETS[segs[k]];
    if (preset) {
      i = preset.intensity;
      t = preset.tone;
    }
  }
  for (const p of parts.slice(1)) {
    const m = p.match(/^([ita])\s*:\s*([\d.]+)$/);
    if (!m) continue;
    if (m[1] === "i") i = parseFloat(m[2]);
    if (m[1] === "t") t = parseFloat(m[2]);
    if (m[1] === "a") a = parseFloat(m[2]);
  }
  if (!CHROMATIC.has(hue)) return null;
  return { i, t, a };
}

function formatTugColor(hue: string, i: number, t: number, a: number | null): string {
  const parts = [`i: ${Math.round(i)}`, `t: ${t}`];
  if (a !== null) parts.push(`a: ${a}`);
  return `--tug-color(${hue}, ${parts.join(", ")})`;
}

/**
 * Extract the baseline recipe from a clean (pre-duet) theme CSS: tokenName ->
 * the original `--tug-color(...)` inner, for every duet-classified chromatic token.
 */
export function extractBaseline(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--tug7-[\w-]+)\s*:\s*--tug-color\(([^)]*)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const name = m[1];
    if (classifyRole(name) === null) continue;
    if (parseTugColor(m[2]) === null) continue; // achromatic wash — not part of the duet
    out[name] = m[2].trim();
  }
  return out;
}

/**
 * Apply a duet to a theme's current CSS, computing every duet token absolutely
 * from the baseline recipe (so repeated applies never compound). Returns the new
 * CSS plus counts.
 */
export function applyDuet(
  currentCss: string,
  baseline: Record<string, string>,
  seed: DuetSeed,
): { css: string; keyCount: number; accentCount: number } {
  let css = currentCss;
  let keyCount = 0;
  let accentCount = 0;

  for (const [name, inner] of Object.entries(baseline)) {
    const role = classifyRole(name);
    if (!role) continue;
    const parsed = parseTugColor(inner);
    if (!parsed) continue;
    const hue = role === "key" ? seed.keyHue : seed.accentHue;
    const scale = role === "key" ? seed.keyScale : seed.accentScale;
    const toneShift = (role === "key" ? seed.keyToneShift : seed.accentToneShift) ?? 0;
    const tone = Math.max(0, Math.min(100, parsed.t + toneShift));
    const rewritten = formatTugColor(hue, parsed.i * scale, tone, parsed.a);

    // Replace this token's value in place (first definition wins).
    const tokenRe = new RegExp(
      `(${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:\\s*)--tug-color\\([^)]*\\)(\\s*;)`,
    );
    if (!tokenRe.test(css)) continue;
    css = css.replace(tokenRe, `$1${rewritten}$2`);
    if (role === "key") keyCount++;
    else accentCount++;
  }

  return { css, keyCount, accentCount };
}

/** Validate a hue name is a known TugColor hue. */
export function isKnownHue(hue: string): boolean {
  return CHROMATIC.has(hue);
}
