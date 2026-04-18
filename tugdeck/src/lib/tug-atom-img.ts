/**
 * tug-atom-img.ts — Atom rendering as <img> elements with SVG data URIs.
 *
 * Atoms are replaced elements — WebKit treats them as atomic inline units.
 * Caret navigation, selection, undo, and clipboard all work natively.
 * No contentEditable="false", no ZWSP, no caret fixup.
 *
 * Each atom is an <img> with data attributes:
 *   data-atom-type, data-atom-label, data-atom-value
 *
 * Colors read from theme tokens via getTokenValue. SVG is regenerated
 * on theme change (see TugTextEngine.regenerateAtoms).
 */

import { getTokenValue } from "@/theme-tokens";

// ---- Types ----

/** U+FFFC — Object Replacement Character representing an atom in the text flow. */
export const TUG_ATOM_CHAR = "\uFFFC";

/** Segment type used by TugTextEngine. */
export interface AtomSegment {
  kind: "atom";
  type: string;
  label: string;
  value: string;
}

/** Label display mode for file paths. */
export type AtomLabelMode = "filename" | "relative" | "absolute";

/** Options for createAtomImgElement. */
export interface AtomImgOptions {
  /** Maximum label width in pixels before truncation with ellipsis. */
  maxLabelWidth?: number;
}

// ---- SVG helpers ----

/** Escape text for safe interpolation into SVG/XML markup. */
function escapeSVG(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Lucide-style icon paths (24x24 viewBox) for atom types. */
const ATOM_ICON_PATHS: Record<string, string> = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  command: '<path d="m5 19 14-14"/>',
  doc: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

// ---- Layout constants ----

let _fontSize = 12;
let _editorFontSize = 14;
/** Font family for Canvas measurement (can include custom fonts). */
let _measureFamily = "system-ui, sans-serif";
/** Font family for SVG markup (must use generic families — custom fonts
 *  loaded via @font-face are not available inside data-URI SVGs). */
let _svgFamily = "system-ui, sans-serif";
/** Atom layout dimensions, scaled from the current _fontSize. */
function atomHeight(): number { return Math.round(_fontSize * 1.75); }
function iconSize(): number { return _fontSize; }
const PADDING = 6;
const GAP = 4;

/**
 * Set the font used for atom label rendering and measurement.
 * `family` is the full CSS font-family stack (e.g. `"Hack", monospace`).
 * The SVG font is derived by stripping custom font names and keeping
 * only generic families that work inside data-URI SVGs.
 * Call this when the editor font changes, then regenerateAtoms().
 */
export function setAtomFont(family: string, size?: number): void {
  _measureFamily = family;
  // Keep only generic CSS font families for SVG rendering.
  const generics = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"]);
  const svgParts = family.split(",")
    .map(s => s.replace(/"/g, "").trim())
    .filter(s => generics.has(s));
  _svgFamily = svgParts.length > 0 ? svgParts.join(", ") : "sans-serif";
  // Atom label font matches the editor font size so atom and surrounding
  // text share the same x-height and baseline.
  if (size !== undefined) {
    _editorFontSize = size;
    _fontSize = size;
  }
}

/**
 * vertical-align offset (px) so the atom's internal text baseline aligns
 * with the surrounding text baseline. The SVG draws label text with its
 * baseline at `atomHeight/2 + _fontSize * 0.32` from the top of the box,
 * so the IMG's bottom must sit `atomHeight/2 - _fontSize * 0.32` below
 * the parent baseline — i.e. a negative vertical-align of that magnitude.
 */
function atomBaselineOffset(): number {
  return Math.round(_fontSize * 0.32 - atomHeight() / 2);
}

// ---- Text measurement ----

/** Shared canvas for text measurement. */
let _measureCanvas: HTMLCanvasElement | null = null;

/** Measure text width using Canvas 2D API. */
function measureTextWidth(text: string, font: string): number {
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Current atom font as a CSS font shorthand (for Canvas measurement). */
function atomFont(): string {
  return `${_fontSize}px ${_measureFamily}`;
}

/** Truncate text to fit within maxWidth, appending "…" if needed. */
function truncateLabel(label: string, maxWidth: number): string {
  if (measureTextWidth(label, atomFont()) <= maxWidth) return label;
  const ellipsis = "…";
  const font = atomFont();
  const ellipsisW = measureTextWidth(ellipsis, font);
  let lo = 1, hi = label.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (measureTextWidth(label.slice(0, mid), font) + ellipsisW <= maxWidth) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return label.slice(0, best) + ellipsis;
}

// ---- SVG generation ----

/** Build the SVG data URI for an atom with a given icon path and display label. */
function buildAtomSVG(
  iconPath: string,
  displayLabel: string,
  bgColor: string,
  borderColor: string,
  iconColor: string,
  textColor: string,
): { svg: string; width: number } {
  const font = atomFont();
  const textWidth = measureTextWidth(displayLabel, font);
  const w = PADDING + iconSize() + GAP + Math.ceil(textWidth) + PADDING;
  const icon = `<g transform="translate(${PADDING},${(atomHeight() - iconSize()) / 2}) scale(${iconSize() / 24})" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${atomHeight()}" viewBox="0 0 ${w} ${atomHeight()}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${atomHeight() - 1}" rx="3" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>`,
    icon,
    `<text x="${PADDING + iconSize() + GAP}" y="${atomHeight() / 2 + _fontSize * 0.32}" font-size="${_fontSize}" font-family="${_svgFamily}" fill="${textColor}">${escapeSVG(displayLabel)}</text>`,
    `</svg>`,
  ].join("");
  return { svg, width: w };
}

function svgToDataURI(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// ---- Public API ----

/** Create an atom <img> element with SVG data URI. */
export function createAtomImgElement(
  type: string,
  label: string,
  value: string,
  options?: AtomImgOptions,
): HTMLImageElement {
  const displayLabel = options?.maxLabelWidth != null ? truncateLabel(label, options.maxLabelWidth) : label;

  const bgColor = getTokenValue("--tug7-surface-atom-primary-normal-default-rest");
  const borderColor = getTokenValue("--tug7-element-atom-border-normal-default-rest");
  const iconColor = getTokenValue("--tug7-element-atom-icon-normal-default-rest");
  const textColor = getTokenValue("--tug7-element-atom-text-normal-default-rest");

  const iconPath = ATOM_ICON_PATHS[type] ?? ATOM_ICON_PATHS.file;
  const { svg, width } = buildAtomSVG(iconPath, displayLabel, bgColor, borderColor, iconColor, textColor);

  const img = document.createElement("img");
  img.src = svgToDataURI(svg);
  img.width = width;
  img.height = atomHeight();
  img.style.verticalAlign = `${atomBaselineOffset()}px`;
  img.style.margin = "0 2px";
  img.dataset.atomType = type;
  img.dataset.atomLabel = label;
  img.dataset.atomValue = value;
  img.title = value;

  return img;
}

/** Create atom img as HTML string (for execCommand insertHTML). */
export function atomImgHTML(type: string, label: string, value?: string): string {
  const el = createAtomImgElement(type, label, value ?? label);
  const wrapper = document.createElement("div");
  wrapper.appendChild(el);
  return wrapper.innerHTML;
}

/** Create a route atom <img> element — a compact styled indicator for the active route. */
export function createRouteAtomImgElement(char: string): HTMLImageElement {
  const textWidth = measureTextWidth(char, atomFont());
  const padding = 5;
  const w = padding + Math.ceil(textWidth) + padding;

  const bgColor = getTokenValue("--tug7-surface-atom-primary-normal-route-rest");
  const borderColor = getTokenValue("--tug7-element-atom-border-normal-route-rest");
  const textColor = getTokenValue("--tug7-element-atom-text-normal-route-rest");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${atomHeight()}" viewBox="0 0 ${w} ${atomHeight()}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${atomHeight() - 1}" rx="3" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>`,
    `<text x="${w / 2}" y="${atomHeight() / 2 + _fontSize * 0.32}" font-size="${_fontSize}" font-weight="600" font-family="${_svgFamily}" fill="${textColor}" text-anchor="middle">${escapeSVG(char)}</text>`,
    `</svg>`,
  ].join("");

  const img = document.createElement("img");
  img.src = svgToDataURI(svg);
  img.width = w;
  img.height = atomHeight();
  img.style.verticalAlign = `${atomBaselineOffset()}px`;
  // Right-only margin. Route atoms always sit at text position 0, so a
  // left margin just pushes them off the editor's padding edge — zero
  // it. The right margin creates a small visual gap between the atom
  // and the caret that naturally sits at position 1 next to it.
  img.style.margin = "0 4px 0 0";
  img.dataset.atomType = "route";
  img.dataset.atomLabel = char;
  img.dataset.atomValue = char;
  img.title = char;
  return img;
}

/** Create route atom as HTML string (for execCommand insertHTML). */
export function routeAtomImgHTML(char: string): string {
  const el = createRouteAtomImgElement(char);
  const wrapper = document.createElement("div");
  wrapper.appendChild(el);
  return wrapper.innerHTML;
}

// ---- Label formatting ----

/**
 * Format an atom value for display as a label.
 *
 * - "filename": last path component (e.g., "main.ts")
 * - "relative": project-relative path (e.g., "src/main.ts")
 * - "absolute": full path as-is
 *
 * For non-path values (URLs, commands), returns the value unchanged.
 */
export function formatAtomLabel(value: string, mode: AtomLabelMode): string {
  if (mode === "absolute") return value;

  // URLs — return as-is for filename mode, or strip protocol for relative
  if (value.startsWith("http://") || value.startsWith("https://")) {
    if (mode === "filename") {
      const url = value.split("?")[0].split("#")[0];
      const lastSlash = url.lastIndexOf("/");
      const filename = lastSlash >= 0 ? url.slice(lastSlash + 1) : url;
      return filename || value;
    }
    return value;
  }

  // Commands — return as-is
  if (value.startsWith("/")) {
    if (mode === "filename") {
      const lastSlash = value.lastIndexOf("/");
      return lastSlash >= 0 && lastSlash < value.length - 1
        ? value.slice(lastSlash + 1)
        : value;
    }
  }

  // File paths
  if (mode === "filename") {
    const lastSlash = value.lastIndexOf("/");
    return lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
  }

  // "relative" — strip leading slash if present
  return value.startsWith("/") ? value.slice(1) : value;
}
