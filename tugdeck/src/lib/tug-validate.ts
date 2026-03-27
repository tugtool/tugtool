/**
 * Numeric validation utilities for tugways.
 *
 * Pure functions — no dependencies, no side effects.
 * Used by any component that accepts numeric input.
 */

/**
 * Clamp a number to [min, max].
 * Returns min if value is NaN.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Compute the number of decimal places in a number (as a string representation).
 * e.g. decimalPlaces(0.1) === 1, decimalPlaces(0.25) === 2, decimalPlaces(5) === 0.
 */
function decimalPlaces(n: number): number {
  const str = n.toString();
  const dot = str.indexOf(".");
  if (dot === -1) return 0;
  return str.length - dot - 1;
}

/**
 * Snap value to nearest step increment from base (defaults to min, or 0).
 * Handles floating-point epsilon by normalizing the division ratio before
 * rounding — toPrecision(12) removes FP drift near integer boundaries,
 * so cases like snapToStep(0.1 + 0.2, 0.1) return 0.3 (not 0.30000000000000004)
 * and snapToStep(1.005, 0.01) returns 1.01 (not 1.00).
 */
export function snapToStep(value: number, step: number, min = 0): number {
  const ratio = (value - min) / step;
  // Normalize away FP drift near integer boundaries before rounding.
  const rounded = Math.round(parseFloat(ratio.toPrecision(12)));
  const snapped = rounded * step + min;
  // Final round to step's decimal precision to clean up multiplication residue.
  const places = Math.max(decimalPlaces(step), decimalPlaces(min));
  if (places === 0) return snapped;
  const factor = Math.pow(10, places);
  return Math.round(snapped * factor) / factor;
}

/**
 * Parse a string to a number.
 * Returns null for empty strings, whitespace-only strings, or non-numeric input.
 * Uses Number() (not parseFloat) so trailing garbage like "42abc" returns null.
 * "Infinity" and "-Infinity" return the corresponding Infinity values.
 */
export function coerceNumber(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return null;
  return n;
}

/**
 * Full validation pipeline: parse → clamp → snap.
 * Returns null if the input cannot be parsed as a number.
 * step is optional; if omitted, snapping is skipped.
 */
export function validateNumericInput(
  input: string,
  options: { min: number; max: number; step?: number },
): number | null {
  const { min, max, step } = options;
  const parsed = coerceNumber(input);
  if (parsed === null) return null;
  const clamped = clamp(parsed, min, max);
  if (step === undefined) return clamped;
  return snapToStep(clamped, step, min);
}
