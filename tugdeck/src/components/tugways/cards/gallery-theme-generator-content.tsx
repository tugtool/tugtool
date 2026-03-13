/**
 * gallery-theme-generator-content.tsx — Theme Generator gallery card.
 *
 * Interactive tool for deriving complete 264-token --tug-base-* themes from a
 * compact ThemeRecipe: atmosphere + text hue selectors, mode toggle,
 * three mood sliders, token preview grid, and contrast dashboard.
 *
 * Wires controls to `deriveTheme()` with 150ms debounce on slider changes.
 * Runs `validateThemeContrast()` on every derived output to populate the
 * contrast dashboard. Token preview renders all 264 tokens with name,
 * value string, and a color swatch derived from the resolved OKLCH map.
 *
 * Rules of Tugways compliance:
 *   - Appearance changes through CSS custom properties on the preview container,
 *     not React state. [D08, D09]
 *   - useState only for recipe parameters (local component state, not external
 *     store). [D40]
 *   - No root.render() after initial mount. [D40, D42]
 *
 * **Authoritative references:** [D04] ThemeRecipe, [D06] Gallery tab pattern,
 * [D07] Contrast thresholds, [D03] Pairing map, Spec S01, Spec S02,
 * (#constraints, #internal-architecture)
 *
 * @module components/tugways/cards/gallery-theme-generator-content
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { HUE_FAMILIES, tugColor, DEFAULT_CANONICAL_L, oklchToHex } from "@/components/tugways/palette-engine";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
  type ThemeRecipe,
  type ThemeOutput,
  type ContrastResult,
} from "@/components/tugways/theme-derivation-engine";
import {
  validateThemeContrast,
  WCAG_CONTRAST_THRESHOLDS,
  APCA_LC_THRESHOLDS,
} from "@/components/tugways/theme-accessibility";
import { FG_BG_PAIRING_MAP } from "@/components/tugways/fg-bg-pairing-map";
import "./gallery-theme-generator-content.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HUE_NAMES = Object.keys(HUE_FAMILIES);

/**
 * Default recipe used on initial mount — matches Brio (default dark theme).
 */
const DEFAULT_RECIPE: ThemeRecipe = EXAMPLE_RECIPES.brio;

// ---------------------------------------------------------------------------
// HueSwatch strip helpers
// ---------------------------------------------------------------------------

/**
 * Renders a row of 24 hue swatches for atmosphere or text hue selection.
 * Each swatch shows the canonical color at intensity=50, tone=50.
 * Reuses the gp-canonical-* pattern from gallery-palette-content.
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
      <div className="gtg-hue-strip" data-testid={testId}>
        {HUE_NAMES.map((name) => {
          const canonL = DEFAULT_CANONICAL_L[name] ?? 0.77;
          const color = tugColor(name, 50, 50, canonL);
          const isSelected = name === selectedHue;
          return (
            <div
              key={name}
              className={`gtg-hue-item${isSelected ? " gtg-hue-item--selected" : ""}`}
              onClick={() => onSelect(name)}
              title={name}
            >
              <div
                className="gtg-hue-swatch"
                style={{ backgroundColor: color }}
                data-color={color}
              />
              <div className="gtg-hue-label">{name.slice(0, 3)}</div>
            </div>
          );
        })}
      </div>
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
 * - wcagPass true → "pass"
 * - wcagRatio within 0.5 of threshold → "marginal"
 * - otherwise → "fail"
 *
 * Per [D07]: badge is driven by WCAG 2.x only; APCA is informational.
 */
function badgeVariant(
  result: ContrastResult,
): "pass" | "marginal" | "fail" | "decorative" {
  if (result.role === "decorative") return "decorative";
  if (result.wcagPass) return "pass";
  const threshold = WCAG_CONTRAST_THRESHOLDS[result.role] ?? 1.0;
  if (result.wcagRatio >= threshold - 0.5) return "marginal";
  return "fail";
}

/**
 * Render the short APCA Lc label for a result row (informational, per [D07]).
 */
function apcaLabel(result: ContrastResult): string {
  return `Lc ${result.apcaLc.toFixed(1)}`;
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
 * ContrastDashboard — scrollable grid of all fg/bg pairs from FG_BG_PAIRING_MAP.
 *
 * Renders:
 *   - Summary bar: "N/M pairs pass WCAG AA"
 *   - Grid row per pair: fg swatch, bg swatch, fg token name, bg token name,
 *     WCAG ratio, APCA Lc (informational), pass/fail badge
 *
 * Badge color-coding per [D07]:
 *   - Green (pass)     : wcagPass = true
 *   - Yellow (marginal): failing but within 0.5 of threshold
 *   - Red (fail)       : failing by more than 0.5
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
  const passCount = contrastResults.filter((r) => r.role !== "decorative" && r.wcagPass).length;
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
        <span>pairs pass WCAG AA</span>
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
          <span>APCA Lc</span>
          <span>Badge</span>
        </div>

        {/* Data rows */}
        {contrastResults.map((result, idx) => {
          const variant = badgeVariant(result);
          const fgSwatchColor = resolvedSwatchColor(output.resolved, result.fg);
          const bgSwatchColor = resolvedSwatchColor(output.resolved, result.bg);
          const threshold = WCAG_CONTRAST_THRESHOLDS[result.role] ?? 1.0;
          const apcaThreshold = APCA_LC_THRESHOLDS[result.role] ?? 15;

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
                title={`APCA threshold: Lc ${apcaThreshold} (informational)`}
                data-testid="gtg-dash-apca-lc"
              >
                {apcaLabel(result)}
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
// GalleryThemeGeneratorContent — main component
// ---------------------------------------------------------------------------

/**
 * GalleryThemeGeneratorContent — Theme Generator gallery card tab.
 *
 * Manages local recipe state (mode, atmosphere, text hue, mood knobs).
 * Calls `deriveTheme()` on every recipe change, debounced 150ms for sliders.
 * Runs `validateThemeContrast()` on each derived output to populate the contrast
 * dashboard. Renders mode toggle, hue selectors, mood sliders, token preview,
 * and contrast dashboard.
 *
 * **Authoritative reference:** [D06] Gallery tab pattern, [D04] ThemeRecipe,
 * [D07] Contrast thresholds, [D03] Pairing map.
 */
export function GalleryThemeGeneratorContent() {
  const [mode, setMode] = useState<"dark" | "light">(DEFAULT_RECIPE.mode);
  const [atmosphereHue, setAtmosphereHue] = useState<string>(DEFAULT_RECIPE.atmosphere.hue);
  const [textHue, setTextHue] = useState<string>(DEFAULT_RECIPE.text.hue);
  const [surfaceContrast, setSurfaceContrast] = useState<number>(
    DEFAULT_RECIPE.surfaceContrast ?? 50,
  );
  const [signalVividity, setSignalVividity] = useState<number>(
    DEFAULT_RECIPE.signalVividity ?? 50,
  );
  const [warmth, setWarmth] = useState<number>(DEFAULT_RECIPE.warmth ?? 50);

  // The derived theme output — updated whenever recipe changes.
  const [themeOutput, setThemeOutput] = useState<ThemeOutput>(() => deriveTheme(DEFAULT_RECIPE));

  // Contrast results — derived from themeOutput via validateThemeContrast().
  // Computed with useMemo to avoid redundant runs on unrelated re-renders.
  const contrastResults = useMemo(
    () => validateThemeContrast(themeOutput.resolved, FG_BG_PAIRING_MAP),
    [themeOutput],
  );

  // Slider debounce timer ref.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Assemble the current recipe and call deriveTheme(), updating themeOutput.
   * Must be called with the latest values — no stale state.
   */
  const runDerive = useCallback(
    (
      m: "dark" | "light",
      atm: string,
      txt: string,
      sc: number,
      sv: number,
      w: number,
    ) => {
      const recipe: ThemeRecipe = {
        name: "preview",
        mode: m,
        atmosphere: { hue: atm },
        text: { hue: txt },
        surfaceContrast: sc,
        signalVividity: sv,
        warmth: w,
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
    runDerive(mode, atmosphereHue, textHue, surfaceContrast, signalVividity, warmth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, atmosphereHue, textHue]);

  /**
   * Debounced re-derive for slider changes (150ms delay).
   */
  const handleSliderChange = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<number>>,
      newValue: number,
      m: "dark" | "light",
      atm: string,
      txt: string,
      sc: number,
      sv: number,
      w: number,
    ) => {
      setter(newValue);
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        runDerive(m, atm, txt, sc, sv, w);
      }, 150);
    },
    [runDerive],
  );

  // ---------------------------------------------------------------------------
  // Preset load helpers
  // ---------------------------------------------------------------------------

  const loadPreset = useCallback(
    (recipeName: keyof typeof EXAMPLE_RECIPES) => {
      const r = EXAMPLE_RECIPES[recipeName];
      setMode(r.mode);
      setAtmosphereHue(r.atmosphere.hue);
      setTextHue(r.text.hue);
      setSurfaceContrast(r.surfaceContrast ?? 50);
      setSignalVividity(r.signalVividity ?? 50);
      setWarmth(r.warmth ?? 50);
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
            <button
              key={name}
              type="button"
              className="gtg-preset-btn"
              onClick={() => loadPreset(name)}
              data-testid={`gtg-preset-${name}`}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Mode toggle (dark / light) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Mode</div>
        <div className="gtg-mode-group" data-testid="gtg-mode-group">
          <button
            type="button"
            className={`gtg-mode-btn${mode === "dark" ? " gtg-mode-btn--active" : ""}`}
            onClick={() => setMode("dark")}
            data-testid="gtg-mode-dark"
          >
            Dark
          </button>
          <button
            type="button"
            className={`gtg-mode-btn${mode === "light" ? " gtg-mode-btn--active" : ""}`}
            onClick={() => setMode("light")}
            data-testid="gtg-mode-light"
          >
            Light
          </button>
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

      {/* ---- Mood sliders ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Mood</div>
        <div className="gtg-sliders">
          <MoodSlider
            label="Surface Contrast"
            value={surfaceContrast}
            onChange={(v) =>
              handleSliderChange(setSurfaceContrast, v, mode, atmosphereHue, textHue, v, signalVividity, warmth)
            }
            testId="gtg-slider-surface-contrast"
          />
          <MoodSlider
            label="Signal Vividity"
            value={signalVividity}
            onChange={(v) =>
              handleSliderChange(setSignalVividity, v, mode, atmosphereHue, textHue, surfaceContrast, v, warmth)
            }
            testId="gtg-slider-signal-vividity"
          />
          <MoodSlider
            label="Warmth"
            value={warmth}
            onChange={(v) =>
              handleSliderChange(setWarmth, v, mode, atmosphereHue, textHue, surfaceContrast, signalVividity, v)
            }
            testId="gtg-slider-warmth"
          />
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

    </div>
  );
}
