/**
 * gallery-palette-content.tsx -- TugColor palette tuning editor.
 *
 * Interactive tool for defining 24 canonical colors in the TugColor color
 * system (Color · Intensity · Tone · Alpha). Each canonical color is defined
 * by its OKLCH hue angle (fixed in HUE_FAMILIES) and a tunable canonical
 * lightness. Intensity and tone axes let the developer derive any shade from
 * the canonical color.
 *
 * UI sections:
 *   - Canonical color strip: 24 swatches at intensity=50, tone=50
 *   - L curve editor: SVG with draggable points for per-hue canonical lightness
 *   - IntensityTonePicker: interactive 2D intensity/tone drag picker for the
 *     selected hue, with preset overlay and CSS formula export
 *   - Export/import: JSON serialization of canonical L values
 *
 * Rules of Tugways compliance:
 *   - Swatch colors set via inline style, not React appearance state [D08, D09]
 *   - Local useState for UI state only [D40]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-palette-content
 */

import React, { useState, useRef, useCallback } from "react";
import {
  HUE_FAMILIES,
  ADJACENCY_RING,
  tugColor,
  DEFAULT_CANONICAL_L,
  TUG_COLOR_PRESETS,
  L_DARK,
  L_LIGHT,
} from "@/components/tugways/palette-engine";
import { TugButton } from "@/components/tugways/tug-button";
import { TugHueStrip } from "@/components/tugways/tug-hue-strip";
import "./gallery-palette-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUE_NAMES: readonly string[] = ADJACENCY_RING;

const INTENSITY_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const TONE_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];

// ---------------------------------------------------------------------------
// SVG curve coordinate helpers (constants, outside component)
// ---------------------------------------------------------------------------

const VIEWBOX_W = 720;
const VIEWBOX_H = 260;
const CURVE_PAD = { top: 12, right: 52, bottom: 92, left: 36 };
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
        fill="var(--tug-base-surface-default, #1a1a1a)"
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
            stroke="var(--tug-base-border-default, #333)"
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
        stroke="var(--tug-base-fg-muted, #888)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* Draggable points + hue labels */}
      {HUE_NAMES.map((name, i) => {
        const cx = hueX(i);
        const cy = lToY(canonicalL[name]);
        const dotColor = tugColor(name, 70, 50, canonicalL[name]);
        const isSelected = name === selectedHue;
        return (
          <g key={name}>
            {/* Hue name (rotated) */}
            <text
              x={cx}
              y={CURVE_PAD.top + PLOT_H + 6}
              textAnchor="start"
              transform={`rotate(62, ${cx}, ${CURVE_PAD.top + PLOT_H + 6})`}
              className={`gp-curve-hue-label${isSelected ? " gp-curve-hue-label--selected" : ""}`}
            >
              {name}
            </text>
            {/* Selection ring */}
            {isSelected && (
              <circle
                cx={cx}
                cy={cy}
                r={9}
                fill="none"
                stroke="var(--tug-base-accent-default, #0066cc)"
                strokeWidth={2}
              />
            )}
            {/* Draggable dot */}
            <circle
              cx={cx}
              cy={cy}
              r={6}
              fill={dotColor}
              stroke={isSelected ? "var(--tug-base-accent-default, #0066cc)" : "var(--tug-base-border-default, #555)"}
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

// CanonicalStrip is now provided by the shared TugHueStrip component.

// ---------------------------------------------------------------------------
// TugAchromaticStrip — 10 achromatic steps from black (0) to white (100)
// ---------------------------------------------------------------------------

/** 11 achromatic steps: 0 (black) through 100 (white) in increments of 10. */
const GRAY_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * Compute the oklch() string for gray at a given tone, using the same
 * piecewise tone formula as the PostCSS plugin (canonical L=0.5).
 */
function grayOklch(tone: number): string {
  const canonicalL = 0.5;
  const L =
    L_DARK +
    Math.min(tone, 50) * (canonicalL - L_DARK) / 50 +
    Math.max(tone - 50, 0) * (L_LIGHT - canonicalL) / 50;
  const Lstr = parseFloat(L.toFixed(4)).toString();
  return `oklch(${Lstr} 0 0)`;
}

/**
 * Achromatic strip: renders 10 gray tone steps from black (0) to white (100).
 * Gray-0 is a synonym for black, gray-100 is a synonym for white.
 */
export function TugAchromaticStrip() {
  return (
    <div className="gp-achromatic-strip" data-testid="tug-achromatic-strip">
      {GRAY_STEPS.map((tone) => {
        const color = grayOklch(tone);
        const label = tone === 0 ? "black" : tone === 100 ? "white" : `gray-${tone}`;
        const name = tone === 0 ? "black" : tone === 100 ? "white" : "gray";
        return (
          <div
            key={tone}
            className="gp-achromatic-swatch"
            style={{ backgroundColor: color }}
            title={`${label}: ${color}`}
            data-testid="gp-achromatic-swatch"
            data-color={color}
            data-name={name}
            data-tone={tone}
          >
            <span className="gp-achromatic-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IntensityToneGrid — 2D grid of intensity x tone for a single hue
// ---------------------------------------------------------------------------

function IntensityToneGrid({
  hueName,
  canonicalL,
}: {
  hueName: string;
  canonicalL: number;
}) {
  return (
    <div className="gp-vvgrid" data-testid="gp-vibval-grid">
      {/* Header row: intensity labels */}
      <div className="gp-vvgrid-row">
        <div className="gp-vvgrid-corner" />
        {INTENSITY_STEPS.map((v) => (
          <div key={v} className="gp-vvgrid-header-cell">{v}</div>
        ))}
      </div>
      {/* Data rows: tone from 100 (top) to 0 (bottom) */}
      {TONE_STEPS.map((tone) => (
        <div key={tone} className="gp-vvgrid-row" data-testid="gp-vvgrid-val-row">
          <div className="gp-vvgrid-row-label">{tone}</div>
          {INTENSITY_STEPS.map((intensity) => {
            const color = tugColor(hueName, intensity, tone, canonicalL);
            const isCanonical = intensity === 50 && tone === 50;
            return (
              <div
                key={intensity}
                className={`gp-vvgrid-cell${isCanonical ? " gp-vvgrid-cell--canonical" : ""}`}
                style={{ backgroundColor: color }}
                title={`${hueName} intensity=${intensity} tone=${tone}: ${color}`}
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
// IntensityTone picker grid constants
// ---------------------------------------------------------------------------

// 21 steps: 0, 5, 10, ..., 100  (intensity x-axis, tone y-axis)
const PICKER_STEPS = 21;
const PICKER_TONES = Array.from({ length: PICKER_STEPS }, (_, i) => 100 - i * 5); // 100..0 top-to-bottom
const PICKER_INTENSITIES = Array.from({ length: PICKER_STEPS }, (_, i) => i * 5); // 0..100 left-to-right

// ---------------------------------------------------------------------------
// PresetOverlay — 5 labeled preset dots on the picker surface
// ---------------------------------------------------------------------------

function PresetOverlay() {
  return (
    <>
      {Object.entries(TUG_COLOR_PRESETS).map(([name, { intensity, tone }]) => {
        // left = intensity/100*100%, bottom = tone/100*100%
        const leftPct = intensity;
        const bottomPct = tone;
        return (
          <div
            key={name}
            className="gp-picker-preset-dot"
            style={{ left: `${leftPct}%`, bottom: `${bottomPct}%` }}
            data-testid="gp-preset-dot"
            data-preset={name}
            title={`${name} (intensity=${intensity}, tone=${tone})`}
          >
            <span className="gp-picker-preset-label">{name}</span>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// CssFormulaExport — generates and copies CSS formula snippet
// ---------------------------------------------------------------------------

function CssFormulaExport({
  hueName,
  intensity,
  tone,
}: {
  hueName: string;
  intensity: number;
  tone: number;
}) {
  const [copied, setCopied] = useState(false);

  const formula = [
    `oklch(`,
    `  calc(`,
    `    var(--tug-l-dark)`,
    `    + clamp(0, ${tone}, 50)`,
    `      * (var(--tug-${hueName}-canonical-l) - var(--tug-l-dark)) / 50`,
    `    + (clamp(50, ${tone}, 100) - 50)`,
    `      * (var(--tug-l-light) - var(--tug-${hueName}-canonical-l)) / 50`,
    `  )`,
    `  calc(${intensity} / 100 * var(--tug-${hueName}-peak-c))`,
    `  var(--tug-${hueName}-h)`,
    `)`,
  ].join("\n");

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(formula).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // clipboard unavailable in test env — silently ignore
    });
  }, [formula]);

  return (
    <div className="gp-formula-export" data-testid="gp-formula-export">
      <pre className="gp-formula-snippet" data-testid="gp-formula-snippet">{formula}</pre>
      <TugButton
        emphasis="ghost"
        role="action"
        size="sm"
        onClick={handleCopy}
        data-testid="gp-formula-copy-btn"
      >
        {copied ? "Copied" : "Copy CSS"}
      </TugButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IntensityTonePicker — interactive 2D intensity/tone drag picker
// ---------------------------------------------------------------------------

function IntensityTonePicker({
  hueName,
  canonicalL,
}: {
  hueName: string;
  canonicalL: number;
}) {
  const [intensity, setIntensity] = useState(50);
  const [tone, setTone] = useState(50);
  const gridRef = useRef<HTMLDivElement>(null);
  const capturedRef = useRef(false);

  const computeIntensityTone = useCallback((clientX: number, clientY: number) => {
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const rawIntensity = ((clientX - rect.left) / rect.width) * 100;
    const rawTone = (1 - (clientY - rect.top) / rect.height) * 100;
    setIntensity(Math.round(Math.max(0, Math.min(100, rawIntensity))));
    setTone(Math.round(Math.max(0, Math.min(100, rawTone))));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    capturedRef.current = true;
    computeIntensityTone(e.clientX, e.clientY);
  }, [computeIntensityTone]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!capturedRef.current) return;
    computeIntensityTone(e.clientX, e.clientY);
  }, [computeIntensityTone]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    capturedRef.current = false;
  }, []);

  const selectedColor = tugColor(hueName, intensity, tone, canonicalL);

  // Crosshair position: left = intensity%, bottom = tone%
  const crosshairLeft = `${intensity}%`;
  const crosshairBottom = `${tone}%`;

  return (
    <div className="gp-picker-outer" data-testid="gp-picker-outer">
      {/* 2D color grid surface */}
      <div
        ref={gridRef}
        className="gp-picker-grid"
        data-testid="gp-picker-grid"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ touchAction: "none" }}
      >
        {/* Rows: tone from 100 (top) to 0 (bottom) */}
        {PICKER_TONES.map((rowTone) => (
          <div key={rowTone} className="gp-picker-row">
            {PICKER_INTENSITIES.map((colIntensity) => {
              const color = tugColor(hueName, colIntensity, rowTone, canonicalL);
              return (
                <div
                  key={colIntensity}
                  className="gp-picker-cell"
                  style={{ backgroundColor: color }}
                  data-testid="gp-picker-cell"
                  data-color={color}
                />
              );
            })}
          </div>
        ))}

        {/* Preset overlay dots */}
        <PresetOverlay />

        {/* Crosshair indicator */}
        <div
          className="gp-picker-crosshair"
          style={{ left: crosshairLeft, bottom: crosshairBottom }}
          data-testid="gp-picker-crosshair"
        />
      </div>

      {/* Result swatch */}
      <div
        className="gp-picker-swatch"
        style={{ backgroundColor: selectedColor }}
        data-testid="gp-picker-swatch"
        data-color={selectedColor}
        title={`intensity=${intensity}, tone=${tone}: ${selectedColor}`}
      />

      {/* Intensity/tone readout */}
      <div className="gp-picker-readout" data-testid="gp-picker-readout">
        <span>intensity={intensity}</span>
        <span>tone={tone}</span>
      </div>

      {/* CSS formula export */}
      <CssFormulaExport hueName={hueName} intensity={intensity} tone={tone} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON export/import helpers (exported for unit testing)
// ---------------------------------------------------------------------------

const EXPORT_VERSION = 2;

interface TugColorExportPayload {
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
  const payload: TugColorExportPayload = {
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
    a.download = "tug-color-canonical.json";
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
          <TugButton emphasis="ghost" role="action" size="sm" onClick={handleExport} data-testid="gp-export-btn">
            Export JSON
          </TugButton>
          <TugButton emphasis="ghost" role="action" size="sm" onClick={handleImportClick} data-testid="gp-import-btn">
            Import JSON
          </TugButton>
          <TugButton emphasis="ghost" role="danger" size="sm" onClick={handleReset} data-testid="gp-reset-btn">
            Reset
          </TugButton>
        </div>
        {importError && (
          <div className="gp-import-error" data-testid="gp-import-error">
            {importError}
          </div>
        )}
      </div>

      {/* Achromatic strip: black / gray / white */}
      <div className="cg-section">
        <div className="cg-section-title">Achromatic</div>
        <TugAchromaticStrip />
      </div>

      {/* Canonical color strip */}
      <div className="cg-section">
        <div className="cg-section-title">Canonical Colors</div>
        <TugHueStrip
          canonicalL={canonicalL}
          selectedHue={selectedHue}
          onSelectHue={setSelectedHue}
          data-testid="gp-canonical-strip"
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

      {/* IntensityTone picker for selected hue */}
      {selectedHue && (
        <div className="cg-section">
          <div className="cg-section-title">{selectedHue} — Intensity x Tone</div>
          <IntensityTonePicker
            hueName={selectedHue}
            canonicalL={canonicalL[selectedHue]}
          />
        </div>
      )}
    </div>
  );
}
