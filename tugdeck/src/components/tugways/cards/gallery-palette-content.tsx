/**
 * gallery-palette-content.tsx -- GalleryPaletteContent interactive palette demo.
 *
 * Renders all 24 hue families across all 11 standard intensity stops as a
 * colored swatch grid, with two modes:
 *   - Anchors mode (default, Phase 5d5b): per-hue anchor-based interpolation
 *     with click-to-edit L/C values and theme selector.
 *   - Curves mode (Phase 5d5a): smoothstep/bezier/piecewise transfer function
 *     tuning and side-by-side comparison panel.
 *
 * Design decisions:
 *   [D01] Smoothstep transfer function as default curve
 *   [D06] Gallery palette tab follows existing gallery card pattern
 *
 * Rules of Tugways compliance:
 *   - Swatch background colors are set via inline style attributes computed
 *     per-render from tugPaletteColor() / tugAnchoredColor(). This is
 *     acceptable because the colors are computed values applied directly to
 *     DOM, not stored as React appearance state ([D08], [D09]).
 *   - Interactive controls use local useState for curve/anchor parameters.
 *     This is local component state, not external store state ([D40]).
 *   - No root.render() calls after initial mount ([D40], [D42]).
 *
 * Spec S04 (#s04-gallery-palette-tab), Spec S05 (#s05-gallery-anchor-editor)
 *
 * @module components/tugways/cards/gallery-palette-content
 */

import React, { useState, useRef } from "react";
import {
  HUE_FAMILIES,
  DEFAULT_LC_PARAMS,
  MAX_CHROMA_FOR_HUE,
  tugPaletteColor,
  clampedOklchString,
  tugAnchoredColor,
  type LCParams,
  type HueAnchors,
  type ThemeHueAnchors,
} from "@/components/tugways/palette-engine";
import { DEFAULT_ANCHOR_DATA } from "@/components/tugways/theme-anchors";
import "./gallery-palette-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 11 standard intensity stops (Spec S03). */
const STANDARD_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Hue names in insertion order from HUE_FAMILIES. */
const HUE_NAMES = Object.keys(HUE_FAMILIES);

type CurveType = "smoothstep" | "bezier" | "piecewise";

type EditorMode = "anchors" | "curves";

type ThemeKey = "brio" | "bluenote" | "harmony";

// ---------------------------------------------------------------------------
// Alternative curve implementations (local, not exported from palette-engine)
// ---------------------------------------------------------------------------

/**
 * Cubic bezier transfer function with configurable control points.
 * Uses a single cubic mapping t → s, where P0=0, P3=1 and P1,P2 are
 * configurable. We approximate the y(t) value using de Casteljau iteration.
 */
function bezierEase(t: number, p1: number, p2: number): number {
  // Simplified 1D cubic bezier with control points 0, p1, p2, 1.
  // Treats t as the curve parameter directly (no Newton iteration needed for
  // this demo use case) and evaluates the standard cubic bezier formula.
  return 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
}

/**
 * Piecewise linear transfer function with two configurable breakpoints.
 * Four linear segments:
 *   [0, breakT]       → [0, breakS]
 *   [breakT, breakT2] → [breakS, breakS2]
 *   [breakT2, 1]      → [breakS2, 1]
 *
 * breakT must be less than breakT2 for well-ordered breakpoints.
 */
function piecewiseLinear(
  t: number,
  breakT: number,
  breakS: number,
  breakT2: number,
  breakS2: number,
): number {
  const clampedBreakT = Math.max(0.01, Math.min(0.98, breakT));
  const clampedBreakT2 = Math.max(clampedBreakT + 0.01, Math.min(0.99, breakT2));
  const clampedBreakS = Math.max(0.01, Math.min(0.99, breakS));
  const clampedBreakS2 = Math.max(0.01, Math.min(0.99, breakS2));
  if (t <= clampedBreakT) {
    return (t / clampedBreakT) * clampedBreakS;
  }
  if (t <= clampedBreakT2) {
    return (
      clampedBreakS +
      ((t - clampedBreakT) / (clampedBreakT2 - clampedBreakT)) *
        (clampedBreakS2 - clampedBreakS)
    );
  }
  return clampedBreakS2 + ((t - clampedBreakT2) / (1 - clampedBreakT2)) * (1 - clampedBreakS2);
}

/**
 * Compute L and C for a given intensity using the selected curve type.
 * For smoothstep mode, delegates to tugPaletteColor (which uses the same
 * smoothstep curve internally). For bezier/piecewise, computes the curve
 * locally and calls clampedOklchString for chroma capping.
 */
function computeColor(
  hueName: string,
  intensity: number,
  params: LCParams,
  curveType: CurveType,
  bezierP1: number,
  bezierP2: number,
  pieceBreakT: number,
  pieceBreakS: number,
  pieceBreakT2: number,
  pieceBreakS2: number,
): string {
  if (curveType === "smoothstep") {
    return tugPaletteColor(hueName, intensity, params);
  }

  const t = Math.max(0, Math.min(100, intensity)) / 100;
  let s: number;

  if (curveType === "bezier") {
    s = bezierEase(t, bezierP1, bezierP2);
  } else {
    s = piecewiseLinear(t, pieceBreakT, pieceBreakS, pieceBreakT2, pieceBreakS2);
  }

  const L = params.lMax + s * (params.lMin - params.lMax);
  const C = params.cMin + s * (params.cMax - params.cMin);
  return clampedOklchString(hueName, L, C);
}

// ---------------------------------------------------------------------------
// CurveParams type — full curve configuration
// ---------------------------------------------------------------------------

interface CurveConfig {
  params: LCParams;
  curveType: CurveType;
  bezierP1: number;
  bezierP2: number;
  pieceBreakT: number;
  pieceBreakS: number;
  pieceBreakT2: number;
  pieceBreakS2: number;
}

const DEFAULT_CURVE_CONFIG: CurveConfig = {
  params: { ...DEFAULT_LC_PARAMS },
  curveType: "smoothstep",
  bezierP1: 0.42,
  bezierP2: 0.58,
  pieceBreakT: 0.3,
  pieceBreakS: 0.45,
  pieceBreakT2: 0.7,
  pieceBreakS2: 0.85,
};

// ---------------------------------------------------------------------------
// SwatchGrid — renders the 24x11 color grid for one curve configuration
// ---------------------------------------------------------------------------

function SwatchGrid({
  config,
  testIdPrefix,
}: {
  config: CurveConfig;
  testIdPrefix?: string;
}) {
  return (
    <div className="gp-grid" data-testid={testIdPrefix ? `${testIdPrefix}-swatch-grid` : "gp-swatch-grid"}>
      {/* Header row: intensity stops */}
      <div className="gp-grid-row gp-grid-header">
        <div className="gp-hue-label gp-header-corner" />
        {STANDARD_STOPS.map((stop) => (
          <div key={stop} className="gp-stop-label">
            {stop}
          </div>
        ))}
      </div>
      {/* Data rows: one per hue */}
      {HUE_NAMES.map((hueName) => {
        const angle = HUE_FAMILIES[hueName];
        return (
          <div key={hueName} className="gp-grid-row" data-testid="gp-hue-row">
            <div className="gp-hue-label">{hueName}</div>
            {STANDARD_STOPS.map((stop) => {
              const color = computeColor(
                hueName,
                stop,
                config.params,
                config.curveType,
                config.bezierP1,
                config.bezierP2,
                config.pieceBreakT,
                config.pieceBreakS,
                config.pieceBreakT2,
                config.pieceBreakS2,
              );
              const varName = `--tug-palette-hue-${angle}-${hueName}-tone-${stop}`;
              return (
                <div
                  key={stop}
                  className="gp-swatch"
                  style={{ backgroundColor: color }}
                  title={`${varName}: ${color}`}
                  data-color={color}
                  data-testid="gp-swatch"
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CurveControls — sliders and selectors for one curve configuration
// ---------------------------------------------------------------------------

function CurveControls({
  config,
  onChange,
  idPrefix,
}: {
  config: CurveConfig;
  onChange: (next: CurveConfig) => void;
  idPrefix: string;
}) {
  const set = (partial: Partial<CurveConfig>) => onChange({ ...config, ...partial });
  const setParam = (key: keyof LCParams, value: number) =>
    onChange({ ...config, params: { ...config.params, [key]: value } });

  return (
    <div className="cg-controls gp-controls">
      {/* Curve type selector */}
      <div className="cg-control-group">
        <label className="cg-control-label" htmlFor={`${idPrefix}-curve-type`}>
          Curve
        </label>
        <select
          id={`${idPrefix}-curve-type`}
          className="cg-control-select"
          value={config.curveType}
          onChange={(e) => set({ curveType: e.target.value as CurveType })}
          data-testid={`${idPrefix}-curve-select`}
        >
          <option value="smoothstep">Smoothstep</option>
          <option value="bezier">Cubic Bezier</option>
          <option value="piecewise">Piecewise</option>
        </select>
      </div>

      {/* L_MAX slider */}
      <div className="cg-control-group">
        <label className="cg-control-label" htmlFor={`${idPrefix}-lmax`}>
          L_MAX
        </label>
        <input
          id={`${idPrefix}-lmax`}
          type="range"
          min="0.5"
          max="1.0"
          step="0.01"
          value={config.params.lMax}
          onChange={(e) => setParam("lMax", parseFloat(e.target.value))}
          className="gp-slider"
          data-testid={`${idPrefix}-lmax-slider`}
        />
        <span className="gp-slider-value">{config.params.lMax.toFixed(2)}</span>
      </div>

      {/* L_MIN slider */}
      <div className="cg-control-group">
        <label className="cg-control-label" htmlFor={`${idPrefix}-lmin`}>
          L_MIN
        </label>
        <input
          id={`${idPrefix}-lmin`}
          type="range"
          min="0.1"
          max="0.7"
          step="0.01"
          value={config.params.lMin}
          onChange={(e) => setParam("lMin", parseFloat(e.target.value))}
          className="gp-slider"
          data-testid={`${idPrefix}-lmin-slider`}
        />
        <span className="gp-slider-value">{config.params.lMin.toFixed(2)}</span>
      </div>

      {/* C_MAX slider */}
      <div className="cg-control-group">
        <label className="cg-control-label" htmlFor={`${idPrefix}-cmax`}>
          C_MAX
        </label>
        <input
          id={`${idPrefix}-cmax`}
          type="range"
          min="0.05"
          max="0.30"
          step="0.005"
          value={config.params.cMax}
          onChange={(e) => setParam("cMax", parseFloat(e.target.value))}
          className="gp-slider"
          data-testid={`${idPrefix}-cmax-slider`}
        />
        <span className="gp-slider-value">{config.params.cMax.toFixed(3)}</span>
      </div>

      {/* C_MIN slider */}
      <div className="cg-control-group">
        <label className="cg-control-label" htmlFor={`${idPrefix}-cmin`}>
          C_MIN
        </label>
        <input
          id={`${idPrefix}-cmin`}
          type="range"
          min="0.0"
          max="0.05"
          step="0.001"
          value={config.params.cMin}
          onChange={(e) => setParam("cMin", parseFloat(e.target.value))}
          className="gp-slider"
          data-testid={`${idPrefix}-cmin-slider`}
        />
        <span className="gp-slider-value">{config.params.cMin.toFixed(3)}</span>
      </div>

      {/* Bezier controls (only shown when curveType === "bezier") */}
      {config.curveType === "bezier" && (
        <>
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor={`${idPrefix}-bp1`}>
              P1
            </label>
            <input
              id={`${idPrefix}-bp1`}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.bezierP1}
              onChange={(e) => set({ bezierP1: parseFloat(e.target.value) })}
              className="gp-slider"
              data-testid={`${idPrefix}-bezier-p1`}
            />
            <span className="gp-slider-value">{config.bezierP1.toFixed(2)}</span>
          </div>
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor={`${idPrefix}-bp2`}>
              P2
            </label>
            <input
              id={`${idPrefix}-bp2`}
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={config.bezierP2}
              onChange={(e) => set({ bezierP2: parseFloat(e.target.value) })}
              className="gp-slider"
              data-testid={`${idPrefix}-bezier-p2`}
            />
            <span className="gp-slider-value">{config.bezierP2.toFixed(2)}</span>
          </div>
        </>
      )}

      {/* Piecewise controls (only shown when curveType === "piecewise") */}
      {config.curveType === "piecewise" && (
        <>
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor={`${idPrefix}-pt`}>
              Break T
            </label>
            <input
              id={`${idPrefix}-pt`}
              type="range"
              min="0.05"
              max="0.94"
              step="0.01"
              value={config.pieceBreakT}
              onChange={(e) => set({ pieceBreakT: parseFloat(e.target.value) })}
              className="gp-slider"
              data-testid={`${idPrefix}-piece-break-t`}
            />
            <span className="gp-slider-value">{config.pieceBreakT.toFixed(2)}</span>
          </div>
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor={`${idPrefix}-ps`}>
              Break S
            </label>
            <input
              id={`${idPrefix}-ps`}
              type="range"
              min="0.05"
              max="0.95"
              step="0.01"
              value={config.pieceBreakS}
              onChange={(e) => set({ pieceBreakS: parseFloat(e.target.value) })}
              className="gp-slider"
              data-testid={`${idPrefix}-piece-break-s`}
            />
            <span className="gp-slider-value">{config.pieceBreakS.toFixed(2)}</span>
          </div>
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor={`${idPrefix}-pt2`}>
              Break T2
            </label>
            <input
              id={`${idPrefix}-pt2`}
              type="range"
              min="0.06"
              max="0.95"
              step="0.01"
              value={config.pieceBreakT2}
              onChange={(e) => set({ pieceBreakT2: parseFloat(e.target.value) })}
              className="gp-slider"
              data-testid={`${idPrefix}-piece-break-t2`}
            />
            <span className="gp-slider-value">{config.pieceBreakT2.toFixed(2)}</span>
          </div>
          <div className="cg-control-group">
            <label className="cg-control-label" htmlFor={`${idPrefix}-ps2`}>
              Break S2
            </label>
            <input
              id={`${idPrefix}-ps2`}
              type="range"
              min="0.05"
              max="0.95"
              step="0.01"
              value={config.pieceBreakS2}
              onChange={(e) => set({ pieceBreakS2: parseFloat(e.target.value) })}
              className="gp-slider"
              data-testid={`${idPrefix}-piece-break-s2`}
            />
            <span className="gp-slider-value">{config.pieceBreakS2.toFixed(2)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone ThemeHueAnchors so edits to one theme don't affect others.
 */
function cloneThemeHueAnchors(src: ThemeHueAnchors): ThemeHueAnchors {
  const result: ThemeHueAnchors = {};
  for (const [hue, data] of Object.entries(src)) {
    result[hue] = { anchors: data.anchors.map((a) => ({ ...a })) };
  }
  return result;
}

/**
 * Return the computed L/C at a given stop by interpolating between anchors.
 * Used when toggling a stop to anchor: freeze the interpolated value.
 */
function computedLCAtStop(stop: number, hueAnchors: HueAnchors): { L: number; C: number } {
  const anchors = hueAnchors.anchors;
  const clamped = Math.max(0, Math.min(100, stop));

  for (const a of anchors) {
    if (a.stop === clamped) return { L: a.L, C: a.C };
  }

  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (anchors[i].stop <= clamped && anchors[i + 1].stop >= clamped) {
      lo = anchors[i];
      hi = anchors[i + 1];
      break;
    }
  }

  const range = hi.stop - lo.stop;
  if (range === 0) return { L: lo.L, C: lo.C };
  const t = (clamped - lo.stop) / range;
  return { L: lo.L + t * (hi.L - lo.L), C: lo.C + t * (hi.C - lo.C) };
}

// ---------------------------------------------------------------------------
// AnchorSwatchGrid — 24x11 grid using per-hue anchor interpolation
// ---------------------------------------------------------------------------

interface SelectedSwatch {
  hue: string;
  stop: number;
}

function AnchorSwatchGrid({
  anchorData,
  selected,
  onSelect,
}: {
  anchorData: ThemeHueAnchors;
  selected: SelectedSwatch | null;
  onSelect: (hue: string, stop: number) => void;
}) {
  return (
    <div className="gp-grid" data-testid="gp-anchor-swatch-grid">
      {/* Header row */}
      <div className="gp-grid-row gp-grid-header">
        <div className="gp-hue-label gp-header-corner" />
        {STANDARD_STOPS.map((stop) => (
          <div key={stop} className="gp-stop-label">
            {stop}
          </div>
        ))}
      </div>
      {/* Data rows */}
      {HUE_NAMES.map((hueName) => {
        const angle = HUE_FAMILIES[hueName];
        const hueAnchors = anchorData[hueName];
        const anchorStops = new Set(hueAnchors?.anchors.map((a) => a.stop) ?? []);
        return (
          <div key={hueName} className="gp-grid-row" data-testid="gp-hue-row">
            <div className="gp-hue-label">{hueName}</div>
            {STANDARD_STOPS.map((stop) => {
              const color = hueAnchors
                ? tugAnchoredColor(hueName, stop, hueAnchors)
                : tugPaletteColor(hueName, stop);
              const varName = `--tug-palette-hue-${angle}-${hueName}-tone-${stop}`;
              const isAnchor = anchorStops.has(stop);
              const isSelected = selected?.hue === hueName && selected?.stop === stop;
              return (
                <div
                  key={stop}
                  className={[
                    "gp-swatch",
                    "gp-anchor-swatch",
                    isAnchor ? "gp-anchor-swatch--is-anchor" : "",
                    isSelected ? "gp-anchor-swatch--selected" : "",
                  ].filter(Boolean).join(" ")}
                  style={{ backgroundColor: color }}
                  title={`${varName}: ${color}`}
                  data-color={color}
                  data-anchor={isAnchor ? "true" : "false"}
                  data-testid="gp-swatch"
                  onClick={() => onSelect(hueName, stop)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AnchorEditor — inline editor for a selected swatch
// ---------------------------------------------------------------------------

function AnchorEditor({
  hue,
  stop,
  hueAnchors,
  onUpdate,
}: {
  hue: string;
  stop: number;
  hueAnchors: HueAnchors;
  onUpdate: (hue: string, newAnchors: HueAnchors) => void;
}) {
  const isAnchor = hueAnchors.anchors.some((a) => a.stop === stop);
  const chromaCap = MAX_CHROMA_FOR_HUE[hue] ?? 0.22;

  // Current values: read from anchor if it exists, else interpolate
  const currentAnchor = hueAnchors.anchors.find((a) => a.stop === stop);
  const { L: currentL, C: currentC } = currentAnchor ?? computedLCAtStop(stop, hueAnchors);

  const handleLChange = (newL: number) => {
    if (!isAnchor) return;
    const newAnchors = hueAnchors.anchors.map((a) =>
      a.stop === stop ? { ...a, L: newL } : a
    );
    onUpdate(hue, { anchors: newAnchors });
  };

  const handleCChange = (newC: number) => {
    if (!isAnchor) return;
    const newAnchors = hueAnchors.anchors.map((a) =>
      a.stop === stop ? { ...a, C: newC } : a
    );
    onUpdate(hue, { anchors: newAnchors });
  };

  const handleAnchorToggle = (checked: boolean) => {
    if (checked) {
      // Freeze the current computed L/C as a new anchor point, then sort
      const { L, C } = computedLCAtStop(stop, hueAnchors);
      const newAnchors = [...hueAnchors.anchors, { stop, L, C }]
        .sort((a, b) => a.stop - b.stop);
      onUpdate(hue, { anchors: newAnchors });
    } else {
      // Remove this stop from anchors (revert to interpolated)
      // Never remove stops 0 or 100 — they are required boundary anchors
      if (stop === 0 || stop === 100) return;
      const newAnchors = hueAnchors.anchors.filter((a) => a.stop !== stop);
      onUpdate(hue, { anchors: newAnchors });
    }
  };

  const isOverGamut = currentC > chromaCap + 0.0001;

  return (
    <div className="gp-anchor-editor" data-testid="gp-anchor-editor">
      <div className="gp-anchor-editor-title">
        <span className="gp-anchor-editor-hue" data-testid="gp-anchor-editor-hue">{hue}</span>
        <span className="gp-anchor-editor-stop" data-testid="gp-anchor-editor-stop">stop {stop}</span>
      </div>

      <div className="gp-anchor-editor-row">
        <label className="gp-anchor-editor-label">
          <input
            type="checkbox"
            checked={isAnchor}
            onChange={(e) => handleAnchorToggle(e.target.checked)}
            data-testid="gp-anchor-checkbox"
            disabled={stop === 0 || stop === 100}
          />
          Anchor
        </label>
      </div>

      <div className="gp-anchor-editor-row">
        <label className="gp-anchor-editor-label" htmlFor="gp-anchor-l">L</label>
        <input
          id="gp-anchor-l"
          type="number"
          min="0.1"
          max="1.0"
          step="0.01"
          value={parseFloat(currentL.toFixed(4))}
          onChange={(e) => handleLChange(parseFloat(e.target.value))}
          disabled={!isAnchor}
          className="gp-anchor-input"
          data-testid="gp-anchor-l-input"
        />
      </div>

      <div className="gp-anchor-editor-row">
        <label className="gp-anchor-editor-label" htmlFor="gp-anchor-c">C</label>
        <input
          id="gp-anchor-c"
          type="number"
          min="0.0"
          max="0.3"
          step="0.001"
          value={parseFloat(currentC.toFixed(4))}
          onChange={(e) => handleCChange(parseFloat(e.target.value))}
          disabled={!isAnchor}
          className="gp-anchor-input"
          data-testid="gp-anchor-c-input"
        />
        {isOverGamut && (
          <span className="gp-anchor-gamut-warning" data-testid="gp-anchor-gamut-warning">
            C exceeds cap ({chromaCap.toFixed(3)})
          </span>
        )}
      </div>

      {!isAnchor && (
        <div className="gp-anchor-editor-note" data-testid="gp-anchor-interpolated-note">
          Interpolated — check Anchor to edit
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON export/import helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** The schema version written into every export file. */
const EXPORT_VERSION = 1;

/** Serialized JSON format (Spec S04). */
interface ExportPayload {
  version: number;
  themes: {
    brio: ThemeHueAnchors;
    bluenote: ThemeHueAnchors;
    harmony: ThemeHueAnchors;
  };
}

/**
 * Build the export JSON string from the three theme anchor states.
 * Returns a formatted JSON string matching Spec S04.
 */
export function buildExportPayload(
  brio: ThemeHueAnchors,
  bluenote: ThemeHueAnchors,
  harmony: ThemeHueAnchors,
): string {
  const payload: ExportPayload = {
    version: EXPORT_VERSION,
    themes: { brio, bluenote, harmony },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse and validate an import JSON string.
 *
 * Validates:
 * - Top-level `version` field is present (numeric)
 * - `themes.brio`, `themes.bluenote`, `themes.harmony` are present objects
 * - Every hue in each theme has an `anchors` array
 * - Every anchor has numeric `stop`, `L`, `C` fields
 *
 * Returns the parsed themes object on success.
 * Throws an Error with a descriptive message on validation failure.
 */
export function parseImportPayload(jsonString: string): ExportPayload["themes"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error("Invalid JSON: file could not be parsed.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid format: root must be a JSON object.");
  }

  const root = parsed as Record<string, unknown>;

  if (typeof root["version"] !== "number") {
    throw new Error("Invalid format: missing or non-numeric 'version' field.");
  }

  const themes = root["themes"];
  if (typeof themes !== "object" || themes === null) {
    throw new Error("Invalid format: missing 'themes' object.");
  }

  const themesObj = themes as Record<string, unknown>;
  const themeKeys: Array<keyof ExportPayload["themes"]> = ["brio", "bluenote", "harmony"];

  for (const themeKey of themeKeys) {
    const themeData = themesObj[themeKey];
    if (typeof themeData !== "object" || themeData === null) {
      throw new Error(`Invalid format: missing theme '${themeKey}'.`);
    }
    // Validate per-hue anchor arrays
    const hues = themeData as Record<string, unknown>;
    for (const [hueName, hueData] of Object.entries(hues)) {
      if (typeof hueData !== "object" || hueData === null) {
        throw new Error(`Invalid format: theme '${themeKey}', hue '${hueName}' is not an object.`);
      }
      const hueObj = hueData as Record<string, unknown>;
      if (!Array.isArray(hueObj["anchors"])) {
        throw new Error(`Invalid format: theme '${themeKey}', hue '${hueName}' missing 'anchors' array.`);
      }
      for (const anchor of hueObj["anchors"] as unknown[]) {
        if (typeof anchor !== "object" || anchor === null) {
          throw new Error(`Invalid format: theme '${themeKey}', hue '${hueName}': anchor is not an object.`);
        }
        const a = anchor as Record<string, unknown>;
        if (typeof a["stop"] !== "number" || typeof a["L"] !== "number" || typeof a["C"] !== "number") {
          throw new Error(
            `Invalid format: theme '${themeKey}', hue '${hueName}': anchor missing numeric stop/L/C.`,
          );
        }
      }
    }
  }

  return {
    brio:     themesObj["brio"] as ThemeHueAnchors,
    bluenote: themesObj["bluenote"] as ThemeHueAnchors,
    harmony:  themesObj["harmony"] as ThemeHueAnchors,
  };
}

// ---------------------------------------------------------------------------
// AnchorsPanel — top-level anchors mode UI
// ---------------------------------------------------------------------------

function AnchorsPanel() {
  const [selectedTheme, setSelectedTheme] = useState<ThemeKey>("brio");

  // Per-theme mutable anchor state, initialized from DEFAULT_ANCHOR_DATA
  const [brioAnchors, setBrioAnchors] = useState<ThemeHueAnchors>(() =>
    cloneThemeHueAnchors(DEFAULT_ANCHOR_DATA.brio)
  );
  const [bluenoteAnchors, setBluenoteAnchors] = useState<ThemeHueAnchors>(() =>
    cloneThemeHueAnchors(DEFAULT_ANCHOR_DATA.bluenote)
  );
  const [harmonyAnchors, setHarmonyAnchors] = useState<ThemeHueAnchors>(() =>
    cloneThemeHueAnchors(DEFAULT_ANCHOR_DATA.harmony)
  );

  const [selected, setSelected] = useState<SelectedSwatch | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Hidden file input ref for the import picker (imperative DOM op, not appearance state)
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resolve the active anchor data and setter for the current theme
  const activeAnchors: ThemeHueAnchors =
    selectedTheme === "brio" ? brioAnchors
    : selectedTheme === "bluenote" ? bluenoteAnchors
    : harmonyAnchors;

  const setActiveAnchors = (updater: (prev: ThemeHueAnchors) => ThemeHueAnchors) => {
    if (selectedTheme === "brio") setBrioAnchors(updater);
    else if (selectedTheme === "bluenote") setBluenoteAnchors(updater);
    else setHarmonyAnchors(updater);
  };

  const handleSwatchSelect = (hue: string, stop: number) => {
    setSelected({ hue, stop });
  };

  const handleAnchorUpdate = (hue: string, newHueAnchors: HueAnchors) => {
    setActiveAnchors((prev) => ({ ...prev, [hue]: newHueAnchors }));
  };

  // Export: serialize all three themes and trigger a browser download.
  // Imperative DOM operations — no React appearance state involved.
  const handleExport = () => {
    const jsonString = buildExportPayload(brioAnchors, bluenoteAnchors, harmonyAnchors);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tug-palette-anchors.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Import: open the hidden file picker.
  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  // File selected: read, validate, and apply.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== "string") {
        setImportError("Could not read file contents.");
        return;
      }
      try {
        const themes = parseImportPayload(text);
        setBrioAnchors(cloneThemeHueAnchors(themes.brio));
        setBluenoteAnchors(cloneThemeHueAnchors(themes.bluenote));
        setHarmonyAnchors(cloneThemeHueAnchors(themes.harmony));
        setSelected(null);
        setImportError(null);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Unknown import error.");
      }
    };
    reader.onerror = () => {
      setImportError("File read error.");
    };
    reader.readAsText(file);

    // Reset the input so the same file can be re-imported if needed
    e.target.value = "";
  };

  return (
    <div className="gp-anchors-panel" data-testid="gp-anchors-panel">
      {/* Hidden file input for import (imperative trigger, not appearance state) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleFileChange}
        data-testid="gp-import-file-input"
      />

      {/* Theme selector + export/import actions */}
      <div className="cg-section">
        <div className="cg-section-title">Theme</div>
        <div className="gp-anchor-theme-row">
          <select
            value={selectedTheme}
            onChange={(e) => {
              setSelectedTheme(e.target.value as ThemeKey);
              setSelected(null);
            }}
            className="cg-control-select"
            data-testid="gp-anchor-theme-select"
          >
            <option value="brio">Brio</option>
            <option value="bluenote">Bluenote</option>
            <option value="harmony">Harmony</option>
          </select>
          <div className="gp-action-row">
            <button
              className="gp-action-btn"
              onClick={handleExport}
              data-testid="gp-export-btn"
            >
              Export JSON
            </button>
            <button
              className="gp-action-btn"
              onClick={handleImportClick}
              data-testid="gp-import-btn"
            >
              Import JSON
            </button>
          </div>
        </div>
        {importError && (
          <div className="gp-import-error" data-testid="gp-import-error">
            {importError}
          </div>
        )}
      </div>

      {/* Swatch grid */}
      <div className="cg-section">
        <div className="cg-section-title">Anchor Palette — click a swatch to edit</div>
        <AnchorSwatchGrid
          anchorData={activeAnchors}
          selected={selected}
          onSelect={handleSwatchSelect}
        />
      </div>

      {/* Inline editor */}
      {selected && (
        <div className="cg-section">
          <div className="cg-section-title">Edit Anchor</div>
          <AnchorEditor
            hue={selected.hue}
            stop={selected.stop}
            hueAnchors={activeAnchors[selected.hue]}
            onUpdate={handleAnchorUpdate}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryPaletteContent
// ---------------------------------------------------------------------------

/**
 * GalleryPaletteContent — interactive palette demo with two modes.
 *
 * Anchors mode (default): per-hue anchor-based palette tuning tool.
 * Curves mode: transfer function (smoothstep/bezier/piecewise) comparison.
 *
 * Rules of Tugways: all appearance changes go through computed inline style
 * attributes, never React state. Local useState is used only for UI state
 * (mode, selection, anchor values).
 *
 * **Authoritative reference:** Spec S04 (#s04-gallery-palette-tab),
 * Spec S05 (#s05-gallery-anchor-editor), [D06]
 */
export function GalleryPaletteContent() {
  const [mode, setMode] = useState<EditorMode>("anchors");

  // Curves-mode state (preserved when switching modes)
  const [liveConfig, setLiveConfig] = useState<CurveConfig>({ ...DEFAULT_CURVE_CONFIG });
  const [lockedConfig, setLockedConfig] = useState<CurveConfig>({ ...DEFAULT_CURVE_CONFIG });

  const handleReset = () => {
    setLiveConfig({ ...DEFAULT_CURVE_CONFIG });
  };

  const handleLock = () => {
    setLockedConfig({ ...liveConfig });
  };

  return (
    <div className="cg-content gp-content" data-testid="gallery-palette-content">
      {/* ---- Mode toggle ---- */}
      <div className="cg-section">
        <div className="gp-mode-toggle" data-testid="gp-mode-toggle">
          <button
            className={["gp-mode-btn", mode === "anchors" ? "gp-mode-btn--active" : ""].filter(Boolean).join(" ")}
            onClick={() => setMode("anchors")}
            data-testid="gp-mode-anchors-btn"
          >
            Anchors
          </button>
          <button
            className={["gp-mode-btn", mode === "curves" ? "gp-mode-btn--active" : ""].filter(Boolean).join(" ")}
            onClick={() => setMode("curves")}
            data-testid="gp-mode-curves-btn"
          >
            Curves
          </button>
        </div>
      </div>

      {/* ---- Anchors mode ---- */}
      {/* Hidden (not unmounted) when in curves mode so Curves tests can always query the DOM */}
      <div className={mode === "anchors" ? "" : "gp-hidden"}>
        <AnchorsPanel />
      </div>

      {/* ---- Curves mode ---- */}
      {/* Hidden (not unmounted) when in anchors mode so existing tests always find these elements */}
      <div className={mode === "curves" ? "" : "gp-hidden"}>
        {/* Controls section */}
        <div className="cg-section">
          <div className="cg-section-title">Transfer Function Controls</div>
          <CurveControls
            config={liveConfig}
            onChange={setLiveConfig}
            idPrefix="gp-live"
          />
          <div className="gp-action-row">
            <button
              className="gp-action-btn"
              onClick={handleReset}
              data-testid="gp-reset-btn"
            >
              Reset to defaults
            </button>
            <button
              className="gp-action-btn"
              onClick={handleLock}
              data-testid="gp-lock-btn"
            >
              Lock current
            </button>
          </div>
        </div>

        {/* Side-by-side comparison */}
        <div className="cg-section">
          <div className="cg-section-title">Side-by-Side Comparison</div>
          <div className="gp-comparison">
            {/* Left: live configuration */}
            <div className="gp-panel" data-testid="gp-live-panel">
              <div className="gp-panel-label">
                Live — {liveConfig.curveType}
              </div>
              <SwatchGrid config={liveConfig} testIdPrefix="gp-live" />
            </div>

            {/* Right: locked reference */}
            <div className="gp-panel" data-testid="gp-locked-panel">
              <div className="gp-panel-label">
                Locked — {lockedConfig.curveType}
              </div>
              <SwatchGrid config={lockedConfig} testIdPrefix="gp-locked" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
