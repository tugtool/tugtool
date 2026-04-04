/**
 * Visible Units — position boundary queries for the TugTextEngine document model.
 *
 * Pure functions over Segment[]. No DOM, no engine dependency.
 * Each function answers: "given a flat offset, where is the boundary of this unit?"
 *
 * Architecture adopted from WebKit's visible_units.h (see THIRD_PARTY_NOTICES.md).
 * The editing operations in tug-text-engine.ts are one-liners on top of these:
 *   deleteWordBackward = deleteRange(startOfWord(cursor), cursor)
 *
 * Unit hierarchy:
 *   - Character: single text character or atom (flat offset width 1)
 *   - Word: sequence of non-boundary characters; atoms are word boundaries
 *   - Paragraph: \n-delimited; hard line boundary
 *   - Document: entire content
 *
 * Soft line (visual wrap boundary) is NOT in this module — it requires layout
 * information. For now, soft line ≡ paragraph in the engine.
 */

import type { Segment, TextSegment } from "./tug-text-engine";
import { TUG_ATOM_CHAR } from "./tug-atom-char";

// ===================================================================
// Document — trivial, but complete for symmetry
// ===================================================================

/** Start of document is always offset 0. */
export function startOfDocument(): number {
  return 0;
}

/** End of document is the flat length of all segments. */
export function endOfDocument(segments: readonly Segment[]): number {
  let n = 0;
  for (const s of segments) {
    n += s.kind === "text" ? (s as TextSegment).text.length : 1;
  }
  return n;
}

// ===================================================================
// Paragraph — \n or document edge
// ===================================================================

/**
 * Flatten segments into a single string where each atom is TUG_ATOM_CHAR (U+E100).
 * This lets us do character-class scanning without worrying about
 * the segment array structure.
 */
function flattenToString(segments: readonly Segment[]): string {
  return segments.map(s =>
    s.kind === "text" ? (s as TextSegment).text : TUG_ATOM_CHAR
  ).join("");
}

/**
 * Start of paragraph: scan backward from offset to find \n or document start.
 * The returned offset is the position after the \n (or 0).
 */
export function startOfParagraph(segments: readonly Segment[], offset: number): number {
  const flat = flattenToString(segments);
  if (offset <= 0) return 0;
  // Scan backward from just before offset
  for (let i = offset - 1; i >= 0; i--) {
    if (flat[i] === "\n") return i + 1;
  }
  return 0;
}

/**
 * End of paragraph: scan forward from offset to find \n or document end.
 * The returned offset is the position of the \n (not past it).
 */
export function endOfParagraph(segments: readonly Segment[], offset: number): number {
  const flat = flattenToString(segments);
  if (offset >= flat.length) return flat.length;
  for (let i = offset; i < flat.length; i++) {
    if (flat[i] === "\n") return i;
  }
  return flat.length;
}

// ===================================================================
// Word — space/punctuation/atom boundaries
// ===================================================================

/** Character classes for word boundary detection. */
const enum CharClass {
  /** Whitespace: space, tab, newline */
  Space,
  /** Punctuation and symbols */
  Punctuation,
  /** Word character: letter, digit, underscore */
  Word,
  /** Atom (TUG_ATOM_CHAR / U+E100) — treated as its own word */
  Atom,
}

/** Classify a character for word boundary detection. */
function classifyChar(ch: string): CharClass {
  if (ch === TUG_ATOM_CHAR) return CharClass.Atom;
  if (/\s/.test(ch)) return CharClass.Space;
  if (/[\p{P}\p{S}]/u.test(ch)) return CharClass.Punctuation;
  return CharClass.Word;
}

/**
 * Start of word: scan backward from offset to find the word boundary.
 *
 * Behavior matches macOS text system (Option+Left):
 *   - Skip whitespace backward
 *   - Then skip characters of the same class backward
 *   - An atom is its own word (width 1)
 *
 * At offset 0, returns 0.
 */
export function startOfWord(segments: readonly Segment[], offset: number): number {
  const flat = flattenToString(segments);
  if (offset <= 0) return 0;

  let pos = offset;

  // Skip whitespace backward
  while (pos > 0 && classifyChar(flat[pos - 1]) === CharClass.Space) {
    pos--;
  }

  if (pos === 0) return 0;

  // Check what's just before the cursor
  const cls = classifyChar(flat[pos - 1]);

  // Atom: it's its own word — just step over it
  if (cls === CharClass.Atom) return pos - 1;

  // Skip characters of the same class
  while (pos > 0 && classifyChar(flat[pos - 1]) === cls) {
    pos--;
  }

  return pos;
}

/**
 * End of word: scan forward from offset to find the word boundary.
 *
 * Behavior matches macOS text system (Option+Right):
 *   - Skip characters of the current class forward
 *   - Then skip whitespace forward
 *   - An atom is its own word (width 1)
 *
 * At end of document, returns flatLength.
 */
export function endOfWord(segments: readonly Segment[], offset: number): number {
  const flat = flattenToString(segments);
  if (offset >= flat.length) return flat.length;

  let pos = offset;

  // Check what's at the cursor
  const cls = classifyChar(flat[pos]);

  // Atom: it's its own word — just step over it
  if (cls === CharClass.Atom) {
    pos++;
    // Skip trailing whitespace
    while (pos < flat.length && classifyChar(flat[pos]) === CharClass.Space) {
      pos++;
    }
    return pos;
  }

  // Skip characters of the same class forward
  while (pos < flat.length && classifyChar(flat[pos]) === cls) {
    pos++;
  }

  // Skip trailing whitespace (for word/punctuation classes)
  if (cls !== CharClass.Space) {
    while (pos < flat.length && classifyChar(flat[pos]) === CharClass.Space) {
      pos++;
    }
  }

  return pos;
}
