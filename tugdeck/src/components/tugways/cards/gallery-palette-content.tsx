/**
 * gallery-palette-content.tsx -- HueVibVal palette tuning editor.
 *
 * Interactive tool for defining 24 canonical colors in the HueVibVal color
 * system. Each canonical color is defined by its OKLCH hue angle (fixed in
 * HUE_FAMILIES) and a tunable canonical lightness. Vibrancy and value axes
 * let the developer derive any shade from the canonical color.
 *
 * UI sections:
 *   - Canonical color strip: 24 swatches at vib=50, val=50
 *   - L curve editor: SVG with draggable points for per-hue canonical lightness
 *   - VibVal grid: 11x11 grid showing vibrancy x value for the selected hue
 *   - Export/import: JSON serialization of canonical L values
 *
 * Rules of Tugways compliance:
 *   - Swatch colors set via inline style, not React appearance state [D08, D09]
 *   - Local useState for UI state only [D40]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-palette-content
 */

import React, { useState, useRef } from "react";
import {
  HUE_FAMILIES,
  MAX_CHROMA_FOR_HUE,
} from "@/components/tugways/palette-engine";
import "./gallery-palette-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUE_NAMES = Object.keys(HUE_FAMILIES);

/** Lightness at val=0 (very dark). */
const L_DARK = 0.15;

/** Lightness at val=100 (very light). */
const L_LIGHT = 0.96;

/** Peak chroma is 2x sRGB max — pushes into P3; CSS gamut-maps the rest. */
const PEAK_C_SCALE = 2;

const VIB_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const VAL_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

// ---------------------------------------------------------------------------
// Default canonical L values (from gallery tuning)
// ---------------------------------------------------------------------------

const DEFAULT_CANONICAL_L: Record<string, number> = {
  cherry: 0.619, red: 0.659, tomato: 0.704, flame: 0.740, orange: 0.780,
  amber: 0.821, gold: 0.852, yellow: 0.901, lime: 0.861, green: 0.821,
  mint: 0.807, teal: 0.803, cyan: 0.803, sky: 0.807, blue: 0.771,
  indigo: 0.744, violet: 0.708, purple: 0.686, plum: 0.731, pink: 0.794,
  rose: 0.758, magenta: 0.726, crimson: 0.668, coral: 0.632,
};

// ---------------------------------------------------------------------------
// HVV color computation
// ---------------------------------------------------------------------------

/**
 * Compute an oklch() CSS string from hue name, vibrancy, and value.
 *
 * val -> L: piecewise linear through canonical L at val=50.
 * vib -> C: linear from 0 to peakC (= MAX_CHROMA * PEAK_C_SCALE).
 *   At vib=50, C equals the sRGB-safe max; above 50 pushes into P3.
 *
 * CSS oklch() handles gamut mapping automatically.
 */
export function hvvColor(
  hueName: string,
  vib: number,
  val: number,
  canonicalL: number,
): string {
  const h = HUE_FAMILIES[hueName] ?? 0;
  const maxC = MAX_CHROMA_FOR_HUE[hueName] ?? 0.22;
  const peakC = maxC * PEAK_C_SCALE;

  // val -> L: piecewise through canonicalL at val=50
  let L: number;
  if (val <= 50) {
    L = L_DARK + (val / 50) * (canonicalL - L_DARK);
  } else {
    L = canonicalL + ((val - 50) / 50) * (L_LIGHT - canonicalL);
  }

  // vib -> C: linear 0 -> peakC
  const C = (vib / 100) * peakC;

  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  return `oklch(${fmt(L)} ${fmt(C)} ${h})`;
}

// ---------------------------------------------------------------------------
// SVG curve coordinate helpers (constants, outside component)
// ---------------------------------------------------------------------------

const VIEWBOX_W = 680;
const VIEWBOX_H = 200;
const CURVE_PAD = { top: 12, right: 12, bottom: 32, left: 36 };
const PLOT_W = VIEWBOX_W - CURVE_PAD.left - CURVE_PAD.right;
const PLOT_H = VIEWBOX_H - CURVE_PAD.top - CURVE_PAD.bottom;
const L_AXIS_MIN = 0.3;
const L_AXIS_MAX = 1.0;

function hueX(i: number): number {
  return CURVE_PAD.left + (i / (HUE_NAMES.length - 1)) * PLOT_W;
}

function lToY(l: number): number {
  return CURVE_PAD.top + ((L_AXIS_MAX - l) / (L_AXIS_MAX - L_AXIS_MIN)) * PLOT_H;
}

function yToL(y: number): number {
  return L_AXIS_MAX - ((y - CURVE_PAD.top) / PLOT_H) * (L_AXIS_MAX - L_AXIS_MIN);
}

// ---------------------------------------------------------------------------
// LCurveEditor — SVG-based draggable lightness curve
// ---------------------------------------------------------------------------

function LCurveEditor({
  canonicalL,
  onChange,
  selectedHue,
  onSelectHue,
}: {
  canonicalL: Record<string, number>;
  onChange: (hueName: string, newL: number) => void;
  selectedHue: string | null;
  onSelectHue: (hueName: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const handlePointerDown = (hueName: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(hueName);
    onSelectHue(hueName);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleY = VIEWBOX_H / rect.height;
    const y = (e.clientY - rect.top) * scaleY;
    const newL = Math.max(0.3, Math.min(0.98, yToL(y)));
    onChange(dragging, parseFloat(newL.toFixed(3)));
  };

  const handlePointerUp = () => setDragging(null);

  // Polyline connecting all points
  const polyPoints = HUE_NAMES.map((name, i) =>
    `${hueX(i)},${lToY(canonicalL[name])}`
  ).join(" ");

  // Horizontal grid lines
  const gridLs = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      className="gp-curve-svg"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      data-testid="gp-curve-editor"
    >
      {/* Plot background */}
      <rect
        x={CURVE_PAD.left}
        y={CURVE_PAD.top}
        width={PLOT_W}
        height={PLOT_H}
        fill="var(--td-surface, #1a1a1a)"
        rx={4}
      />

      {/* Horizontal grid lines + labels */}
      {gridLs.map((l) => (
        <g key={l}>
          <line
            x1={CURVE_PAD.left}
            y1={lToY(l)}
            x2={CURVE_PAD.left + PLOT_W}
            y2={lToY(l)}
            stroke="var(--td-border, #333)"
            strokeWidth={0.5}
          />
          <text
            x={CURVE_PAD.left - 6}
            y={lToY(l) + 3}
            textAnchor="end"
            className="gp-curve-axis-label"
          >
            {l.toFixed(1)}
          </text>
        </g>
      ))}

      {/* Connecting polyline */}
      <polyline
        points={polyPoints}
        fill="none"
        stroke="var(--td-text-soft, #888)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* Draggable points + hue labels */}
      {HUE_NAMES.map((name, i) => {
        const cx = hueX(i);
        const cy = lToY(canonicalL[name]);
        const dotColor = hvvColor(name, 70, 50, canonicalL[name]);
        const isSelected = name === selectedHue;
        return (
          <g key={name}>
            {/* Hue abbreviation */}
            <text
              x={cx}
              y={CURVE_PAD.top + PLOT_H + 14}
              textAnchor="middle"
              className={`gp-curve-hue-label${isSelected ? " gp-curve-hue-label--selected" : ""}`}
            >
              {name.slice(0, 3)}
            </text>
            {/* Selection ring */}
            {isSelected && (
              <circle
                cx={cx}
                cy={cy}
                r={9}
                fill="none"
                stroke="var(--td-accent, #0066cc)"
                strokeWidth={2}
              />
            )}
            {/* Draggable dot */}
            <circle
              cx={cx}
              cy={cy}
              r={6}
              fill={dotColor}
              stroke={isSelected ? "var(--td-accent, #0066cc)" : "var(--td-border, #555)"}
              strokeWidth={1.5}
              style={{ cursor: "ns-resize" }}
              onPointerDown={(e) => handlePointerDown(name, e)}
              data-testid={`gp-curve-point-${name}`}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CanonicalStrip — row of 24 canonical color swatches
// ---------------------------------------------------------------------------

function CanonicalStrip({
  canonicalL,
  selectedHue,
  onSelectHue,
}: {
  canonicalL: Record<string, number>;
  selectedHue: string | null;
  onSelectHue: (hueName: string) => void;
}) {
  return (
    <div className="gp-canonical-strip" data-testid="gp-canonical-strip">
      {HUE_NAMES.map((name) => {
        const color = hvvColor(name, 50, 50, canonicalL[name]);
        const isSelected = name === selectedHue;
        return (
          <div
            key={name}
            className={`gp-canonical-item${isSelected ? " gp-canonical-item--selected" : ""}`}
            onClick={() => onSelectHue(name)}
          >
            <div
              className="gp-canonical-swatch"
              style={{ backgroundColor: color }}
              title={`${name}: ${color}`}
              data-testid="gp-canonical-swatch"
              data-color={color}
            />
            <div className="gp-canonical-label">{name}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VibValGrid — 2D grid of vib x val for a single hue
// ---------------------------------------------------------------------------

function VibValGrid({
  hueName,
  canonicalL,
}: {
  hueName: string;
  canonicalL: number;
}) {
  return (
    <div className="gp-vvgrid" data-testid="gp-vibval-grid">
      {/* Header row: vib labels */}
      <div className="gp-vvgrid-row">
        <div className="gp-vvgrid-corner" />
        {VIB_STEPS.map((v) => (
          <div key={v} className="gp-vvgrid-header-cell">{v}</div>
        ))}
      </div>
      {/* Data rows: val from 100 (top) to 0 (bottom) */}
      {VAL_STEPS.map((val) => (
        <div key={val} className="gp-vvgrid-row" data-testid="gp-vvgrid-val-row">
          <div className="gp-vvgrid-row-label">{val}</div>
          {VIB_STEPS.map((vib) => {
            const color = hvvColor(hueName, vib, val, canonicalL);
            const isCanonical = vib === 50 && val === 50;
            return (
              <div
                key={vib}
                className={`gp-vvgrid-cell${isCanonical ? " gp-vvgrid-cell--canonical" : ""}`}
                style={{ backgroundColor: color }}
                title={`${hueName} vib=${vib} val=${val}: ${color}`}
                data-testid="gp-vvgrid-cell"
                data-color={color}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON export/import helpers (exported for unit testing)
// ---------------------------------------------------------------------------

const EXPORT_VERSION = 2;

interface HvvExportPayload {
  version: number;
  global: { l_dark: number; l_light: number };
  hues: Record<string, { canonical_l: number }>;
}

/**
 * Build export JSON string from the canonical L values.
 */
export function buildExportPayload(
  canonicalL: Record<string, number>,
): string {
  const payload: HvvExportPayload = {
    version: EXPORT_VERSION,
    global: { l_dark: L_DARK, l_light: L_LIGHT },
    hues: {},
  };
  for (const [name, l] of Object.entries(canonicalL)) {
    payload.hues[name] = { canonical_l: l };
  }
  return JSON.stringify(payload, null, 2);
}

/**
 * Parse and validate an import JSON string.
 * Returns a Record<string, number> mapping hue names to canonical L values.
 * Throws an Error with a descriptive message on validation failure.
 */
export function parseImportPayload(jsonString: string): Record<string, number> {
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

  const hues = root["hues"];
  if (typeof hues !== "object" || hues === null) {
    throw new Error("Invalid format: missing 'hues' object.");
  }

  const result: Record<string, number> = {};
  for (const [name, data] of Object.entries(hues as Record<string, unknown>)) {
    if (typeof data !== "object" || data === null) {
      throw new Error(`Invalid format: hue '${name}' is not an object.`);
    }
    const obj = data as Record<string, unknown>;
    if (typeof obj["canonical_l"] !== "number") {
      throw new Error(`Invalid format: hue '${name}' missing numeric 'canonical_l'.`);
    }
    result[name] = obj["canonical_l"];
  }
  return result;
}

// ---------------------------------------------------------------------------
// GalleryPaletteContent — main component
// ---------------------------------------------------------------------------

export function GalleryPaletteContent() {
  const [canonicalL, setCanonicalL] = useState<Record<string, number>>(
    () => ({ ...DEFAULT_CANONICAL_L }),
  );
  const [selectedHue, setSelectedHue] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLChange = (hueName: string, newL: number) => {
    setCanonicalL((prev) => ({ ...prev, [hueName]: newL }));
  };

  const handleExport = () => {
    const jsonString = buildExportPayload(canonicalL);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tug-hvv-canonical.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

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
        const imported = parseImportPayload(text);
        setCanonicalL(imported);
        setSelectedHue(null);
        setImportError(null);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Unknown import error.");
      }
    };
    reader.onerror = () => setImportError("File read error.");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleReset = () => {
    setCanonicalL({ ...DEFAULT_CANONICAL_L });
    setSelectedHue(null);
  };

  return (
    <div className="cg-content gp-content" data-testid="gallery-palette-content">
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={handleFileChange}
        data-testid="gp-import-file-input"
      />

      {/* Actions */}
      <div className="cg-section">
        <div className="gp-action-row">
          <button className="gp-action-btn" onClick={handleExport} data-testid="gp-export-btn">
            Export JSON
          </button>
          <button className="gp-action-btn" onClick={handleImportClick} data-testid="gp-import-btn">
            Import JSON
          </button>
          <button className="gp-action-btn" onClick={handleReset} data-testid="gp-reset-btn">
            Reset
          </button>
        </div>
        {importError && (
          <div className="gp-import-error" data-testid="gp-import-error">
            {importError}
          </div>
        )}
      </div>

      {/* Canonical color strip */}
      <div className="cg-section">
        <div className="cg-section-title">Canonical Colors</div>
        <CanonicalStrip
          canonicalL={canonicalL}
          selectedHue={selectedHue}
          onSelectHue={setSelectedHue}
        />
      </div>

      {/* L Curve Editor */}
      <div className="cg-section">
        <div className="cg-section-title">Canonical Lightness — drag to adjust</div>
        <LCurveEditor
          canonicalL={canonicalL}
          onChange={handleLChange}
          selectedHue={selectedHue}
          onSelectHue={setSelectedHue}
        />
      </div>

      {/* VibVal grid for selected hue */}
      {selectedHue && (
        <div className="cg-section">
          <div className="cg-section-title">{selectedHue} — Vibrancy x Value</div>
          <VibValGrid
            hueName={selectedHue}
            canonicalL={canonicalL[selectedHue]}
          />
        </div>
      )}
    </div>
  );
}
