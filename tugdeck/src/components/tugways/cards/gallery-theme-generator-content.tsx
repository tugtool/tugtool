/**
 * gallery-theme-generator-content.tsx — Theme Generator gallery card.
 *
 * Shows the active shipped theme's token output and accessibility diagnostics:
 *   - Color pickers (read-only display of active theme)
 *   - Token preview grid
 *   - Contrast dashboard
 *   - CVD preview strip
 *   - Contrast diagnostics panel
 *
 * On mount, loads the currently active app theme via GET /__themes/<name>.json.
 * Controls are always read-only (shipped themes only).
 *
 * Rules of Tugways compliance:
 *   - Appearance changes through CSS custom properties, never React state. [L06]
 *   - useState only for local UI state (not external store).
 *   - No root.render() after initial mount.
 *
 * @module components/tugways/cards/gallery-theme-generator-content
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { tugColor, DEFAULT_CANONICAL_L, oklchToHex } from "@/components/tugways/palette-engine";
import {
  deriveTheme,
  type ThemeSpec,
  type ThemeOutput,
  type ContrastResult,
  type ContrastDiagnostic,
  type CVDWarning,
} from "@/components/tugways/theme-engine";
import { BASE_THEME_NAME } from "@/theme-constants";
import { BASE_THEME_SPEC } from "@/generated/base-theme";

import {
  validateThemeContrast,
  checkCVDDistinguishability,
  CVD_SEMANTIC_PAIRS,
  simulateCVDFromOKLCH,
  WCAG_CONTRAST_THRESHOLDS,
  CONTRAST_THRESHOLDS,
  CONTRAST_MARGINAL_DELTA,
  type CVDType,
} from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/theme-pairings";
import { TugButton } from "@/components/tugways/tug-button";
import { TugToneStrip, TugIntensityStrip } from "@/components/tugways/tug-color-strip";
import type { TugButtonEmphasis, TugButtonRole } from "@/components/tugways/tug-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole } from "@/components/tugways/tug-badge";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import type { TugCheckboxRole } from "@/components/tugways/tug-checkbox";
import { TugSwitch } from "@/components/tugways/tug-switch";
import type { TugSwitchRole } from "@/components/tugways/tug-switch";
import { useOptionalThemeContext } from "@/contexts/theme-provider";
import "./gallery-theme-generator-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Convert a ResolvedColor to an oklch() CSS string. */
function resolvedToCSS(r: { L: number; C: number; h: number; alpha: number }): string {
  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  const a = r.alpha < 1 ? ` / ${fmt(r.alpha)}` : "";
  return `oklch(${fmt(r.L)} ${fmt(r.C)} ${r.h}${a})`;
}

/**
 * Token names used to sample the actual resolved color for each surface hue.
 */
const SURFACE_TOKENS: Record<string, string> = {
  card: "--tug-surface-global-primary-normal-primary-rest",
  canvas: "--tug-surface-global-primary-normal-canvas-rest",
};

/**
 * Token names used to sample the actual resolved color for each element hue.
 */
const ELEMENT_TOKENS: Record<string, string> = {
  content: "--tug-element-global-text-normal-default-rest",
  control: "--tug-element-global-icon-normal-default-rest",
  display: "--tug-element-global-text-normal-default-rest",
  informational: "--tug-element-global-text-normal-muted-rest",
  border: "--tug-element-global-border-normal-default-rest",
  decorative: "--tug-element-global-border-normal-muted-rest",
};

const ROLE_TOKENS: Record<string, string> = {
  accent: "--tug-element-tone-fill-normal-accent-rest",
  action: "--tug-element-tone-fill-normal-active-rest",
  agent: "--tug-element-tone-fill-normal-agent-rest",
  data: "--tug-element-tone-fill-normal-data-rest",
  success: "--tug-element-tone-fill-normal-success-rest",
  caution: "--tug-element-tone-fill-normal-caution-rest",
  danger: "--tug-element-tone-fill-normal-danger-rest",
};

// ---------------------------------------------------------------------------
// CompactHuePicker — compact row with color chip (read-only, always disabled)
// ---------------------------------------------------------------------------

/**
 * Compute the canonical-L swatch color for a hue name using tugColor at
 * intensity=50 tone=50 with the hue's canonical L value.
 */
function hueSwatchColor(hueName: string): string {
  const canonicalL = DEFAULT_CANONICAL_L[hueName] ?? 0.55;
  return tugColor(hueName, 50, 50, canonicalL);
}

function CompactHuePicker({
  label,
  selectedHue,
  testId,
  actualColor,
  preview,
}: {
  label: string;
  selectedHue: string;
  testId: string;
  actualColor?: string;
  preview?: React.ReactNode;
}) {
  const swatchColor = actualColor ?? hueSwatchColor(selectedHue);

  return (
    <button
      className="gtg-compact-hue-row"
      data-testid={testId}
      aria-label={`${label}: ${selectedHue} (read-only)`}
      type="button"
      disabled
    >
      {preview && <span className="gtg-hue-preview" aria-hidden="true">{preview}</span>}
      <span className="gtg-compact-hue-label">{label}</span>
      <span
        className="gtg-compact-hue-chip"
        style={{ backgroundColor: swatchColor }}
        aria-hidden="true"
      />
      <span className="gtg-compact-hue-name">{selectedHue}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FullColorPicker — compact row (read-only, always disabled)
// ---------------------------------------------------------------------------

function FullColorPicker({
  label,
  selectedHue,
  tone,
  intensity,
  testId,
  actualColor,
}: {
  label: string;
  selectedHue: string;
  tone: number;
  intensity: number;
  testId: string;
  actualColor?: string;
}) {
  const swatchColor = actualColor ?? hueSwatchColor(selectedHue);

  return (
    <button
      className="gtg-compact-hue-row"
      data-testid={testId}
      aria-label={`${label}: ${selectedHue}, tone ${tone}, intensity ${intensity} (read-only)`}
      type="button"
      disabled
    >
      <span className="gtg-compact-hue-label">{label}</span>
      <span
        className="gtg-compact-hue-chip"
        style={{ backgroundColor: swatchColor }}
        aria-hidden="true"
      />
      <span className="gtg-compact-hue-name">{selectedHue}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// HueIntensityPicker — compact row (read-only, always disabled)
// ---------------------------------------------------------------------------

function HueIntensityPicker({
  label,
  selectedHue,
  intensity,
  testId,
  actualColor,
}: {
  label: string;
  selectedHue: string;
  intensity: number;
  testId: string;
  actualColor?: string;
}) {
  const swatchColor = actualColor ?? hueSwatchColor(selectedHue);

  return (
    <button
      className="gtg-compact-hue-row"
      data-testid={testId}
      aria-label={`${label}: ${selectedHue}, intensity ${intensity} (read-only)`}
      type="button"
      disabled
    >
      <span className="gtg-compact-hue-label">{label}</span>
      <span
        className="gtg-compact-hue-chip"
        style={{ backgroundColor: swatchColor }}
        aria-hidden="true"
      />
      <span className="gtg-compact-hue-name">{selectedHue}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// TokenPreview — scrollable grid of all 264 tokens
// ---------------------------------------------------------------------------

function resolvedToOklch(resolved: ThemeOutput["resolved"], tokenName: string): string {
  const r = resolved[tokenName];
  if (!r) return "transparent";
  const { L, C, h, alpha } = r;
  if (alpha < 1) {
    return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)} / ${alpha.toFixed(2)})`;
  }
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
}

function TokenPreview({ output }: { output: ThemeOutput }) {
  const tokenEntries = Object.entries(output.tokens);

  return (
    <div className="gtg-token-grid" data-testid="gtg-token-grid">
      <div className="gtg-token-header">
        <span>Token</span>
        <span>Color</span>
        <span>Value</span>
      </div>
      {tokenEntries.map(([name, value]) => {
        const swatchColor = resolvedToOklch(output.resolved, name);
        return (
          <React.Fragment key={name}>
            <span className="gtg-token-name" title={name}>{name}</span>
            <div
              className="gtg-token-swatch"
              style={{ backgroundColor: swatchColor }}
              title={swatchColor}
            />
            <span className="gtg-token-value" title={value}>{value}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContrastDashboard — fg/bg pair grid with badges and summary bar
// ---------------------------------------------------------------------------

function badgeVariant(
  result: ContrastResult,
): "pass" | "marginal" | "fail" | "decorative" {
  if (result.role === "decorative") return "decorative";
  if (result.contrastPass) return "pass";
  const threshold = CONTRAST_THRESHOLDS[result.role] ?? 15;
  if (Math.abs(result.contrast) >= threshold - CONTRAST_MARGINAL_DELTA) return "marginal";
  return "fail";
}

function contrastLabel(result: ContrastResult): string {
  return `Contrast ${result.contrast.toFixed(1)}`;
}

function resolvedSwatchColor(
  resolved: ThemeOutput["resolved"],
  tokenName: string,
): string {
  const r = resolved[tokenName];
  if (!r) return "transparent";
  return oklchToHex(r.L, r.C, r.h);
}

function ContrastDashboard({
  output,
  contrastResults,
}: {
  output: ThemeOutput;
  contrastResults: ContrastResult[];
}) {
  const passCount = contrastResults.filter((r) => r.role !== "decorative" && r.contrastPass).length;
  const checkedCount = contrastResults.filter((r) => r.role !== "decorative").length;

  let summaryClass = "gtg-dash-summary-count";
  if (checkedCount > 0) {
    if (passCount === checkedCount) {
      summaryClass += " gtg-dash-summary-count--all-pass";
    } else if (passCount >= checkedCount / 2) {
      summaryClass += " gtg-dash-summary-count--partial";
    } else {
      summaryClass += " gtg-dash-summary-count--fail";
    }
  }

  return (
    <div data-testid="gtg-contrast-dashboard">
      <div className="gtg-dash-summary" data-testid="gtg-dash-summary">
        <span className={summaryClass} data-testid="gtg-dash-summary-count">
          {passCount}/{checkedCount}
        </span>
        <span>pairs pass contrast</span>
        <span style={{ color: "var(--tug-element-global-text-normal-muted-rest)", marginLeft: "4px" }}>
          ({contrastResults.length} total pairs, {contrastResults.length - checkedCount} decorative)
        </span>
      </div>

      <div className="gtg-dash-grid" data-testid="gtg-dash-grid">
        <div className="gtg-dash-col-header">
          <span title="Foreground color swatch">FG</span>
          <span title="Background color swatch">BG</span>
          <span>Foreground token</span>
          <span>Background token</span>
          <span>WCAG 2.x</span>
          <span>Contrast</span>
          <span>Badge</span>
        </div>

        {contrastResults.map((result, idx) => {
          const variant = badgeVariant(result);
          const fgSwatchColor = resolvedSwatchColor(output.resolved, result.fg);
          const bgSwatchColor = resolvedSwatchColor(output.resolved, result.bg);
          const threshold = WCAG_CONTRAST_THRESHOLDS[result.role] ?? 1.0;
          const contrastThreshold = CONTRAST_THRESHOLDS[result.role] ?? 15;

          return (
            <React.Fragment key={idx}>
              <div
                className="gtg-dash-swatch"
                style={{ backgroundColor: fgSwatchColor }}
                title={result.fg}
                data-testid="gtg-dash-fg-swatch"
              />
              <div
                className="gtg-dash-swatch"
                style={{ backgroundColor: bgSwatchColor }}
                title={result.bg}
                data-testid="gtg-dash-bg-swatch"
              />
              <span
                className="gtg-dash-token-name"
                title={result.fg}
                data-testid="gtg-dash-fg-name"
              >
                {result.fg}
              </span>
              <span
                className="gtg-dash-token-name"
                title={result.bg}
                data-testid="gtg-dash-bg-name"
              >
                {result.bg}
              </span>
              <span
                className="gtg-dash-ratio"
                title={`Threshold: ${threshold}:1`}
                data-testid="gtg-dash-wcag-ratio"
              >
                {result.wcagRatio.toFixed(2)}:1
              </span>
              <span
                className="gtg-dash-ratio"
                title={`Contrast threshold: ${contrastThreshold}`}
                data-testid="gtg-dash-contrast"
              >
                {contrastLabel(result)}
              </span>
              <span
                className={`gtg-dash-badge gtg-dash-badge--${variant}`}
                data-testid="gtg-dash-badge"
                data-variant={variant}
              >
                {variant === "pass" ? "Pass" : variant === "marginal" ? "Marginal" : variant === "decorative" ? "Decorative" : "Fail"}
              </span>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CVD preview strip constants and helpers
// ---------------------------------------------------------------------------

const CVD_TYPES: CVDType[] = ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"];

const CVD_TYPE_LABELS: Record<CVDType, string> = {
  protanopia: "Protanopia",
  deuteranopia: "Deuteranopia",
  tritanopia: "Tritanopia",
  achromatopsia: "Achromatopsia",
};

const CVD_SEMANTIC_TOKENS: Array<{ token: string; label: string }> = [
  { token: "--tug-element-tone-fill-normal-accent-rest",   label: "Accent" },
  { token: "--tug-element-tone-fill-normal-active-rest",   label: "Active" },
  { token: "--tug-element-tone-fill-normal-agent-rest",    label: "Agent" },
  { token: "--tug-element-tone-fill-normal-data-rest",     label: "Data" },
  { token: "--tug-element-tone-fill-normal-success-rest",  label: "Success" },
  { token: "--tug-element-tone-fill-normal-caution-rest",  label: "Caution" },
  { token: "--tug-element-tone-fill-normal-danger-rest",   label: "Danger" },
];

function linearSrgbToHex(linear: { r: number; g: number; b: number }): string {
  const enc = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    const gamma = clamped >= 0.0031308
      ? 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
      : 12.92 * clamped;
    return Math.round(Math.max(0, Math.min(1, gamma)) * 255);
  };
  const r = enc(linear.r).toString(16).padStart(2, "0");
  const g = enc(linear.g).toString(16).padStart(2, "0");
  const b = enc(linear.b).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

// ---------------------------------------------------------------------------
// CvdPreviewStrip — 4-row simulation table
// ---------------------------------------------------------------------------

function CvdPreviewStrip({
  output,
  cvdWarnings,
}: {
  output: ThemeOutput;
  cvdWarnings: CVDWarning[];
}) {
  const warnedTypes = useMemo(() => {
    const types = new Set<string>();
    for (const w of cvdWarnings) {
      types.add(w.type);
    }
    return types;
  }, [cvdWarnings]);

  return (
    <div className="gtg-cvd-strip" data-testid="gtg-cvd-strip">
      <div className="gtg-cvd-col-headers">
        <div className="gtg-cvd-type-label-cell" />
        {CVD_SEMANTIC_TOKENS.map(({ label }) => (
          <div key={label} className="gtg-cvd-token-header" title={label}>
            {label}
          </div>
        ))}
      </div>

      {CVD_TYPES.map((cvdType) => {
        const hasWarning = warnedTypes.has(cvdType);
        return (
          <div
            key={cvdType}
            className="gtg-cvd-row"
            data-testid="gtg-cvd-row"
            data-cvd-type={cvdType}
          >
            <div className="gtg-cvd-type-label-cell">
              <span className="gtg-cvd-type-label">{CVD_TYPE_LABELS[cvdType]}</span>
              {hasWarning && (
                <span
                  className="gtg-cvd-warn-badge"
                  title="One or more semantic pairs may be indistinguishable under this CVD type"
                  data-testid="gtg-cvd-warn-badge"
                >
                  !
                </span>
              )}
            </div>

            {CVD_SEMANTIC_TOKENS.map(({ token, label }) => {
              const resolved = output.resolved[token];
              if (!resolved) {
                return (
                  <div key={token} className="gtg-cvd-swatch-pair">
                    <div className="gtg-cvd-swatch gtg-cvd-swatch--missing" title="N/A" />
                    <div className="gtg-cvd-swatch gtg-cvd-swatch--missing" title="N/A" />
                  </div>
                );
              }

              const origHex = oklchToHex(resolved.L, resolved.C, resolved.h);
              const simLinear = simulateCVDFromOKLCH(resolved.L, resolved.C, resolved.h, cvdType);
              const simHex = linearSrgbToHex(simLinear);

              return (
                <div key={token} className="gtg-cvd-swatch-pair" title={`${label}: ${origHex} → ${simHex}`}>
                  <div
                    className="gtg-cvd-swatch"
                    style={{ backgroundColor: origHex }}
                    title={`Original: ${origHex}`}
                    data-testid="gtg-cvd-orig-swatch"
                  />
                  <div
                    className="gtg-cvd-swatch"
                    style={{ backgroundColor: simHex }}
                    title={`Simulated (${cvdType}): ${simHex}`}
                    data-testid="gtg-cvd-sim-swatch"
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContrastDiagnosticsPanel — structured contrast diagnostic output
// ---------------------------------------------------------------------------

function ContrastDiagnosticsPanel({
  diagnostics,
  cvdWarnings,
}: {
  diagnostics: ContrastDiagnostic[];
  cvdWarnings: CVDWarning[];
}) {
  const floorApplied = useMemo(
    () => diagnostics.filter((d) => d.reason === "floor-applied"),
    [diagnostics],
  );
  const structurallyFixed = useMemo(
    () => diagnostics.filter((d) => d.reason === "structurally-fixed"),
    [diagnostics],
  );

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return cvdWarnings.filter((w) => {
      if (seen.has(w.suggestion)) return false;
      seen.add(w.suggestion);
      return true;
    });
  }, [cvdWarnings]);

  return (
    <div className="gtg-autofix-panel" data-testid="gtg-autofix-panel">
      {floorApplied.length > 0 ? (
        <div className="gtg-diag-section" data-testid="gtg-diag-floor-section">
          <div className="gtg-diag-section-title" data-testid="gtg-diag-floor-title">
            Floor-applied ({floorApplied.length} token{floorApplied.length !== 1 ? "s" : ""} clamped to meet contrast threshold)
          </div>
          <ul className="gtg-diag-list" data-testid="gtg-diag-floor-list">
            {floorApplied.map((d, idx) => (
              <li key={idx} className="gtg-diag-item" data-testid="gtg-diag-floor-item">
                <span className="gtg-diag-token" title={d.token}>{d.token}</span>
                <span className="gtg-diag-detail">
                  tone {d.initialTone} → {d.finalTone} (threshold {d.threshold})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="gtg-diag-section" data-testid="gtg-diag-floor-section">
          <div className="gtg-diag-section-title" data-testid="gtg-diag-floor-title">
            No floor adjustments — all tokens passed contrast thresholds natively.
          </div>
        </div>
      )}

      {structurallyFixed.length > 0 && (
        <div className="gtg-diag-section" data-testid="gtg-diag-structural-section">
          <div className="gtg-diag-section-title" data-testid="gtg-diag-structural-title">
            Structurally fixed ({structurallyFixed.length} token{structurallyFixed.length !== 1 ? "s" : ""} not adjustable)
          </div>
          <ul className="gtg-diag-list" data-testid="gtg-diag-structural-list">
            {structurallyFixed.map((d, idx) => (
              <li key={idx} className="gtg-diag-item" data-testid="gtg-diag-structural-item">
                <span className="gtg-diag-token" title={d.token}>{d.token}</span>
                <span className="gtg-diag-detail">
                  surfaces: {d.surfaces.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="gtg-autofix-suggestions" data-testid="gtg-cvd-suggestions">
          <div className="gtg-autofix-suggestions-title">CVD hue-shift suggestions</div>
          <ul className="gtg-autofix-suggestion-list">
            {suggestions.map((w, idx) => (
              <li key={idx} className="gtg-autofix-suggestion-item" data-testid="gtg-cvd-suggestion-item">
                <span className="gtg-autofix-suggestion-type">{w.type}</span>
                {" — "}
                {w.suggestion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export / download helpers (CSS/JSON file download)
// ---------------------------------------------------------------------------

/**
 * Compute a simple djb2-style hash of a string for the recipe hash header.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Generate the CSS export string for a theme output.
 * Exported for unit testing.
 */
export function generateCssExport(
  output: ThemeOutput,
  spec: ThemeSpec,
): string {
  const specJson = JSON.stringify(spec);
  const hash = simpleHash(specJson);
  const dateStr = new Date().toISOString().slice(0, 10);

  const header = [
    "/**",
    ` * @theme-name ${spec.name}`,
    ` * @generated ${dateStr}`,
    ` * @spec-hash ${hash}`,
    " *",
    " * Generated by Theme Generator. Contains --tug-* overrides as --tug-color() values.",
    " * Spacing, radius, typography, stroke, icon-size are theme-invariant and not overridden.",
    " */",
  ].join("\n");

  const entries = Object.entries(output.tokens)
    .filter(([, v]) => v.startsWith("--tug-color("))
    .map(([name, value]) => `  ${name}: ${value};`);

  const body = ["body {", ...entries, "}"].join("\n");

  return `${header}\n${body}\n`;
}

/**
 * Validate that a value looks like a ThemeSpec.
 * Returns an error string if invalid, or null if valid.
 * Exported for unit testing.
 */
function isThemeColorSpec(v: unknown): v is { hue: string; tone: number; intensity: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>)["hue"] === "string" &&
    typeof (v as Record<string, unknown>)["tone"] === "number" &&
    typeof (v as Record<string, unknown>)["intensity"] === "number"
  );
}

export function validateRecipeJson(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "Expected an object";
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj["name"] !== "string" || obj["name"].trim() === "") {
    return "Missing or invalid 'name' field (string required)";
  }
  if (obj["mode"] !== "dark" && obj["mode"] !== "light") {
    return "Invalid 'mode' field (must be 'dark' or 'light')";
  }

  const isDark = obj["mode"] === "dark";

  if (typeof obj["surface"] !== "object" || obj["surface"] === null) {
    return "Missing or invalid 'surface' field (object required)";
  }
  const surface = obj["surface"] as Record<string, unknown>;

  const isOldFormat =
    typeof surface["canvas"] === "string" ||
    typeof surface["card"] === "string" ||
    (typeof obj["element"] === "object" && obj["element"] !== null) ||
    !isThemeColorSpec(surface["frame"]);

  if (isOldFormat) {
    let canvasHue: string;
    if (typeof surface["canvas"] === "string") {
      canvasHue = surface["canvas"].trim();
      if (canvasHue === "") return "Missing or invalid 'surface.canvas' field (string required)";
    } else if (isThemeColorSpec(surface["canvas"])) {
      canvasHue = surface["canvas"].hue;
    } else {
      return "Missing or invalid 'surface.canvas' field (string required)";
    }

    let frameHueMigrated: string;
    if (isThemeColorSpec(surface["frame"])) {
      frameHueMigrated = surface["frame"].hue;
    } else if (typeof surface["card"] === "string") {
      const h = surface["card"].trim();
      if (h === "") return "Missing or invalid 'surface.card' field (string required)";
      frameHueMigrated = h;
    } else if (isThemeColorSpec(surface["card"])) {
      frameHueMigrated = surface["card"].hue;
    } else {
      frameHueMigrated = canvasHue;
    }

    const canvasTone = isDark ? 5 : 95;
    const canvasIntensity = isDark ? 5 : 6;
    const gridTone = isDark ? 12 : 88;
    const gridIntensity = isDark ? 4 : 5;
    const frameTone = isDark ? 16 : 85;
    const frameIntensity = isDark ? 12 : 35;
    const cardBodyTone = isDark ? 12 : 90;
    const cardBodyIntensity = isDark ? 5 : 6;
    const textIntensity = isDark ? 3 : 4;
    const roleTone = isDark ? 50 : 55;
    const roleIntensity = isDark ? 50 : 60;

    let controlsCanvasTone = canvasTone;
    let controlsCanvasIntensity = canvasIntensity;
    let controlsFrameTone = frameTone;
    let controlsFrameIntensity = frameIntensity;
    let controlsRoleTone = roleTone;
    let controlsRoleIntensity = roleIntensity;
    if (typeof obj["controls"] === "object" && obj["controls"] !== null && !Array.isArray(obj["controls"])) {
      const controls = obj["controls"] as Record<string, unknown>;
      if (typeof controls["canvasTone"] === "number") controlsCanvasTone = controls["canvasTone"] as number;
      if (typeof controls["canvasIntensity"] === "number") controlsCanvasIntensity = controls["canvasIntensity"] as number;
      if (typeof controls["frameTone"] === "number") controlsFrameTone = controls["frameTone"] as number;
      if (typeof controls["frameIntensity"] === "number") controlsFrameIntensity = controls["frameIntensity"] as number;
      if (typeof controls["roleTone"] === "number") controlsRoleTone = controls["roleTone"] as number;
      if (typeof controls["roleIntensity"] === "number") controlsRoleIntensity = controls["roleIntensity"] as number;
    }

    let textHue = canvasHue;
    let displayHueOverride: string | undefined;
    if (typeof obj["element"] === "object" && obj["element"] !== null) {
      const element = obj["element"] as Record<string, unknown>;
      if (typeof element["content"] === "string" && element["content"].trim() !== "") {
        textHue = element["content"].trim();
      }
      if (typeof element["display"] === "string" && element["display"].trim() !== "" &&
          element["display"].trim() !== textHue) {
        displayHueOverride = element["display"].trim();
      }
    }

    if (typeof obj["role"] !== "object" || obj["role"] === null) {
      return "Missing or invalid 'role' field (object required)";
    }
    const role = obj["role"] as Record<string, unknown>;
    for (const field of ["accent", "action", "agent", "data", "success", "caution", "danger"] as const) {
      if (typeof role[field] !== "string" || (role[field] as string).trim() === "") {
        return `Missing or invalid 'role.${field}' field (string required)`;
      }
    }

    const finalCanvasTone = isThemeColorSpec(surface["canvas"]) ? surface["canvas"].tone : controlsCanvasTone;
    const finalCanvasIntensity = isThemeColorSpec(surface["canvas"]) ? surface["canvas"].intensity : controlsCanvasIntensity;
    const finalFrameTone = isThemeColorSpec(surface["card"]) ? surface["card"].tone : controlsFrameTone;
    const finalFrameIntensity = isThemeColorSpec(surface["card"]) ? surface["card"].intensity : controlsFrameIntensity;
    const finalFrameToneActual = isThemeColorSpec(surface["frame"]) ? surface["frame"].tone : finalFrameTone;
    const finalFrameIntensityActual = isThemeColorSpec(surface["frame"]) ? surface["frame"].intensity : finalFrameIntensity;
    const finalRoleTone = typeof (role as Record<string, unknown>)["tone"] === "number" ? (role as Record<string, unknown>)["tone"] as number : controlsRoleTone;
    const finalRoleIntensity = typeof (role as Record<string, unknown>)["intensity"] === "number" ? (role as Record<string, unknown>)["intensity"] as number : controlsRoleIntensity;

    obj["surface"] = {
      canvas: { hue: canvasHue, tone: finalCanvasTone, intensity: finalCanvasIntensity },
      grid: isThemeColorSpec(surface["grid"])
        ? surface["grid"]
        : { hue: canvasHue, tone: gridTone, intensity: gridIntensity },
      frame: { hue: frameHueMigrated, tone: finalFrameToneActual, intensity: finalFrameIntensityActual },
      card: { hue: canvasHue, tone: cardBodyTone, intensity: cardBodyIntensity },
    };
    obj["text"] = typeof obj["text"] === "object" && obj["text"] !== null
      ? obj["text"]
      : { hue: textHue, intensity: textIntensity };
    if ((role as Record<string, unknown>)["tone"] === undefined || (role as Record<string, unknown>)["tone"] === null) {
      (role as Record<string, unknown>)["tone"] = finalRoleTone;
    }
    if ((role as Record<string, unknown>)["intensity"] === undefined || (role as Record<string, unknown>)["intensity"] === null) {
      (role as Record<string, unknown>)["intensity"] = finalRoleIntensity;
    }
    if (displayHueOverride !== undefined && !obj["display"]) {
      obj["display"] = { hue: displayHueOverride, intensity: textIntensity };
    }
    delete obj["element"];
    delete obj["controls"];
    return null;
  }

  for (const field of ["canvas", "grid", "frame", "card"] as const) {
    if (!isThemeColorSpec(surface[field])) {
      return `Missing or invalid 'surface.${field}' field (ThemeColorSpec with hue, tone, intensity required)`;
    }
  }

  if (typeof obj["text"] !== "object" || obj["text"] === null) {
    return "Missing or invalid 'text' field (object required)";
  }
  const text = obj["text"] as Record<string, unknown>;
  if (typeof text["hue"] !== "string" || text["hue"].trim() === "") {
    return "Missing or invalid 'text.hue' field (string required)";
  }
  if (typeof text["intensity"] !== "number") {
    return "Missing or invalid 'text.intensity' field (number required)";
  }

  if (typeof obj["role"] !== "object" || obj["role"] === null) {
    return "Missing or invalid 'role' field (object required)";
  }
  const role = obj["role"] as Record<string, unknown>;
  if (typeof role["tone"] !== "number") {
    return "Missing or invalid 'role.tone' field (number required)";
  }
  if (typeof role["intensity"] !== "number") {
    return "Missing or invalid 'role.intensity' field (number required)";
  }
  for (const field of ["accent", "action", "agent", "data", "success", "caution", "danger"] as const) {
    if (typeof role[field] !== "string" || (role[field] as string).trim() === "") {
      return `Missing or invalid 'role.${field}' field (string required)`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// EmphasisRolePreview — emphasis x role matrix for buttons, badges, and
// selection controls
// ---------------------------------------------------------------------------

const BUTTON_EMPHASES: TugButtonEmphasis[] = ["filled", "outlined", "ghost"];
const BADGE_EMPHASES: TugBadgeEmphasis[] = ["filled", "outlined", "ghost"];
const BUTTON_ROLES: TugButtonRole[] = ["accent", "action", "data", "danger"];
const BADGE_ROLES: TugBadgeRole[] = [
  "accent", "action", "agent", "data", "success", "caution", "danger",
];
const SELECTION_ROLES: TugCheckboxRole[] = [
  "accent", "action", "agent", "data", "success", "caution", "danger",
];

function EmphasisRolePreview() {
  return (
    <div className="gtg-emphasis-role-preview" data-testid="gtg-emphasis-role-preview">
      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Buttons (3 emphasis × 4 roles)</div>
        <div className="gtg-erp-button-grid" data-testid="gtg-erp-button-grid">
          {BUTTON_EMPHASES.map((emphasis) => (
            <React.Fragment key={emphasis}>
              <div className="gtg-erp-row-label">{emphasis}</div>
              {BUTTON_ROLES.map((role) => (
                <div key={role} className="gtg-erp-cell">
                  <TugButton emphasis={emphasis} role={role} size="sm">
                    {role}
                  </TugButton>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Badges (3 emphasis × 7 roles)</div>
        <div className="gtg-erp-badge-grid" data-testid="gtg-erp-badge-grid">
          {BADGE_EMPHASES.map((emphasis) => (
            <React.Fragment key={emphasis}>
              <div className="gtg-erp-row-label">{emphasis}</div>
              {BADGE_ROLES.map((role) => (
                <div key={role} className="gtg-erp-cell">
                  <TugBadge emphasis={emphasis} role={role}>
                    {role}
                  </TugBadge>
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Selection Controls (7 roles, checked)</div>
        <div className="gtg-erp-selection-row" data-testid="gtg-erp-selection-row">
          {SELECTION_ROLES.map((role) => (
            <div key={role} className="gtg-erp-selection-cell">
              <div className="gtg-erp-col-label">{role}</div>
              <TugCheckbox role={role} checked aria-label={`checkbox-${role}`} />
              <TugSwitch role={role as TugSwitchRole} checked aria-label={`switch-${role}`} />
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// ThemePreviewCard — color pickers for surface/text/role hues (read-only)
// ---------------------------------------------------------------------------

function ThemePreviewCard({
  resolvedColor,
  surface,
  text,
  roles,
  roleTone,
  roleIntensity,
}: {
  resolvedColor: (key: string) => string;
  surface: Array<{
    key: string;
    label: string;
    hue: string;
    tone: number;
    intensity: number;
    testId: string;
  }>;
  text: {
    key: string;
    label: string;
    hue: string;
    intensity: number;
    testId: string;
  };
  roles: Array<{ key: string; label: string; hue: string; testId: string }>;
  roleTone: number;
  roleIntensity: number;
}) {
  const roleRepresentativeHue = roles[0]?.hue ?? "blue";

  return (
    <div className="gtg-annotated-preview" data-testid="gtg-theme-preview">
      <div className="gtg-picker-columns">
        {/* Left column: Surface + Text */}
        <div className="gtg-hue-column">
          <div className="gtg-hue-column-title">Surface</div>
          {surface.map((s) => (
            <FullColorPicker
              key={s.key}
              label={s.label}
              selectedHue={s.hue}
              tone={s.tone}
              intensity={s.intensity}
              testId={s.testId}
              actualColor={resolvedColor(s.key)}
            />
          ))}

          <div className="gtg-hue-column-title">Text</div>
          <HueIntensityPicker
            label={text.label}
            selectedHue={text.hue}
            intensity={text.intensity}
            testId={text.testId}
            actualColor={resolvedColor(text.key)}
          />
        </div>

        {/* Right column: Roles */}
        <div className="gtg-hue-column">
          <div className="gtg-hue-column-title">Roles</div>
          {roles.map((r) => (
            <CompactHuePicker
              key={r.key}
              label={r.label}
              selectedHue={r.hue}
              testId={r.testId}
              actualColor={resolvedColor(r.key)}
            />
          ))}
          <div className="gtg-role-tone-row">
            <span className="gtg-full-color-strip-label">Tone</span>
            <TugToneStrip
              hue={roleRepresentativeHue}
              intensity={roleIntensity}
              value={roleTone}
              onChange={() => {}}
              data-testid="gtg-role-tone-strip"
            />
          </div>
          <div className="gtg-role-tone-row">
            <span className="gtg-full-color-strip-label">Intensity</span>
            <TugIntensityStrip
              hue={roleRepresentativeHue}
              tone={roleTone}
              value={roleIntensity}
              onChange={() => {}}
              data-testid="gtg-role-intensity-strip"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryThemeGeneratorContent — main component
// ---------------------------------------------------------------------------

/**
 * GalleryThemeGeneratorContent — Theme Generator gallery card tab.
 *
 * Shows the active shipped theme's token output and accessibility diagnostics.
 * Controls are always read-only. On mount, loads the active app theme.
 */
export function GalleryThemeGeneratorContent() {
  const themeCtx = useOptionalThemeContext();

  // ---------------------------------------------------------------------------
  // Recipe field state (loaded from active theme, read-only display)
  // ---------------------------------------------------------------------------

  const [recipeName, setRecipeName] = useState<string>(BASE_THEME_NAME);
  const [recipeMode, setRecipeMode] = useState<"dark" | "light">("dark");
  const [frameHue, setFrameHue] = useState<string>(BASE_THEME_SPEC.surface.frame.hue);
  const [canvasHue, setCanvasHue] = useState<string>(BASE_THEME_SPEC.surface.canvas.hue);
  const [canvasTone, setCanvasTone] = useState<number>(BASE_THEME_SPEC.surface.canvas.tone);
  const [canvasIntensity, setCanvasIntensity] = useState<number>(BASE_THEME_SPEC.surface.canvas.intensity);
  const [gridHue, setGridHue] = useState<string>(BASE_THEME_SPEC.surface.grid.hue);
  const [gridTone, setGridTone] = useState<number>(BASE_THEME_SPEC.surface.grid.tone);
  const [gridIntensity, setGridIntensity] = useState<number>(BASE_THEME_SPEC.surface.grid.intensity);
  const [frameTone, setFrameTone] = useState<number>(BASE_THEME_SPEC.surface.frame.tone);
  const [frameIntensity, setFrameIntensity] = useState<number>(BASE_THEME_SPEC.surface.frame.intensity);
  const [cardHue, setCardHue] = useState<string>(BASE_THEME_SPEC.surface.card.hue);
  const [cardTone, setCardTone] = useState<number>(BASE_THEME_SPEC.surface.card.tone);
  const [cardIntensity, setCardIntensity] = useState<number>(BASE_THEME_SPEC.surface.card.intensity);
  const [contentHue, setContentHue] = useState<string>(BASE_THEME_SPEC.text.hue);
  const [textIntensity, setTextIntensity] = useState<number>(BASE_THEME_SPEC.text.intensity);
  const [roleTone, setRoleTone] = useState<number>(BASE_THEME_SPEC.role.tone);
  const [roleIntensity, setRoleIntensity] = useState<number>(BASE_THEME_SPEC.role.intensity);
  const [accentHue, setAccentHue] = useState<string>(BASE_THEME_SPEC.role.accent);
  const [activeHue, setActiveHue] = useState<string>(BASE_THEME_SPEC.role.action);
  const [agentHue, setAgentHue] = useState<string>(BASE_THEME_SPEC.role.agent);
  const [dataHue, setDataHue] = useState<string>(BASE_THEME_SPEC.role.data);
  const [successHue, setSuccessHue] = useState<string>(BASE_THEME_SPEC.role.success);
  const [cautionHue, setCautionHue] = useState<string>(BASE_THEME_SPEC.role.caution);
  const [dangerHue, setDangerHue] = useState<string>(BASE_THEME_SPEC.role.danger);

  // Derived theme output — updated whenever recipe fields change
  const [themeOutput, setThemeOutput] = useState<ThemeOutput>(() => deriveTheme(BASE_THEME_SPEC));

  // ---------------------------------------------------------------------------
  // Load recipe into local state fields
  // ---------------------------------------------------------------------------

  const loadRecipeIntoState = useCallback((r: ThemeSpec) => {
    setRecipeName(r.name);
    setRecipeMode(r.mode);
    setFrameHue(r.surface.frame.hue);
    setFrameTone(r.surface.frame.tone);
    setFrameIntensity(r.surface.frame.intensity);
    setCardHue(r.surface.card.hue);
    setCardTone(r.surface.card.tone);
    setCardIntensity(r.surface.card.intensity);
    setCanvasHue(r.surface.canvas.hue);
    setCanvasTone(r.surface.canvas.tone);
    setCanvasIntensity(r.surface.canvas.intensity);
    setGridHue(r.surface.grid.hue);
    setGridTone(r.surface.grid.tone);
    setGridIntensity(r.surface.grid.intensity);
    setContentHue(r.text.hue);
    setTextIntensity(r.text.intensity);
    setRoleTone(r.role.tone);
    setRoleIntensity(r.role.intensity);
    setAccentHue(r.role.accent);
    setActiveHue(r.role.action);
    setAgentHue(r.role.agent);
    setDataHue(r.role.data);
    setSuccessHue(r.role.success);
    setCautionHue(r.role.caution);
    setDangerHue(r.role.danger);
    setThemeOutput(deriveTheme(r));
  }, []);

  // ---------------------------------------------------------------------------
  // Load active theme on mount / when active theme changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const themeName = themeCtx?.theme ?? BASE_THEME_NAME;
    const doLoad = async () => {
      try {
        const res = await fetch(`/__themes/${encodeURIComponent(themeName)}.json`);
        let spec: ThemeSpec;
        if (res.ok) {
          const raw = (await res.json()) as unknown;
          const err = validateRecipeJson(raw);
          if (err !== null) {
            return;
          }
          spec = raw as ThemeSpec;
        } else {
          spec = BASE_THEME_SPEC;
        }
        loadRecipeIntoState(spec);
      } catch {
        // Network error — keep current state
      }
    };
    void doLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeCtx?.theme]);

  // ---------------------------------------------------------------------------
  // Derived values for the preview
  // ---------------------------------------------------------------------------

  const contrastResults = useMemo(
    () => validateThemeContrast(themeOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP),
    [themeOutput],
  );

  const cvdWarnings = useMemo<CVDWarning[]>(
    () => checkCVDDistinguishability(themeOutput.resolved, CVD_SEMANTIC_PAIRS),
    [themeOutput],
  );

  // Live CSS custom properties for the preview container. [L06]
  const liveTokenStyle = useMemo<React.CSSProperties>(() => {
    const style: Record<string, string> = {};
    const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
    for (const [token, color] of Object.entries(themeOutput.resolved)) {
      const { L, C, h, alpha } = color;
      const alphaSuffix = alpha < 1 ? ` / ${fmt(alpha)}` : "";
      style[token] = `oklch(${fmt(L)} ${fmt(C)} ${h}${alphaSuffix})`;
    }
    for (const [token, value] of Object.entries(themeOutput.tokens)) {
      if (token in style) continue;
      if (value.startsWith("--tug-color(")) continue;
      style[token] = value;
    }
    const COMPONENT_ALIASES: Record<string, string> = {
      "--tug-card-title-bar-bg-active": "--tug-surface-tab-primary-normal-plain-active",
      "--tug-card-title-bar-bg-inactive": "--tug-surface-tab-primary-normal-plain-inactive",
      "--tug-card-title-bar-bg-collapsed": "--tug-surface-tab-primary-normal-plain-collapsed",
      "--tug-card-title-fg": "--tug-element-cardTitle-text-normal-plain-rest",
      "--tug-card-title-bar-fg": "--tug-element-global-text-normal-default-rest",
      "--tug-card-title-bar-icon-active": "--tug-element-global-icon-normal-active-rest",
      "--tug-card-title-bar-icon-inactive": "--tug-element-global-text-normal-subtle-rest",
      "--tug-card-title-bar-icon-hover": "--tug-element-global-text-normal-muted-rest",
      "--tug-card-title-bar-divider": "--tug-element-global-divider-normal-default-rest",
      "--tug-card-border": "--tug-element-global-border-normal-default-rest",
      "--tug-card-accessory-bg": "--tug-surface-global-primary-normal-sunken-rest",
      "--tug-card-accessory-border": "--tug-element-global-border-normal-default-rest",
      "--tug-card-bg": "--tug-surface-global-primary-normal-overlay-rest",
      "--tug-card-findbar-bg": "--tug-surface-field-primary-normal-plain-focus",
      "--tug-card-findbar-border": "--tug-element-global-border-normal-default-rest",
      "--tug-tab-bar-bg": "--tug-surface-tab-primary-normal-plain-inactive",
      "--tug-tab-bg-active": "--tug-surface-tab-primary-normal-plain-active",
      "--tug-tab-bg-hover": "--tug-surface-tab-primary-normal-plain-hover",
      "--tug-tab-fg-rest": "--tug-element-tab-text-normal-plain-rest",
      "--tug-tab-fg-active": "--tug-element-tab-text-normal-plain-active",
      "--tug-tab-fg-hover": "--tug-element-tab-text-normal-plain-hover",
    };
    for (const [comp, base] of Object.entries(COMPONENT_ALIASES)) {
      if (base in style) {
        style[comp] = style[base];
      }
    }
    return style as React.CSSProperties;
  }, [themeOutput]);

  const resolvedColor = useCallback(
    (key: string): string => {
      const token = SURFACE_TOKENS[key] ?? ELEMENT_TOKENS[key] ?? ROLE_TOKENS[key];
      if (!token) return "transparent";
      const r = themeOutput.resolved[token];
      return r ? resolvedToCSS(r) : "transparent";
    },
    [themeOutput],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="cg-content gtg-content" data-testid="gallery-theme-generator-content">

      {/* ---- Header: theme info ---- */}
      <div className="gtg-header-row" data-testid="gtg-doc-header">
        <div className="gtg-doc-info" data-testid="gtg-doc-info">
          <span className="gtg-doc-name" data-testid="gtg-doc-name">
            {recipeName}
          </span>
          <span
            className="gtg-doc-recipe-label"
            data-testid="gtg-doc-recipe-label"
            title="Recipe (dark or light)"
          >
            {recipeMode}
          </span>
          <span className="gtg-doc-readonly-badge" data-testid="gtg-doc-readonly-badge">
            read-only
          </span>
        </div>
      </div>

      {/* ---- Color pickers (read-only display) ---- */}
      <div data-testid="gtg-role-hues">
        <div className="cg-section">
          <div className="cg-section-title">Colors</div>
          <ThemePreviewCard
            resolvedColor={resolvedColor}
            surface={[
              { key: "canvas", label: "Canvas", hue: canvasHue, tone: canvasTone, intensity: canvasIntensity, testId: "gtg-canvas-hue" },
              { key: "grid", label: "Grid", hue: gridHue, tone: gridTone, intensity: gridIntensity, testId: "gtg-grid-hue" },
              { key: "frame", label: "Frame", hue: frameHue, tone: frameTone, intensity: frameIntensity, testId: "gtg-frame-hue" },
              { key: "card", label: "Card", hue: cardHue, tone: cardTone, intensity: cardIntensity, testId: "gtg-card-hue" },
            ]}
            text={{
              key: "content",
              label: "Content",
              hue: contentHue,
              intensity: textIntensity,
              testId: "gtg-content-hue",
            }}
            roles={[
              { key: "accent", label: "Accent", hue: accentHue, testId: "gtg-role-hue-accent" },
              { key: "action", label: "Action", hue: activeHue, testId: "gtg-role-hue-action" },
              { key: "agent", label: "Agent", hue: agentHue, testId: "gtg-role-hue-agent" },
              { key: "data", label: "Data", hue: dataHue, testId: "gtg-role-hue-data" },
              { key: "success", label: "Success", hue: successHue, testId: "gtg-role-hue-success" },
              { key: "caution", label: "Caution", hue: cautionHue, testId: "gtg-role-hue-caution" },
              { key: "danger", label: "Danger", hue: dangerHue, testId: "gtg-role-hue-danger" },
            ]}
            roleTone={roleTone}
            roleIntensity={roleIntensity}
          />
        </div>

        <div className="cg-section">
          <div className="cg-section-title">Controls</div>
          <div style={liveTokenStyle}>
            <EmphasisRolePreview />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Token preview ---- */}
      <div className="cg-section">
        <div className="cg-section-title">
          Token Preview ({Object.keys(themeOutput.tokens).length} tokens)
        </div>
        <TokenPreview output={themeOutput} />
      </div>

      <div className="cg-divider" />

      {/* ---- Contrast dashboard ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Contrast Dashboard</div>
        <ContrastDashboard output={themeOutput} contrastResults={contrastResults} />
      </div>

      <div className="cg-divider" />

      {/* ---- CVD preview strip ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Color Vision Deficiency Preview</div>
        <CvdPreviewStrip output={themeOutput} cvdWarnings={cvdWarnings} />
      </div>

      <div className="cg-divider" />

      {/* ---- Contrast Diagnostics ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Contrast Diagnostics</div>
        <ContrastDiagnosticsPanel
          diagnostics={themeOutput.diagnostics}
          cvdWarnings={cvdWarnings}
        />
      </div>

    </div>
  );
}
