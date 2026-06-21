/**
 * theme-editor-core.ts — shared Key/Accent re-hue transform.
 *
 * Single source of truth for classifying a theme's selection/action axis (Key)
 * and affordance axis (Accent) tokens and re-hueing them on the TugColor model.
 * Used by:
 *   - scripts/apply-theme-editor.ts (CLI)
 *   - the dev-server POST /__theme-editor/apply endpoint (vite.config.ts), driven
 *     by the Theme Editor card's Apply button
 *
 * Re-hue is always computed from a clean BASELINE recipe (the original per-theme
 * intensities/tones, captured in styles/themes/theme-editor-baseline.json) so
 * applying repeatedly with new hues/scales never compounds — each apply is absolute.
 */

import { HUE_FAMILIES, TUG_COLOR_PRESETS } from "./src/components/tugways/palette-engine";

const CHROMATIC = new Set(Object.keys(HUE_FAMILIES));

/** A chrome treatment — a TugColor of the Key hue with its own intensity / tone (/ alpha). */
export interface DuetTreatment {
  i: number;
  t: number;
  a?: number;
}

export interface DuetSeed {
  keyHue: string;
  keyScale: number;
  /** Tone (lightness) offset added to every Key rung's tone, clamped 0–100. */
  keyToneShift?: number;
  accentHue: string;
  accentScale: number;
  /** Tone (lightness) offset added to every Accent rung's tone, clamped 0–100. */
  accentToneShift?: number;
  /** Title bar / active tab tint (writes --tugx-chrome-key-surface where present). */
  titlebar?: DuetTreatment;
  /** Filled buttons (filled-action surface + border). */
  filled?: DuetTreatment;
  /** Tinted badges (tinted-action surface + border). */
  tinted?: DuetTreatment;
  /**
   * Text-selection wash — the Key-hued fill behind selected text and the
   * editing caret (writes --tug7-surface-selection-primary-normal-plain-rest).
   * Its own intensity / tone / alpha off the Key hue, independent of the rest
   * of the Key ramp.
   */
  textsel?: DuetTreatment;
}

/** The single token the text-selection treatment owns. */
const TEXTSEL_TOKEN = "--tug7-surface-selection-primary-normal-plain-rest";

/**
 * Which treatment a token belongs to (surface/border only — text/icon stay
 * neutral). Covers BOTH the control family (TugPushButton) and the badge family
 * (TugBadge) so buttons and badges driven by one treatment look identical at rest.
 */
function treatmentGroup(name: string): "filled" | "tinted" | null {
  const isSurfaceOrBorder =
    name.includes("surface-control") || name.includes("element-control-border") ||
    name.includes("surface-badge") || name.includes("element-badge-border");
  if (!isSurfaceOrBorder) return null;
  if (name.includes("filled-action")) return "filled";
  if (name.includes("tinted-action")) return "tinted";
  return null;
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
  // Clamp every axis to its valid --tug-color() range — treatment deltas (e.g.
  // filled rest + active delta) and chroma scaling can otherwise overshoot and
  // the postcss plugin rejects the value.
  const clamp = (n: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(n)));
  const parts = [`i: ${clamp(i, 100)}`, `t: ${clamp(t, 100)}`];
  if (a !== null) parts.push(`a: ${clamp(a, 100)}`);
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

  const replaceToken = (name: string, value: string): boolean => {
    const tokenRe = new RegExp(
      `(${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\s*:\\s*)--tug-color\\([^)]*\\)(\\s*;)`,
    );
    if (!tokenRe.test(css)) return false;
    css = css.replace(tokenRe, `$1${value}$2`);
    return true;
  };

  for (const [name, inner] of Object.entries(baseline)) {
    const role = classifyRole(name);
    if (!role) continue;
    const parsed = parseTugColor(inner);
    if (!parsed) continue;

    // Text-selection treatment owns the plain-rest wash directly: a TugColor of
    // the Key hue at its own i / t / a (alpha in 0–1 oklch convention, scaled to
    // --tug-color()'s 0–100). Overrides the generic Key re-hue for this one token.
    if (seed.textsel && name === TEXTSEL_TOKEN) {
      const a = seed.textsel.a !== undefined ? seed.textsel.a * 100 : parsed.a;
      if (replaceToken(name, formatTugColor(seed.keyHue, seed.textsel.i, seed.textsel.t, a))) {
        keyCount++;
      }
      continue;
    }

    // Chrome treatments override the Key re-hue for the filled/tinted surface +
    // border tokens: a TugColor of the Key hue at the treatment's own i/t, with
    // hover/active/disabled keeping their baseline tone/intensity delta from rest
    // so the interaction ramp survives. Text/icon stay on the normal Key re-hue.
    const tg = treatmentGroup(name);
    const tr = tg ? seed[tg] : undefined;
    if (tg && tr) {
      const restName = name.replace(/-(hover|active|disabled)$/, "-rest");
      const baseThis = parsed;
      const baseRest = parseTugColor(baseline[restName] ?? inner);
      if (baseRest) {
        const di = baseThis.i - baseRest.i;
        const dt = baseThis.t - baseRest.t;
        const i = tr.i + di;
        const t = Math.max(0, Math.min(100, tr.t + dt));
        // Tinted surface rest takes the treatment's alpha; everything else keeps
        // its own baseline alpha (so border/hover translucency is preserved).
        // Treatment alpha is 0–1 (oklch convention); --tug-color() wants 0–100,
        // so scale it up — the source of the "transparent at rest" bug.
        let alpha = baseThis.a;
        if (tg === "tinted" && name === restName && name.includes("surface")) {
          alpha = tr.a !== undefined ? tr.a * 100 : baseThis.a;
        }
        if (replaceToken(name, formatTugColor(seed.keyHue, i, t, alpha))) keyCount++;
        continue;
      }
    }

    const hue = role === "key" ? seed.keyHue : seed.accentHue;
    const scale = role === "key" ? seed.keyScale : seed.accentScale;
    const toneShift = (role === "key" ? seed.keyToneShift : seed.accentToneShift) ?? 0;
    const tone = Math.max(0, Math.min(100, parsed.t + toneShift));
    const rewritten = formatTugColor(hue, parsed.i * scale, tone, parsed.a);
    if (replaceToken(name, rewritten)) {
      if (role === "key") keyCount++;
      else accentCount++;
    }
  }

  // Title-bar treatment — a single token (--tugx-chrome-key-surface), present
  // only in the light themes. Written directly (no baseline; no states).
  if (seed.titlebar) {
    replaceToken(
      "--tugx-chrome-key-surface",
      formatTugColor(seed.keyHue, seed.titlebar.i, seed.titlebar.t, seed.titlebar.a ?? null),
    );
  }

  return { css, keyCount, accentCount };
}

/** Validate a hue name is a known TugColor hue. */
export function isKnownHue(hue: string): boolean {
  return CHROMATIC.has(hue);
}
