/**
 * inline-command-ghost — the pure geometry of the mid-text slash-command
 * inline ghost completion.
 *
 * ## What this is
 *
 * A slash command only *runs* when it leads the message — claude expands
 * `/cmd` into a user invocation just at the start of the prompt. Typed
 * anywhere else (`hello /rewi…`) it is plain text that will never run, so the
 * Session card does not offer the full descriptive popup there. Instead it mirrors
 * the terminal: a single inline **ghost completion** — the muted remainder of
 * the best-matching command, shown after the caret — that the user can accept
 * (Tab / →) to fill in as ordinary text. No chip, because a chip would imply
 * the command runs.
 *
 * This module is the pure decision: given the document text, the caret offset,
 * and a {@link InlineCommandMatcher} over the live command catalog, decide
 * whether a ghost should show and what its suffix is. No DOM, no CodeMirror —
 * the extension ({@link module:components/tugways/tug-text-editor/inline-command-completion})
 * wraps this with the widget, the keymap, and the theme.
 *
 * @module lib/inline-command-ghost
 */

import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

/**
 * Resolve the typed query (the text after `/`) to the full command name it
 * should complete to, or `null` when nothing sensible completes it. The
 * returned name MUST be a case-insensitive prefix-extension of `query` (the
 * host scans the ranked catalog for the best such match) — that is what makes
 * the remainder a simple inline suffix.
 */
export type InlineCommandMatcher = (query: string) => string | null;

/**
 * Resolve the ghost's completion name from a ranked catalog of command names
 * (best first) against the typed `query`. Returns the first name that
 * case-insensitively prefix-extends the query, trying each name's full form
 * first and then its **leaf** — the part after the last `:` — for namespaced
 * plugin commands (`tugplug:devise`), where the user types the leaf (`/dev`),
 * not the qualified name. The returned name always prefix-extends `query`, so
 * it satisfies {@link computeInlineGhost}'s contract (the painted suffix is a
 * plain slice). Null when nothing prefix-extends the query.
 *
 * The leaf is completed as ordinary text: mid-text a slash command never runs
 * (see the module docstring), so `/dev` → `/devise` is exactly the literal the
 * user is writing, with no plugin qualifier.
 */
export function resolveInlineGhostName(
  rankedNames: readonly string[],
  query: string,
): string | null {
  if (query.length === 0) return null;
  const q = query.toLowerCase();
  for (const name of rankedNames) {
    if (name.toLowerCase().startsWith(q)) return name;
    const colon = name.lastIndexOf(":");
    if (colon >= 0) {
      const leaf = name.slice(colon + 1);
      if (leaf.toLowerCase().startsWith(q)) return leaf;
    }
  }
  return null;
}

/** A resolved inline ghost: where it sits and what it completes to. */
export interface InlineGhost {
  /** Document offset of the leading `/` of the mid-text command token. */
  slashOffset: number;
  /** Caret offset — where the suffix renders and where it inserts on accept. */
  caret: number;
  /** The text typed after `/`, up to the caret. */
  query: string;
  /** The full command name being completed to (prefix-extends `query`). */
  name: string;
  /** The remaining suffix to show as ghost text and insert on accept. */
  suffix: string;
}

/** Whitespace test that also treats the atom placeholder as a boundary. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === TUG_ATOM_CHAR || /\s/.test(ch);
}

/**
 * Characters that, sitting immediately to the RIGHT of the caret, still
 * leave the caret at a token end: closing quotes (curly + straight),
 * closing brackets, and sentence punctuation. Editing often repositions the
 * caret so one of these lands to its right (a closing quote after a command,
 * a command before a comma) — and the ghost should survive that, not vanish.
 */
const RIGHT_BOUNDARY_CHARS = new Set([
  "”", "’", '"', "'",
  ")", "]", "}",
  ".", ",", ";", ":", "!", "?",
]);

/**
 * Whether `ch` ends the token at the caret when it sits to the caret's
 * RIGHT. Broader than {@link isBoundary} (used for the token-START scan):
 * in addition to whitespace / atom / end-of-document, a closing
 * quote/bracket/punctuation counts, so a repositioned caret with such a
 * char to its right keeps the ghost alive.
 */
function isTokenEndBoundary(ch: string | undefined): boolean {
  return isBoundary(ch) || (ch !== undefined && RIGHT_BOUNDARY_CHARS.has(ch));
}

/**
 * Decide the inline ghost for `text` with the caret at `caret`, or `null` when
 * none applies. Pure.
 *
 * A ghost shows only when ALL hold:
 *  - the caret sits at the **end** of an unbroken token (the next char is a
 *    boundary) — never mid-token, where a suffix would be nonsense;
 *  - that token begins with `/` and the `/` is **not** at offset 0 (offset 0
 *    is the descriptive popup's territory — the two never overlap);
 *  - something has been typed after the `/` (a bare `/` mid-text ghosts
 *    nothing);
 *  - the matcher returns a name that genuinely prefix-extends the query.
 */
export function computeInlineGhost(
  text: string,
  caret: number,
  matcher: InlineCommandMatcher,
): InlineGhost | null {
  if (caret <= 0 || caret > text.length) return null;
  // Caret must be at the token end: the character to its right is a boundary
  // (whitespace / atom / EOD, or a closing quote/bracket/punctuation).
  if (!isTokenEndBoundary(text[caret])) return null;

  // Walk back to the token start, stopping at the first boundary char.
  let slashOffset = caret;
  while (slashOffset > 0 && !isBoundary(text[slashOffset - 1])) {
    slashOffset--;
  }

  // The token must be a `/command` run that does not lead the document.
  if (text[slashOffset] !== "/") return null;
  if (slashOffset === 0) return null;

  const query = text.slice(slashOffset + 1, caret);
  if (query.length === 0) return null;

  const name = matcher(query);
  if (name === null) return null;
  if (name.length <= query.length) return null;
  if (!name.toLowerCase().startsWith(query.toLowerCase())) return null;

  return { slashOffset, caret, query, name, suffix: name.slice(query.length) };
}

/** A named right-boundary scenario for the test suite (see the ghost test). */
export interface GhostBoundaryCase {
  /** What the case pins. */
  name: string;
  /** Document text. */
  text: string;
  /** Caret offset. Defaults to `text.length` (caret at end) when omitted. */
  caret?: number;
  /** Whether a ghost should show. */
  ghost: boolean;
}

/**
 * Right-of-caret boundary cases. Each pins whether a mid-text `/rewi…` token
 * ghosts when a given character sits immediately to the caret's right. Data,
 * not code: a newly-discovered case is one new row here, then a green test.
 * The test supplies a matcher whose catalog completes `rewi` → `rewind`.
 */
export const GHOST_BOUNDARY_CASES: GhostBoundaryCase[] = [
  { name: "end of document", text: "hello /rewi", ghost: true },
  { name: "whitespace right of caret", text: "hello /rewi there", caret: 11, ghost: true },
  { name: "closing double quote", text: 'hello /rewi"', caret: 11, ghost: true },
  { name: "closing single quote", text: "hello /rewi'", caret: 11, ghost: true },
  { name: "curly closing double quote", text: "hello /rewi”", caret: 11, ghost: true },
  { name: "curly closing single quote", text: "hello /rewi’", caret: 11, ghost: true },
  { name: "closing paren", text: "hello /rewi)", caret: 11, ghost: true },
  { name: "closing bracket", text: "hello /rewi]", caret: 11, ghost: true },
  { name: "closing brace", text: "hello /rewi}", caret: 11, ghost: true },
  { name: "period", text: "hello /rewi.", caret: 11, ghost: true },
  { name: "comma", text: "hello /rewi,", caret: 11, ghost: true },
  { name: "semicolon", text: "hello /rewi;", caret: 11, ghost: true },
  { name: "letter right of caret is mid-token, no ghost", text: "hello /rewind", caret: 11, ghost: false },
  { name: "opening paren right of caret is not a token end", text: "hello /rewi(more", caret: 11, ghost: false },
];
