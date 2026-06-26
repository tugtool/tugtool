/**
 * tug-color-parser — Tokenizer and parser for the --tug-color() color notation.
 *
 * --tug-color() is thin sugar over oklch(): it names the hue and carries the OKLCH
 * lightness/chroma/alpha as integers on one uniform 0–1000 scale.
 * Lightness and alpha map linearly onto the full 0–1 oklch axis; chroma's 0–1000
 * maps onto 0–MAX_CHROMA (its top exceeds the in-gamut ceiling — see palette-engine's
 * MAX_CHROMA note — so high chroma is browser gamut-mapped). Integers only —
 * fractional values are rejected. The conversion lives in palette-engine
 * (fracFromAuthored / chromaFromAuthored); the parser just calls it.
 *
 *   Color:         A named hue, optionally followed by a ring-adjacent hue (hyphenated)
 *   Lightness (l): 0–1000 → oklch L 0–1 (required for chromatic hues and gray)
 *   Chroma (c):    0–1000 → oklch C 0–MAX_CHROMA (required for chromatic hues)
 *   Alpha (a):     0–1000 → opacity 0–1 (default 1000)
 *
 * Supported color forms (60-name vocabulary: 48 chromatic + 11 achromatic + 1 transparent):
 *   --tug-color(indigo, l: 300, c: 160)       chromatic hue → oklch(0.30 0.08 260)
 *   --tug-color(cobalt-indigo, l: 300, c: 100) hyphenated adjacency (cobalt dominant)
 *   --tug-color(gray, l: 430)                 gray pseudo-hue (achromatic, arbitrary L)
 *   --tug-color(paper)                        named gray (fixed L, no l/c)
 *   --tug-color(white, a: 80)                 fixed endpoint with alpha
 *   --tug-color(transparent)                  fully transparent (always oklch(0 0 0 / 0))
 *
 * Supported syntax forms:
 *   --tug-color(indigo, l: 300, c: 160)         labeled (canonical form)
 *   --tug-color(indigo, 300, 160)               positional: color, lightness, chroma
 *   --tug-color(indigo, l: 300, c: 160, a: 500) with alpha
 *
 * Labels: l/lightness, c/chroma, a/alpha. Color is the first positional argument.
 * Positional order: color, lightness, chroma, alpha. Positional args must precede labeled args.
 *
 * TugColorError and TugColorWarning both carry pos (start) and end (exclusive end)
 * for source spans, enabling precise underlining in IDE integrations and build output.
 *
 * Soft warnings: a successful parse (ok: true) may include an optional warnings array
 * for ignored arguments (e.g. l/c supplied for a fixed achromatic name).
 *
 * @module tug-color-parser
 */

import {
  AUTHOR_MAX,
  fracFromAuthored,
  chromaFromAuthored,
} from "./src/components/tugways/palette-engine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TugColorValue {
  name: string;
  adjacentName?: string; // second color name if hyphenated adjacency (must be adjacent)
}

export interface TugColorParsed {
  color: TugColorValue;
  /** OKLCH lightness, 0–1. Undefined for fixed achromatics where L is implied. */
  lightness: number;
  /** OKLCH chroma, 0–~0.5. Undefined / 0 for achromatics. */
  chroma: number;
  /** Alpha, 0–1. */
  alpha: number;
}

export interface TugColorError {
  message: string;
  pos: number;
  end: number;
}

export interface TugColorWarning {
  message: string;
  pos: number;
  end: number;
}

export type ParseResult =
  | { ok: true; value: TugColorParsed; warnings?: TugColorWarning[] }
  | { ok: false; errors: TugColorError[] };

/** A --tug-color() call found within a larger CSS value string. */
export interface TugColorCallSpan {
  /** Index of the first '-' in '--tug-color(' */
  start: number;
  /** Index one past the closing ')' */
  end: number;
  /** The text between the parentheses (excluding them) */
  inner: string;
}

/** Result of findTugColorCallsWithWarnings — calls plus any unmatched-paren warnings. */
export interface FindCallsResult {
  calls: TugColorCallSpan[];
  warnings: TugColorWarning[];
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type TokenType = "ident" | "number" | "minus" | "colon" | "comma";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/** Return true if ch is a valid ident character (a-z or A-Z). */
function isIdentChar(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

/** Result from tokenize() — tokens produced and any errors encountered during scanning. */
interface TokenizeResult {
  tokens: Token[];
  errors: TugColorError[];
}

/**
 * Tokenize the input string.
 *
 * Error recovery: unrecognized characters (including `+`) are recorded as errors and
 * skipped; tokenization continues from the next position rather than aborting. This
 * allows the parser to report all problems in a single pass.
 */
function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  const errors: TugColorError[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace (space, tab, newline, carriage return, NBSP U+00A0)
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\u00A0") {
      i++;
      continue;
    }

    const pos = i;

    if (ch === ",") {
      tokens.push({ type: "comma", value: ch, pos, end: pos + 1 });
      i++;
    } else if (ch === ":") {
      tokens.push({ type: "colon", value: ch, pos, end: pos + 1 });
      i++;
    } else if (ch === "+") {
      // Plus is no longer valid syntax — offset syntax removed. Record error and skip.
      errors.push({ message: `Unexpected character '+'; hue offsets have been replaced by hyphenated adjacency syntax (e.g. 'cobalt-indigo')`, pos, end: pos + 1 });
      i++;
    } else if (ch === "-") {
      tokens.push({ type: "minus", value: ch, pos, end: pos + 1 });
      i++;
    } else if (isIdentChar(ch) || ch === "\\") {
      // Ident scanning: handles a-z, A-Z (normalized to lowercase), and CSS hex escapes (\41 etc.)
      let identValue = "";
      const identStart = i;

      while (i < input.length) {
        const c = input[i];

        if (isIdentChar(c)) {
          // Normalize uppercase to lowercase
          identValue += c.toLowerCase();
          i++;
        } else if (c === "\\") {
          // CSS hex escape: backslash followed by 1–6 hex digits
          const escStart = i;
          i++; // consume backslash
          let hexStr = "";
          while (hexStr.length < 6 && i < input.length) {
            const h = input[i];
            if ((h >= "0" && h <= "9") || (h >= "a" && h <= "f") || (h >= "A" && h <= "F")) {
              hexStr += h;
              i++;
            } else {
              break;
            }
          }
          if (hexStr.length === 0) {
            // Backslash not followed by hex digits — record error, skip backslash, end ident
            errors.push({ message: `Unexpected character '\\'`, pos: escStart, end: escStart + 1 });
            break;
          }
          // Optionally consume a single trailing space (per CSS spec)
          if (i < input.length && (input[i] === " " || input[i] === "\t")) {
            i++;
          }
          const codePoint = parseInt(hexStr, 16);
          const decoded = String.fromCodePoint(codePoint);
          // If decoded char is a letter, normalize to lowercase and add to ident
          if (isIdentChar(decoded)) {
            identValue += decoded.toLowerCase();
          } else if (decoded === " " || decoded === "\t") {
            // Decoded whitespace ends the ident — stop scanning
            break;
          } else {
            // Non-ident decoded character — end ident here, leave i pointing past escape
            break;
          }
        } else {
          // Not an ident char or backslash — end of ident
          break;
        }
      }

      tokens.push({ type: "ident", value: identValue, pos: identStart, end: i });
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
      tokens.push({ type: "number", value: input.slice(i, end), pos, end });
      i = end;
    } else {
      // Unrecognized character — record error, skip, and continue
      errors.push({ message: `Unexpected character '${ch}'`, pos, end: pos + 1 });
      i++;
    }
  }

  return { tokens, errors };
}

// ---------------------------------------------------------------------------
// Label normalization
// ---------------------------------------------------------------------------

const LABEL_ALIASES: Record<string, string> = {
  l: "lightness",
  lightness: "lightness",
  c: "chroma",
  chroma: "chroma",
  a: "alpha",
  alpha: "alpha",
};

const VALID_LABELS = "l, lightness, c, chroma, a, or alpha";

// Positional slot order (color is always first; lightness/chroma/alpha follow).
const SLOT_ORDER = ["color", "lightness", "chroma", "alpha"] as const;

// Default for the optional alpha slot, in authoring units. Lightness/chroma have no
// default — required for chromatic hues, ignored for fixed achromatics.
const DEFAULTS = { alpha: AUTHOR_MAX } as const;

// Every axis is an integer 0–AUTHOR_MAX; palette-engine maps it into oklch space.
const RANGES: Record<string, [number, number]> = {
  lightness: [0, AUTHOR_MAX],
  chroma: [0, AUTHOR_MAX],
  alpha: [0, AUTHOR_MAX],
};

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
 * Parse tokens as a color value using the chain grammar:
 *   IDENT [MINUS IDENT]
 *
 * Chain resolution rules:
 *   1. First ident: must be a known color (48 chromatic hues, gray, the named grays,
 *      black, white, or transparent).
 *   2. Second ident after minus (if present): must be a ring-adjacent chromatic hue.
 *      Non-adjacent pairs produce a hard error.
 *
 * Returns null on failure after pushing errors.
 */
function parseColorTokens(
  tokens: Token[],
  knownHues: ReadonlySet<string>,
  errors: TugColorError[],
  adjacencyRing?: readonly string[],
): TugColorValue | null {
  if (tokens.length === 0) {
    errors.push({ message: "Expected a color name", pos: 0, end: 0 });
    return null;
  }

  if (tokens[0].type !== "ident") {
    errors.push({
      message: `Expected a color name, got '${tokens[0].value}'`,
      pos: tokens[0].pos,
      end: tokens[0].end,
    });
    return null;
  }

  const name = tokens[0].value;

  if (!knownHues.has(name)) {
    errors.push({ message: `Unknown color '${name}'`, pos: tokens[0].pos, end: tokens[0].end });
    return null;
  }

  // Color name alone
  if (tokens.length === 1) {
    return { name };
  }

  // Expect MINUS as second token
  if (tokens[1].type !== "minus") {
    errors.push({
      message: `Invalid color syntax after '${name}'`,
      pos: tokens[1].pos,
      end: tokens[1].end,
    });
    return null;
  }

  // Need a third token (the ident after the minus)
  if (tokens.length < 3 || tokens[2].type !== "ident") {
    const errTok = tokens.length < 3 ? tokens[1] : tokens[2];
    errors.push({
      message: `Expected an adjacent color name after '${name}-'`,
      pos: errTok.pos,
      end: errTok.end,
    });
    return null;
  }

  const secondIdent = tokens[2].value;

  if (!knownHues.has(secondIdent)) {
    errors.push({
      message: `Unknown color '${secondIdent}'`,
      pos: tokens[2].pos,
      end: tokens[2].end,
    });
    return null;
  }

  // Ring adjacency: both names must be in the ring at distance 1 (with wrap).
  if (adjacencyRing) {
    const idxA = adjacencyRing.indexOf(name);
    const idxB = adjacencyRing.indexOf(secondIdent);
    const ringAdj =
      idxA !== -1 &&
      idxB !== -1 &&
      (Math.abs(idxA - idxB) === 1 || Math.abs(idxA - idxB) === adjacencyRing.length - 1);
    if (!ringAdj) {
      errors.push({
        message: `'${name}' and '${secondIdent}' are not adjacent`,
        pos: tokens[2].pos,
        end: tokens[2].end,
      });
      return null;
    }
  }

  // No segments beyond the adjacent pair are allowed.
  if (tokens.length > 3) {
    errors.push({
      message: `Unexpected token after '${name}-${secondIdent}'`,
      pos: tokens[3].pos,
      end: tokens[3].end,
    });
    return null;
  }

  return { name, adjacentName: secondIdent };
}

/**
 * Parse tokens as a numeric value: NUMBER or MINUS NUMBER.
 * Validates the result is within the slot's permitted range.
 * Returns null on failure after pushing errors.
 */
function parseNumericTokens(
  tokens: Token[],
  slotName: string,
  errors: TugColorError[],
): number | null {
  const [min, max] = RANGES[slotName] ?? [0, 1];
  if (tokens.length === 0) {
    errors.push({ message: `Expected a number for ${slotName}`, pos: 0, end: 0 });
    return null;
  }

  let value: number;
  const anchorTok = tokens[0];

  if (tokens.length === 1 && tokens[0].type === "number") {
    value = parseFloat(tokens[0].value);
  } else if (
    tokens.length === 2 &&
    tokens[0].type === "minus" &&
    tokens[1].type === "number"
  ) {
    value = -parseFloat(tokens[1].value);
  } else if (
    tokens[0].type === "minus" &&
    (tokens.length === 1 || tokens[1].type !== "number")
  ) {
    // Bare minus without a following number — slot-specific error
    const spanEnd = tokens.length > 1 ? tokens[1].end : tokens[0].end;
    errors.push({
      message: `Bare '-' without a number for ${slotName}`,
      pos: anchorTok.pos,
      end: spanEnd,
    });
    return null;
  } else {
    const raw = tokens.map((t) => t.value).join("");
    const spanEnd = tokens[tokens.length - 1].end;
    errors.push({
      message: `Invalid value '${raw}' for ${slotName}; expected a number`,
      pos: anchorTok.pos,
      end: spanEnd,
    });
    return null;
  }

  // Span covers from anchor token to end of last token consumed.
  const lastTok = tokens.length === 2 ? tokens[1] : tokens[0];

  // Every axis is a whole number 0–1000 — fractional values are not supported.
  if (!Number.isInteger(value)) {
    errors.push({
      message: `Value ${value} for ${slotName} must be a whole number 0–1000 (e.g. l: 300)`,
      pos: anchorTok.pos,
      end: lastTok.end,
    });
    return null;
  }

  if (value < min || value > max) {
    errors.push({
      message: `Value ${value} is out of range for ${slotName} (${min}–${max})`,
      pos: anchorTok.pos,
      end: lastTok.end,
    });
    return null;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Slot dispatch table
// ---------------------------------------------------------------------------

/**
 * A SlotParser receives the tokens for one argument group, pushes any errors into
 * the shared errors array, and returns the parsed value (TugColorValue, number, or null).
 * The extra parameters (knownHues, knownPresets, adjacencyRing, achromaticSequence) are
 * forwarded only by the color slot; numeric slots ignore them.
 */
type SlotParser = (
  tokens: Token[],
  errors: TugColorError[],
  knownHues: ReadonlySet<string>,
  adjacencyRing?: readonly string[],
) => TugColorValue | number | null;

const SLOT_DISPATCH: Record<string, SlotParser> = {
  color: (tokens, errors, knownHues, adjacencyRing) =>
    parseColorTokens(tokens, knownHues, errors, adjacencyRing),
  lightness: (tokens, errors) =>
    parseNumericTokens(tokens, "lightness", errors),
  chroma: (tokens, errors) =>
    parseNumericTokens(tokens, "chroma", errors),
  alpha: (tokens, errors) =>
    parseNumericTokens(tokens, "alpha", errors),
};

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse the inner content of a --tug-color() call.
 *
 * @param input  The text between the parentheses (not including them).
 * @param knownHues  Set of valid color names (e.g. "red", "cobalt", "indigo").
 *   Should include all 48 named hues plus "black", "white", optionally "gray",
 *   the 9 named grays (pitch through paper), and optionally "transparent".
 * @param adjacencyRing  Optional ordered array of hue names defining ring adjacency.
 *   When provided, non-adjacent pairs produce hard errors and the ring identifies
 *   which names are chromatic (and therefore require explicit l/c). When omitted,
 *   adjacency is not validated and the required-l/c check is skipped.
 */
export function parseTugColor(
  input: string,
  knownHues: ReadonlySet<string>,
  adjacencyRing?: readonly string[],
): ParseResult {
  const { tokens, errors: tokErrors } = tokenize(input);

  // Merge tokenizer errors into the parser error array before argument parsing.
  // Tokenization continues past bad characters, so we proceed with whatever tokens
  // were produced even when there were tokenizer errors.
  const errors: TugColorError[] = [...tokErrors];

  if (tokens.length === 0 && errors.length === 0) {
    return { ok: false, errors: [{ message: "Empty --tug-color() call", pos: 0, end: 0 }] };
  }

  // If the tokenizer found only errors and no tokens, we still fall through to
  // the "missing color" check below, which will add the appropriate error.
  const argGroups = splitArgs(tokens);

  // Parsed values — undefined means not yet assigned
  let color: TugColorValue | undefined;
  let lightness: number | undefined;
  let chroma: number | undefined;
  let alpha: number | undefined;

  // Track which slots have been assigned or attempted (even if invalid)
  // to distinguish "missing" from "present but invalid"
  const attempted = new Set<string>();

  let positionalIndex = 0;
  let seenLabeled = false;

  for (const group of argGroups) {
    if (group.length === 0) {
      errors.push({ message: "Empty argument (extra comma?)", pos: 0, end: 0 });
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
          end: group[0].end,
        });
        continue;
      }

      if (attempted.has(slot)) {
        errors.push({
          message: `Duplicate value for ${slot}`,
          pos: group[0].pos,
          end: group[0].end,
        });
        continue;
      }

      attempted.add(slot);
      const valueToks = group.slice(2);

      const labeledResult = SLOT_DISPATCH[slot](valueToks, errors, knownHues, adjacencyRing);
      if (slot === "color") { if (labeledResult !== null) color = labeledResult as TugColorValue; }
      else if (slot === "lightness") { if (labeledResult !== null) lightness = labeledResult as number; }
      else if (slot === "chroma") { if (labeledResult !== null) chroma = labeledResult as number; }
      else { if (labeledResult !== null) alpha = labeledResult as number; }
    } else {
      // Positional argument
      if (seenLabeled) {
        errors.push({
          message: "Positional argument after labeled argument",
          pos: group[0].pos,
          end: group[group.length - 1].end,
        });
        continue;
      }

      const slot = SLOT_ORDER[positionalIndex];
      if (!slot) {
        errors.push({
          message: "Too many arguments; expected at most 4 (color, lightness, chroma, alpha)",
          pos: group[0].pos,
          end: group[group.length - 1].end,
        });
        continue;
      }

      attempted.add(slot);

      const positionalResult = SLOT_DISPATCH[slot](group, errors, knownHues, adjacencyRing);
      if (slot === "color") { if (positionalResult !== null) color = positionalResult as TugColorValue; }
      else if (slot === "lightness") { if (positionalResult !== null) lightness = positionalResult as number; }
      else if (slot === "chroma") { if (positionalResult !== null) chroma = positionalResult as number; }
      else { if (positionalResult !== null) alpha = positionalResult as number; }

      positionalIndex++;
    }
  }

  // Color is required — add a missing error only if it wasn't attempted at all
  if (!attempted.has("color")) {
    errors.push({ message: "Missing required color argument", pos: 0, end: 0 });
  }

  const colorName = color?.name;

  // Classify the color: chromatic hues (in the ring) require explicit l + c; the
  // `gray` pseudo-hue requires explicit l; fixed achromatics (black, white, the
  // named grays) and transparent take no l/c.
  const isChromatic =
    colorName != null && adjacencyRing != null && adjacencyRing.includes(colorName);

  if (isChromatic) {
    if (lightness === undefined) {
      errors.push({ message: `'${colorName}' requires a lightness value (l:)`, pos: 0, end: input.length });
    }
    if (chroma === undefined) {
      errors.push({ message: `'${colorName}' requires a chroma value (c:)`, pos: 0, end: input.length });
    }
  } else if (colorName === "gray" && lightness === undefined) {
    errors.push({ message: "'gray' requires a lightness value (l:)", pos: 0, end: input.length });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Authored integers (0–1000) → oklch fractions for the resolver.
  const resolvedLightness = fracFromAuthored(lightness ?? 0);
  const resolvedChroma = chromaFromAuthored(chroma ?? 0);
  const resolvedAlpha = fracFromAuthored(alpha ?? DEFAULTS.alpha);
  const resolvedColor = color!;

  // Soft warnings — flag l/c supplied where they are ignored. Spans cover the full
  // input because they concern the combined argument set, not a single token.
  const warnings: TugColorWarning[] = [];
  const fullSpan = { pos: 0, end: input.length };
  const name = resolvedColor.name;
  const isFixedAchromatic = !isChromatic && name !== "gray" && name !== "transparent";

  if (name === "transparent") {
    if (attempted.has("lightness") || attempted.has("chroma") || attempted.has("alpha")) {
      warnings.push({ message: "all arguments are ignored for 'transparent' (always oklch(0 0 0 / 0))", ...fullSpan });
    }
  } else if (isFixedAchromatic) {
    if (attempted.has("lightness")) {
      warnings.push({ message: `lightness is ignored for '${name}' (fixed lightness)`, ...fullSpan });
    }
    if (attempted.has("chroma")) {
      warnings.push({ message: `chroma is ignored for '${name}' (always C=0)`, ...fullSpan });
    }
  } else if (name === "gray" && attempted.has("chroma")) {
    warnings.push({ message: "chroma is ignored for 'gray' (always C=0)", ...fullSpan });
  }

  const parsed: TugColorParsed = {
    color: resolvedColor,
    lightness: resolvedLightness,
    chroma: resolvedChroma,
    alpha: resolvedAlpha,
  };

  if (warnings.length > 0) {
    return { ok: true, value: parsed, warnings };
  }
  return { ok: true, value: parsed };
}

// ---------------------------------------------------------------------------
// CSS value scanner — finds --tug-color() calls within a CSS declaration value
// ---------------------------------------------------------------------------

const TUG_COLOR_MARKER = "--tug-color(";

/**
 * Find all --tug-color() calls in a CSS value string, returning both the matched
 * calls and warnings for any unmatched parentheses.
 *
 * When a `--tug-color(` opener is found but the closing `)` is never reached
 * (depth stays > 0 after scanning to end of input), a TugColorWarning is emitted
 * with pos=start of the opener and end=cssValue.length.
 *
 * Handles nested parentheses correctly (e.g. inside calc() or linear-gradient()).
 */
export function findTugColorCallsWithWarnings(cssValue: string): FindCallsResult {
  const calls: TugColorCallSpan[] = [];
  const warnings: TugColorWarning[] = [];
  let searchFrom = 0;

  while (searchFrom < cssValue.length) {
    const start = cssValue.indexOf(TUG_COLOR_MARKER, searchFrom);
    if (start === -1) break;

    const innerStart = start + TUG_COLOR_MARKER.length;
    let depth = 1;
    let i = innerStart;

    while (i < cssValue.length && depth > 0) {
      if (cssValue[i] === "(") depth++;
      else if (cssValue[i] === ")") depth--;
      i++;
    }

    if (depth !== 0) {
      // Unmatched parenthesis — emit a warning and skip this occurrence
      warnings.push({
        message: "Unmatched parenthesis in --tug-color() call",
        pos: start,
        end: cssValue.length,
      });
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

  return { calls, warnings };
}

/**
 * Find all --tug-color() calls in a CSS value string.
 * Handles nested parentheses correctly (e.g. inside calc() or linear-gradient()).
 *
 * For backward compatibility this function returns only the call spans. Use
 * findTugColorCallsWithWarnings to also receive warnings about unmatched parens.
 */
export function findTugColorCalls(cssValue: string): TugColorCallSpan[] {
  return findTugColorCallsWithWarnings(cssValue).calls;
}
