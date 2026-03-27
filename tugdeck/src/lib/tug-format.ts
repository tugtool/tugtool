/**
 * TugFormatter — bidirectional value formatting infrastructure.
 *
 * Models the formatter pattern from Apple's Foundation Formatter hierarchy:
 * a common interface with type-specific implementations.
 *
 * Built now: TugNumberFormatter (wraps Intl.NumberFormat, zero external deps).
 * Future: TugDateFormatter, TugDurationFormatter, TugRelativeFormatter, etc.
 */

// ---------------------------------------------------------------------------
// Core interface
// ---------------------------------------------------------------------------

/** Bidirectional value formatter. */
export interface TugFormatter<T> {
  /** Format a value for display. */
  format(value: T): string;
  /** Parse a display string back to a value. Returns null if unparseable. */
  parse(input: string): T | null;
}

// ---------------------------------------------------------------------------
// TugNumberFormatter options
// ---------------------------------------------------------------------------

export interface TugNumberFormatterOptions {
  /**
   * Formatting style. Default: "decimal".
   *
   * - decimal  — standard number with grouping (1,234.5)
   * - integer  — no decimals, rounds to nearest integer (1,235)
   * - percent  — multiply by 100 and add % (75%)
   * - compact  — abbreviated notation (1.23M)
   * - currency — ISO currency symbol prefix ($42.00)
   * - unit     — Intl unit suffix (2.5 s)
   * - custom   — decimal with optional prefix/suffix
   */
  style?: "decimal" | "integer" | "percent" | "compact" | "currency" | "unit" | "custom";

  /** Maximum decimal places. Default: style-dependent (0 for integer, 2 for currency). */
  decimals?: number;
  /** Minimum decimal places. Overrides the lower bound only. */
  minDecimals?: number;

  /** Currency code (required when style is "currency"). Example: "USD". */
  currency?: string;
  /** Intl unit identifier (required when style is "unit"). Example: "second", "gigabyte". */
  unit?: string;
  /** Unit display mode. Default: "short". */
  unitDisplay?: "short" | "narrow" | "long";

  /** Custom suffix for "custom" style. Example: " pts". */
  suffix?: string;
  /** Custom prefix for "custom" style. */
  prefix?: string;

  /** Use grouping separators. Default: true. */
  grouping?: boolean;
  /** Locale. Default: "en-US". */
  locale?: string;
}

// ---------------------------------------------------------------------------
// Internal: Intl.NumberFormat cache
// ---------------------------------------------------------------------------

const _intlCache = new Map<string, Intl.NumberFormat>();

function _getCachedIntl(
  locale: string,
  intlOptions: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = locale + "|" + JSON.stringify(intlOptions);
  let fmt = _intlCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, intlOptions);
    _intlCache.set(key, fmt);
  }
  return fmt;
}

// ---------------------------------------------------------------------------
// Internal: detect locale separators via formatToParts
// ---------------------------------------------------------------------------

interface _Separators {
  group: string;
  decimal: string;
}

const _separatorCache = new Map<string, _Separators>();

function _getSeparators(locale: string): _Separators {
  const cached = _separatorCache.get(locale);
  if (cached) return cached;

  const fmt = new Intl.NumberFormat(locale, { useGrouping: true });
  const parts = fmt.formatToParts(1234567.89);
  let group = ",";
  let decimal = ".";
  for (const part of parts) {
    if (part.type === "group") group = part.value;
    if (part.type === "decimal") decimal = part.value;
  }
  const sep: _Separators = { group, decimal };
  _separatorCache.set(locale, sep);
  return sep;
}

// ---------------------------------------------------------------------------
// Internal: strip group separators and normalise decimal for parseFloat
// ---------------------------------------------------------------------------

function _normaliseNumericString(raw: string, locale: string): string {
  const { group, decimal } = _getSeparators(locale);
  // Escape special regex characters in separator strings.
  const escGroup = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escDecimal = decimal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw
    .replace(new RegExp(escGroup, "g"), "")
    .replace(new RegExp(escDecimal), ".");
}

// ---------------------------------------------------------------------------
// Compact suffix multipliers
// ---------------------------------------------------------------------------

const _COMPACT_SUFFIXES: ReadonlyMap<string, number> = new Map([
  ["k", 1e3],
  ["m", 1e6],
  ["b", 1e9],
  ["t", 1e12],
]);

// ---------------------------------------------------------------------------
// createNumberFormatter
// ---------------------------------------------------------------------------

/**
 * Create a TugNumberFormatter.
 *
 * @example
 * const pct = createNumberFormatter({ style: "percent" });
 * pct.format(0.75); // "75%"
 * pct.parse("75%"); // 0.75
 */
export function createNumberFormatter(
  options?: TugNumberFormatterOptions,
): TugFormatter<number> {
  const style = options?.style ?? "decimal";
  const locale = options?.locale ?? "en-US";
  const grouping = options?.grouping ?? true;
  const suffix = options?.suffix ?? "";
  const prefix = options?.prefix ?? "";

  // Build Intl.NumberFormatOptions from our options.
  function _buildIntlOptions(): Intl.NumberFormatOptions {
    const intlOpts: Intl.NumberFormatOptions = {
      useGrouping: grouping,
    };

    switch (style) {
      case "decimal":
      case "custom": {
        intlOpts.style = "decimal";
        if (options?.decimals !== undefined) {
          intlOpts.maximumFractionDigits = options.decimals;
          // When decimals is set, default minimumFractionDigits to match so
          // trailing zeros are preserved (e.g. 1.5 → "1.50" with decimals: 2).
          intlOpts.minimumFractionDigits = options.minDecimals ?? options.decimals;
        }
        if (options?.minDecimals !== undefined) {
          intlOpts.minimumFractionDigits = options.minDecimals;
        }
        break;
      }
      case "integer": {
        intlOpts.style = "decimal";
        intlOpts.maximumFractionDigits = 0;
        intlOpts.minimumFractionDigits = 0;
        break;
      }
      case "percent": {
        intlOpts.style = "percent";
        if (options?.decimals !== undefined) {
          intlOpts.maximumFractionDigits = options.decimals;
        }
        if (options?.minDecimals !== undefined) {
          intlOpts.minimumFractionDigits = options.minDecimals;
        }
        break;
      }
      case "compact": {
        intlOpts.style = "decimal";
        intlOpts.notation = "compact";
        intlOpts.compactDisplay = "short";
        if (options?.decimals !== undefined) {
          intlOpts.maximumFractionDigits = options.decimals;
          intlOpts.minimumFractionDigits = options.minDecimals ?? 0;
        }
        break;
      }
      case "currency": {
        intlOpts.style = "currency";
        intlOpts.currency = options?.currency ?? "USD";
        if (options?.decimals !== undefined) {
          intlOpts.maximumFractionDigits = options.decimals;
          intlOpts.minimumFractionDigits = options.minDecimals ?? options.decimals;
        }
        break;
      }
      case "unit": {
        intlOpts.style = "unit";
        intlOpts.unit = options?.unit ?? "second";
        intlOpts.unitDisplay = options?.unitDisplay ?? "short";
        if (options?.decimals !== undefined) {
          intlOpts.maximumFractionDigits = options.decimals;
        }
        if (options?.minDecimals !== undefined) {
          intlOpts.minimumFractionDigits = options.minDecimals;
        }
        break;
      }
    }

    return intlOpts;
  }

  const intlOptions = _buildIntlOptions();
  const intlFmt = _getCachedIntl(locale, intlOptions);

  function format(value: number): string {
    if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
      return "";
    }
    if (style === "custom") {
      const base = intlFmt.format(value);
      return `${prefix}${base}${suffix}`;
    }
    return intlFmt.format(value);
  }

  function parse(input: string): number | null {
    if (input === null || input === undefined) return null;
    const trimmed = input.trim();
    if (trimmed === "") return null;

    if (style === "percent") {
      // Strip trailing % (and optional space before it), then divide by 100.
      const stripped = trimmed.replace(/\s*%\s*$/, "");
      const normalised = _normaliseNumericString(stripped, locale);
      const n = Number(normalised);
      if (Number.isNaN(n)) return null;
      return n / 100;
    }

    if (style === "compact") {
      // Try to extract a numeric part and a suffix letter.
      const match = trimmed.match(/^([+-]?[\d.,\s]*)([a-zA-Z]?)$/);
      if (!match) return null;
      const numPart = match[1].trim();
      const suffixLetter = match[2].toLowerCase();
      if (numPart === "") return null;
      const normalised = _normaliseNumericString(numPart, locale);
      const base = Number(normalised);
      if (Number.isNaN(base)) return null;
      const multiplier = _COMPACT_SUFFIXES.get(suffixLetter) ?? 1;
      return base * multiplier;
    }

    if (style === "currency") {
      // Strip everything that's not a digit, decimal separator, group separator, or minus sign.
      const { group, decimal } = _getSeparators(locale);
      const escGroup = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escDecimal = decimal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Keep digits, group sep, decimal sep, minus.
      const allowed = new RegExp(`[^0-9${escGroup}${escDecimal}\\-]`, "g");
      const stripped = trimmed.replace(allowed, "");
      const normalised = _normaliseNumericString(stripped, locale);
      const n = Number(normalised);
      if (Number.isNaN(n)) return null;
      return n;
    }

    if (style === "unit") {
      // Use formatToParts on a sample value to learn what the unit text looks like,
      // then strip it from the input.
      const parts = intlFmt.formatToParts(0);
      let unitStr = "";
      for (const part of parts) {
        if (part.type === "unit") {
          unitStr = part.value;
          break;
        }
      }
      let stripped = trimmed;
      if (unitStr) {
        // Remove the unit text (and surrounding whitespace) from the string.
        stripped = trimmed.replace(unitStr, "").trim();
      }
      const normalised = _normaliseNumericString(stripped, locale);
      const n = Number(normalised);
      if (Number.isNaN(n)) return null;
      return n;
    }

    if (style === "custom") {
      let stripped = trimmed;
      if (prefix && stripped.startsWith(prefix)) {
        stripped = stripped.slice(prefix.length);
      }
      if (suffix && stripped.endsWith(suffix)) {
        stripped = stripped.slice(0, stripped.length - suffix.length);
      }
      stripped = stripped.trim();
      const normalised = _normaliseNumericString(stripped, locale);
      const n = Number(normalised);
      if (Number.isNaN(n)) return null;
      return n;
    }

    // decimal and integer styles.
    const normalised = _normaliseNumericString(trimmed, locale);
    const n = Number(normalised);
    if (Number.isNaN(n)) return null;
    return n;
  }

  return Object.freeze({ format, parse });
}
