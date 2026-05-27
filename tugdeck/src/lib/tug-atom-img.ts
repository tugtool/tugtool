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
import { findEmbeddableFace } from "./tug-atom-fonts";

// ---- Types ----

/** U+FFFC — Object Replacement Character representing an atom in the text flow. */
export const TUG_ATOM_CHAR = "\uFFFC";

/**
 * Segment type used by TugTextEngine.
 *
 * The optional `id` field is a UUID minted at drop / paste time for
 * image atoms that have associated bytes in the per-card
 * `AtomBytesStore`. Atoms inserted via `@`-completion / typing /
 * legacy paths do not carry an id. The reducer-side substrate, state
 * preservation, and clipboard sidecar all round-trip the field
 * verbatim — present-when-known, absent otherwise.
 *
 * The id pairs an atom (display surface) with its bytes (storage
 * surface). At submit time, `buildWirePayload` consults the
 * bytes-store by id; at transcript-commit time, the same id moves
 * onto `AttachmentRecord.id` for click-to-enlarge lookup. Per
 * [D03](roadmap/tide-atoms.md#d03-atom-bytes-store).
 */
export interface AtomSegment {
  kind: "atom";
  type: string;
  label: string;
  value: string;
  /** UUID minted at drop / paste; pairs the atom with its byte payload. */
  id?: string;
}

/** Label display mode for file paths. */
export type AtomLabelMode = "filename" | "relative" | "absolute";

/** Options for createAtomImgElement. */
export interface AtomImgOptions {
  /** Maximum label width in pixels before truncation with ellipsis. */
  maxLabelWidth?: number;
  /**
   * Atom id (UUID minted at drop / paste). When present, the rendered
   * `<img>` carries a `data-atom-id` attribute the pending-sync
   * `ViewPlugin` keys off when mutating `data-pending` after bytes
   * arrive. Atoms without an id (legacy completion atoms, link /
   * command atoms) don't get this attribute.
   */
  id?: string;
  /**
   * When `true`, the rendered `<img>` carries a `data-pending="true"`
   * attribute. CSS in `atom-decoration.ts`'s `baseTheme` block
   * applies a dimmed + pulsing appearance so the user sees the atom
   * is mid-processing. The pending-sync `ViewPlugin` toggles this
   * attribute via direct DOM mutation when the bytes-store's matching
   * id transitions to "has bytes" — no CM6 widget rebuild, no React.
   * [L06].
   */
  pending?: boolean;
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
/** Font family stack for Canvas measurement and SVG rendering (full stack
 *  including custom @font-face fonts — resolved inside the SVG via inline
 *  @font-face embedding; see tug-atom-fonts.ts). */
let _measureFamily = "system-ui, sans-serif";
/**
 * Atom label rendered as a fraction of the editor font size. SVG text
 * rasterizes slightly heavier than hinted HTML text at the same nominal
 * px, so 1.0 looks oversized against the surrounding text. Shave it to
 * visually match.
 */
const ATOM_LABEL_SIZE_RATIO = 0.96;
/**
 * Pixel height of an atom chip for a given font size — the formula
 * is `round(size * 1.75)`. Exported because consumers that pixel-bake
 * chips (the transcript walker `TugAtomTextBody`) need to publish a
 * matching `line-height` floor so the chip never breaks out of its
 * line-box. Pure — no module state, no DOM access.
 */
export function atomHeightFor(size: number): number { return Math.round(size * 1.75); }
function iconSizeFor(size: number): number { return size; }
/** Module-state versions used by the editor path. */
function atomHeight(): number { return atomHeightFor(_fontSize); }
function iconSize(): number { return iconSizeFor(_fontSize); }
const PADDING = 6;
const GAP = 4;

// ---- Transcript-side chip sizing ----

/**
 * Base font size (in px) for transcript-side atom chips. Transcript
 * chips don't track the user's editor font *size* — that's
 * editor-surface coupling that surprised users (chips visibly
 * shrinking/growing when they bumped their editor font for code
 * legibility). They DO track the user's editor font *family* so the
 * chip still reads as "code-like" alongside surrounding transcript
 * prose. The size is anchored here at 12px and scaled by the
 * transcript's own magnification slider via
 * {@link chipFontSizeForMagnification} below.
 */
export const TRANSCRIPT_CHIP_BASE_FONT_SIZE = 12;
/**
 * Minimum px floor for transcript-side atom chips. Below this the
 * label glyphs lose readable detail (anti-aliasing dominates) and
 * the icon's stroke weight starts vanishing into the chip
 * background. Reached at magnification 9/12 ≈ 0.75.
 */
export const TRANSCRIPT_CHIP_MIN_FONT_SIZE = 9;

/**
 * Compute the chip font size (px) for the transcript-side surfaces
 * given the current transcript magnification value. Pure — no module
 * state, no DOM access. The 12px base ({@link TRANSCRIPT_CHIP_BASE_FONT_SIZE})
 * scales linearly with magnification, floored at the readability
 * threshold ({@link TRANSCRIPT_CHIP_MIN_FONT_SIZE}). Rounded to the
 * nearest pixel so the SVG rasterizes cleanly.
 *
 * Examples (with default 1.0 magnification):
 *   chipFontSizeForMagnification(1.0)  → 12
 *   chipFontSizeForMagnification(1.5)  → 18
 *   chipFontSizeForMagnification(0.5)  → 9 (floor)
 *   chipFontSizeForMagnification(0.75) → 9 (floor)
 *   chipFontSizeForMagnification(0.8)  → 10
 */
export function chipFontSizeForMagnification(magnification: number): number {
  const raw = TRANSCRIPT_CHIP_BASE_FONT_SIZE * magnification;
  return Math.max(TRANSCRIPT_CHIP_MIN_FONT_SIZE, Math.round(raw));
}

/**
 * Current rendered height of an atom widget, in pixels. Derived from
 * `_fontSize` × 1.75 (rounded). Tracks any prior `setAtomFont` call.
 *
 * Substrates that need to floor their line-height to "always tall
 * enough to host an atom" read this value and either pass it as a
 * CSS variable (theme `max(1lh, var(--…))`) or use it directly in JS
 * geometry math (caret-layer row sizing). A function rather than a
 * constant because the atom's intrinsic size moves with `setAtomFont`;
 * callers re-read on prop / theme changes that may have triggered a
 * font swap.
 */
export function getAtomHeightPx(): number {
  return atomHeight();
}

// ---------------------------------------------------------------------------
// L02 atom-font subscription
// ---------------------------------------------------------------------------
//
// React surfaces that render atom chips via JSX (`<TugAtomTextBody>`,
// the assistant-side tool-block path renderers) need to re-bake their
// SVG when the user changes their editor font preference — otherwise
// the chip is stuck on whatever font was active when the component
// first rendered. The editor's CM6 widget has its own refresh path
// (`regenerateAtoms()` busts the widget cache), but React-side `<img>`
// elements just have a `src={dataUri}` prop that doesn't update when
// module-state changes.
//
// This subscription makes the module-level font state L02-compliant:
// {@link subscribeAtomFont} + {@link getAtomFontSnapshot} feed
// `useSyncExternalStore` on React-side surfaces. {@link setAtomFont}
// notifies subscribers after mutating the state. The snapshot is
// reference-stable across calls until the state changes, so
// `useSyncExternalStore` doesn't churn renders on no-op reads.

/**
 * Read-only snapshot of the atom-font state, returned by
 * {@link getAtomFontSnapshot}. Reference-stable across calls until
 * {@link setAtomFont} fires (then a fresh object is minted). The
 * stability contract is load-bearing for `useSyncExternalStore`
 * consumers — without it, React would treat every getSnapshot call
 * as a new value and loop infinitely.
 */
export interface AtomFontSnapshot {
  /** Font family stack — last value passed to {@link setAtomFont}. */
  family: string;
  /** Atom label font size in px (scaled from the editor font size by
   *  `ATOM_LABEL_SIZE_RATIO`). */
  size: number;
}

let _atomFontSnapshot: AtomFontSnapshot = { family: _measureFamily, size: _fontSize };
const _atomFontListeners: Set<() => void> = new Set();

/**
 * Subscribe to atom-font changes. Returns an unsubscribe function.
 * React surfaces compose this with {@link getAtomFontSnapshot} via
 * `useSyncExternalStore` per [L02].
 */
export function subscribeAtomFont(listener: () => void): () => void {
  _atomFontListeners.add(listener);
  return () => { _atomFontListeners.delete(listener); };
}

/**
 * Get the current atom-font snapshot. Reference-stable until
 * {@link setAtomFont} mutates state. Consumers pair this with
 * {@link subscribeAtomFont} in `useSyncExternalStore`.
 */
export function getAtomFontSnapshot(): AtomFontSnapshot {
  return _atomFontSnapshot;
}

/**
 * Set the font used for atom label rendering and measurement.
 * `family` is the full CSS font-family stack (e.g. `"Hack", monospace`).
 * The editor settings store calls this when the user's font preference
 * changes (and at cold-boot construction time so React surfaces don't
 * race against the first paint). All subscribers ({@link subscribeAtomFont})
 * are notified after the state mutation; the editor still calls
 * `regenerateAtoms()` separately to bust CM6's widget cache.
 *
 * A no-op call (same family and size) does not notify subscribers,
 * keeping React surfaces from re-rendering on idempotent applies.
 */
export function setAtomFont(family: string, size?: number): void {
  const nextFamily = family;
  const nextEditorSize = size ?? _editorFontSize;
  const nextSize = size !== undefined
    ? Math.round(size * ATOM_LABEL_SIZE_RATIO)
    : _fontSize;
  if (nextFamily === _measureFamily && nextSize === _fontSize) {
    // No-op apply — skip the notification so subscribers don't churn.
    return;
  }
  _measureFamily = nextFamily;
  _editorFontSize = nextEditorSize;
  _fontSize = nextSize;
  _atomFontSnapshot = { family: _measureFamily, size: _fontSize };
  for (const listener of _atomFontListeners) listener();
}

/**
 * vertical-align offset (px) so the atom's internal text baseline aligns
 * with the surrounding text baseline, for a given font size. The SVG
 * draws label text with its baseline at `atomHeightFor(size)/2 + size *
 * 0.32` from the top of the box, so the IMG's bottom must sit
 * `atomHeightFor(size)/2 - size * 0.32` below the parent baseline —
 * i.e. a negative vertical-align of that magnitude.
 */
function atomBaselineOffsetFor(size: number): number {
  return Math.round(size * 0.32 - atomHeightFor(size) / 2);
}
function atomBaselineOffset(): number {
  return atomBaselineOffsetFor(_fontSize);
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

/** Construct a CSS font shorthand for Canvas measurement. */
function atomFontFor(family: string, size: number): string {
  return `${size}px ${family}`;
}
/** Current atom font as a CSS font shorthand (editor-side, module state). */
function atomFont(): string {
  return atomFontFor(_measureFamily, _fontSize);
}

/** Truncate text to fit within maxWidth, appending "…" if needed. */
function truncateLabel(label: string, maxWidth: number, fontShorthand: string = atomFont()): string {
  if (measureTextWidth(label, fontShorthand) <= maxWidth) return label;
  const ellipsis = "…";
  const font = fontShorthand;
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

/**
 * Resolve the font-family to render inside the SVG and the @font-face
 * block to inline so the SVG can use it. Picks the first family from
 * the given stack that has been loaded via @font-face + discovered by
 * tug-atom-fonts. Falls back to a generic family name only — still
 * inherits the generic keyword so the SVG's monospace/sans pick is
 * preserved when a custom font hasn't loaded yet.
 */
function resolveSvgFont(family: string, weight: number): { fontFamily: string; fontFaceCSS: string } {
  const face = findEmbeddableFace(family, weight, "normal");
  if (face) {
    const generic = pickGenericFallback(family);
    return {
      fontFamily: `&quot;${face.family}&quot;${generic ? `, ${generic}` : ""}`,
      fontFaceCSS: face.css,
    };
  }
  return { fontFamily: pickGenericFallback(family) || "sans-serif", fontFaceCSS: "" };
}

/** Extract the last generic family keyword from a CSS font-family stack. */
function pickGenericFallback(stack: string): string {
  const generics = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"]);
  const parts = stack.split(",").map((s) => s.replace(/["']/g, "").trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    if (generics.has(parts[i])) return parts[i];
  }
  return "";
}

/** Build the SVG data URI for an atom with a given icon path and display label.
 *  `family` + `size` are explicit so the editor path (using module state)
 *  and the React-side stable-font path (locked to `STABLE_REACT_CHIP_*`)
 *  share this code unchanged. */
function buildAtomSVG(
  iconPath: string,
  displayLabel: string,
  bgColor: string,
  borderColor: string,
  iconColor: string,
  textColor: string,
  family: string,
  size: number,
): { svg: string; width: number } {
  const font = atomFontFor(family, size);
  const textWidth = measureTextWidth(displayLabel, font);
  const icon_px = iconSizeFor(size);
  const height_px = atomHeightFor(size);
  const w = PADDING + icon_px + GAP + Math.ceil(textWidth) + PADDING;
  const icon = `<g transform="translate(${PADDING},${(height_px - icon_px) / 2}) scale(${icon_px / 24})" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>`;
  const { fontFamily, fontFaceCSS } = resolveSvgFont(family, 400);
  const defs = fontFaceCSS ? `<defs><style>${fontFaceCSS}</style></defs>` : "";
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height_px}" viewBox="0 0 ${w} ${height_px}">`,
    defs,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${height_px - 1}" rx="3" fill="${bgColor}" stroke="${borderColor}" stroke-width="1"/>`,
    icon,
    `<text x="${PADDING + icon_px + GAP}" y="${height_px / 2 + size * 0.32}" font-size="${size}" font-family="${fontFamily}" fill="${textColor}">${escapeSVG(displayLabel)}</text>`,
    `</svg>`,
  ].join("");
  return { svg, width: w };
}

function svgToDataURI(svg: string): string {
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// ---- Public API ----

/**
 * Result of {@link buildAtomSVGDataUri}: a self-describing SVG chip
 * the caller can apply to an `<img>` (the editor's CM6 widget) or
 * a React-rendered `<img>` (the transcript walker), without either
 * surface re-implementing the SVG / theme-token / baseline math.
 *
 * Pure data — no DOM references. Both numeric fields are in px.
 */
export interface AtomSvgResult {
  /** `data:image/svg+xml,…` URI ready for `<img src=...>`. */
  dataUri: string;
  /** Chip width in px — set on `<img width=...>` for layout stability. */
  width: number;
  /** Chip height in px — set on `<img height=...>`. */
  height: number;
  /**
   * Vertical-align offset in px (typically negative). Apply as
   * `verticalAlign: \`${baselineOffset}px\`` so the chip's internal
   * text baseline lines up with the surrounding line's baseline.
   */
  baselineOffset: number;
}

/**
 * Build the SVG-chip data URI + geometry for an atom. Pure with
 * respect to the inputs and the currently-resolved theme tokens —
 * two calls in the same theme/font frame return byte-identical
 * results. Both the editor's `createAtomImgElement` (imperative
 * `<img>` for CM6 widgets) and the transcript's `TugAtomTextBody`
 * (React `<img>` per `U+FFFC` position) call this single helper, so
 * every surface that paints an atom chip paints the same pixels.
 *
 * Reads theme tokens via `getTokenValue` at call time, so theme
 * switches are picked up on next render (per the [theme-tokens]
 * cascade). The widget's regeneration counter ({@link AtomWidget}
 * in `atom-decoration.ts`) takes care of busting CM6's reconciliation
 * cache so the editor refreshes too.
 */
export function buildAtomSVGDataUri(
  type: string,
  label: string,
  value: string,
  options?: {
    maxLabelWidth?: number;
    /**
     * Override the font family used for SVG text rendering AND
     * Canvas-side text measurement (the two must match or the chip's
     * bounds won't fit the rendered label). When omitted, the chip
     * uses the module-state `_measureFamily` last set via
     * {@link setAtomFont} — which the editor settings store calls
     * when the user's font preference changes.
     */
    fontFamily?: string;
    /**
     * Override the font size (in px) used for SVG text and Canvas
     * measurement. When omitted, defaults to the module-state
     * `_fontSize`. Transcript-side chips pass a 12px base scaled by
     * the user's transcript magnification (`useChipFontSize`), so
     * the chip stays proportional to the surrounding magnified
     * transcript text without coupling to the editor's font size.
     */
    fontSize?: number;
  },
): AtomSvgResult {
  // The `value` field is part of the public signature so future
  // theme variants can fork on it (e.g., a different icon for a path
  // pointing inside `node_modules`); today only `type` and `label`
  // drive the rendered output.
  void value;
  const family = options?.fontFamily ?? _measureFamily;
  const size = options?.fontSize ?? _fontSize;
  const displayLabel = options?.maxLabelWidth != null
    ? truncateLabel(label, options.maxLabelWidth, atomFontFor(family, size))
    : label;

  const bgColor = getTokenValue("--tug7-surface-atom-primary-normal-default-rest");
  const borderColor = getTokenValue("--tug7-element-atom-border-normal-default-rest");
  const iconColor = getTokenValue("--tug7-element-atom-icon-normal-default-rest");
  const textColor = getTokenValue("--tug7-element-atom-text-normal-default-rest");

  const iconPath = ATOM_ICON_PATHS[type] ?? ATOM_ICON_PATHS.file;
  const { svg, width } = buildAtomSVG(
    iconPath, displayLabel, bgColor, borderColor, iconColor, textColor,
    family, size,
  );

  return {
    dataUri: svgToDataURI(svg),
    width,
    height: atomHeightFor(size),
    baselineOffset: atomBaselineOffsetFor(size),
  };
}

/** Create an atom <img> element with SVG data URI. */
export function createAtomImgElement(
  type: string,
  label: string,
  value: string,
  options?: AtomImgOptions,
): HTMLImageElement {
  const { dataUri, width, height, baselineOffset } = buildAtomSVGDataUri(
    type,
    label,
    value,
    options?.maxLabelWidth !== undefined ? { maxLabelWidth: options.maxLabelWidth } : undefined,
  );

  const img = document.createElement("img");
  img.src = dataUri;
  img.width = width;
  img.height = height;
  img.style.verticalAlign = `${baselineOffset}px`;
  img.style.margin = "0 2px";
  img.dataset.atomType = type;
  img.dataset.atomLabel = label;
  img.dataset.atomValue = value;
  img.title = value;

  // Optional: pair this widget with its bytes-store entry. Set only
  // when the caller has an id to attach. The pending-sync ViewPlugin
  // queries `[data-atom-id]` to toggle `data-pending` after bytes
  // arrive (skeleton → ready transition).
  if (options?.id !== undefined) {
    img.dataset.atomId = options.id;
  }
  if (options?.pending === true) {
    img.dataset.pending = "true";
  }

  return img;
}

/** Create atom img as HTML string (for execCommand insertHTML). */
export function atomImgHTML(type: string, label: string, value?: string): string {
  const el = createAtomImgElement(type, label, value ?? label);
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

// ---- Path-chip props ----

/**
 * Props ready to spread onto an `<img>` to render a path as an atom
 * chip. Returned by {@link composeAtomChipPropsForPath}.
 *
 * The shape pairs with the shared `.tug-atom-chip` CSS rule
 * (`lib/tug-atom-chip.css`). Callers add `className="tug-atom-chip"`
 * to the `<img>` to pick up the chip's vertical-align + margin
 * styling. The chip's *colour* + *icon* + *baseline* come from the
 * SVG data URI via {@link buildAtomSVGDataUri}.
 */
export interface AtomChipImgProps {
  /** `data:image/svg+xml,…` URI ready for `<img src=...>`. */
  src: string;
  /** Accessible label — the path's basename (e.g. `"main.ts"`). */
  alt: string;
  /** Native hover tooltip — the full path (e.g. `"src/main.ts"`). */
  title: string;
  /** Chip width in px. */
  width: number;
  /** Chip height in px. */
  height: number;
}

/**
 * Compose the `<img>` props needed to render `path` as an atom chip.
 *
 * Pure — combines {@link formatAtomLabel} (basename extraction) with
 * {@link buildAtomSVGDataUri} (SVG + geometry) into the single shape
 * tool-block path renderers spread onto an `<img>`. The assistant
 * side ([Step 7](roadmap/tide-atoms.md#step-7)) consumes this from
 * each of the four file-bearing tool blocks (Read / Edit / Write /
 * NotebookEdit), so every assistant-rendered path chip paints with
 * the same SVG, basename, and tooltip semantics.
 *
 * The `type` parameter is forwarded to {@link buildAtomSVGDataUri};
 * `"file"` is the canonical type for filesystem paths and selects
 * the file icon from `ATOM_ICON_PATHS`. Other consumers may pass
 * different types (e.g., a future URL chip).
 *
 * Returns `null` only on an empty string — defensive against an
 * upstream narrower handing an empty `file_path`. Callers can use
 * `?.` to render nothing in that case.
 *
 * Reads the current atom-font module state via
 * {@link buildAtomSVGDataUri} unless `options` overrides it. React
 * surfaces typically subscribe to {@link subscribeAtomFont} (for the
 * editor font family) and pass {@link chipFontSizeForMagnification}
 * (for the transcript's magnification-scaled size) — see
 * `useAtomChipImgProps`.
 */
export function composeAtomChipImgProps(
  type: string,
  path: string,
  options?: { fontFamily?: string; fontSize?: number },
): AtomChipImgProps | null {
  if (path.length === 0) return null;
  const label = formatAtomLabel(path, "filename");
  const { dataUri, width, height } = buildAtomSVGDataUri(
    type, label, path, options,
  );
  return {
    src: dataUri,
    alt: label,
    title: path,
    width,
    height,
  };
}
