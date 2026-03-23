/**
 * gallery-theme-generator-content.tsx — Theme Generator gallery card.
 *
 * Mac-style document model:
 *   - Idle    — no theme loaded. Shows New / Open buttons.
 *   - Viewing — a shipped theme is loaded. Controls show values but are disabled.
 *   - Editing — an authored theme is loaded. Controls enabled. Auto-save fires 500ms
 *               after last change. Apply injects CSS app-wide after each save. [L06]
 *
 * On open, loads the currently active app theme via GET /__themes/<name>.json.
 * Shipped themes (brio, harmony) open read-only (Viewing state).
 * Authored themes open for editing (Editing state).
 *
 * New flow: prompt for name (unique check via GET /__themes/list), select prototype,
 * copy via POST /__themes/save, enter Editing state. [D06]
 *
 * Open flow: list available themes via GET /__themes/list, load selected via
 * GET /__themes/<name>.json. Shipped=read-only, authored=editable. [D06]
 *
 * Auto-save: debounce at 500ms after last change, write JSON + CSS to
 * ~/.tugtool/themes/ via POST /__themes/save. Only active in Editing state.
 *
 * Apply: inject regenerated CSS app-wide via stylesheet injection after each
 * auto-save. Use deriveTheme() in-browser for immediate preview; disk write
 * is debounced. Appearance changes go through CSS and DOM, never React state. [L06]
 *
 * Recipe locked at creation time — displayed as a read-only label. [D09]
 *
 * After save, push updated theme list to Swift via themeListUpdated bridge message. [D10]
 *
 * Rules of Tugways compliance:
 *   - Appearance changes through CSS custom properties on the preview container,
 *     not React state. [L06]
 *   - useState only for local UI state (not external store).
 *   - No root.render() after initial mount.
 *
 * **Authoritative references:** [D06] Mac-style document model, [D09] Recipe locked,
 * [D10] Dynamic Swift Theme menu, Spec S05, (#generator-new-flow)
 *
 * @module components/tugways/cards/gallery-theme-generator-content
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as Popover from "@radix-ui/react-popover";
import { HUE_FAMILIES, ADJACENCY_RING, tugColor, DEFAULT_CANONICAL_L, oklchToHex } from "@/components/tugways/palette-engine";
import {
  deriveTheme,
  type ThemeRecipe,
  type ThemeOutput,
  type ContrastResult,
  type ContrastDiagnostic,
  type CVDWarning,
} from "@/components/tugways/theme-engine";
import brioJson from "../../../../themes/brio.json";
import harmonyJson from "../../../../themes/harmony.json";

const SHIPPED_BRIO = brioJson as ThemeRecipe;
const SHIPPED_HARMONY = harmonyJson as ThemeRecipe;

/** Names of shipped (read-only) themes. */
const SHIPPED_NAMES: ReadonlySet<string> = new Set(["brio", "harmony"]);

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
import { TugHueStrip } from "@/components/tugways/tug-hue-strip";
import { TugToneStrip, TugIntensityStrip } from "@/components/tugways/tug-color-strip";
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
  card: "--tug-surface-global-primary-normal-default-rest",
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
// ThemeListEntry — the { name, recipe, source } shape from /__themes/list
// ---------------------------------------------------------------------------

interface ThemeListEntry {
  name: string;
  recipe: string;
  source: "shipped" | "authored";
}

// ---------------------------------------------------------------------------
// CompactHuePicker — compact row with color chip that opens a popover strip
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
  onSelect,
  testId,
  actualColor,
  preview,
  disabled,
}: {
  label: string;
  selectedHue: string;
  onSelect: (hue: string) => void;
  testId: string;
  actualColor?: string;
  preview?: React.ReactNode;
  disabled?: boolean;
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

  if (disabled) {
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
// FullColorPicker — compact row that opens a popover with hue + tone + intensity strips
// ---------------------------------------------------------------------------

function FullColorPicker({
  label,
  selectedHue,
  tone,
  intensity,
  onSelectHue,
  onChangeTone,
  onChangeIntensity,
  testId,
  actualColor,
  disabled,
}: {
  label: string;
  selectedHue: string;
  tone: number;
  intensity: number;
  onSelectHue: (hue: string) => void;
  onChangeTone: (tone: number) => void;
  onChangeIntensity: (intensity: number) => void;
  testId: string;
  actualColor?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const swatchColor = actualColor ?? hueSwatchColor(selectedHue);

  const handleSelectHue = useCallback(
    (hue: string) => {
      onSelectHue(hue);
    },
    [onSelectHue],
  );

  if (disabled) {
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="gtg-compact-hue-row"
          data-testid={testId}
          aria-label={`${label}: ${selectedHue}, tone ${tone}, intensity ${intensity}. Click to change.`}
          type="button"
        >
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
          className="gtg-full-color-popover"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <div className="gtg-full-color-popover-inner">
            <div className="gtg-full-color-strip-row">
              <span className="gtg-full-color-strip-label">Hue</span>
              <div className="gtg-full-color-strip-track">
                <TugHueStrip
                  selectedHue={selectedHue}
                  onSelectHue={handleSelectHue}
                />
              </div>
            </div>
            <div className="gtg-full-color-strip-row">
              <span className="gtg-full-color-strip-label">Tone</span>
              <div className="gtg-full-color-strip-track">
                <TugToneStrip
                  hue={selectedHue}
                  intensity={intensity}
                  value={tone}
                  onChange={onChangeTone}
                  data-testid={`${testId}-tone`}
                />
              </div>
            </div>
            <div className="gtg-full-color-strip-row">
              <span className="gtg-full-color-strip-label">Intensity</span>
              <div className="gtg-full-color-strip-track">
                <TugIntensityStrip
                  hue={selectedHue}
                  tone={tone}
                  value={intensity}
                  onChange={onChangeIntensity}
                  data-testid={`${testId}-intensity`}
                />
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------------------
// HueIntensityPicker — compact row that opens a popover with hue + intensity strips
// ---------------------------------------------------------------------------

function HueIntensityPicker({
  label,
  selectedHue,
  intensity,
  onSelectHue,
  onChangeIntensity,
  testId,
  actualColor,
  disabled,
}: {
  label: string;
  selectedHue: string;
  intensity: number;
  onSelectHue: (hue: string) => void;
  onChangeIntensity: (intensity: number) => void;
  testId: string;
  actualColor?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const swatchColor = actualColor ?? hueSwatchColor(selectedHue);
  const REPRESENTATIVE_TONE = 50;

  const handleSelectHue = useCallback(
    (hue: string) => {
      onSelectHue(hue);
    },
    [onSelectHue],
  );

  if (disabled) {
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="gtg-compact-hue-row"
          data-testid={testId}
          aria-label={`${label}: ${selectedHue}, intensity ${intensity}. Click to change.`}
          type="button"
        >
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
          className="gtg-full-color-popover"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <div className="gtg-full-color-popover-inner">
            <div className="gtg-full-color-strip-row">
              <span className="gtg-full-color-strip-label">Hue</span>
              <div className="gtg-full-color-strip-track">
                <TugHueStrip
                  selectedHue={selectedHue}
                  onSelectHue={handleSelectHue}
                />
              </div>
            </div>
            <div className="gtg-full-color-strip-row">
              <span className="gtg-full-color-strip-label">Intensity</span>
              <div className="gtg-full-color-strip-track">
                <TugIntensityStrip
                  hue={selectedHue}
                  tone={REPRESENTATIVE_TONE}
                  value={intensity}
                  onChange={onChangeIntensity}
                  data-testid={`${testId}-intensity`}
                />
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  recipe: ThemeRecipe,
): string {
  const recipeJson = JSON.stringify(recipe);
  const hash = simpleHash(recipeJson);
  const dateStr = new Date().toISOString().slice(0, 10);

  const header = [
    "/**",
    ` * @theme-name ${recipe.name}`,
    ` * @theme-description ${recipe.description}`,
    ` * @generated ${dateStr}`,
    ` * @recipe-hash ${hash}`,
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
 * Validate that a value looks like a ThemeRecipe.
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
  if (typeof obj["description"] !== "string" || obj["description"].trim() === "") {
    return "Missing or invalid 'description' field (non-empty string required)";
  }
  if (obj["recipe"] !== "dark" && obj["recipe"] !== "light") {
    return "Invalid 'recipe' field (must be 'dark' or 'light')";
  }

  const isDark = obj["recipe"] === "dark";

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
// ThemePreviewCard — color pickers for surface/text/role hues
// ---------------------------------------------------------------------------

function ThemePreviewCard({
  resolvedColor,
  surface,
  text,
  roles,
  roleTone,
  roleIntensity,
  onRoleToneChange,
  onRoleIntensityChange,
  disabled,
}: {
  resolvedColor: (key: string) => string;
  surface: Array<{
    key: string;
    label: string;
    hue: string;
    tone: number;
    intensity: number;
    setHue: (h: string) => void;
    setTone: (t: number) => void;
    setIntensity: (i: number) => void;
    testId: string;
  }>;
  text: {
    key: string;
    label: string;
    hue: string;
    intensity: number;
    setHue: (h: string) => void;
    setIntensity: (i: number) => void;
    testId: string;
  };
  roles: Array<{ key: string; label: string; hue: string; set: (h: string) => void; testId: string }>;
  roleTone: number;
  roleIntensity: number;
  onRoleToneChange: (t: number) => void;
  onRoleIntensityChange: (i: number) => void;
  disabled?: boolean;
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
              onSelectHue={s.setHue}
              onChangeTone={s.setTone}
              onChangeIntensity={s.setIntensity}
              testId={s.testId}
              actualColor={resolvedColor(s.key)}
              disabled={disabled}
            />
          ))}

          <div className="gtg-hue-column-title">Text</div>
          <HueIntensityPicker
            label={text.label}
            selectedHue={text.hue}
            intensity={text.intensity}
            onSelectHue={text.setHue}
            onChangeIntensity={text.setIntensity}
            testId={text.testId}
            actualColor={resolvedColor(text.key)}
            disabled={disabled}
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
              onSelect={r.set}
              testId={r.testId}
              actualColor={resolvedColor(r.key)}
              disabled={disabled}
            />
          ))}
          <div className="gtg-role-tone-row">
            <span className="gtg-full-color-strip-label">Tone</span>
            <TugToneStrip
              hue={roleRepresentativeHue}
              intensity={roleIntensity}
              value={roleTone}
              onChange={disabled ? () => {} : onRoleToneChange}
              data-testid="gtg-role-tone-strip"
            />
          </div>
          <div className="gtg-role-tone-row">
            <span className="gtg-full-color-strip-label">Intensity</span>
            <TugIntensityStrip
              hue={roleRepresentativeHue}
              tone={roleTone}
              value={roleIntensity}
              onChange={disabled ? () => {} : onRoleIntensityChange}
              data-testid="gtg-role-intensity-strip"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewThemeDialog — modal-ish inline dialog for New flow
// ---------------------------------------------------------------------------

/**
 * NewThemeDialog — presented as an overlay when the user clicks New.
 *
 * Step 1: Name entry with uniqueness validation against the live theme list.
 * Step 2: Prototype picker (shows available themes from GET /__themes/list).
 * On confirm: POST /__themes/save with copied recipe, then enter Editing state.
 */
function NewThemeDialog({
  onCreated,
  onCancel,
}: {
  onCreated: (name: string, recipe: ThemeRecipe) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<"name" | "prototype">("name");
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [availableThemes, setAvailableThemes] = useState<ThemeListEntry[]>([]);
  const [selectedPrototype, setSelectedPrototype] = useState<string>("brio");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus name input on mount
  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const handleNameSubmit = useCallback(async () => {
    const trimmed = newName.trim();
    if (trimmed === "") {
      setNameError("Name is required");
      return;
    }
    setIsValidating(true);
    setNameError(null);
    try {
      const res = await fetch("/__themes/list");
      if (res.ok) {
        const data = (await res.json()) as { themes?: unknown[] };
        const existingNames = new Set<string>();
        if (Array.isArray(data.themes)) {
          for (const entry of data.themes) {
            if (typeof entry === "string") existingNames.add(entry);
            else if (entry !== null && typeof entry === "object") {
              const n = (entry as Record<string, unknown>).name;
              if (typeof n === "string") existingNames.add(n);
            }
          }
        }
        if (existingNames.has(trimmed)) {
          setNameError(`A theme named "${trimmed}" already exists`);
          setIsValidating(false);
          return;
        }
        // Build prototype list from themes
        const entries: ThemeListEntry[] = [];
        if (Array.isArray(data.themes)) {
          for (const entry of data.themes) {
            if (typeof entry === "string") {
              entries.push({ name: entry, recipe: "dark", source: "shipped" });
            } else if (entry !== null && typeof entry === "object") {
              const e = entry as Record<string, unknown>;
              entries.push({
                name: String(e.name ?? ""),
                recipe: String(e.recipe ?? "dark"),
                source: (e.source === "authored" ? "authored" : "shipped") as "shipped" | "authored",
              });
            }
          }
        }
        // Ensure brio and harmony are always available as prototypes
        if (!entries.some((e) => e.name === "brio")) {
          entries.unshift({ name: "brio", recipe: "dark", source: "shipped" });
        }
        if (!entries.some((e) => e.name === "harmony")) {
          entries.splice(1, 0, { name: "harmony", recipe: "light", source: "shipped" });
        }
        setAvailableThemes(entries);
        setSelectedPrototype("brio");
        setStep("prototype");
      } else {
        // Middleware unavailable — use built-ins only
        setAvailableThemes([
          { name: "brio", recipe: "dark", source: "shipped" },
          { name: "harmony", recipe: "light", source: "shipped" },
        ]);
        setSelectedPrototype("brio");
        setStep("prototype");
      }
    } catch {
      setAvailableThemes([
        { name: "brio", recipe: "dark", source: "shipped" },
        { name: "harmony", recipe: "light", source: "shipped" },
      ]);
      setSelectedPrototype("brio");
      setStep("prototype");
    }
    setIsValidating(false);
  }, [newName]);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setCreateError(null);
    try {
      // Fetch prototype JSON
      const protoRes = await fetch(`/__themes/${encodeURIComponent(selectedPrototype)}.json`);
      let protoRecipe: ThemeRecipe;
      if (protoRes.ok) {
        const raw = (await protoRes.json()) as unknown;
        const err = validateRecipeJson(raw);
        if (err !== null) {
          setCreateError(`Prototype recipe invalid: ${err}`);
          setIsCreating(false);
          return;
        }
        protoRecipe = raw as ThemeRecipe;
      } else {
        // Fall back to in-memory shipped recipe
        protoRecipe = selectedPrototype === "harmony" ? SHIPPED_HARMONY : SHIPPED_BRIO;
      }

      // Copy with new name
      const newRecipe: ThemeRecipe = { ...protoRecipe, name: newName.trim() };

      // Save via POST /__themes/save — server derives CSS from recipe [D07]
      const saveRes = await fetch("/__themes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRecipe.name, recipe: JSON.stringify(newRecipe) }),
      });
      if (!saveRes.ok) {
        const body = (await saveRes.json().catch(() => ({ error: "Save failed" }))) as { error?: string };
        setCreateError(body.error ?? "Save failed");
        setIsCreating(false);
        return;
      }

      onCreated(newRecipe.name, newRecipe);
    } catch (err) {
      setCreateError(String(err));
      setIsCreating(false);
    }
  }, [newName, selectedPrototype, onCreated]);

  return (
    <div className="gtg-dialog-overlay" data-testid="gtg-new-dialog">
      <div className="gtg-dialog">
        {step === "name" ? (
          <>
            <div className="gtg-dialog-title">New Theme</div>
            <div className="gtg-dialog-body">
              <label className="gtg-dialog-label" htmlFor="gtg-new-theme-name">
                Theme name
              </label>
              <TugInput
                id="gtg-new-theme-name"
                ref={nameInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-theme"
                size="sm"
                data-testid="gtg-new-theme-name-input"
                aria-label="New theme name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleNameSubmit();
                  if (e.key === "Escape") onCancel();
                }}
              />
              {nameError !== null && (
                <span className="gtg-dialog-error" data-testid="gtg-new-theme-name-error">
                  {nameError}
                </span>
              )}
            </div>
            <div className="gtg-dialog-actions">
              <TugButton
                emphasis="ghost"
                role="action"
                size="sm"
                onClick={onCancel}
                data-testid="gtg-new-dialog-cancel"
              >
                Cancel
              </TugButton>
              <TugButton
                emphasis="filled"
                role="accent"
                size="sm"
                onClick={() => { void handleNameSubmit(); }}
                disabled={isValidating || newName.trim() === ""}
                data-testid="gtg-new-dialog-next"
              >
                {isValidating ? "Checking…" : "Next"}
              </TugButton>
            </div>
          </>
        ) : (
          <>
            <div className="gtg-dialog-title">Choose Prototype</div>
            <div className="gtg-dialog-body">
              <div className="gtg-dialog-label">Start from:</div>
              <div className="gtg-prototype-list" data-testid="gtg-prototype-list">
                {availableThemes.map((t) => (
                  <button
                    key={t.name}
                    className={`gtg-prototype-item${selectedPrototype === t.name ? " gtg-prototype-item--selected" : ""}`}
                    type="button"
                    onClick={() => setSelectedPrototype(t.name)}
                    data-testid={`gtg-prototype-option-${t.name}`}
                  >
                    <span className="gtg-prototype-name">{t.name}</span>
                    <span className="gtg-prototype-meta">{t.recipe} · {t.source}</span>
                  </button>
                ))}
              </div>
              {createError !== null && (
                <span className="gtg-dialog-error" data-testid="gtg-create-error">
                  {createError}
                </span>
              )}
            </div>
            <div className="gtg-dialog-actions">
              <TugButton
                emphasis="ghost"
                role="action"
                size="sm"
                onClick={() => setStep("name")}
                data-testid="gtg-new-dialog-back"
              >
                Back
              </TugButton>
              <TugButton
                emphasis="filled"
                role="accent"
                size="sm"
                onClick={() => { void handleCreate(); }}
                disabled={isCreating}
                data-testid="gtg-new-dialog-create"
              >
                {isCreating ? "Creating…" : "Create"}
              </TugButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OpenThemeDialog — modal-ish inline dialog for Open flow
// ---------------------------------------------------------------------------

function OpenThemeDialog({
  onSelected,
  onCancel,
}: {
  onSelected: (name: string, recipe: ThemeRecipe, isShipped: boolean) => void;
  onCancel: () => void;
}) {
  const [themes, setThemes] = useState<ThemeListEntry[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const doLoad = async () => {
      try {
        const res = await fetch("/__themes/list");
        const entries: ThemeListEntry[] = [];
        if (res.ok) {
          const data = (await res.json()) as { themes?: unknown[] };
          if (Array.isArray(data.themes)) {
            for (const entry of data.themes) {
              if (typeof entry === "string") {
                entries.push({ name: entry, recipe: "dark", source: "shipped" });
              } else if (entry !== null && typeof entry === "object") {
                const e = entry as Record<string, unknown>;
                entries.push({
                  name: String(e.name ?? ""),
                  recipe: String(e.recipe ?? "dark"),
                  source: (e.source === "authored" ? "authored" : "shipped") as "shipped" | "authored",
                });
              }
            }
          }
        }
        // Ensure brio is always first
        if (!entries.some((e) => e.name === "brio")) {
          entries.unshift({ name: "brio", recipe: "dark", source: "shipped" });
        }
        setThemes(entries);
        setSelected(entries[0]?.name ?? "brio");
      } catch {
        setThemes([
          { name: "brio", recipe: "dark", source: "shipped" },
          { name: "harmony", recipe: "light", source: "shipped" },
        ]);
        setSelected("brio");
      }
      setIsLoading(false);
    };
    void doLoad();
  }, []);

  const handleOpen = useCallback(async () => {
    if (!selected) return;
    setIsOpening(true);
    setError(null);
    try {
      const res = await fetch(`/__themes/${encodeURIComponent(selected)}.json`);
      let recipe: ThemeRecipe;
      if (res.ok) {
        const raw = (await res.json()) as unknown;
        const err = validateRecipeJson(raw);
        if (err !== null) {
          setError(`Invalid recipe: ${err}`);
          setIsOpening(false);
          return;
        }
        recipe = raw as ThemeRecipe;
      } else {
        // Fall back to in-memory for shipped themes
        if (selected === "harmony") recipe = SHIPPED_HARMONY;
        else recipe = SHIPPED_BRIO;
      }
      const shipped = SHIPPED_NAMES.has(selected);
      onSelected(selected, recipe, shipped);
    } catch (err) {
      setError(String(err));
      setIsOpening(false);
    }
  }, [selected, onSelected]);

  return (
    <div className="gtg-dialog-overlay" data-testid="gtg-open-dialog">
      <div className="gtg-dialog">
        <div className="gtg-dialog-title">Open Theme</div>
        <div className="gtg-dialog-body">
          {isLoading ? (
            <div className="gtg-dialog-loading" data-testid="gtg-open-dialog-loading">Loading themes…</div>
          ) : (
            <div className="gtg-prototype-list" data-testid="gtg-open-theme-list">
              {themes.map((t) => (
                <button
                  key={t.name}
                  className={`gtg-prototype-item${selected === t.name ? " gtg-prototype-item--selected" : ""}`}
                  type="button"
                  onClick={() => setSelected(t.name)}
                  data-testid={`gtg-open-theme-option-${t.name}`}
                >
                  <span className="gtg-prototype-name">{t.name}</span>
                  <span className="gtg-prototype-meta">
                    {t.recipe} · {t.source === "shipped" ? "read-only" : "editable"}
                  </span>
                </button>
              ))}
            </div>
          )}
          {error !== null && (
            <span className="gtg-dialog-error" data-testid="gtg-open-error">
              {error}
            </span>
          )}
        </div>
        <div className="gtg-dialog-actions">
          <TugButton
            emphasis="ghost"
            role="action"
            size="sm"
            onClick={onCancel}
            data-testid="gtg-open-dialog-cancel"
          >
            Cancel
          </TugButton>
          <TugButton
            emphasis="filled"
            role="accent"
            size="sm"
            onClick={() => { void handleOpen(); }}
            disabled={isOpening || isLoading || !selected}
            data-testid="gtg-open-dialog-open"
          >
            {isOpening ? "Opening…" : "Open"}
          </TugButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pushThemeListToSwift — push updated theme list via Swift bridge
// ---------------------------------------------------------------------------

/**
 * After a theme save or theme switch, push the updated theme list to the Swift
 * bridge so it can refresh its cached menu. Pass the currently active theme
 * name so the Swift handler can update activeThemeName in the same call. [D10]
 */
async function pushThemeListToSwift(activeTheme?: string): Promise<void> {
  try {
    const res = await fetch("/__themes/list");
    if (!res.ok) return;
    const data = (await res.json()) as { themes?: unknown[] };
    const themes: Array<{ name: string; recipe: string; source: string }> = [];
    if (Array.isArray(data.themes)) {
      for (const entry of data.themes) {
        if (typeof entry === "string") {
          themes.push({ name: entry, recipe: "dark", source: "shipped" });
        } else if (entry !== null && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          themes.push({
            name: String(e.name ?? ""),
            recipe: String(e.recipe ?? "dark"),
            source: String(e.source ?? "shipped"),
          });
        }
      }
    }
    const payload: { themes: typeof themes; activeTheme?: string } = { themes };
    if (activeTheme !== undefined) payload.activeTheme = activeTheme;
    (window as unknown as {
      webkit?: {
        messageHandlers?: {
          themeListUpdated?: { postMessage: (v: unknown) => void };
        };
      };
    }).webkit?.messageHandlers?.themeListUpdated?.postMessage(payload);
  } catch {
    // Bridge unavailable (tests, non-Mac) — ignore
  }
}

// ---------------------------------------------------------------------------
// GalleryThemeGeneratorContent — main component
// ---------------------------------------------------------------------------

type GeneratorState = "idle" | "viewing" | "editing";

/**
 * GalleryThemeGeneratorContent — Theme Generator gallery card tab.
 *
 * Implements the Mac-style document model per [D06]:
 *   - Idle:    No theme loaded. Shows New / Open buttons.
 *   - Viewing: A shipped theme is loaded. Controls show values but are disabled.
 *   - Editing: An authored theme is loaded. Controls enabled. Auto-save 500ms.
 *
 * On mount, loads the active app theme (if a TugThemeProvider is in scope).
 * Recipe displayed as a read-only label — no Dark/Light toggle. [D09]
 *
 * Preview section updates on color changes via CSS custom properties. [L06]
 */
export function GalleryThemeGeneratorContent() {
  const themeCtx = useOptionalThemeContext();

  // ---------------------------------------------------------------------------
  // Document model state
  // ---------------------------------------------------------------------------

  const [generatorState, setGeneratorState] = useState<GeneratorState>("idle");
  const [currentThemeName, setCurrentThemeName] = useState<string | null>(null);
  const [isShipped, setIsShipped] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showOpenDialog, setShowOpenDialog] = useState(false);

  // Auto-save status
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Recipe field state
  // ---------------------------------------------------------------------------

  const [recipeName, setRecipeName] = useState<string>("brio");
  const [recipeMode, setRecipeMode] = useState<"dark" | "light">("dark");
  const [frameHue, setFrameHue] = useState<string>(SHIPPED_BRIO.surface.frame.hue);
  const [canvasHue, setCanvasHue] = useState<string>(SHIPPED_BRIO.surface.canvas.hue);
  const [canvasTone, setCanvasTone] = useState<number>(SHIPPED_BRIO.surface.canvas.tone);
  const [canvasIntensity, setCanvasIntensity] = useState<number>(SHIPPED_BRIO.surface.canvas.intensity);
  const [gridHue, setGridHue] = useState<string>(SHIPPED_BRIO.surface.grid.hue);
  const [gridTone, setGridTone] = useState<number>(SHIPPED_BRIO.surface.grid.tone);
  const [gridIntensity, setGridIntensity] = useState<number>(SHIPPED_BRIO.surface.grid.intensity);
  const [frameTone, setFrameTone] = useState<number>(SHIPPED_BRIO.surface.frame.tone);
  const [frameIntensity, setFrameIntensity] = useState<number>(SHIPPED_BRIO.surface.frame.intensity);
  const [cardHue, setCardHue] = useState<string>(SHIPPED_BRIO.surface.card.hue);
  const [cardTone, setCardTone] = useState<number>(SHIPPED_BRIO.surface.card.tone);
  const [cardIntensity, setCardIntensity] = useState<number>(SHIPPED_BRIO.surface.card.intensity);
  const [contentHue, setContentHue] = useState<string>(SHIPPED_BRIO.text.hue);
  const [textIntensity, setTextIntensity] = useState<number>(SHIPPED_BRIO.text.intensity);
  const [roleTone, setRoleTone] = useState<number>(SHIPPED_BRIO.role.tone);
  const [roleIntensity, setRoleIntensity] = useState<number>(SHIPPED_BRIO.role.intensity);
  const [accentHue, setAccentHue] = useState<string>(SHIPPED_BRIO.role.accent);
  const [activeHue, setActiveHue] = useState<string>(SHIPPED_BRIO.role.action);
  const [agentHue, setAgentHue] = useState<string>(SHIPPED_BRIO.role.agent);
  const [dataHue, setDataHue] = useState<string>(SHIPPED_BRIO.role.data);
  const [successHue, setSuccessHue] = useState<string>(SHIPPED_BRIO.role.success);
  const [cautionHue, setCautionHue] = useState<string>(SHIPPED_BRIO.role.caution);
  const [dangerHue, setDangerHue] = useState<string>(SHIPPED_BRIO.role.danger);

  // Derived theme output — updated whenever recipe fields change
  const [themeOutput, setThemeOutput] = useState<ThemeOutput>(() => deriveTheme(SHIPPED_BRIO));

  // ---------------------------------------------------------------------------
  // Load active theme on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const themeName = themeCtx?.theme ?? "brio";
    const doLoad = async () => {
      try {
        const res = await fetch(`/__themes/${encodeURIComponent(themeName)}.json`);
        let recipe: ThemeRecipe;
        if (res.ok) {
          const raw = (await res.json()) as unknown;
          const err = validateRecipeJson(raw);
          if (err !== null) {
            // Invalid — show idle
            return;
          }
          recipe = raw as ThemeRecipe;
        } else {
          // Fall back to shipped recipes
          if (themeName === "harmony") recipe = SHIPPED_HARMONY;
          else recipe = SHIPPED_BRIO;
        }
        const shipped = SHIPPED_NAMES.has(themeName);
        loadRecipeIntoState(recipe);
        setCurrentThemeName(themeName);
        setIsShipped(shipped);
        setGeneratorState(shipped ? "viewing" : "editing");
      } catch {
        // Network error — stay idle
      }
    };
    void doLoad();
    // Re-run whenever the active theme changes (e.g. set-theme from Swift menu).
    // loadRecipeIntoState is intentionally omitted: it is declared after this
    // useEffect (useCallback below) and its deps are [] so it is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeCtx?.theme]);

  // ---------------------------------------------------------------------------
  // Load recipe into local state fields
  // ---------------------------------------------------------------------------

  const loadRecipeIntoState = useCallback((r: ThemeRecipe) => {
    setRecipeName(r.name);
    setRecipeMode(r.recipe);
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
  // Re-derive theme when any recipe field changes
  // ---------------------------------------------------------------------------

  const currentRecipe = useMemo<ThemeRecipe>(
    () => ({
      name: recipeName,
      description: `Generated theme (${recipeMode} mode, frame: ${frameHue}, content: ${contentHue})`,
      recipe: recipeMode,
      surface: {
        canvas: { hue: canvasHue, tone: canvasTone, intensity: canvasIntensity },
        grid: { hue: gridHue, tone: gridTone, intensity: gridIntensity },
        frame: { hue: frameHue, tone: frameTone, intensity: frameIntensity },
        card: { hue: cardHue, tone: cardTone, intensity: cardIntensity },
      },
      text: { hue: contentHue, intensity: textIntensity },
      role: { tone: roleTone, intensity: roleIntensity, accent: accentHue, action: activeHue, agent: agentHue, data: dataHue, success: successHue, caution: cautionHue, danger: dangerHue },
    }),
    [
      recipeName, recipeMode,
      frameHue, frameTone, frameIntensity,
      cardHue, cardTone, cardIntensity,
      canvasHue, canvasTone, canvasIntensity,
      gridHue, gridTone, gridIntensity,
      contentHue, textIntensity,
      roleTone, roleIntensity,
      accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue,
    ],
  );

  // Re-derive and apply preview on recipe change (Editing state only)
  useEffect(() => {
    if (generatorState === "idle") return;
    const output = deriveTheme(currentRecipe);
    setThemeOutput(output);

    // Live preview via activate endpoint will be wired in step 9.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recipeMode,
    frameHue, frameTone, frameIntensity,
    cardHue, cardTone, cardIntensity,
    canvasHue, canvasTone, canvasIntensity,
    gridHue, gridTone, gridIntensity,
    contentHue, textIntensity,
    roleTone, roleIntensity,
    accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue,
  ]);

  // ---------------------------------------------------------------------------
  // Auto-save — debounced 500ms after last change, Editing state only
  // ---------------------------------------------------------------------------

  const performSave = useCallback(async (recipe: ThemeRecipe) => {
    setSaveStatus("saving");
    try {
      // Server derives CSS from recipe — no client-side CSS generation needed [D07]
      const res = await fetch("/__themes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: recipe.name, recipe: JSON.stringify(recipe) }),
      });
      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
        // Push updated theme list to Swift bridge with active theme name [D10]
        void pushThemeListToSwift(recipe.name);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, []);

  // Trigger auto-save debounce when recipe changes in editing state
  useEffect(() => {
    if (generatorState !== "editing" || currentThemeName === null) return;

    // Clear any pending timer
    if (autoSaveTimerRef.current !== null) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      void performSave(currentRecipe);
    }, 500);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    generatorState, currentThemeName,
    recipeMode,
    frameHue, frameTone, frameIntensity,
    cardHue, cardTone, cardIntensity,
    canvasHue, canvasTone, canvasIntensity,
    gridHue, gridTone, gridIntensity,
    contentHue, textIntensity,
    roleTone, roleIntensity,
    accentHue, activeHue, agentHue, dataHue, successHue, cautionHue, dangerHue,
  ]);

  // ---------------------------------------------------------------------------
  // New / Open dialog handlers
  // ---------------------------------------------------------------------------

  const handleNewCreated = useCallback((name: string, recipe: ThemeRecipe) => {
    setShowNewDialog(false);
    loadRecipeIntoState(recipe);
    setCurrentThemeName(name);
    setIsShipped(false);
    setGeneratorState("editing");
    setSaveStatus("idle");
    // Apply theme via context (activate endpoint wired in step 9).
    if (themeCtx) themeCtx.setTheme(name);
    void pushThemeListToSwift(name);
  }, [loadRecipeIntoState, themeCtx]);

  const handleOpenSelected = useCallback((name: string, recipe: ThemeRecipe, shipped: boolean) => {
    setShowOpenDialog(false);
    loadRecipeIntoState(recipe);
    setCurrentThemeName(name);
    setIsShipped(shipped);
    setGeneratorState(shipped ? "viewing" : "editing");
    setSaveStatus("idle");
    // Apply via theme context if available
    if (themeCtx) themeCtx.setTheme(name);
  }, [loadRecipeIntoState, themeCtx]);

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

  const isReadOnly = generatorState === "viewing" || generatorState === "idle";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="cg-content gtg-content" data-testid="gallery-theme-generator-content">

      {/* ---- Dialogs (rendered as overlays) ---- */}
      {showNewDialog && (
        <NewThemeDialog
          onCreated={handleNewCreated}
          onCancel={() => setShowNewDialog(false)}
        />
      )}
      {showOpenDialog && (
        <OpenThemeDialog
          onSelected={handleOpenSelected}
          onCancel={() => setShowOpenDialog(false)}
        />
      )}

      {/* ---- Header: document actions + theme info ---- */}
      <div className="gtg-header-row" data-testid="gtg-doc-header">
        <div className="gtg-doc-actions">
          <TugButton
            emphasis="outlined"
            role="action"
            size="sm"
            onClick={() => setShowNewDialog(true)}
            data-testid="gtg-new-btn"
          >
            New
          </TugButton>
          <TugButton
            emphasis="outlined"
            role="action"
            size="sm"
            onClick={() => setShowOpenDialog(true)}
            data-testid="gtg-open-btn"
          >
            Open
          </TugButton>
        </div>

        {generatorState !== "idle" && (
          <div className="gtg-doc-info" data-testid="gtg-doc-info">
            <span className="gtg-doc-name" data-testid="gtg-doc-name">
              {currentThemeName ?? recipeName}
            </span>
            <span
              className="gtg-doc-recipe-label"
              data-testid="gtg-doc-recipe-label"
              title="Recipe (dark or light) is set at creation time and cannot be changed"
            >
              {recipeMode}
            </span>
            {isShipped && (
              <span className="gtg-doc-readonly-badge" data-testid="gtg-doc-readonly-badge">
                read-only
              </span>
            )}
            {generatorState === "editing" && (
              <span className="gtg-doc-save-status" data-testid="gtg-doc-save-status">
                {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Save failed" : ""}
              </span>
            )}
          </div>
        )}

        {generatorState === "idle" && (
          <div className="gtg-idle-hint" data-testid="gtg-idle-hint">
            Click New to create a theme, or Open to edit an existing one.
          </div>
        )}
      </div>

      {/* ---- Color pickers ---- */}
      <div data-testid="gtg-role-hues">
        <div className="cg-section">
          <div className="cg-section-title">Colors</div>
          <ThemePreviewCard
            resolvedColor={resolvedColor}
            disabled={isReadOnly}
            surface={[
              { key: "canvas", label: "Canvas", hue: canvasHue, tone: canvasTone, intensity: canvasIntensity, setHue: setCanvasHue, setTone: setCanvasTone, setIntensity: setCanvasIntensity, testId: "gtg-canvas-hue" },
              { key: "grid", label: "Grid", hue: gridHue, tone: gridTone, intensity: gridIntensity, setHue: setGridHue, setTone: setGridTone, setIntensity: setGridIntensity, testId: "gtg-grid-hue" },
              { key: "frame", label: "Frame", hue: frameHue, tone: frameTone, intensity: frameIntensity, setHue: setFrameHue, setTone: setFrameTone, setIntensity: setFrameIntensity, testId: "gtg-frame-hue" },
              { key: "card", label: "Card", hue: cardHue, tone: cardTone, intensity: cardIntensity, setHue: setCardHue, setTone: setCardTone, setIntensity: setCardIntensity, testId: "gtg-card-hue" },
            ]}
            text={{
              key: "content",
              label: "Content",
              hue: contentHue,
              intensity: textIntensity,
              setHue: setContentHue,
              setIntensity: setTextIntensity,
              testId: "gtg-content-hue",
            }}
            roles={[
              { key: "accent", label: "Accent", hue: accentHue, set: setAccentHue, testId: "gtg-role-hue-accent" },
              { key: "action", label: "Action", hue: activeHue, set: setActiveHue, testId: "gtg-role-hue-action" },
              { key: "agent", label: "Agent", hue: agentHue, set: setAgentHue, testId: "gtg-role-hue-agent" },
              { key: "data", label: "Data", hue: dataHue, set: setDataHue, testId: "gtg-role-hue-data" },
              { key: "success", label: "Success", hue: successHue, set: setSuccessHue, testId: "gtg-role-hue-success" },
              { key: "caution", label: "Caution", hue: cautionHue, set: setCautionHue, testId: "gtg-role-hue-caution" },
              { key: "danger", label: "Danger", hue: dangerHue, set: setDangerHue, testId: "gtg-role-hue-danger" },
            ]}
            roleTone={roleTone}
            roleIntensity={roleIntensity}
            onRoleToneChange={setRoleTone}
            onRoleIntensityChange={setRoleIntensity}
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
