/**
 * gallery-palette-content.tsx -- GalleryPaletteContent interactive palette demo.
 *
 * Renders all 24 hue families across all 11 standard intensity stops as a
 * colored swatch grid, with interactive curve controls for transfer function
 * tuning and a side-by-side comparison panel.
 *
 * Design decisions:
 *   [D01] Smoothstep transfer function as default curve
 *   [D06] Gallery palette tab follows existing gallery card pattern
 *
 * Rules of Tugways compliance:
 *   - Swatch background colors are set via inline style attributes computed
 *     per-render from tugPaletteColor() / clampedOklchString(). This is
 *     acceptable because the colors are computed values applied directly to
 *     DOM, not stored as React appearance state ([D08], [D09]).
 *   - Interactive controls use local useState for curve parameters. This is
 *     local component state, not external store state, so useSyncExternalStore
 *     does not apply ([D40]).
 *   - No root.render() calls after initial mount ([D40], [D42]).
 *
 * Spec S04 (#s04-gallery-palette-tab)
 *
 * @module components/tugways/cards/gallery-palette-content
 */

import React, { useState } from "react";
import {
  HUE_FAMILIES,
  DEFAULT_LC_PARAMS,
  tugPaletteColor,
  clampedOklchString,
  type LCParams,
} from "@/components/tugways/palette-engine";
import "./gallery-palette-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 11 standard intensity stops (Spec S03). */
const STANDARD_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** Hue names in insertion order from HUE_FAMILIES. */
const HUE_NAMES = Object.keys(HUE_FAMILIES);

type CurveType = "smoothstep" | "bezier" | "piecewise";

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
 * Piecewise linear transfer function with a configurable breakpoint.
 * Two linear segments: [0, breakT] → [0, breakS] and [breakT, 1] → [breakS, 1].
 */
function piecewiseLinear(t: number, breakT: number, breakS: number): number {
  const clampedBreakT = Math.max(0.01, Math.min(0.99, breakT));
  const clampedBreakS = Math.max(0.01, Math.min(0.99, breakS));
  if (t <= clampedBreakT) {
    return (t / clampedBreakT) * clampedBreakS;
  }
  return clampedBreakS + ((t - clampedBreakT) / (1 - clampedBreakT)) * (1 - clampedBreakS);
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
): string {
  if (curveType === "smoothstep") {
    return tugPaletteColor(hueName, intensity, params);
  }

  const t = Math.max(0, Math.min(100, intensity)) / 100;
  let s: number;

  if (curveType === "bezier") {
    s = bezierEase(t, bezierP1, bezierP2);
  } else {
    s = piecewiseLinear(t, pieceBreakT, pieceBreakS);
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
}

const DEFAULT_CURVE_CONFIG: CurveConfig = {
  params: { ...DEFAULT_LC_PARAMS },
  curveType: "smoothstep",
  bezierP1: 0.42,
  bezierP2: 0.58,
  pieceBreakT: 0.4,
  pieceBreakS: 0.6,
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
              max="0.95"
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryPaletteContent
// ---------------------------------------------------------------------------

/**
 * GalleryPaletteContent — interactive palette demo with curve tuning controls.
 *
 * Renders the 24-hue x 11-stop swatch grid with:
 * - Transfer function controls (curve type, L/C anchors)
 * - Side-by-side comparison: left (live) vs right (locked reference)
 * - "Lock current" and "Reset to defaults" buttons
 *
 * Rules of Tugways: all appearance changes go through computed inline style
 * attributes, never React state. Local useState is used only for curve
 * parameters (pure UI state, not external store state).
 *
 * **Authoritative reference:** Spec S04 (#s04-gallery-palette-tab), [D06]
 */
export function GalleryPaletteContent() {
  // Left panel (live): current slider configuration
  const [liveConfig, setLiveConfig] = useState<CurveConfig>({ ...DEFAULT_CURVE_CONFIG });
  // Right panel (locked): last "locked" configuration — starts as defaults
  const [lockedConfig, setLockedConfig] = useState<CurveConfig>({ ...DEFAULT_CURVE_CONFIG });

  const handleReset = () => {
    setLiveConfig({ ...DEFAULT_CURVE_CONFIG });
  };

  const handleLock = () => {
    setLockedConfig({ ...liveConfig });
  };

  return (
    <div className="cg-content gp-content" data-testid="gallery-palette-content">
      {/* ---- Controls section ---- */}
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

      {/* ---- Side-by-side comparison ---- */}
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
  );
}
