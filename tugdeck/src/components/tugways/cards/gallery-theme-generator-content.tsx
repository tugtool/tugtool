/**
 * gallery-theme-generator-content.tsx — Theme Generator gallery card.
 *
 * Interactive tool for deriving complete 264-token --tug-base-* themes from a
 * compact ThemeRecipe: atmosphere + text hue selectors, mode toggle,
 * three mood sliders, token preview grid, contrast dashboard, CVD preview
 * strip, and auto-fix.
 *
 * Wires controls to `deriveTheme()` with 150ms debounce on slider changes.
 * Runs `validateThemeContrast()` and `checkCVDDistinguishability()` on every
 * derived output. The Auto-fix button runs `autoAdjustContrast()` on contrast
 * failures and displays CVD hue-shift suggestions for confusable pairs.
 *
 * Rules of Tugways compliance:
 *   - Appearance changes through CSS custom properties on the preview container,
 *     not React state. [D08, D09]
 *   - useState only for recipe parameters and local UI state (not external
 *     store). [D40]
 *   - No root.render() after initial mount. [D40, D42]
 *
 * **Authoritative references:** [D04] ThemeRecipe, [D05] CVD matrices,
 * [D06] Gallery tab pattern, [D07] Contrast thresholds, [D03] Pairing map,
 * [D02] Native contrast fix, Spec S01, Spec S02,
 * (#constraints, #internal-architecture)
 *
 * @module components/tugways/cards/gallery-theme-generator-content
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, useId } from "react";
import { HUE_FAMILIES, ADJACENCY_RING, tugColor, DEFAULT_CANONICAL_L, oklchToHex } from "@/components/tugways/palette-engine";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
  type ThemeRecipe,
  type ThemeOutput,
  type ContrastResult,
  type CVDWarning,
} from "@/components/tugways/theme-derivation-engine";
import {
  validateThemeContrast,
  autoAdjustContrast,
  checkCVDDistinguishability,
  CVD_SEMANTIC_PAIRS,
  simulateCVDFromOKLCH,
  WCAG_CONTRAST_THRESHOLDS,
  LC_THRESHOLDS,
  LC_MARGINAL_DELTA,
  type CVDType,
} from "@/components/tugways/theme-accessibility";
import { ELEMENT_SURFACE_PAIRING_MAP } from "@/components/tugways/element-surface-pairing-map";
import { TugButton } from "@/components/tugways/tug-button";
import { TugHueStrip } from "@/components/tugways/tug-hue-strip";
import type { TugButtonEmphasis, TugButtonRole } from "@/components/tugways/tug-button";
import { TugBadge } from "@/components/tugways/tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole } from "@/components/tugways/tug-badge";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import type { TugCheckboxRole } from "@/components/tugways/tug-checkbox";
import { TugSwitch } from "@/components/tugways/tug-switch";
import type { TugSwitchRole } from "@/components/tugways/tug-switch";
import "./gallery-theme-generator-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUE_NAMES: readonly string[] = ADJACENCY_RING;

/**
 * Default recipe used on initial mount — matches Brio (default dark theme).
 */
const DEFAULT_RECIPE: ThemeRecipe = EXAMPLE_RECIPES.brio;

// ---------------------------------------------------------------------------
// HueSwatch strip helpers
// ---------------------------------------------------------------------------

/**
 * Renders a labeled TugHueStrip for atmosphere, text, or role hue selection.
 */
function HueSelector({
  label,
  selectedHue,
  onSelect,
  testId,
}: {
  label: string;
  selectedHue: string;
  onSelect: (hue: string) => void;
  testId: string;
}) {
  return (
    <div>
      <div className="cg-section-title" style={{ marginBottom: "8px" }}>{label}</div>
      <TugHueStrip
        selectedHue={selectedHue}
        onSelectHue={onSelect}
        data-testid={testId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MoodSlider
// ---------------------------------------------------------------------------

/**
 * A labeled range input for a single mood knob (0-100).
 */
function MoodSlider({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  testId: string;
}) {
  return (
    <div className="gtg-slider-row">
      <label className="gtg-slider-label" htmlFor={testId}>
        {label}
      </label>
      <input
        id={testId}
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gtg-slider-input"
        data-testid={testId}
      />
      <span className="gtg-slider-value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TokenPreview — scrollable grid of all 264 tokens
// ---------------------------------------------------------------------------

/**
 * Convert a ResolvedColor to a CSS `oklch()` string for rendering swatches.
 * Tokens absent from the resolved map (structural, invariant) return a
 * transparent placeholder.
 */
function resolvedToOklch(resolved: ThemeOutput["resolved"], tokenName: string): string {
  const r = resolved[tokenName];
  if (!r) return "transparent";
  const { L, C, h, alpha } = r;
  if (alpha < 1) {
    return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)} / ${alpha.toFixed(2)})`;
  }
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
}

/**
 * Scrollable grid showing all 264 tokens: name, color swatch, value string.
 *
 * Appearance: swatch backgroundColor set via inline style (DOM mutation),
 * not React state. [D08, D09]
 */
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

/**
 * Determine the badge variant for a ContrastResult row.
 *
 * - "decorative" role → always "decorative" (no minimum requirement)
 * - lcPass true → "pass"
 * - |lc| within LC_MARGINAL_DELTA of threshold → "marginal"
 * - otherwise → "fail"
 *
 * Per [D06]: badge is driven by Lc (normative); WCAG ratio is informational.
 */
function badgeVariant(
  result: ContrastResult,
): "pass" | "marginal" | "fail" | "decorative" {
  if (result.role === "decorative") return "decorative";
  if (result.lcPass) return "pass";
  const threshold = LC_THRESHOLDS[result.role] ?? 15;
  if (Math.abs(result.lc) >= threshold - LC_MARGINAL_DELTA) return "marginal";
  return "fail";
}

/**
 * Render the short Lc label for a result row.
 */
function lcLabel(result: ContrastResult): string {
  return `Lc ${result.lc.toFixed(1)}`;
}

/**
 * Convert a resolved-map entry to an oklch() CSS string for swatch rendering.
 * Returns "transparent" for tokens not in the resolved map.
 */
function resolvedSwatchColor(
  resolved: ThemeOutput["resolved"],
  tokenName: string,
): string {
  const r = resolved[tokenName];
  if (!r) return "transparent";
  return oklchToHex(r.L, r.C, r.h);
}

/**
 * ContrastDashboard — scrollable grid of all element/surface pairs from ELEMENT_SURFACE_PAIRING_MAP.
 *
 * Renders:
 *   - Summary bar: "N/M pairs pass Lc contrast"
 *   - Grid row per pair: fg swatch, bg swatch, element token name, surface token name,
 *     WCAG ratio (informational), Lc (normative), pass/fail badge
 *
 * Badge color-coding per [D06]:
 *   - Green (pass)     : lcPass = true
 *   - Yellow (marginal): failing but within LC_MARGINAL_DELTA of threshold
 *   - Red (fail)       : failing by more than LC_MARGINAL_DELTA
 *   - Neutral          : role = "decorative" (no minimum)
 *
 * Lazy rendering: `content-visibility: auto` on each swatch handles off-screen
 * pairs without a JS virtual list, keeping the implementation simple.
 */
function ContrastDashboard({
  output,
  contrastResults,
}: {
  output: ThemeOutput;
  contrastResults: ContrastResult[];
}) {
  const passCount = contrastResults.filter((r) => r.role !== "decorative" && r.lcPass).length;
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
      {/* Summary bar */}
      <div className="gtg-dash-summary" data-testid="gtg-dash-summary">
        <span className={summaryClass} data-testid="gtg-dash-summary-count">
          {passCount}/{checkedCount}
        </span>
        <span>pairs pass Lc contrast</span>
        <span style={{ color: "var(--tug-base-fg-muted)", marginLeft: "4px" }}>
          ({contrastResults.length} total pairs, {contrastResults.length - checkedCount} decorative)
        </span>
      </div>

      {/* Pair grid */}
      <div className="gtg-dash-grid" data-testid="gtg-dash-grid">
        {/* Column headers */}
        <div className="gtg-dash-col-header">
          <span title="Foreground color swatch">FG</span>
          <span title="Background color swatch">BG</span>
          <span>Foreground token</span>
          <span>Background token</span>
          <span>WCAG 2.x</span>
          <span>Lc</span>
          <span>Badge</span>
        </div>

        {/* Data rows */}
        {contrastResults.map((result, idx) => {
          const variant = badgeVariant(result);
          const fgSwatchColor = resolvedSwatchColor(output.resolved, result.fg);
          const bgSwatchColor = resolvedSwatchColor(output.resolved, result.bg);
          const threshold = WCAG_CONTRAST_THRESHOLDS[result.role] ?? 1.0;
          const lcThreshold = LC_THRESHOLDS[result.role] ?? 15;

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
                title={`Lc threshold: ${lcThreshold}`}
                data-testid="gtg-dash-apca-lc"
              >
                {lcLabel(result)}
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

/** All four CVD types rendered in the preview strip. */
const CVD_TYPES: CVDType[] = ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"];

/** Human-readable labels for each CVD type. */
const CVD_TYPE_LABELS: Record<CVDType, string> = {
  protanopia: "Protanopia",
  deuteranopia: "Deuteranopia",
  tritanopia: "Tritanopia",
  achromatopsia: "Achromatopsia",
};

/**
 * The semantic token names shown in each CVD row.
 * Ordered: accent, active, agent, data, success, caution, danger.
 */
const CVD_SEMANTIC_TOKENS: Array<{ token: string; label: string }> = [
  { token: "--tug-base-tone-accent",   label: "Accent" },
  { token: "--tug-base-tone-active",   label: "Active" },
  { token: "--tug-base-tone-agent",    label: "Agent" },
  { token: "--tug-base-tone-data",     label: "Data" },
  { token: "--tug-base-tone-success",  label: "Success" },
  { token: "--tug-base-tone-caution",  label: "Caution" },
  { token: "--tug-base-tone-danger",   label: "Danger" },
];

/**
 * Convert a linear-sRGB triplet to a CSS hex string for swatch display.
 * Gamma-encodes using the IEC 61966-2-1 formula.
 */
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

/**
 * CvdPreviewStrip — renders 4 rows (one per CVD type), each with 6 simulated
 * semantic color swatches alongside their original colours for comparison.
 *
 * Each row shows:
 *   - CVD type label
 *   - For each semantic token: original swatch + simulated swatch side-by-side
 *
 * A warning badge appears next to the type label when that type has any
 * indistinguishable pair warnings in `cvdWarnings`.
 *
 * Appearance: swatch colors set via inline style (DOM mutation). [D08, D09]
 */
function CvdPreviewStrip({
  output,
  cvdWarnings,
}: {
  output: ThemeOutput;
  cvdWarnings: CVDWarning[];
}) {
  // Build a set of CVD types that have at least one warning for quick lookup.
  const warnedTypes = useMemo(() => {
    const types = new Set<string>();
    for (const w of cvdWarnings) {
      types.add(w.type);
    }
    return types;
  }, [cvdWarnings]);

  return (
    <div className="gtg-cvd-strip" data-testid="gtg-cvd-strip">
      {/* Column headers */}
      <div className="gtg-cvd-col-headers">
        <div className="gtg-cvd-type-label-cell" />
        {CVD_SEMANTIC_TOKENS.map(({ label }) => (
          <div key={label} className="gtg-cvd-token-header" title={label}>
            {label}
          </div>
        ))}
      </div>

      {/* One row per CVD type */}
      {CVD_TYPES.map((cvdType) => {
        const hasWarning = warnedTypes.has(cvdType);
        return (
          <div
            key={cvdType}
            className="gtg-cvd-row"
            data-testid="gtg-cvd-row"
            data-cvd-type={cvdType}
          >
            {/* Type label + optional warning badge */}
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

            {/* Swatch pairs for each semantic token */}
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

              // Original color as hex
              const origHex = oklchToHex(resolved.L, resolved.C, resolved.h);

              // Simulated: OKLCH → linear sRGB (via CVD matrix) → gamma-encode to hex
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
// AutoFixPanel — auto-fix button + CVD suggestions
// ---------------------------------------------------------------------------

/**
 * AutoFixPanel — renders the Auto-fix button and, after a fix has been run,
 * shows:
 *   - A summary of how many tokens were adjusted
 *   - Any tokens that could not be fixed (unfixable list)
 *   - CVD hue-shift suggestions from the warning set
 *
 * The button triggers `autoAdjustContrast` on the current contrast failures
 * and passes the updated output up via `onFixApplied`.
 */
function AutoFixPanel({
  output,
  contrastResults,
  cvdWarnings,
  onFixApplied,
}: {
  output: ThemeOutput;
  contrastResults: ContrastResult[];
  cvdWarnings: CVDWarning[];
  onFixApplied: (updated: Pick<ThemeOutput, "tokens" | "resolved">) => void;
}) {
  const [lastFixResult, setLastFixResult] = useState<{
    adjustedCount: number;
    unfixable: string[];
  } | null>(null);

  const failures = useMemo(
    () => contrastResults.filter((r) => !r.lcPass && r.role !== "decorative"),
    [contrastResults],
  );

  const handleAutoFix = useCallback(() => {
    const result = autoAdjustContrast(output.tokens, output.resolved, failures, ELEMENT_SURFACE_PAIRING_MAP);
    const adjustedCount = Object.keys(result.tokens).filter(
      (k) => result.tokens[k] !== output.tokens[k],
    ).length;
    setLastFixResult({ adjustedCount, unfixable: result.unfixable });
    onFixApplied({ tokens: result.tokens, resolved: result.resolved });
  }, [output, failures, onFixApplied]);

  // Unique CVD suggestions (de-duped by suggestion text)
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
      <div className="gtg-autofix-row">
        <TugButton
          emphasis="outlined"
          role="action"
          size="sm"
          onClick={handleAutoFix}
          disabled={failures.length === 0}
          data-testid="gtg-autofix-btn"
          title={
            failures.length === 0
              ? "No contrast failures to fix"
              : `Fix ${failures.length} contrast failure${failures.length !== 1 ? "s" : ""}`
          }
        >
          Auto-fix ({failures.length} {failures.length === 1 ? "failure" : "failures"})
        </TugButton>
        {lastFixResult !== null && (
          <span className="gtg-autofix-result" data-testid="gtg-autofix-result">
            {lastFixResult.adjustedCount} token{lastFixResult.adjustedCount !== 1 ? "s" : ""} adjusted
            {lastFixResult.unfixable.length > 0
              ? `, ${lastFixResult.unfixable.length} unfixable`
              : ""}
          </span>
        )}
      </div>

      {/* CVD hue-shift suggestions */}
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
// Export / Import helpers
// ---------------------------------------------------------------------------

/**
 * Compute a simple djb2-style hash of a string for the recipe hash header.
 * Not cryptographic — used only as a human-readable fingerprint in comments.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // convert to unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Generate the CSS export string for a theme output.
 *
 * Produces a complete CSS file in the same format as tug-base.css overrides:
 * - Header comment with @theme-name, @theme-description, date, recipe hash
 * - `body { }` block with all `--tug-base-*` overrides as `--tug-color()` values
 *
 * Per [D01]: export format matches existing theme file conventions.
 *
 * Exported for unit testing.
 */
export function generateCssExport(
  output: ThemeOutput,
  recipe: ThemeRecipe,
): string {
  const recipeJson = JSON.stringify(recipe);
  const hash = simpleHash(recipeJson);
  const dateStr = new Date().toISOString().slice(0, 10);
  const desc = `Generated theme (${recipe.mode} mode, atmosphere: ${recipe.atmosphere.hue}, text: ${recipe.text.hue})`;

  const header = [
    "/**",
    ` * @theme-name ${recipe.name}`,
    ` * @theme-description ${desc}`,
    ` * @generated ${dateStr}`,
    ` * @recipe-hash ${hash}`,
    " *",
    " * Generated by Theme Generator. Contains --tug-base-* overrides as --tug-color() values.",
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
 * Validate that a value looks like a ThemeRecipe.
 * Returns an error string if invalid, or null if valid.
 *
 * Exported for unit testing.
 */
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
  if (typeof obj["atmosphere"] !== "object" || obj["atmosphere"] === null) {
    return "Missing or invalid 'atmosphere' field (object required)";
  }
  const atm = obj["atmosphere"] as Record<string, unknown>;
  if (typeof atm["hue"] !== "string" || atm["hue"].trim() === "") {
    return "Missing or invalid 'atmosphere.hue' field (string required)";
  }
  if (typeof obj["text"] !== "object" || obj["text"] === null) {
    return "Missing or invalid 'text' field (object required)";
  }
  const txt = obj["text"] as Record<string, unknown>;
  if (typeof txt["hue"] !== "string" || txt["hue"].trim() === "") {
    return "Missing or invalid 'text.hue' field (string required)";
  }
  // Legacy migration shim: rename signalVividity → signalIntensity in imported JSON.
  // Allows old recipe files saved before the rename to import seamlessly. [Risk R01]
  const LEGACY_FIELD = "signalVividity";
  if (LEGACY_FIELD in obj && !("signalIntensity" in obj)) {
    obj.signalIntensity = obj[LEGACY_FIELD];
    delete obj[LEGACY_FIELD];
  }
  // Optional numeric fields
  for (const field of ["surfaceContrast", "signalIntensity", "warmth"] as const) {
    if (obj[field] !== undefined && typeof obj[field] !== "number") {
      return `Invalid '${field}' field (number required)`;
    }
  }
  return null;
}

/**
 * Trigger a file download using Blob + createObjectURL + programmatic click.
 */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// ExportImportPanel — export CSS / JSON + import recipe
// ---------------------------------------------------------------------------

/**
 * ExportImportPanel renders:
 *   - "Export CSS" button: downloads a complete theme CSS file as --tug-base-* overrides
 *   - "Export Recipe JSON" button: downloads the current recipe as formatted JSON
 *   - "Import Recipe" button: opens a file picker to load a JSON recipe
 *
 * Download uses Blob + URL.createObjectURL + programmatic <a> click per spec.
 * Import validates the JSON against ThemeRecipe schema before applying.
 *
 * Per [D01]: export format is --tug-color() notation matching existing theme files.
 * Per [D04]: ThemeRecipe is the import/export serialization format.
 */
function ExportImportPanel({
  output,
  recipe,
  onRecipeImported,
}: {
  output: ThemeOutput;
  recipe: ThemeRecipe;
  onRecipeImported: (r: ThemeRecipe) => void;
}) {
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportCss = useCallback(() => {
    const css = generateCssExport(output, recipe);
    const safeName = recipe.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    triggerDownload(css, `${safeName}.css`, "text/css");
  }, [output, recipe]);

  const handleExportJson = useCallback(() => {
    const json = JSON.stringify(recipe, null, 2);
    const safeName = recipe.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    triggerDownload(json, `${safeName}-recipe.json`, "application/json");
  }, [recipe]);

  const handleImportClick = useCallback(() => {
    setImportError(null);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset file input so the same file can be re-imported
      e.target.value = "";

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (typeof text !== "string") {
          setImportError("Failed to read file");
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setImportError("Invalid JSON: could not parse file");
          return;
        }
        const validationError = validateRecipeJson(parsed);
        if (validationError !== null) {
          setImportError(`Invalid recipe: ${validationError}`);
          return;
        }
        setImportError(null);
        onRecipeImported(parsed as ThemeRecipe);
      };
      reader.onerror = () => {
        setImportError("Failed to read file");
      };
      reader.readAsText(file);
    },
    [onRecipeImported],
  );

  return (
    <div className="gtg-export-import-panel" data-testid="gtg-export-import-panel">
      {/* Export buttons */}
      <div className="gtg-export-row">
        <TugButton
          emphasis="ghost"
          role="action"
          size="sm"
          onClick={handleExportCss}
          data-testid="gtg-export-css-btn"
          title="Download theme as CSS file (--tug-color() notation)"
        >
          Export CSS
        </TugButton>
        <TugButton
          emphasis="ghost"
          role="action"
          size="sm"
          onClick={handleExportJson}
          data-testid="gtg-export-json-btn"
          title="Download current recipe as JSON"
        >
          Export Recipe JSON
        </TugButton>
      </div>

      {/* Import section */}
      <div className="gtg-import-row">
        {/* Hidden file input — triggered programmatically */}
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept=".json,application/json"
          className="gtg-import-file-input"
          onChange={handleFileChange}
          aria-label="Import recipe JSON file"
          data-testid="gtg-import-file-input"
        />
        <TugButton
          emphasis="ghost"
          role="action"
          size="sm"
          onClick={handleImportClick}
          data-testid="gtg-import-btn"
          title="Load a previously exported recipe JSON file"
        >
          Import Recipe
        </TugButton>
        {importError !== null && (
          <span
            className="gtg-import-error"
            role="alert"
            data-testid="gtg-import-error"
          >
            {importError}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmphasisRolePreview — emphasis x role matrix for buttons, badges, and
// selection controls [D05, Step 7]
// ---------------------------------------------------------------------------

/**
 * All emphasis values for TugButton and TugBadge.
 */
const BUTTON_EMPHASES: TugButtonEmphasis[] = ["filled", "outlined", "ghost"];
const BADGE_EMPHASES: TugBadgeEmphasis[] = ["filled", "outlined", "ghost"];

/**
 * TugButton supports 4 roles; TugBadge supports all 7. [D02]
 */
const BUTTON_ROLES: TugButtonRole[] = ["accent", "action", "data", "danger"];
const BADGE_ROLES: TugBadgeRole[] = [
  "accent", "action", "agent", "data", "success", "caution", "danger",
];

/**
 * All 7 roles for TugCheckbox and TugSwitch. [D04, Table T04]
 */
const SELECTION_ROLES: TugCheckboxRole[] = [
  "accent", "action", "agent", "data", "success", "caution", "danger",
];

/**
 * EmphasisRolePreview — renders a 3×N button grid, a 3×7 badge grid, and
 * a 1×7 selection control row showing all emphasis x role combinations.
 *
 * Each cell renders a live component with the current derived theme applied
 * via the inherited CSS custom properties on the preview container.
 *
 * Appearance changes are driven entirely by CSS token cascade — no React
 * state is used for color. [D08, D09]
 */
function EmphasisRolePreview() {
  return (
    <div className="gtg-erp" data-testid="gtg-emphasis-role-preview">

      {/* ---- Buttons: 3 emphasis × 5 roles ---- */}
      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Buttons (3 emphasis × 5 roles)</div>
        <div className="gtg-erp-grid" data-testid="gtg-erp-button-grid" style={{ "--gtg-erp-cols": BUTTON_ROLES.length } as React.CSSProperties}>
          {/* Role column headers */}
          <div className="gtg-erp-corner" />
          {BUTTON_ROLES.map((role) => (
            <div key={role} className="gtg-erp-col-label">{role}</div>
          ))}
          {/* Emphasis rows */}
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

      {/* ---- Badges: 3 emphasis × 7 roles ---- */}
      <div className="gtg-erp-subsection">
        <div className="gtg-erp-subtitle">Badges (3 emphasis × 7 roles)</div>
        <div className="gtg-erp-grid" data-testid="gtg-erp-badge-grid" style={{ "--gtg-erp-cols": BADGE_ROLES.length } as React.CSSProperties}>
          {/* Role column headers */}
          <div className="gtg-erp-corner" />
          {BADGE_ROLES.map((role) => (
            <div key={role} className="gtg-erp-col-label">{role}</div>
          ))}
          {/* Emphasis rows */}
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

      {/* ---- Selection controls: TugCheckbox + TugSwitch × 7 roles ---- */}
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
// GalleryThemeGeneratorContent — main component
// ---------------------------------------------------------------------------

/**
 * GalleryThemeGeneratorContent — Theme Generator gallery card tab.
 *
 * Manages local recipe state (mode, atmosphere, text hue, mood knobs).
 * Calls `deriveTheme()` on every recipe change, debounced 150ms for sliders.
 * Runs `validateThemeContrast()` and `checkCVDDistinguishability()` on each
 * derived output to populate the contrast dashboard and CVD strip.
 * The Auto-fix button runs `autoAdjustContrast()` on failures.
 *
 * **Authoritative reference:** [D06] Gallery tab pattern, [D04] ThemeRecipe,
 * [D07] Contrast thresholds, [D03] Pairing map, [D05] CVD matrices,
 * [D02] Native contrast fix.
 */
export function GalleryThemeGeneratorContent() {
  const [recipeName, setRecipeName] = useState<string>(DEFAULT_RECIPE.name);
  const [mode, setMode] = useState<"dark" | "light">(DEFAULT_RECIPE.mode);
  const [atmosphereHue, setAtmosphereHue] = useState<string>(DEFAULT_RECIPE.atmosphere.hue);
  const [textHue, setTextHue] = useState<string>(DEFAULT_RECIPE.text.hue);
  const [surfaceContrast, setSurfaceContrast] = useState<number>(
    DEFAULT_RECIPE.surfaceContrast ?? 50,
  );
  const [signalIntensity, setSignalIntensity] = useState<number>(
    DEFAULT_RECIPE.signalIntensity ?? 50,
  );
  const [warmth, setWarmth] = useState<number>(DEFAULT_RECIPE.warmth ?? 50);

  // Role hue state — one per role in the 7-role system. [D05, Step 6]
  // Note: recipe field "destructive" maps to the "danger" role in the UI.
  const [accentHue, setAccentHue] = useState<string>(DEFAULT_RECIPE.accent ?? "orange");
  const [activeHue, setActiveHue] = useState<string>(DEFAULT_RECIPE.active ?? "blue");
  const [agentHue, setAgentHue] = useState<string>(DEFAULT_RECIPE.agent ?? "violet");
  const [dataHue, setDataHue] = useState<string>(DEFAULT_RECIPE.data ?? "teal");
  const [successHue, setSuccessHue] = useState<string>(DEFAULT_RECIPE.success ?? "green");
  const [cautionHue, setCautionHue] = useState<string>(DEFAULT_RECIPE.caution ?? "yellow");
  const [dangerHue, setDangerHue] = useState<string>(DEFAULT_RECIPE.destructive ?? "red");

  // The derived theme output — updated whenever recipe changes or auto-fix runs.
  const [themeOutput, setThemeOutput] = useState<ThemeOutput>(() => deriveTheme(DEFAULT_RECIPE));

  // Contrast results — derived from themeOutput via validateThemeContrast().
  // Computed with useMemo to avoid redundant runs on unrelated re-renders.
  const contrastResults = useMemo(
    () => validateThemeContrast(themeOutput.resolved, ELEMENT_SURFACE_PAIRING_MAP),
    [themeOutput],
  );

  // CVD distinguishability warnings — computed from the resolved map.
  const cvdWarnings = useMemo<CVDWarning[]>(
    () => checkCVDDistinguishability(themeOutput.resolved, CVD_SEMANTIC_PAIRS),
    [themeOutput],
  );

  // Slider debounce timer ref.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Assemble the current recipe and call deriveTheme(), updating themeOutput.
   * Must be called with the latest values — no stale state.
   * Accepts `n` (name) so that slider/hue changes preserve the current recipe
   * name rather than hardcoding "preview".
   */
  const runDerive = useCallback(
    (
      n: string,
      m: "dark" | "light",
      atm: string,
      txt: string,
      sc: number,
      sv: number,
      w: number,
      accent: string,
      active: string,
      agent: string,
      data: string,
      success: string,
      caution: string,
      danger: string,
    ) => {
      const recipe: ThemeRecipe = {
        name: n,
        mode: m,
        atmosphere: { hue: atm },
        text: { hue: txt },
        surfaceContrast: sc,
        signalIntensity: sv,
        warmth: w,
        accent,
        active,
        agent,
        data,
        success,
        caution,
        destructive: danger,
      };
      setThemeOutput(deriveTheme(recipe));
    },
    [],
  );

  /**
   * Re-derive theme when mode or hue changes (no debounce needed — these are
   * discrete picks, not continuous drags).
   */
  useEffect(() => {
    // Cancel any pending slider debounce when a hue/mode changes.
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    runDerive(recipeName, mode, atmosphereHue, textHue, surfaceContrast, signalIntensity, warmth, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, atmosphereHue, textHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue]);

  /**
   * Debounced re-derive for slider changes (150ms delay).
   * Accepts `n` (the current recipe name) so the name is preserved in the
   * derived output even when sliders change.
   */
  const handleSliderChange = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<number>>,
      newValue: number,
      n: string,
      m: "dark" | "light",
      atm: string,
      txt: string,
      sc: number,
      sv: number,
      w: number,
      accent: string,
      active: string,
      agent: string,
      data: string,
      success: string,
      caution: string,
      danger: string,
    ) => {
      setter(newValue);
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runDerive(n, m, atm, txt, sc, sv, w, accent, active, agent, data, success, caution, danger);
      }, 150);
    },
    [runDerive],
  );

  // ---------------------------------------------------------------------------
  // Auto-fix handler — merges adjusted tokens/resolved into themeOutput
  // ---------------------------------------------------------------------------

  const handleFixApplied = useCallback(
    (updated: Pick<ThemeOutput, "tokens" | "resolved">) => {
      setThemeOutput((prev) => ({ ...prev, ...updated }));
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Preset load helpers
  // ---------------------------------------------------------------------------

  const loadPreset = useCallback(
    (presetKey: keyof typeof EXAMPLE_RECIPES) => {
      const r = EXAMPLE_RECIPES[presetKey];
      setRecipeName(r.name);
      setMode(r.mode);
      setAtmosphereHue(r.atmosphere.hue);
      setTextHue(r.text.hue);
      setSurfaceContrast(r.surfaceContrast ?? 50);
      setSignalIntensity(r.signalIntensity ?? 50);
      setWarmth(r.warmth ?? 50);
      setAccentHue(r.accent ?? "orange");
      setActiveHue(r.active ?? "blue");
      setAgentHue(r.agent ?? "violet");
      setDataHue(r.data ?? "teal");
      setSuccessHue(r.success ?? "green");
      setCautionHue(r.caution ?? "yellow");
      setDangerHue(r.destructive ?? "red");
      setThemeOutput(deriveTheme(r));
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Current recipe — assembled from local state for export/import
  // ---------------------------------------------------------------------------

  /**
   * The current assembled recipe, kept in sync with local state fields.
   * Used by ExportImportPanel for export and as a round-trip reference.
   * `recipeName` is preserved across imports so exported filenames and CSS
   * headers reflect the actual recipe name, not a hardcoded "preview" label.
   */
  const currentRecipe = useMemo<ThemeRecipe>(
    () => ({
      name: recipeName,
      mode,
      atmosphere: { hue: atmosphereHue },
      text: { hue: textHue },
      surfaceContrast,
      signalIntensity,
      warmth,
      accent: accentHue,
      active: activeHue,
      agent: agentHue,
      data: dataHue,
      success: successHue,
      caution: cautionHue,
      destructive: dangerHue,
    }),
    [recipeName, mode, atmosphereHue, textHue, surfaceContrast, signalIntensity, warmth, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue],
  );

  /**
   * Handle an imported recipe: apply all fields to local state and re-derive.
   * Sets `recipeName` from the imported recipe so subsequent exports preserve
   * the original name rather than reverting to "preview".
   */
  const handleRecipeImported = useCallback(
    (r: ThemeRecipe) => {
      setRecipeName(r.name);
      setMode(r.mode);
      setAtmosphereHue(r.atmosphere.hue);
      setTextHue(r.text.hue);
      setSurfaceContrast(r.surfaceContrast ?? 50);
      setSignalIntensity(r.signalIntensity ?? 50);
      setWarmth(r.warmth ?? 50);
      setAccentHue(r.accent ?? "orange");
      setActiveHue(r.active ?? "blue");
      setAgentHue(r.agent ?? "violet");
      setDataHue(r.data ?? "teal");
      setSuccessHue(r.success ?? "green");
      setCautionHue(r.caution ?? "yellow");
      setDangerHue(r.destructive ?? "red");
      setThemeOutput(deriveTheme(r));
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="cg-content gtg-content" data-testid="gallery-theme-generator-content">

      {/* ---- Presets ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Load Preset Recipe</div>
        <div className="gtg-preset-row">
          {(Object.keys(EXAMPLE_RECIPES) as Array<keyof typeof EXAMPLE_RECIPES>).map((name) => (
            <TugButton
              key={name}
              emphasis="outlined"
              role="action"
              size="sm"
              onClick={() => loadPreset(name)}
              data-testid={`gtg-preset-${name}`}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </TugButton>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Mode toggle (dark / light) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Mode</div>
        <div className="gtg-mode-group" data-testid="gtg-mode-group">
          <TugButton
            emphasis={mode === "dark" ? "filled" : "outlined"}
            role="action"
            size="sm"
            onClick={() => setMode("dark")}
            data-testid="gtg-mode-dark"
          >
            Dark
          </TugButton>
          <TugButton
            emphasis={mode === "light" ? "filled" : "outlined"}
            role="action"
            size="sm"
            onClick={() => setMode("light")}
            data-testid="gtg-mode-light"
          >
            Light
          </TugButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Atmosphere hue selector ---- */}
      <div className="cg-section">
        <HueSelector
          label="Atmosphere Hue"
          selectedHue={atmosphereHue}
          onSelect={setAtmosphereHue}
          testId="gtg-atmosphere-hue-strip"
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Text hue selector ---- */}
      <div className="cg-section">
        <HueSelector
          label="Text Hue"
          selectedHue={textHue}
          onSelect={setTextHue}
          testId="gtg-text-hue-strip"
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Role hue selectors ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Role Hues</div>
        <div className="gtg-role-hues" data-testid="gtg-role-hues">
          <HueSelector
            label="Accent"
            selectedHue={accentHue}
            onSelect={setAccentHue}
            testId="gtg-role-hue-accent"
          />
          <HueSelector
            label="Action"
            selectedHue={activeHue}
            onSelect={setActiveHue}
            testId="gtg-role-hue-action"
          />
          <HueSelector
            label="Agent"
            selectedHue={agentHue}
            onSelect={setAgentHue}
            testId="gtg-role-hue-agent"
          />
          <HueSelector
            label="Data"
            selectedHue={dataHue}
            onSelect={setDataHue}
            testId="gtg-role-hue-data"
          />
          <HueSelector
            label="Success"
            selectedHue={successHue}
            onSelect={setSuccessHue}
            testId="gtg-role-hue-success"
          />
          <HueSelector
            label="Caution"
            selectedHue={cautionHue}
            onSelect={setCautionHue}
            testId="gtg-role-hue-caution"
          />
          <HueSelector
            label="Danger"
            selectedHue={dangerHue}
            onSelect={setDangerHue}
            testId="gtg-role-hue-danger"
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Mood sliders ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Mood</div>
        <div className="gtg-sliders">
          <MoodSlider
            label="Surface Contrast"
            value={surfaceContrast}
            onChange={(v) =>
              handleSliderChange(setSurfaceContrast, v, recipeName, mode, atmosphereHue, textHue, v, signalIntensity, warmth, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue)
            }
            testId="gtg-slider-surface-contrast"
          />
          <MoodSlider
            label="Signal Intensity"
            value={signalIntensity}
            onChange={(v) =>
              handleSliderChange(setSignalIntensity, v, recipeName, mode, atmosphereHue, textHue, surfaceContrast, v, warmth, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue)
            }
            testId="gtg-slider-signal-intensity"
          />
          <MoodSlider
            label="Warmth"
            value={warmth}
            onChange={(v) =>
              handleSliderChange(setWarmth, v, recipeName, mode, atmosphereHue, textHue, surfaceContrast, signalIntensity, v, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue)
            }
            testId="gtg-slider-warmth"
          />
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Emphasis x Role Preview ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Emphasis × Role Preview</div>
        <EmphasisRolePreview />
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

      {/* ---- Auto-fix ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Auto-fix</div>
        <AutoFixPanel
          output={themeOutput}
          contrastResults={contrastResults}
          cvdWarnings={cvdWarnings}
          onFixApplied={handleFixApplied}
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Export / Import ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Export / Import</div>
        <ExportImportPanel
          output={themeOutput}
          recipe={currentRecipe}
          onRecipeImported={handleRecipeImported}
        />
      </div>

    </div>
  );
}
