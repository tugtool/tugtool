/**
 * `FieldRow` — one line in an inspector's field table.
 *
 * Label, value, and the underlying value path (e.g.
 * `TurnEntry.awaitingApprovalMs`) so a screenshot of the panel is
 * self-documenting. The label / path / value are all rendered through
 * `TugLabel` so typography, color, and truncation come from the
 * standard token family rather than ad-hoc CSS.
 *
 * Conformance: [L19] small focused component, [L20] no raw token reads
 * — every visual aspect goes through `TugLabel`'s own slot family.
 *
 * @module components/tug-dev-panel/field-row
 */

import React from "react";

import { cn } from "@/lib/utils";
import { TugLabel } from "@/components/tugways/tug-label";

export interface FieldRowProps {
  /** Human label, e.g. "Awaiting approval". */
  label: string;
  /** Formatted value, e.g. `"1234 ms"` or `"null"`. */
  value: string;
  /**
   * Source path the value comes from, e.g.
   * `"TurnEntry.awaitingApprovalMs"`. Rendered in muted monospace
   * under the label.
   */
  fieldPath: string;
  /**
   * Optional one-line hint shown after the value. Use for units,
   * derivation notes, or "live: ticks every 1s" annotations.
   */
  hint?: string;
  /**
   * Override the default tabular formatting — used for very long
   * values (e.g. a JSON blob) that need a multi-line block.
   */
  multiline?: boolean;
  className?: string;
}

/**
 * Format a numeric value for display. Tests use this helper directly
 * so they don't depend on locale.
 */
export function formatFieldValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return value > 0 ? "+∞" : "−∞";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const FieldRow: React.FC<FieldRowProps> = ({
  label,
  value,
  fieldPath,
  hint,
  multiline,
  className,
}) => {
  return (
    <div
      className={cn("tug-devpanel-field-row", className)}
      data-multiline={multiline ? "true" : undefined}
    >
      <div className="tug-devpanel-field-label">
        <TugLabel size="xs" className="tug-devpanel-field-label-text">
          {label}
        </TugLabel>
        <TugLabel
          size="3xs"
          emphasis="calm"
          mono
          ellipsis="end"
          maxLines={1}
          className="tug-devpanel-field-path"
        >
          {fieldPath}
        </TugLabel>
      </div>
      <div className="tug-devpanel-field-value">
        {multiline ? (
          <pre className="tug-devpanel-field-value-pre">{value}</pre>
        ) : (
          <TugLabel size="xs" mono className="tug-devpanel-field-value-text">
            {value}
          </TugLabel>
        )}
        {hint !== undefined ? (
          <TugLabel
            size="3xs"
            emphasis="calm"
            className="tug-devpanel-field-hint"
          >
            {hint}
          </TugLabel>
        ) : null}
      </div>
    </div>
  );
};
FieldRow.displayName = "FieldRow";
