/**
 * tug-color-spec.ts — the TugColor value the color well / picker edit, plus the
 * pure helpers to paint it and print it.
 *
 * A spec is hue + intensity + tone + alpha in TugColor units (per
 * tuglaws/color-palette.md) — never raw oklch. Swatches resolve through the
 * palette engine (adjacency- and P3-aware); text prints as `tug(hue, i, t, a)`.
 */

import {
  resolveTugColorToOklch,
  MAX_CHROMA_FOR_HUE,
  PEAK_C_SCALE,
  DEFAULT_CANONICAL_L,
  L_DARK,
  L_LIGHT,
  type ResolvedOklch,
} from "./palette-engine";

/** A TugColor value: a hue (optionally adjacent) with i / t / a in 0–100. */
export interface TugColorSpec {
  hue: string;
  /** Optional adjacency partner — `blue-cobalt`. */
  adjacent?: string;
  /** Intensity 0–100. */
  i: number;
  /** Tone 0–100. */
  t: number;
  /** Alpha 0–100 (100 = opaque). */
  a: number;
}

export const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Normalize a spec's axes into range. */
export function normalizeSpec(s: TugColorSpec): TugColorSpec {
  return { hue: s.hue, adjacent: s.adjacent, i: clamp100(s.i), t: clamp100(s.t), a: clamp100(s.a) };
}

/** A CSS `oklch(...)` string for the spec — adjacency- and P3-aware, alpha-honoring. */
export function swatchOklch(s: TugColorSpec): string {
  const r: ResolvedOklch = resolveTugColorToOklch(s.hue, s.adjacent, s.i, s.t, s.a);
  const fmt = (n: number): string => parseFloat(n.toFixed(4)).toString();
  const head = `oklch(${fmt(r.L)} ${fmt(r.C)} ${fmt(r.h)}`;
  return r.alpha >= 1 ? `${head})` : `${head} / ${fmt(r.alpha)})`;
}

/** The hue token as written — `blue` or `blue-cobalt`. */
export function hueText(s: TugColorSpec): string {
  return s.adjacent ? `${s.hue}-${s.adjacent}` : s.hue;
}

/** Value text: `tug(blue, i:50, t:50, a:100)` — labeled axes, alpha always shown. */
export function formatTugColorText(s: TugColorSpec): string {
  return `tug(${hueText(s)}, i:${clamp100(s.i)}, t:${clamp100(s.t)}, a:${clamp100(s.a)})`;
}

/** Equality on the four axes (+ hue) — used to skip no-op store writes. */
export function specsEqual(a: TugColorSpec, b: TugColorSpec): boolean {
  return a.hue === b.hue && (a.adjacent ?? "") === (b.adjacent ?? "") &&
    a.i === b.i && a.t === b.t && a.a === b.a;
}

// ---------------------------------------------------------------------------
// Perceptual axes — absolute OKLCH chroma (C) and lightness (L).
//
// Intensity and tone are GAMUT-relative (i → this hue's chroma ceiling, t →
// this hue's canonical lightness), so equal i/t across hues is NOT equal
// perceived saturation/lightness. C and L are the absolute, cross-hue-uniform
// view: the same C reads as the same saturation on any hue. These convert
// between the two so the picker can edit either. Base-hue accurate; adjacency
// uses the base hue's ceiling (the grid edits base hues).
// ---------------------------------------------------------------------------

/** This hue's absolute chroma ceiling (the C at i = 100). */
export function peakChromaFor(s: TugColorSpec): number {
  return (MAX_CHROMA_FOR_HUE[s.hue] ?? 0.022) * PEAK_C_SCALE;
}

/** The spec's absolute OKLCH chroma. */
export function chromaOf(s: TugColorSpec): number {
  return resolveTugColorToOklch(s.hue, s.adjacent, s.i, s.t, s.a).C;
}

/** The spec's absolute OKLCH lightness. */
export function lightnessOf(s: TugColorSpec): number {
  return resolveTugColorToOklch(s.hue, s.adjacent, s.i, s.t, s.a).L;
}

/** Back-solve the intensity that yields absolute chroma `C` on the spec's hue. */
export function intensityForChroma(s: TugColorSpec, c: number): number {
  const peak = peakChromaFor(s);
  return peak <= 0 ? s.i : clamp100((c / peak) * 100);
}

/** Back-solve the tone that yields absolute lightness `L` on the spec's hue
 *  (inverse of the piecewise tone→L mapping through the hue's canonical L). */
export function toneForLightness(s: TugColorSpec, l: number): number {
  const canonicalL = DEFAULT_CANONICAL_L[s.hue] ?? 0.77;
  const t = l <= canonicalL
    ? ((l - L_DARK) / (canonicalL - L_DARK)) * 50
    : 50 + ((l - canonicalL) / (L_LIGHT - canonicalL)) * 50;
  return clamp100(t);
}
