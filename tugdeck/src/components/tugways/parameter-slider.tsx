/**
 * parameter-slider.tsx — ParameterSlider component and PARAMETER_METADATA.
 *
 * Provides a native HTML range input (min=0, max=100, step=1) for each of
 * the 7 design parameters in the recipe authoring UI.
 *
 * Design decisions:
 *   [D05] Native range input with CSS styling
 *   [D01] onChange fires on the `input` event (continuous during drag)
 *
 * @module components/tugways/parameter-slider
 */

import React from "react";
import type { RecipeParameters } from "./recipe-parameters";
import "./parameter-slider.css";

// ---------------------------------------------------------------------------
// ParameterMetadata — Spec S02
// ---------------------------------------------------------------------------

/**
 * Metadata for a single parameter slider.
 * Per Spec S02.
 */
export interface ParameterMetadataEntry {
  /** Parameter key in RecipeParameters. */
  paramKey: keyof RecipeParameters;
  /** Human-readable label. */
  label: string;
  /** Description of the low extreme (parameter=0). */
  lowLabel: string;
  /** Description of the high extreme (parameter=100). */
  highLabel: string;
}

/**
 * Ordered metadata for all 7 design parameters.
 * Per Spec S02.
 */
export const PARAMETER_METADATA: ParameterMetadataEntry[] = [
  {
    paramKey: "surfaceDepth",
    label: "Surface Depth",
    lowLabel: "Flat",
    highLabel: "Deep",
  },
  {
    paramKey: "textHierarchy",
    label: "Text Hierarchy",
    lowLabel: "Democratic",
    highLabel: "Strong order",
  },
  {
    paramKey: "controlWeight",
    label: "Control Weight",
    lowLabel: "Light",
    highLabel: "Bold",
  },
  {
    paramKey: "borderDefinition",
    label: "Border Definition",
    lowLabel: "Minimal",
    highLabel: "Strong",
  },
  {
    paramKey: "shadowDepth",
    label: "Shadow Depth",
    lowLabel: "Flat",
    highLabel: "Deep",
  },
  {
    paramKey: "signalStrength",
    label: "Signal Strength",
    lowLabel: "Muted",
    highLabel: "Vivid",
  },
  {
    paramKey: "atmosphere",
    label: "Atmosphere",
    lowLabel: "Achromatic",
    highLabel: "Tinted",
  },
];

// ---------------------------------------------------------------------------
// ParameterSliderProps — Spec S01
// ---------------------------------------------------------------------------

/**
 * Props for the ParameterSlider component.
 * Per Spec S01.
 */
export interface ParameterSliderProps {
  /** Parameter key (e.g., "surfaceDepth"). */
  paramKey: keyof RecipeParameters;
  /** Human-readable label (e.g., "Surface Depth"). */
  label: string;
  /** Description of the low extreme (parameter=0). */
  lowLabel: string;
  /** Description of the high extreme (parameter=100). */
  highLabel: string;
  /** Current value (0-100). */
  value: number;
  /** Callback when value changes. Fires on input event (continuous during drag). */
  onChange: (paramKey: keyof RecipeParameters, value: number) => void;
}

// ---------------------------------------------------------------------------
// ParameterSlider component — Spec S01, [D05]
// ---------------------------------------------------------------------------

/**
 * ParameterSlider renders a native HTML range input for one design parameter.
 *
 * Layout:
 *   - Label row: label text + numeric value
 *   - Slider row: low-label | range input | high-label
 *
 * Fires onChange on every `input` event for continuous updates during drag.
 * Uses native <input type="range"> per [D05].
 *
 * Per Spec S01, [D05].
 */
export function ParameterSlider({
  paramKey,
  label,
  lowLabel,
  highLabel,
  value,
  onChange,
}: ParameterSliderProps) {
  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    const newValue = Number((e.target as HTMLInputElement).value);
    onChange(paramKey, newValue);
  };

  return (
    <div className="ps-slider" data-testid={`parameter-slider-${paramKey}`}>
      <div className="ps-label-row">
        <span className="ps-label" data-testid={`ps-label-${paramKey}`}>{label}</span>
        <span className="ps-value" data-testid={`ps-value-${paramKey}`}>{value}</span>
      </div>
      <div className="ps-track-row">
        <span className="ps-low-label" data-testid={`ps-low-label-${paramKey}`}>{lowLabel}</span>
        <input
          type="range"
          className="ps-range"
          min={0}
          max={100}
          step={1}
          value={value}
          onInput={handleInput}
          onChange={() => {
            // onChange is required for controlled React inputs, but we use onInput
            // for continuous updates during drag. This is intentionally a no-op.
          }}
          aria-label={`${label}: ${value}`}
          data-testid={`ps-range-${paramKey}`}
        />
        <span className="ps-high-label" data-testid={`ps-high-label-${paramKey}`}>{highLabel}</span>
      </div>
    </div>
  );
}
