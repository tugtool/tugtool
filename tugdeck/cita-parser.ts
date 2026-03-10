/**
 * cita-parser — Tokenizer and parser for the --cita() color notation.
 *
 * --cita() specifies colors using four parameters:
 *   Color (C):     A named hue, optionally adjusted by a degree offset
 *   Intensity (I): Chroma axis, 0–100 (default 50)
 *   Tone (T):      Lightness axis, 0–100 (default 50)
 *   Alpha (A):     Opacity, 0–100 (default 100)
 *
 * Supported syntax forms:
 *   --cita(red)                              defaults for i/t/a
 *   --cita(red, 70)                          positional i, defaults for t/a
 *   --cita(red, 50, 40, 100)                 all positional
 *   --cita(c: red, i: 50, t: 40, a: 100)    all labeled
 *   --cita(color: red, intensity: 50, tone: 40, alpha: 100) full label names
 *   --cita(coral, t: 20)                     mixed: positional then labeled
 *   --cita(red+5.2, i: 30, t: 70)           color with hue offset
 *   --cita(t: 40, a: 100, c: purple, i: 12) labeled, any order
 *
 * Labels: c/color, i/intensity, t/tone, a/alpha
 * Positional order: color, intensity, tone, alpha
 * Positional args must precede labeled args.
 *
 * @module cita-parser
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CITAColor {
  name: string;
  offset: number; // degrees, 0 if no offset specified
}

export interface CITAParsed {
  color: CITAColor;
  intensity: number;
  tone: number;
  alpha: number;
}

export interface CITAError {
  message: string;
  pos: number;
}

export type ParseResult =
  | { ok: true; value: CITAParsed }
  | { ok: false; errors: CITAError[] };

/** A --cita() call found within a larger CSS value string. */
export interface CITACallSpan {
  /** Index of the first '-' in '--cita(' */
  start: number;
  /** Index one past the closing ')' */
  end: number;
  /** The text between the parentheses (excluding them) */
  inner: string;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokenType = "ident" | "number" | "plus" | "minus" | "colon" | "comma";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(input: string): Token[] | CITAError {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    const pos = i;

    if (ch === ",") {
      tokens.push({ type: "comma", value: ch, pos });
      i++;
    } else if (ch === ":") {
      tokens.push({ type: "colon", value: ch, pos });
      i++;
    } else if (ch === "+") {
      tokens.push({ type: "plus", value: ch, pos });
      i++;
    } else if (ch === "-") {
      tokens.push({ type: "minus", value: ch, pos });
      i++;
    } else if (ch >= "a" && ch <= "z") {
      let end = i + 1;
      while (end < input.length && input[end] >= "a" && input[end] <= "z") end++;
      tokens.push({ type: "ident", value: input.slice(i, end), pos });
      i = end;
    } else if ((ch >= "0" && ch <= "9") || ch === ".") {
      let end = i + 1;
      let hasDot = ch === ".";
      while (end < input.length) {
        const c = input[end];
        if (c >= "0" && c <= "9") {
          end++;
        } else if (c === "." && !hasDot) {
          hasDot = true;
          end++;
        } else {
          break;
        }
      }
      tokens.push({ type: "number", value: input.slice(i, end), pos });
      i = end;
    } else {
      return { message: `Unexpected character '${ch}'`, pos };
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Label normalization
// ---------------------------------------------------------------------------

const LABEL_ALIASES: Record<string, string> = {
  c: "color",
  color: "color",
  i: "intensity",
  intensity: "intensity",
  t: "tone",
  tone: "tone",
  a: "alpha",
  alpha: "alpha",
};

const VALID_LABELS = "c, color, i, intensity, t, tone, a, or alpha";

// Positional slot order
const SLOT_ORDER = ["color", "intensity", "tone", "alpha"] as const;

// Defaults for optional numeric slots
const DEFAULTS = { intensity: 50, tone: 50, alpha: 100 } as const;

// ---------------------------------------------------------------------------
// Argument group splitting
// ---------------------------------------------------------------------------

/** Split a token array on COMMA tokens into groups. */
function splitArgs(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  for (const tok of tokens) {
    if (tok.type === "comma") {
      groups.push(current);
      current = [];
    } else {
      current.push(tok);
    }
  }
  groups.push(current);
  return groups;
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

/**
 * Parse tokens as a color value: IDENT [(PLUS|MINUS) NUMBER]
 * Returns null on failure after pushing errors.
 */
function parseColorTokens(
  tokens: Token[],
  knownHues: ReadonlySet<string>,
  errors: CITAError[],
): CITAColor | null {
  if (tokens.length === 0) {
    errors.push({ message: "Expected a color name", pos: 0 });
    return null;
  }

  if (tokens[0].type !== "ident") {
    errors.push({
      message: `Expected a color name, got '${tokens[0].value}'`,
      pos: tokens[0].pos,
    });
    return null;
  }

  const name = tokens[0].value;

  if (!knownHues.has(name)) {
    errors.push({ message: `Unknown color '${name}'`, pos: tokens[0].pos });
    return null;
  }

  // Color name alone
  if (tokens.length === 1) {
    return { name, offset: 0 };
  }

  // Color name with explicit sign offset: IDENT (PLUS|MINUS) NUMBER
  if (
    tokens.length === 3 &&
    (tokens[1].type === "plus" || tokens[1].type === "minus") &&
    tokens[2].type === "number"
  ) {
    const sign = tokens[1].type === "plus" ? 1 : -1;
    const offset = sign * parseFloat(tokens[2].value);
    return { name, offset };
  }

  // Color name with unsigned offset: IDENT NUMBER
  // Lightning CSS (Tailwind v4) normalizes `+10` → `10` in custom property
  // values, stripping the `+` sign.  Accept bare numbers as positive offsets.
  if (tokens.length === 2 && tokens[1].type === "number") {
    const offset = parseFloat(tokens[1].value);
    return { name, offset };
  }

  // Anything else after the color name is a syntax error
  errors.push({
    message: `Invalid color offset syntax after '${name}'`,
    pos: tokens[1].pos,
  });
  return null;
}

/**
 * Parse tokens as a numeric value: NUMBER or MINUS NUMBER.
 * Validates the result is within 0–100.
 * Returns null on failure after pushing errors.
 */
function parseNumericTokens(
  tokens: Token[],
  slotName: string,
  errors: CITAError[],
): number | null {
  if (tokens.length === 0) {
    errors.push({ message: `Expected a number for ${slotName}`, pos: 0 });
    return null;
  }

  let value: number;
  const anchorPos = tokens[0].pos;

  if (tokens.length === 1 && tokens[0].type === "number") {
    value = parseFloat(tokens[0].value);
  } else if (
    tokens.length === 2 &&
    tokens[0].type === "minus" &&
    tokens[1].type === "number"
  ) {
    value = -parseFloat(tokens[1].value);
  } else {
    const raw = tokens.map((t) => t.value).join("");
    errors.push({
      message: `Invalid value '${raw}' for ${slotName}; expected a number`,
      pos: anchorPos,
    });
    return null;
  }

  if (value < 0 || value > 100) {
    errors.push({
      message: `Value ${value} is out of range for ${slotName} (0–100)`,
      pos: anchorPos,
    });
    return null;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse the inner content of a --cita() call.
 *
 * @param input  The text between the parentheses (not including them).
 * @param knownHues  Set of valid color names (e.g. "red", "blue", "cherry").
 */
export function parseCITA(
  input: string,
  knownHues: ReadonlySet<string>,
): ParseResult {
  const tokenResult = tokenize(input);
  if (!Array.isArray(tokenResult)) {
    return { ok: false, errors: [tokenResult] };
  }

  if (tokenResult.length === 0) {
    return { ok: false, errors: [{ message: "Empty --cita() call", pos: 0 }] };
  }

  const argGroups = splitArgs(tokenResult);
  const errors: CITAError[] = [];

  // Parsed values — undefined means not yet assigned
  let color: CITAColor | undefined;
  let intensity: number | undefined;
  let tone: number | undefined;
  let alpha: number | undefined;

  // Track which slots have been assigned or attempted (even if invalid)
  // to distinguish "missing" from "present but invalid"
  const attempted = new Set<string>();

  let positionalIndex = 0;
  let seenLabeled = false;

  for (const group of argGroups) {
    if (group.length === 0) {
      errors.push({ message: "Empty argument (extra comma?)", pos: 0 });
      continue;
    }

    // Determine if this argument is labeled: IDENT COLON ...
    const isLabeled =
      group.length >= 2 &&
      group[0].type === "ident" &&
      group[1].type === "colon";

    if (isLabeled) {
      seenLabeled = true;
      const rawLabel = group[0].value;
      const slot = LABEL_ALIASES[rawLabel];

      if (!slot) {
        errors.push({
          message: `Unknown label '${rawLabel}'; expected ${VALID_LABELS}`,
          pos: group[0].pos,
        });
        continue;
      }

      if (attempted.has(slot)) {
        errors.push({
          message: `Duplicate value for ${slot}`,
          pos: group[0].pos,
        });
        continue;
      }

      attempted.add(slot);
      const valueToks = group.slice(2);

      if (slot === "color") {
        const c = parseColorTokens(valueToks, knownHues, errors);
        if (c) color = c;
      } else if (slot === "intensity") {
        const n = parseNumericTokens(valueToks, "intensity", errors);
        if (n !== null) intensity = n;
      } else if (slot === "tone") {
        const n = parseNumericTokens(valueToks, "tone", errors);
        if (n !== null) tone = n;
      } else {
        const n = parseNumericTokens(valueToks, "alpha", errors);
        if (n !== null) alpha = n;
      }
    } else {
      // Positional argument
      if (seenLabeled) {
        errors.push({
          message: "Positional argument after labeled argument",
          pos: group[0].pos,
        });
        continue;
      }

      const slot = SLOT_ORDER[positionalIndex];
      if (!slot) {
        errors.push({
          message: "Too many arguments; expected at most 4 (color, intensity, tone, alpha)",
          pos: group[0].pos,
        });
        continue;
      }

      attempted.add(slot);

      if (slot === "color") {
        const c = parseColorTokens(group, knownHues, errors);
        if (c) color = c;
      } else if (slot === "intensity") {
        const n = parseNumericTokens(group, "intensity", errors);
        if (n !== null) intensity = n;
      } else if (slot === "tone") {
        const n = parseNumericTokens(group, "tone", errors);
        if (n !== null) tone = n;
      } else {
        const n = parseNumericTokens(group, "alpha", errors);
        if (n !== null) alpha = n;
      }

      positionalIndex++;
    }
  }

  // Color is required — add a missing error only if it wasn't attempted at all
  if (!attempted.has("color")) {
    errors.push({ message: "Missing required color argument", pos: 0 });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      color: color!,
      intensity: intensity ?? DEFAULTS.intensity,
      tone: tone ?? DEFAULTS.tone,
      alpha: alpha ?? DEFAULTS.alpha,
    },
  };
}

// ---------------------------------------------------------------------------
// CSS value scanner — finds --cita() calls within a CSS declaration value
// ---------------------------------------------------------------------------

const CITA_MARKER = "--cita(";

/**
 * Find all --cita() calls in a CSS value string.
 * Handles nested parentheses correctly (e.g. inside calc() or linear-gradient()).
 */
export function findCITACalls(cssValue: string): CITACallSpan[] {
  const calls: CITACallSpan[] = [];
  let searchFrom = 0;

  while (searchFrom < cssValue.length) {
    const start = cssValue.indexOf(CITA_MARKER, searchFrom);
    if (start === -1) break;

    const innerStart = start + CITA_MARKER.length;
    let depth = 1;
    let i = innerStart;

    while (i < cssValue.length && depth > 0) {
      if (cssValue[i] === "(") depth++;
      else if (cssValue[i] === ")") depth--;
      i++;
    }

    if (depth !== 0) {
      // Unmatched parenthesis — skip this occurrence
      searchFrom = innerStart;
      continue;
    }

    calls.push({
      start,
      end: i,
      inner: cssValue.slice(innerStart, i - 1),
    });
    searchFrom = i;
  }

  return calls;
}
