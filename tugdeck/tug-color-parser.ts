/**
 * tug-color-parser — Tokenizer and parser for the --tug-color() color notation.
 *
 * --tug-color() specifies colors using four parameters:
 *   Color (C):     A named hue, optionally followed by an adjacent hue (hyphenated)
 *                  and/or a preset name
 *   Intensity (I): Chroma axis, 0–100 (default 50)
 *   Tone (T):      Lightness axis, 0–100 (default 50)
 *   Alpha (A):     Opacity, 0–100 (default 100)
 *
 * Supported color forms (60-name vocabulary: 48 chromatic + 11 achromatic + 1 transparent):
 *   --tug-color(indigo)                   bare color
 *   --tug-color(indigo-intense)           color + preset
 *   --tug-color(cobalt-indigo)            hyphenated adjacency (cobalt dominant)
 *   --tug-color(cobalt-indigo-intense)    hyphenated adjacency + preset
 *   --tug-color(paper)                    named gray (fixed L, ignores i/t)
 *   --tug-color(paper-linen)             achromatic adjacency (paper dominant, linear sequence)
 *   --tug-color(transparent)             fully transparent (always oklch(0 0 0 / 0))
 *
 * Supported syntax forms:
 *   --tug-color(red)                              defaults for i/t/a
 *   --tug-color(red, 70)                          positional i, defaults for t/a
 *   --tug-color(red, 50, 40, 100)                 all positional
 *   --tug-color(c: red, i: 50, t: 40, a: 100)    all labeled
 *   --tug-color(color: red, intensity: 50, tone: 40, alpha: 100) full label names
 *   --tug-color(coral, t: 20)                     mixed: positional then labeled
 *   --tug-color(t: 40, a: 100, c: purple, i: 12) labeled, any order
 *
 * Labels: c/color, i/intensity, t/tone, a/alpha
 * Positional order: color, intensity, tone, alpha
 * Positional args must precede labeled args.
 *
 * TugColorError and TugColorWarning both carry pos (start) and end (exclusive end)
 * for source spans, enabling precise underlining in IDE integrations and build output.
 *
 * Soft warnings: a successful parse (ok: true) may include an optional warnings array
 * for suspicious-but-valid value combinations (e.g. intensity=0 + tone=0 producing pure
 * black, or intensity provided for an achromatic keyword that ignores it).
 *
 * @module tug-color-parser
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TugColorValue {
  name: string;
  adjacentName?: string; // second color name if hyphenated adjacency (must be adjacent)
  preset?: string;       // preset name if specified (e.g. "intense", "light")
}

export interface TugColorParsed {
  color: TugColorValue;
  intensity: number;
  tone: number;
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

// Known preset names (checked during chain parsing)
const PRESET_NAMES = new Set(["light", "dark", "intense", "muted", "canonical"]);

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
 *   IDENT [MINUS IDENT [MINUS IDENT]]
 *
 * Chain resolution rules (per parser grammar, [D03]-[D05]):
 *   1. First ident: must be a known color (48-color set, plus black/white)
 *   2. Second ident after minus (if present):
 *      a. Preset name? → apply preset, chain ends
 *      b. Adjacent color? → record adjacentName, continue to third ident
 *      c. Known color but not adjacent → hard error
 *      d. Unknown ident → hard error
 *   3. Third ident after minus (if present): must be a preset name; error otherwise
 *
 * Presets win disambiguation [D05]: checked before adjacency ring.
 * Non-adjacent pairs produce hard errors [D04].
 *
 * Returns null on failure after pushing errors.
 */
function parseColorTokens(
  tokens: Token[],
  knownHues: ReadonlySet<string>,
  errors: TugColorError[],
  knownPresets?: ReadonlyMap<string, { intensity: number; tone: number }>,
  adjacencyRing?: readonly string[],
  achromaticSequence?: readonly string[],
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
      message: `Expected a color or preset name after '${name}-'`,
      pos: errTok.pos,
      end: errTok.end,
    });
    return null;
  }

  const secondIdent = tokens[2].value;

  // Second ident: check presets first [D05]
  if (PRESET_NAMES.has(secondIdent)) {
    // Validate against knownPresets map if provided
    if (knownPresets && !knownPresets.has(secondIdent)) {
      errors.push({
        message: `Unknown preset '${secondIdent}' for color '${name}'`,
        pos: tokens[2].pos,
        end: tokens[2].end,
      });
      return null;
    }
    // Must end here (no third segment after preset)
    if (tokens.length > 3) {
      errors.push({
        message: `Unexpected token after preset '${secondIdent}'`,
        pos: tokens[3].pos,
        end: tokens[3].end,
      });
      return null;
    }
    return { name, preset: secondIdent };
  }

  // Second ident is not a preset — must be an adjacent color [D04]
  if (!knownHues.has(secondIdent)) {
    errors.push({
      message: `Unknown color '${secondIdent}'`,
      pos: tokens[2].pos,
      end: tokens[2].end,
    });
    return null;
  }

  // Adjacency check: try ring first, then fall back to achromatic sequence.
  // A hard error is only produced if NEITHER adjacency check passes.
  if (adjacencyRing || achromaticSequence) {
    let ringAdj = false;
    let achromaticAdj = false;

    // Ring adjacency: both names must be in the ring and distance = 1 (with wrap)
    if (adjacencyRing) {
      const idxA = adjacencyRing.indexOf(name);
      const idxB = adjacencyRing.indexOf(secondIdent);
      if (idxA !== -1 && idxB !== -1) {
        const dist = Math.abs(idxA - idxB);
        ringAdj = dist === 1 || dist === adjacencyRing.length - 1;
      }
    }

    // Achromatic adjacency fallback: both names must be in the linear sequence at distance = 1
    if (!ringAdj && achromaticSequence) {
      const idxA = achromaticSequence.indexOf(name);
      const idxB = achromaticSequence.indexOf(secondIdent);
      if (idxA !== -1 && idxB !== -1) {
        achromaticAdj = Math.abs(idxA - idxB) === 1;
      }
    }

    if (!ringAdj && !achromaticAdj) {
      errors.push({
        message: `'${name}' and '${secondIdent}' are not adjacent`,
        pos: tokens[2].pos,
        end: tokens[2].end,
      });
      return null;
    }
  }

  // Adjacent color accepted — check for optional third segment (preset)
  if (tokens.length === 3) {
    // IDENT MINUS IDENT — bare adjacency, no preset
    return { name, adjacentName: secondIdent };
  }

  // Need MINUS IDENT for third segment
  if (tokens.length < 5 || tokens[3].type !== "minus" || tokens[4].type !== "ident") {
    errors.push({
      message: `Expected '-preset' or end of color after '${name}-${secondIdent}'`,
      pos: tokens[3].pos,
      end: tokens[3].end,
    });
    return null;
  }

  const thirdIdent = tokens[4].value;

  // Third ident must be a preset [D05]
  if (!PRESET_NAMES.has(thirdIdent)) {
    errors.push({
      message: `Expected a preset name after '${name}-${secondIdent}-', got '${thirdIdent}'`,
      pos: tokens[4].pos,
      end: tokens[4].end,
    });
    return null;
  }

  // Validate against knownPresets map if provided
  if (knownPresets && !knownPresets.has(thirdIdent)) {
    errors.push({
      message: `Unknown preset '${thirdIdent}' for color '${name}-${secondIdent}'`,
      pos: tokens[4].pos,
      end: tokens[4].end,
    });
    return null;
  }

  // Must end here — no more tokens allowed
  if (tokens.length > 5) {
    errors.push({
      message: `Unexpected token after '${name}-${secondIdent}-${thirdIdent}'`,
      pos: tokens[5].pos,
      end: tokens[5].end,
    });
    return null;
  }

  return { name, adjacentName: secondIdent, preset: thirdIdent };
}

/**
 * Parse tokens as a numeric value: NUMBER or MINUS NUMBER.
 * Validates the result is within 0–100.
 * Returns null on failure after pushing errors.
 */
function parseNumericTokens(
  tokens: Token[],
  slotName: string,
  errors: TugColorError[],
): number | null {
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

  if (value < 0 || value > 100) {
    // Span covers from anchor token to end of last token consumed
    const lastTok = tokens.length === 2 ? tokens[1] : tokens[0];
    errors.push({
      message: `Value ${value} is out of range for ${slotName} (0–100)`,
      pos: anchorTok.pos,
      end: lastTok.end,
    });
    return null;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Slot dispatch table (Spec S07)
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
  knownPresets?: ReadonlyMap<string, { intensity: number; tone: number }>,
  adjacencyRing?: readonly string[],
  achromaticSequence?: readonly string[],
) => TugColorValue | number | null;

const SLOT_DISPATCH: Record<string, SlotParser> = {
  color: (tokens, errors, knownHues, knownPresets, adjacencyRing, achromaticSequence) =>
    parseColorTokens(tokens, knownHues, errors, knownPresets, adjacencyRing, achromaticSequence),
  intensity: (tokens, errors) =>
    parseNumericTokens(tokens, "intensity", errors),
  tone: (tokens, errors) =>
    parseNumericTokens(tokens, "tone", errors),
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
 *   the 9 named grays (paper through pitch), and optionally "transparent".
 * @param knownPresets  Optional map of preset names to {intensity, tone} defaults.
 *   When provided, enables preset syntax: --tug-color(green-intense), --tug-color(cobalt-indigo-muted, a: 50).
 *   Preset intensity/tone values serve as defaults; they can be overridden by explicit args.
 * @param adjacencyRing  Optional ordered array of hue names defining ring adjacency.
 *   When provided, non-adjacent pairs produce hard errors. When omitted, adjacency
 *   is not validated (any two known hues may be hyphenated).
 * @param achromaticSequence  Optional ordered linear array of achromatic names
 *   (e.g. ["black", "paper", ..., "white"]). When provided, achromatic adjacency is
 *   validated as a fallback after ring adjacency fails. Enables hyphenated pairs like
 *   paper-linen and black-paper. Transparent must NOT be included in this sequence.
 */
export function parseTugColor(
  input: string,
  knownHues: ReadonlySet<string>,
  knownPresets?: ReadonlyMap<string, { intensity: number; tone: number }>,
  adjacencyRing?: readonly string[],
  achromaticSequence?: readonly string[],
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

      const labeledResult = SLOT_DISPATCH[slot](valueToks, errors, knownHues, knownPresets, adjacencyRing, achromaticSequence);
      if (slot === "color") { if (labeledResult !== null) color = labeledResult as TugColorValue; }
      else if (slot === "intensity") { if (labeledResult !== null) intensity = labeledResult as number; }
      else if (slot === "tone") { if (labeledResult !== null) tone = labeledResult as number; }
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
          message: "Too many arguments; expected at most 4 (color, intensity, tone, alpha)",
          pos: group[0].pos,
          end: group[group.length - 1].end,
        });
        continue;
      }

      attempted.add(slot);

      const positionalResult = SLOT_DISPATCH[slot](group, errors, knownHues, knownPresets, adjacencyRing, achromaticSequence);
      if (slot === "color") { if (positionalResult !== null) color = positionalResult as TugColorValue; }
      else if (slot === "intensity") { if (positionalResult !== null) intensity = positionalResult as number; }
      else if (slot === "tone") { if (positionalResult !== null) tone = positionalResult as number; }
      else { if (positionalResult !== null) alpha = positionalResult as number; }

      positionalIndex++;
    }
  }

  // Color is required — add a missing error only if it wasn't attempted at all
  if (!attempted.has("color")) {
    errors.push({ message: "Missing required color argument", pos: 0, end: 0 });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Resolve preset defaults: if the color has a preset and i/t were not explicitly
  // provided, use the preset's intensity/tone as defaults (instead of 50/50).
  let defaultIntensity = DEFAULTS.intensity;
  let defaultTone = DEFAULTS.tone;
  if (color?.preset && knownPresets) {
    const presetValues = knownPresets.get(color.preset);
    if (presetValues) {
      defaultIntensity = presetValues.intensity;
      defaultTone = presetValues.tone;
    }
  }

  const resolvedIntensity = intensity ?? defaultIntensity;
  const resolvedTone = tone ?? defaultTone;
  const resolvedAlpha = alpha ?? DEFAULTS.alpha;
  const resolvedColor = color!;

  // Soft warnings — checked against final resolved values (Spec S04).
  // All warning spans cover the full input (pos=0, end=input.length) because
  // they concern the combined effect of multiple arguments, not a single token.
  const warnings: TugColorWarning[] = [];
  const fullSpan = { pos: 0, end: input.length };
  const colorName = resolvedColor.name;

  // isAchromatic: true for black, white, gray, transparent, and any named gray
  // in the achromatic sequence. This gate prevents the chromatic warning block
  // ("intensity=0 and tone=0 produce pure black") from firing for achromatics.
  const isAchromatic =
    colorName === "black" ||
    colorName === "white" ||
    colorName === "gray" ||
    colorName === "transparent" ||
    (achromaticSequence != null && achromaticSequence.includes(colorName));

  // Chromatic-only warning block: only fires when isAchromatic is false.
  if (!isAchromatic) {
    if (resolvedIntensity === 0 && resolvedTone === 0) {
      warnings.push({ message: "intensity=0 and tone=0 produce pure black; did you mean to use 'black'?", ...fullSpan });
    } else if (resolvedIntensity === 0 && resolvedTone === 100) {
      warnings.push({ message: "intensity=0 and tone=100 produce pure white; did you mean to use 'white'?", ...fullSpan });
    }
  }

  // Three-tier achromatic warning block (mutually exclusive tiers):
  //
  // Tier 1 — Transparent: warns on ANY explicitly provided argument (i, t, or a).
  //   transparent always expands to oklch(0 0 0 / 0); all args are meaningless.
  //
  // Tier 2 — Named grays (paper through pitch, i.e. in achromaticSequence but not
  //   black/white/gray): fixed-lightness per [D06], so warn on intensity > 0 or
  //   explicit tone. Alpha is honored silently.
  //
  // Tier 3 — Existing achromatics (black, white, gray): unchanged behavior.
  if (colorName === "transparent") {
    // Tier 1: transparent ignores all three args
    if (attempted.has("intensity")) {
      warnings.push({ message: "intensity is ignored for 'transparent' (always oklch(0 0 0 / 0))", ...fullSpan });
    }
    if (attempted.has("tone")) {
      warnings.push({ message: "tone is ignored for 'transparent' (always oklch(0 0 0 / 0))", ...fullSpan });
    }
    if (attempted.has("alpha")) {
      warnings.push({ message: "alpha is ignored for 'transparent' (always oklch(0 0 0 / 0))", ...fullSpan });
    }
  } else if (
    achromaticSequence != null &&
    achromaticSequence.includes(colorName) &&
    colorName !== "black" &&
    colorName !== "white" &&
    colorName !== "gray"
  ) {
    // Tier 2: named gray — fixed lightness, warn on intensity > 0 or explicit tone
    if (attempted.has("intensity") && resolvedIntensity > 0) {
      warnings.push({ message: `intensity is ignored for '${colorName}' (always C=0)`, ...fullSpan });
    }
    if (attempted.has("tone")) {
      warnings.push({ message: `tone is ignored for '${colorName}' (fixed lightness)`, ...fullSpan });
    }
  } else {
    // Tier 3: black, white, gray — existing behavior unchanged
    if (attempted.has("intensity") && resolvedIntensity > 0) {
      if (colorName === "black") {
        warnings.push({ message: "intensity is ignored for 'black' (always oklch(0 0 0))", ...fullSpan });
      } else if (colorName === "white") {
        warnings.push({ message: "intensity is ignored for 'white' (always oklch(1 0 0))", ...fullSpan });
      } else if (colorName === "gray") {
        warnings.push({ message: "intensity is ignored for 'gray' (always C=0)", ...fullSpan });
      }
    }
  }

  const parsed: TugColorParsed = {
    color: resolvedColor,
    intensity: resolvedIntensity,
    tone: resolvedTone,
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
