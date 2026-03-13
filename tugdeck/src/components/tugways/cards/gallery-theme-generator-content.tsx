/**
 * gallery-theme-generator-content.tsx — Theme Generator gallery card.
 *
 * Interactive tool for deriving complete 264-token --tug-base-* themes from a
 * compact ThemeRecipe: atmosphere + text hue selectors, mode toggle,
 * three mood sliders, and a scrollable token preview grid.
 *
 * Wires controls to `deriveTheme()` with 150ms debounce on slider changes.
 * Token preview renders all 264 tokens with name, value string, and a color
 * swatch derived from the resolved OKLCH map.
 *
 * Rules of Tugways compliance:
 *   - Appearance changes through CSS custom properties on the preview container,
 *     not React state. [D08, D09]
 *   - useState only for recipe parameters (local component state, not external
 *     store). [D40]
 *   - No root.render() after initial mount. [D40, D42]
 *
 * **Authoritative references:** [D04] ThemeRecipe, [D06] Gallery tab pattern,
 * Spec S01, (#constraints, #internal-architecture)
 *
 * @module components/tugways/cards/gallery-theme-generator-content
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { HUE_FAMILIES, tugColor, DEFAULT_CANONICAL_L } from "@/components/tugways/palette-engine";
import {
  deriveTheme,
  EXAMPLE_RECIPES,
  type ThemeRecipe,
  type ThemeOutput,
} from "@/components/tugways/theme-derivation-engine";
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
// GalleryThemeGeneratorContent — main component
// ---------------------------------------------------------------------------

/**
 * GalleryThemeGeneratorContent — Theme Generator gallery card tab.
 *
 * Manages local recipe state (mode, atmosphere, text hue, mood knobs).
 * Calls `deriveTheme()` on every recipe change, debounced 150ms for sliders.
 * Renders mode toggle, hue selectors, mood sliders, and token preview.
 *
 * **Authoritative reference:** [D06] Gallery tab pattern, [D04] ThemeRecipe.
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

    </div>
  );
}
