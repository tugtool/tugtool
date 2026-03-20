/**
 * formula-expansion-panel.tsx — Read-only formula field viewer.
 *
 * Renders one collapsible <details> element per parameter. Each section
 * lists the field names with their current interpolated numeric values
 * from compiledFormulas.
 *
 * Design decisions:
 *   [D03] Formula expansion panel is read-only — no input elements.
 *
 * Per Spec S03, #formula-expansion-spec.
 *
 * @module components/tugways/formula-expansion-panel
 */

import React from "react";
import type { DerivationFormulas } from "./theme-derivation-engine";
import type { RecipeParameters } from "./recipe-parameters";
import { getParameterFields } from "./recipe-parameters";
import { PARAMETER_METADATA } from "./parameter-slider";
import "./formula-expansion-panel.css";

// ---------------------------------------------------------------------------
// FormulaExpansionPanelProps — Spec S03
// ---------------------------------------------------------------------------

/**
 * Props for the FormulaExpansionPanel component.
 * Per Spec S03.
 */
export interface FormulaExpansionPanelProps {
  /** Current compiled formulas (from parent useMemo calling compileRecipe()). */
  compiledFormulas: DerivationFormulas;
  /** Current parameter values (to determine which fields belong to which parameter). */
  parameters: RecipeParameters;
  /** Current mode (to select the correct endpoint bundle for field grouping). */
  mode: "dark" | "light";
}

// ---------------------------------------------------------------------------
// FormulaExpansionPanel component — Spec S03, [D03]
// ---------------------------------------------------------------------------

/**
 * FormulaExpansionPanel renders a read-only collapsible list of formula
 * field values, grouped by parameter.
 *
 * One <details> element per parameter. Summary shows the parameter label
 * and field count. Expanded content lists field name + current numeric value.
 *
 * All display is read-only per [D03].
 *
 * Per Spec S03.
 */
export function FormulaExpansionPanel({
  compiledFormulas,
  parameters: _parameters,
  mode,
}: FormulaExpansionPanelProps) {
  return (
    <div className="fep-panel" data-testid="formula-expansion-panel">
      {PARAMETER_METADATA.map((meta) => {
        const fields = getParameterFields(meta.paramKey, mode);
        return (
          <details
            key={meta.paramKey}
            className="fep-section"
            data-testid={`fep-section-${meta.paramKey}`}
          >
            <summary
              className="fep-summary"
              data-testid={`fep-summary-${meta.paramKey}`}
            >
              <span className="fep-param-label">{meta.label}</span>
              <span
                className="fep-field-count"
                data-testid={`fep-field-count-${meta.paramKey}`}
              >
                {fields.length} fields
              </span>
            </summary>
            <ul
              className="fep-field-list"
              data-testid={`fep-field-list-${meta.paramKey}`}
            >
              {fields.map((fieldName) => {
                const rawValue = (compiledFormulas as unknown as Record<string, unknown>)[fieldName];
                const numValue =
                  typeof rawValue === "number" ? rawValue : null;
                return (
                  <li
                    key={fieldName}
                    className="fep-field-item"
                    data-testid={`fep-field-${meta.paramKey}-${fieldName}`}
                  >
                    <span
                      className="fep-field-name"
                      data-testid={`fep-field-name-${meta.paramKey}-${fieldName}`}
                    >
                      {fieldName}
                    </span>
                    <span
                      className="fep-field-value"
                      data-testid={`fep-field-value-${meta.paramKey}-${fieldName}`}
                    >
                      {numValue !== null
                        ? numValue.toFixed(2)
                        : String(rawValue ?? "")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
