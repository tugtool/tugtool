/**
 * tug-color-spec.ts — the TugColor value the color well / picker edit, plus the
 * pure helpers to paint it and print it.
 *
 * A spec is hue + lightness + chroma + alpha in OKLCH units (per
 * tuglaws/color-palette.md): `--tug-color()` is thin sugar over `oklch()`, so the
 * spec carries the oklch coordinates directly. Swatches resolve through the palette
 * engine (adjacency-aware); text prints as `tug(hue, l, c, a)`.
 */

import {
  MAX_CHROMA,
  resolveTugColorToOklch,
  type ResolvedOklch,
} from "./palette-engine";

export { MAX_CHROMA };

/** A TugColor value: a hue (optionally adjacent) with oklch l / c / a. */
export interface TugColorSpec {
  hue: string;
  /** Optional adjacency partner — `blue-cobalt`. */
  adjacent?: string;
  /** OKLCH lightness 0–1. */
  l: number;
  /** OKLCH chroma 0–MAX_CHROMA. */
  c: number;
  /** Alpha 0–1 (1 = opaque). */
  a: number;
}

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const clampChroma = (n: number): number => Math.max(0, Math.min(MAX_CHROMA, n));

/** Round to 4 decimals, trailing zeros stripped (matches the postcss formatter). */
const fmt = (n: number): string => parseFloat(n.toFixed(4)).toString();

/** Normalize a spec's axes into range. */
export function normalizeSpec(s: TugColorSpec): TugColorSpec {
  return { hue: s.hue, adjacent: s.adjacent, l: clamp01(s.l), c: clampChroma(s.c), a: clamp01(s.a) };
}

/** A CSS `oklch(...)` string for the spec — adjacency-aware, alpha-honoring. */
export function swatchOklch(s: TugColorSpec): string {
  const r: ResolvedOklch = resolveTugColorToOklch(s.hue, s.adjacent, s.l, s.c, s.a);
  const head = `oklch(${fmt(r.L)} ${fmt(r.C)} ${fmt(r.h)}`;
  return r.alpha >= 1 ? `${head})` : `${head} / ${fmt(r.alpha)})`;
}

/** The hue token as written — `blue` or `blue-cobalt`. */
export function hueText(s: TugColorSpec): string {
  return s.adjacent ? `${s.hue}-${s.adjacent}` : s.hue;
}

/** Value text: `tug(blue, l:0.3, c:0.08, a:1)` — labeled axes, alpha always shown. */
export function formatTugColorText(s: TugColorSpec): string {
  return `tug(${hueText(s)}, l:${fmt(clamp01(s.l))}, c:${fmt(clampChroma(s.c))}, a:${fmt(clamp01(s.a))})`;
}

/** Equality on the three axes (+ hue) — used to skip no-op store writes. */
export function specsEqual(a: TugColorSpec, b: TugColorSpec): boolean {
  return a.hue === b.hue && (a.adjacent ?? "") === (b.adjacent ?? "") &&
    a.l === b.l && a.c === b.c && a.a === b.a;
}
