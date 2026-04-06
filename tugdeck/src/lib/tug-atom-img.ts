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
  command: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  doc: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

// ---- Layout constants ----

const FONT_SIZE = 12;
const FONT_FAMILY = "system-ui, sans-serif";
const ICON_SIZE = 12;
const PADDING = 6;
const GAP = 4;
const HEIGHT = 22;

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

const _font = `${FONT_SIZE}px ${FONT_FAMILY}`;

/** Truncate text to fit within maxWidth, appending "…" if needed. */
function truncateLabel(label: string, maxWidth: number): string {
  if (measureTextWidth(label, _font) <= maxWidth) return label;
  const ellipsis = "…";
  const ellipsisW = measureTextWidth(ellipsis, _font);
  let lo = 1, hi = label.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (measureTextWidth(label.slice(0, mid), _font) + ellipsisW <= maxWidth) {
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
  const textWidth = measureTextWidth(displayLabel, _font);
  const w = PADDING + ICON_SIZE + GAP + Math.ceil(textWidth) + PADDING;
  const icon = `<g transform="translate(${PADDING},${(HEIGHT - ICON_SIZE) / 2}) scale(${ICON_SIZE / 24})" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${HEIGHT - 1}" rx="3" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>`,
    icon,
    `<text x="${PADDING + ICON_SIZE + GAP}" y="${HEIGHT / 2 + FONT_SIZE * 0.36}" font-size="${FONT_SIZE}" font-family="${FONT_FAMILY}" fill="${textColor}">${escapeSVG(displayLabel)}</text>`,
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
  img.height = HEIGHT;
  img.style.verticalAlign = "-6px";
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
  const textWidth = measureTextWidth(char, _font);
  const padding = 5;
  const w = padding + Math.ceil(textWidth) + padding;

  const bgColor = getTokenValue("--tug7-surface-atom-primary-normal-route-rest");
  const borderColor = getTokenValue("--tug7-element-atom-border-normal-route-rest");
  const textColor = getTokenValue("--tug7-element-atom-text-normal-route-rest");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" viewBox="0 0 ${w} ${HEIGHT}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${HEIGHT - 1}" rx="3" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>`,
    `<text x="${w / 2}" y="${HEIGHT / 2 + FONT_SIZE * 0.36}" font-size="${FONT_SIZE}" font-weight="600" font-family="${FONT_FAMILY}" fill="${textColor}" text-anchor="middle">${escapeSVG(char)}</text>`,
    `</svg>`,
  ].join("");

  const img = document.createElement("img");
  img.src = svgToDataURI(svg);
  img.width = w;
  img.height = HEIGHT;
  img.style.verticalAlign = "-6px";
  img.style.margin = "0 2px";
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
