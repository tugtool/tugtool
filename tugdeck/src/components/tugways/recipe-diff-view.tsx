/**
 * recipe-diff-view.tsx — Parameter diff bars comparing current state against defaultParameters().
 *
 * Renders 7 horizontal bars, one per parameter. Each bar shows the current value
 * relative to the baseline of 50 (defaultParameters). Values below 50 extend left
 * from center; values above 50 extend right.
 *
 * Each bar is expandable (<details>) to show field-level detail: field name,
 * current interpolated value, default value, and delta.
 *
 * The entire diff view is wrapped in a top-level collapsible section (inline below sliders).
 *
 * Design decisions:
 *   [D04] Diff baseline is always defaultParameters() (all-50).
 *   Spec S04: RecipeDiffView props.
 *
 * @module components/tugways/recipe-diff-view
 */

import React, { useMemo, useState } from "react";
import type { DerivationFormulas } from "./theme-derivation-engine";
import type { RecipeParameters } from "./recipe-parameters";
import {
  compileRecipe,
  defaultParameters,
  getParameterFields,
} from "./recipe-parameters";
import { PARAMETER_METADATA } from "./parameter-slider";
import "./recipe-diff-view.css";

// ---------------------------------------------------------------------------
// RecipeDiffViewProps — Spec S04
// ---------------------------------------------------------------------------

/**
 * Props for the RecipeDiffView component.
 * Per Spec S04.
 */
export interface RecipeDiffViewProps {
  /** Current parameter values. */
  parameters: RecipeParameters;
  /** Current compiled formulas (from parent useMemo calling compileRecipe()). */
  compiledFormulas: DerivationFormulas;
  /** Current mode (needed to compute defaultParameters() baseline for field-level detail). */
  mode: "dark" | "light";
}

// ---------------------------------------------------------------------------
// RecipeDiffView component — Spec S04, [D04]
// ---------------------------------------------------------------------------

/**
 * RecipeDiffView renders 7 parameter diff bars comparing the current recipe
 * parameters against the defaultParameters() baseline (all values = 50).
 *
 * Per [D04]: The diff baseline is always defaultParameters().
 * Per Spec S04: Receives compiledFormulas from parent useMemo; memoizes baseline.
 *
 * Layout per bar:
 *   - Parameter label | current value | delta label
 *   - Horizontal bar: left half (negative deviation) | center mark | right half (positive deviation)
 *   - Expandable <details>: field name | current value | default value | delta
 *
 * The entire component is wrapped in a collapsible <details> section.
 */
export function RecipeDiffView({
  parameters,
  compiledFormulas,
  mode,
}: RecipeDiffViewProps) {
  // Baseline formulas from defaultParameters() — recomputes only on mode change.
  // Per Spec S04: "Compute compileRecipe(mode, defaultParameters()) for the baseline
  // via useMemo keyed on mode (since defaultParameters() is constant)."
  const baselineFormulas = useMemo(
    () => compileRecipe(mode, defaultParameters()),
    [mode],
  );

  // Track which parameter bar sections are open to defer field-level computation
  // until the <details> section is expanded.
  // Per Spec S04: "Defer the field-level computation until the collapsible section
  // is open — only run the field-by-field comparison when the <details> element is expanded."
  const [openSections, setOpenSections] = useState<
    Partial<Record<keyof RecipeParameters, boolean>>
  >({});

  return (
    <details
      className="rdv-wrapper"
      data-testid="recipe-diff-view"
    >
      <summary className="rdv-wrapper-summary" data-testid="recipe-diff-summary">
        Recipe Diff
      </summary>
      <div className="rdv-bars" data-testid="recipe-diff-bars">
        {PARAMETER_METADATA.map((meta) => {
          const value = parameters[meta.paramKey];
          const delta = value - 50; // signed deviation from baseline

          // Bar proportions: max half-width is 50 units (full 0-100 range centered at 50).
          const leftPct = delta < 0 ? Math.abs(delta) / 50 : 0; // 0..1
          const rightPct = delta > 0 ? delta / 50 : 0; // 0..1

          const isOpen = openSections[meta.paramKey] ?? false;

          return (
            <details
              key={meta.paramKey}
              className="rdv-bar-section"
              data-testid={`rdv-bar-${meta.paramKey}`}
              onToggle={(e) => {
                setOpenSections((prev) => ({
                  ...prev,
                  [meta.paramKey]: (e.target as HTMLDetailsElement).open,
                }));
              }}
            >
              <summary
                className="rdv-bar-summary"
                data-testid={`rdv-bar-summary-${meta.paramKey}`}
              >
                <span
                  className="rdv-param-label"
                  data-testid={`rdv-label-${meta.paramKey}`}
                >
                  {meta.label}
                </span>
                <div
                  className="rdv-bar-track"
                  data-testid={`rdv-track-${meta.paramKey}`}
                >
                  {/* Left half: negative deviation (toward 0) */}
                  <div className="rdv-half rdv-half-left">
                    <div
                      className="rdv-fill rdv-fill-left"
                      data-testid={`rdv-fill-left-${meta.paramKey}`}
                      style={{ width: `${leftPct * 100}%` }}
                    />
                  </div>
                  {/* Center mark */}
                  <div
                    className="rdv-center-mark"
                    data-testid={`rdv-center-${meta.paramKey}`}
                  />
                  {/* Right half: positive deviation (toward 100) */}
                  <div className="rdv-half rdv-half-right">
                    <div
                      className="rdv-fill rdv-fill-right"
                      data-testid={`rdv-fill-right-${meta.paramKey}`}
                      style={{ width: `${rightPct * 100}%` }}
                    />
                  </div>
                </div>
                <span
                  className="rdv-value"
                  data-testid={`rdv-value-${meta.paramKey}`}
                >
                  {value}
                </span>
                <span
                  className={`rdv-delta ${delta === 0 ? "rdv-delta-zero" : delta > 0 ? "rdv-delta-positive" : "rdv-delta-negative"}`}
                  data-testid={`rdv-delta-${meta.paramKey}`}
                >
                  {delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `${delta}`}
                </span>
              </summary>

              {/* Field-level detail — only rendered when this section is open.
                  Per Spec S04: defer field-level computation until expanded. */}
              {isOpen && (
                <FieldDetail
                  paramKey={meta.paramKey}
                  mode={mode}
                  compiledFormulas={compiledFormulas}
                  baselineFormulas={baselineFormulas}
                />
              )}
            </details>
          );
        })}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// FieldDetail — per-parameter field comparison (rendered only when expanded)
// ---------------------------------------------------------------------------

/**
 * Renders the field-level detail for one parameter's expanded diff bar.
 * Shows: field name | current value | default value | delta.
 *
 * Per Spec S04: "Defer the field-level computation until the collapsible section
 * is open — only run the field-by-field comparison when the <details> element is expanded."
 *
 * The baseline computation is already memoized in the parent (RecipeDiffView).
 */
function FieldDetail({
  paramKey,
  mode,
  compiledFormulas,
  baselineFormulas,
}: {
  paramKey: keyof RecipeParameters;
  mode: "dark" | "light";
  compiledFormulas: DerivationFormulas;
  baselineFormulas: DerivationFormulas;
}) {
  const fields = getParameterFields(paramKey, mode);

  return (
    <ul
      className="rdv-field-list"
      data-testid={`rdv-field-list-${paramKey}`}
    >
      {fields.map((fieldName) => {
        const currentRaw = (
          compiledFormulas as unknown as Record<string, unknown>
        )[fieldName];
        const defaultRaw = (
          baselineFormulas as unknown as Record<string, unknown>
        )[fieldName];

        const currentVal =
          typeof currentRaw === "number" ? currentRaw : null;
        const defaultVal =
          typeof defaultRaw === "number" ? defaultRaw : null;

        const fieldDelta =
          currentVal !== null && defaultVal !== null
            ? currentVal - defaultVal
            : null;

        return (
          <li
            key={fieldName}
            className="rdv-field-item"
            data-testid={`rdv-field-${paramKey}-${fieldName}`}
          >
            <span
              className="rdv-field-name"
              data-testid={`rdv-field-name-${paramKey}-${fieldName}`}
            >
              {fieldName}
            </span>
            <span
              className="rdv-field-current"
              data-testid={`rdv-field-current-${paramKey}-${fieldName}`}
            >
              {currentVal !== null ? currentVal.toFixed(2) : "—"}
            </span>
            <span
              className="rdv-field-default"
              data-testid={`rdv-field-default-${paramKey}-${fieldName}`}
            >
              {defaultVal !== null ? defaultVal.toFixed(2) : "—"}
            </span>
            <span
              className={`rdv-field-delta ${fieldDelta === null ? "" : fieldDelta > 0 ? "rdv-field-delta-positive" : fieldDelta < 0 ? "rdv-field-delta-negative" : "rdv-field-delta-zero"}`}
              data-testid={`rdv-field-delta-${paramKey}-${fieldName}`}
            >
              {fieldDelta === null
                ? "—"
                : fieldDelta === 0
                  ? "±0"
                  : fieldDelta > 0
                    ? `+${fieldDelta.toFixed(2)}`
                    : fieldDelta.toFixed(2)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
