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
