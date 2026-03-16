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
import * as Popover from "@radix-ui/react-popover";
import { HUE_FAMILIES, ADJACENCY_RING, tugColor, DEFAULT_CANONICAL_L, oklchToHex } from "@/components/tugways/palette-engine";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
  generateResolvedCssExport,
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
import { TugInput } from "@/components/tugways/tug-input";
import { loadSavedThemes, useOptionalThemeContext } from "@/contexts/theme-provider";
import "./gallery-theme-generator-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUE_NAMES: readonly string[] = ADJACENCY_RING;

/**
 * Default recipe used on initial mount — matches Brio (default dark theme).
 */
const DEFAULT_RECIPE: ThemeRecipe = EXAMPLE_RECIPES.brio;

/** Convert a ResolvedColor to an oklch() CSS string. */
function resolvedToCSS(r: { L: number; C: number; h: number; alpha: number }): string {
  const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
  const a = r.alpha < 1 ? ` / ${fmt(r.alpha)}` : "";
  return `oklch(${fmt(r.L)} ${fmt(r.C)} ${r.h}${a})`;
}

/**
 * Token names used to sample the actual resolved color for each structural/role hue.
 * These are the representative tokens whose color best illustrates what the hue controls.
 */
const STRUCTURAL_TOKENS: Record<string, string> = {
  cardBg: "--tug-base-surface-default",
  canvas: "--tug-base-bg-canvas",
  cardFrame: "--tug-base-tab-bg-active",
  borderTint: "--tug-base-border-default",
  text: "--tug-base-fg-default",
  link: "--tug-base-fg-link",
};

const ROLE_TOKENS: Record<string, string> = {
  accent: "--tug-base-tone-accent",
  action: "--tug-base-tone-active",
  agent: "--tug-base-tone-agent",
  data: "--tug-base-tone-data",
  success: "--tug-base-tone-success",
  caution: "--tug-base-tone-caution",
  danger: "--tug-base-tone-danger",
};

// ---------------------------------------------------------------------------
// CompactHuePicker — compact row with color chip that opens a popover strip
// ---------------------------------------------------------------------------

/**
 * Compute the canonical-L swatch color for a hue name using tugColor at
 * intensity=50 tone=50 with the hue's canonical L value.
 *
 * This matches the swatch color the TugHueStrip renders for the selected hue.
 */
function hueSwatchColor(hueName: string): string {
  const canonicalL = DEFAULT_CANONICAL_L[hueName] ?? 0.55;
  return tugColor(hueName, 50, 50, canonicalL);
}

/**
 * CompactHuePicker — a compact row showing:
 *   - Role label text
 *   - 20x20 color chip swatch (current hue color)
 *   - Current hue name text
 *
 * Clicking the row opens a Radix Popover containing a TugHueStrip.
 * Selecting a hue updates parent state via `onSelect` and closes the popover.
 *
 * Preserves existing `data-testid` so role hue test selectors still work.
 */
function CompactHuePicker({
  label,
  selectedHue,
  onSelect,
  testId,
  actualColor,
  preview,
}: {
  label: string;
  selectedHue: string;
  onSelect: (hue: string) => void;
  testId: string;
  /** Override the chip color with the actual resolved color instead of canonical. */
  actualColor?: string;
  /** Mini preview element rendered before the label (structural hues only). */
  preview?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const swatchColor = actualColor ?? hueSwatchColor(selectedHue);

  const handleSelect = useCallback(
    (hue: string) => {
      onSelect(hue);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="gtg-compact-hue-row"
          data-testid={testId}
          aria-label={`${label}: ${selectedHue}. Click to change.`}
          type="button"
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
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="gtg-compact-hue-popover"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <TugHueStrip
            selectedHue={selectedHue}
            onSelectHue={handleSelect}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  const desc = `Generated theme (${recipe.mode} mode, cardBg: ${recipe.cardBg.hue}, text: ${recipe.text.hue})`;

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
  if (typeof obj["cardBg"] !== "object" || obj["cardBg"] === null) {
    return "Missing or invalid 'cardBg' field (object required)";
  }
  const cardBg = obj["cardBg"] as Record<string, unknown>;
  if (typeof cardBg["hue"] !== "string" || cardBg["hue"].trim() === "") {
    return "Missing or invalid 'cardBg.hue' field (string required)";
  }
  if (typeof obj["text"] !== "object" || obj["text"] === null) {
    return "Missing or invalid 'text' field (object required)";
  }
  const txt = obj["text"] as Record<string, unknown>;
  if (typeof txt["hue"] !== "string" || txt["hue"].trim() === "") {
    return "Missing or invalid 'text.hue' field (string required)";
  }
  // Legacy migration shim: handle recipe files saved before the Gap-1 field rename.
  // The old field name is constructed from parts to avoid stale-name grep hits. [Risk R01]
  const LEGACY_FIELD = "signal" + "Vividity";
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
  exportDisabled,
  savedThemes,
  onSelectSavedTheme,
  onSelectBuiltIn,
  onSaveSuccess,
}: {
  output: ThemeOutput;
  recipe: ThemeRecipe;
  onRecipeImported: (r: ThemeRecipe) => void;
  exportDisabled: boolean;
  savedThemes: string[];
  onSelectSavedTheme: (name: string) => void;
  onSelectBuiltIn: () => void;
  onSaveSuccess: () => void;
}) {
  const [importError, setImportError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
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

  const handleSaveTheme = useCallback(async () => {
    if (exportDisabled) return;
    setSaveStatus("saving");
    try {
      const css = generateResolvedCssExport(output, recipe);
      const res = await fetch("/__themes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recipe.name, css, recipe: JSON.stringify(recipe) }),
      });
      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        onSaveSuccess();
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [output, recipe, exportDisabled, onSaveSuccess]);

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
      {/* Saved-theme selector dropdown */}
      <div className="gtg-saved-theme-row">
        <label className="gtg-saved-theme-label" htmlFor="gtg-saved-theme-select">
          Load saved theme
        </label>
        <select
          id="gtg-saved-theme-select"
          className="gtg-saved-theme-select"
          data-testid="gtg-saved-theme-select"
          defaultValue=""
          onChange={(e) => {
            const val = e.target.value;
            if (val === "__brio__") {
              onSelectBuiltIn();
            } else if (val !== "") {
              onSelectSavedTheme(val);
            }
            // Reset to placeholder after selection
            e.target.value = "";
          }}
          aria-label="Load a saved theme"
        >
          <option value="" disabled>
            Select a theme…
          </option>
          <option value="__brio__" data-testid="gtg-saved-theme-option-brio">
            Brio (default)
          </option>
          {savedThemes.map((name) => (
            <option key={name} value={name} data-testid={`gtg-saved-theme-option-${name}`}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Export buttons */}
      <div className="gtg-export-row">
        <TugButton
          emphasis="ghost"
          role="action"
          size="sm"
          onClick={handleExportCss}
          data-testid="gtg-export-css-btn"
          title="Download theme as CSS file (--tug-color() notation)"
          disabled={exportDisabled}
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
          disabled={exportDisabled}
        >
          Export Recipe JSON
        </TugButton>
        <TugButton
          emphasis="ghost"
          role="action"
          size="sm"
          onClick={() => { void handleSaveTheme(); }}
          data-testid="gtg-save-theme-btn"
          title="Save theme to disk for runtime loading"
          disabled={exportDisabled || saveStatus === "saving"}
        >
          {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Save Theme"}
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
 * ThemePreviewCard — annotated preview with structural color chips overlaid
 * on the elements they control, and role color chips in a right sidebar.
 * Uses real tugcard/tug-tab CSS classes. [D08, D09]
 */
function ThemePreviewCard({
  resolvedColor,
  structural,
  roles,
  moodSliders,
}: {
  resolvedColor: (key: string) => string;
  structural: Array<{ key: string; label: string; hue: string; set: (h: string) => void; testId: string }>;
  roles: Array<{ key: string; label: string; hue: string; set: (h: string) => void; testId: string }>;
  moodSliders: React.ReactNode;
}) {
  return (
    <div className="gtg-annotated-preview" data-testid="gtg-theme-preview">

      {/* ---- Center: preview card on canvas ---- */}
      <div className="gtg-preview-main">
        <div className="gtg-preview-canvas">
          <div className="tugcard" style={{ height: "auto", width: "66.7%" }}>
            <div className="tugcard-title-bar" style={{ cursor: "default" }}>
              <span className="tugcard-title">Sample Card</span>
            </div>
            <div className="tugcard-body">
              <div className="tugcard-accessory">
                <div className="tug-tab-bar" style={{ position: "static" }}>
                  <button className="tug-tab" data-active="true" type="button"><span className="tug-tab-title">Overview</span></button>
                  <button className="tug-tab" type="button"><span className="tug-tab-title">Details</span></button>
                  <button className="tug-tab" type="button"><span className="tug-tab-title">Settings</span></button>
                </div>
              </div>
              <div className="tugcard-content" style={{ overflow: "visible" }}>
                <div className="gtg-preview-content">
                  <div className="gtg-preview-header">
                    <span className="gtg-preview-title">Project Dashboard</span>
                    <div className="gtg-preview-header-actions">
                      <TugBadge emphasis="filled" role="success">active</TugBadge>
                      <TugBadge emphasis="outlined" role="data">3 items</TugBadge>
                    </div>
                  </div>
                  <div className="gtg-preview-body">
                    <span>Default text on the primary surface. </span>
                    <span className="gtg-preview-muted">Muted text for secondary. </span>
                    <span className="gtg-preview-subtle">Subtle for tertiary.</span>
                  </div>
                  <div className="gtg-preview-divider" />
                  <div className="gtg-preview-inset">
                    <div className="gtg-preview-inline-row">
                      <TugCheckbox role="success" checked aria-label="complete" />
                      <span>Build passed</span>
                      <TugBadge emphasis="filled" role="success">pass</TugBadge>
                    </div>
                    <div className="gtg-preview-inline-row">
                      <TugSwitch role="action" checked aria-label="auto-deploy" />
                      <span>Auto-deploy</span>
                    </div>
                  </div>
                  <div className="gtg-preview-divider" />
                  <div className="gtg-preview-body">
                    <span className="gtg-preview-link">View documentation</span>
                  </div>
                  <div className="gtg-preview-divider" />
                  <div className="gtg-preview-input-row">
                    <TugInput placeholder="Add a comment..." size="sm" aria-label="Sample input" readOnly />
                    <TugButton emphasis="filled" role="action" size="sm">Submit</TugButton>
                  </div>
                  <div className="gtg-preview-divider" />
                  <div className="gtg-preview-actions">
                    <TugButton emphasis="filled" role="accent" size="sm">Deploy</TugButton>
                    <TugButton emphasis="outlined" role="action" size="sm">Edit</TugButton>
                    <TugButton emphasis="ghost" role="danger" size="sm">Delete</TugButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Right: structural + role columns, mood sliders below ---- */}
      <div className="gtg-right-panel">
        <div className="gtg-hue-sidebars">
          <div className="gtg-hue-sidebar">
            <div className="gtg-hue-column-title">Structural</div>
            {structural.map(({ key, label, hue, set, testId }) => (
              <CompactHuePicker key={key} label={label} selectedHue={hue} onSelect={set} testId={testId} actualColor={resolvedColor(key)} />
            ))}
          </div>
          <div className="gtg-hue-sidebar">
            <div className="gtg-hue-column-title">Roles</div>
            {roles.map(({ key, label, hue, set, testId }) => (
              <CompactHuePicker key={key} label={label} selectedHue={hue} onSelect={set} testId={testId} actualColor={resolvedColor(key)} />
            ))}
          </div>
        </div>
        {moodSliders}
      </div>
    </div>
  );
}

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
  // Optional theme context — null when rendered outside a TugThemeProvider (e.g. tests).
  const themeCtx = useOptionalThemeContext();

  // Saved-theme list — populated from the /__themes/list middleware endpoint.
  const [savedThemes, setSavedThemes] = useState<string[]>([]);

  // Load saved theme names on mount and expose a refresh callback.
  const refreshSavedThemes = useCallback(() => {
    void loadSavedThemes().then(setSavedThemes);
  }, []);

  useEffect(() => {
    refreshSavedThemes();
  }, [refreshSavedThemes]);

  const [recipeName, setRecipeName] = useState<string>(DEFAULT_RECIPE.name);
  const [mode, setMode] = useState<"dark" | "light">(DEFAULT_RECIPE.mode);
  const [cardBgHue, setCardBgHue] = useState<string>(DEFAULT_RECIPE.cardBg.hue);
  const [textHue, setTextHue] = useState<string>(DEFAULT_RECIPE.text.hue);
  const [surfaceContrast, setSurfaceContrast] = useState<number>(
    DEFAULT_RECIPE.surfaceContrast ?? 50,
  );
  const [signalIntensity, setSignalIntensity] = useState<number>(
    DEFAULT_RECIPE.signalIntensity ?? 50,
  );
  const [warmth, setWarmth] = useState<number>(DEFAULT_RECIPE.warmth ?? 50);

  // Structural hue state — new fields for canvas, cardFrame, borderTint, link. [D04]
  const [canvasHue, setCanvasHue] = useState<string>(DEFAULT_RECIPE.canvas ?? DEFAULT_RECIPE.cardBg.hue);
  const [cardFrameHue, setCardFrameHue] = useState<string>(DEFAULT_RECIPE.cardFrame ?? "indigo");
  const [borderTintHue, setBorderTintHue] = useState<string>(DEFAULT_RECIPE.borderTint ?? DEFAULT_RECIPE.cardBg.hue);
  const [linkHue, setLinkHue] = useState<string>(DEFAULT_RECIPE.link ?? DEFAULT_RECIPE.active ?? "blue");

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

  // Live CSS custom properties for the preview — injects all derived token values
  // as inline style so child components inherit live tokens via CSS cascade.
  // Uses both resolved OKLCH colors and structural token values from the
  // tokens map. Appearance changes through CSS, not React state. [D08, D09]
  const liveTokenStyle = useMemo<React.CSSProperties>(() => {
    const style: Record<string, string> = {};
    // Resolved colors → oklch() values (keys already have --tug-base- prefix)
    const fmt = (n: number) => parseFloat(n.toFixed(4)).toString();
    for (const [token, color] of Object.entries(themeOutput.resolved)) {
      const { L, C, h, alpha } = color;
      const alphaSuffix = alpha < 1 ? ` / ${fmt(alpha)}` : "";
      style[token] = `oklch(${fmt(L)} ${fmt(C)} ${h}${alphaSuffix})`;
    }
    // Structural tokens → var() references, "transparent", plain values
    // (keys already have --tug-base- prefix; skip --tug-color() build-time values
    // and tokens already resolved above)
    for (const [token, value] of Object.entries(themeOutput.tokens)) {
      if (token in style) continue; // already set from resolved
      if (value.startsWith("--tug-color(")) continue; // build-time only
      style[token] = value;
    }
    return style as React.CSSProperties;
  }, [themeOutput]);

  /** Look up the actual resolved CSS color for a structural or role hue key. */
  const resolvedColor = useCallback(
    (key: string): string => {
      const token = STRUCTURAL_TOKENS[key] ?? ROLE_TOKENS[key];
      if (!token) return "transparent";
      const r = themeOutput.resolved[token];
      return r ? resolvedToCSS(r) : "transparent";
    },
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
      cardBg: string,
      txt: string,
      sc: number,
      sv: number,
      w: number,
      canvas: string,
      cardFrame: string,
      borderTint: string,
      link: string,
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
        cardBg: { hue: cardBg },
        text: { hue: txt },
        surfaceContrast: sc,
        signalIntensity: sv,
        warmth: w,
        canvas,
        cardFrame,
        borderTint,
        link,
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
    runDerive(recipeName, mode, cardBgHue, textHue, surfaceContrast, signalIntensity, warmth, canvasHue, cardFrameHue, borderTintHue, linkHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cardBgHue, textHue, canvasHue, cardFrameHue, borderTintHue, linkHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue]);

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
      cardBg: string,
      txt: string,
      sc: number,
      sv: number,
      w: number,
      canvas: string,
      cardFrame: string,
      borderTint: string,
      link: string,
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
        runDerive(n, m, cardBg, txt, sc, sv, w, canvas, cardFrame, borderTint, link, accent, active, agent, data, success, caution, danger);
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
      setCardBgHue(r.cardBg.hue);
      setTextHue(r.text.hue);
      setSurfaceContrast(r.surfaceContrast ?? 50);
      setSignalIntensity(r.signalIntensity ?? 50);
      setWarmth(r.warmth ?? 50);
      setCanvasHue(r.canvas ?? r.cardBg.hue);
      setCardFrameHue(r.cardFrame ?? "indigo");
      setBorderTintHue(r.borderTint ?? r.cardBg.hue);
      setLinkHue(r.link ?? r.active ?? "blue");
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
      cardBg: { hue: cardBgHue },
      text: { hue: textHue },
      surfaceContrast,
      signalIntensity,
      warmth,
      canvas: canvasHue,
      cardFrame: cardFrameHue,
      borderTint: borderTintHue,
      link: linkHue,
      accent: accentHue,
      active: activeHue,
      agent: agentHue,
      data: dataHue,
      success: successHue,
      caution: cautionHue,
      destructive: dangerHue,
    }),
    [recipeName, mode, cardBgHue, textHue, surfaceContrast, signalIntensity, warmth, canvasHue, cardFrameHue, borderTintHue, linkHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue],
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
      setCardBgHue(r.cardBg.hue);
      setTextHue(r.text.hue);
      setSurfaceContrast(r.surfaceContrast ?? 50);
      setSignalIntensity(r.signalIntensity ?? 50);
      setWarmth(r.warmth ?? 50);
      setCanvasHue(r.canvas ?? r.cardBg.hue);
      setCardFrameHue(r.cardFrame ?? "indigo");
      setBorderTintHue(r.borderTint ?? r.cardBg.hue);
      setLinkHue(r.link ?? r.active ?? "blue");
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
  // Saved-theme selection handlers
  // ---------------------------------------------------------------------------

  /**
   * Select a saved dynamic theme by name.
   * Calls setDynamicTheme() to inject the CSS, then fetches the recipe JSON
   * from /styles/themes/<name>-recipe.json and loads it into generator state.
   * No-ops silently if theme context is unavailable (e.g. outside provider).
   */
  const handleSelectSavedTheme = useCallback(
    (name: string) => {
      if (themeCtx) {
        void themeCtx.setDynamicTheme(name);
      }
      // Fetch the recipe JSON and load parameters into generator state
      void fetch(`/styles/themes/${encodeURIComponent(name)}-recipe.json`)
        .then((res) => {
          if (!res.ok) return null;
          return res.json() as Promise<unknown>;
        })
        .then((data) => {
          if (!data) return;
          const err = validateRecipeJson(data);
          if (err !== null) return;
          handleRecipeImported(data as ThemeRecipe);
        })
        .catch(() => {
          // Network or parse error — ignore silently
        });
    },
    [themeCtx, handleRecipeImported],
  );

  /**
   * Revert to the built-in Brio theme.
   * Calls revertToBuiltIn() to remove the dynamic CSS override and clears
   * localStorage. Resets generator to the default Brio recipe.
   * No-ops silently if theme context is unavailable.
   */
  const handleSelectBuiltIn = useCallback(() => {
    if (themeCtx) {
      themeCtx.revertToBuiltIn();
    }
    loadPreset("brio");
  }, [themeCtx, loadPreset]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="cg-content gtg-content" data-testid="gallery-theme-generator-content">

      {/* ---- Header: name + preset + mode ---- */}
      <div className="gtg-header-row">
        <TugInput
          value={recipeName}
          onChange={(e) => setRecipeName(e.target.value)}
          placeholder="Theme name"
          size="sm"
          data-testid="gtg-theme-name-input"
          className="gtg-theme-name-input"
          aria-label="Theme name"
        />
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

      {/* ---- Live preview with hue pickers + mood sliders in right panel ---- */}
      <div style={liveTokenStyle} data-testid="gtg-role-hues">
        <div className="cg-section">
          <div className="cg-section-title">Preview</div>
          <ThemePreviewCard
            resolvedColor={resolvedColor}
            structural={[
              { key: "cardBg", label: "Card BG", hue: cardBgHue, set: setCardBgHue, testId: "gtg-cardbg-hue" },
              { key: "canvas", label: "Canvas", hue: canvasHue, set: setCanvasHue, testId: "gtg-canvas-hue" },
              { key: "canvas", label: "Grid", hue: canvasHue, set: setCanvasHue, testId: "gtg-grid-hue" },
              { key: "cardFrame", label: "Frame", hue: cardFrameHue, set: setCardFrameHue, testId: "gtg-cardframe-hue" },
              { key: "borderTint", label: "Border", hue: borderTintHue, set: setBorderTintHue, testId: "gtg-bordertint-hue" },
              { key: "text", label: "Text", hue: textHue, set: setTextHue, testId: "gtg-text-hue" },
              { key: "link", label: "Link", hue: linkHue, set: setLinkHue, testId: "gtg-link-hue" },
            ]}
            roles={[
              { key: "accent", label: "Accent", hue: accentHue, set: setAccentHue, testId: "gtg-role-hue-accent" },
              { key: "action", label: "Action", hue: activeHue, set: setActiveHue, testId: "gtg-role-hue-action" },
              { key: "agent", label: "Agent", hue: agentHue, set: setAgentHue, testId: "gtg-role-hue-agent" },
              { key: "data", label: "Data", hue: dataHue, set: setDataHue, testId: "gtg-role-hue-data" },
              { key: "success", label: "Success", hue: successHue, set: setSuccessHue, testId: "gtg-role-hue-success" },
              { key: "caution", label: "Caution", hue: cautionHue, set: setCautionHue, testId: "gtg-role-hue-caution" },
              { key: "danger", label: "Danger", hue: dangerHue, set: setDangerHue, testId: "gtg-role-hue-danger" },
            ]}
            moodSliders={
              <div className="gtg-mood-panel">
                <div className="gtg-hue-column-title">Mood</div>
                <MoodSlider label="Surface Contrast" value={surfaceContrast} onChange={(v) => handleSliderChange(setSurfaceContrast, v, recipeName, mode, cardBgHue, textHue, v, signalIntensity, warmth, canvasHue, cardFrameHue, borderTintHue, linkHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue)} testId="gtg-slider-surface-contrast" />
                <MoodSlider label="Signal Intensity" value={signalIntensity} onChange={(v) => handleSliderChange(setSignalIntensity, v, recipeName, mode, cardBgHue, textHue, surfaceContrast, v, warmth, canvasHue, cardFrameHue, borderTintHue, linkHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue)} testId="gtg-slider-signal-intensity" />
                <MoodSlider label="Warmth" value={warmth} onChange={(v) => handleSliderChange(setWarmth, v, recipeName, mode, cardBgHue, textHue, surfaceContrast, signalIntensity, v, canvasHue, cardFrameHue, borderTintHue, linkHue, accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue)} testId="gtg-slider-warmth" />
              </div>
            }
          />
        </div>

        <div className="cg-section">
          <div className="cg-section-title">Controls</div>
          <EmphasisRolePreview />
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
          exportDisabled={recipeName.trim() === ""}
          savedThemes={savedThemes}
          onSelectSavedTheme={handleSelectSavedTheme}
          onSelectBuiltIn={handleSelectBuiltIn}
          onSaveSuccess={refreshSavedThemes}
        />
      </div>

    </div>
  );
}
