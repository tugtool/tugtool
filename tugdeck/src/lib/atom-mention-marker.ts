/**
 * atom-mention-marker — wire-text marker syntax for non-image atom
 * mentions.
 *
 * ## Why this exists
 *
 * Non-image atoms (file paths, doc references, URLs, commands the
 * user inserted via `@`-completion in the editor) are flattened
 * into a `text` content block at submit time per [Spec S03] /
 * [D01]. The substrate `U+FFFC` placeholder doesn't survive — the
 * model sees real text, not a placeholder.
 *
 * The original choice was to substitute the atom's bare `value`
 * (`"ga.txt"`) into the text. That made the prompt read naturally
 * to the model but lost the atom's structural identity: the JSONL
 * has no way to know "this token was a mention." On replay the
 * transcript shows `ga.txt` as plain prose, not a chip — visible
 * regression vs. what the user typed.
 *
 * The current marker wraps the value in backticks with a leading
 * `@`: `` `@ga.txt` ``. Two properties matter:
 *
 *   1. **Round-trippable.** The marker survives in JSONL verbatim
 *      and can be parsed back to recover atom positions and
 *      values. On replay the substrate synthesis re-mints chips at
 *      the original positions.
 *   2. **Model-friendly.** Backticked tokens are how Claude already
 *      reads "code-like reference" in prompts; the `@` prefix adds
 *      "user-mentioned this." The combination is unambiguous to the
 *      model and matches conventions in Markdown / `@`-mention UX
 *      elsewhere.
 *
 * Markdown's code-span syntax doesn't disambiguate against literal
 * backticks in user prose either — a user who types
 * `` `@foo` `` in their text literally would get a chip on replay
 * even if no atom was inserted. Acceptable false positive (visible
 * regression, never data loss); raising the bar with escape
 * sequences would complicate the model's reading.
 *
 * ## Backtick-in-value fallback
 *
 * If an atom's `value` contains a backtick (rare — file paths,
 * URLs, commands don't normally have them), the wrap would produce
 * a broken marker. {@link wrapAtomMention} falls back to
 * plain-text substitution in that case — the round-trip is lossy
 * for that one atom, matching the original pre-marker behaviour.
 *
 * @module lib/atom-mention-marker
 */

import { TUG_ATOM_CHAR, type AtomSegment } from "./tug-atom-img";

// ---------------------------------------------------------------------------
// Marker bracketing
// ---------------------------------------------------------------------------

/**
 * Marker prefix used inside the backticks. The `@` is the
 * convention-borne signal "the user mentioned this" — matches the
 * editor's `@`-completion UX even though the literal `@` character
 * never lives in the substrate.
 */
const MENTION_PREFIX = "@";

/**
 * Wrap a non-image atom's `value` as a backtick-`@` mention marker
 * for submit-time text substitution. Pure — no module state, no
 * DOM access.
 *
 * Returns the bare value (no marker) when the value contains a
 * backtick — the marker syntax can't escape backticks, and a value
 * containing one would produce a broken span that fails to parse on
 * replay. Falling back to plain substitution preserves the original
 * pre-marker behaviour for that one atom: lossy round-trip (no chip
 * on replay) but no data loss in the model's reading.
 */
export function wrapAtomMention(value: string): string {
  if (value.includes("`")) return value;
  return "`" + MENTION_PREFIX + value + "`";
}

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

/**
 * One segment in the parsed output of {@link parseAtomMentionSegments}.
 * Either a plain-text run or an atom-mention span. The synthesizer
 * walks segments in order, appending text to its buffer and inserting
 * a `U+FFFC` + atom for each mention.
 */
export type AtomMentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; value: string };

/**
 * Regex matching one mention span. The opening sequence is
 * backtick + `@`; the value is one-or-more non-backtick characters
 * (matching markdown code-span's "anything up to the closing
 * backtick" rule); the closing is one backtick. Greedy `+` is fine
 * because `[^`]+` can never cross a backtick.
 *
 * Global so {@link parseAtomMentionSegments} can iterate all matches
 * in one walk via `exec`.
 */
const MENTION_SPAN_RE = /`@([^`]+)`/g;

/**
 * Parse a wire text block into alternating text + mention segments.
 * Used by the substrate synthesizer ([Step 5c](roadmap/tide-atoms.md#step-5c))
 * to recover atom positions from a JSONL-honest wire text.
 *
 * Empty input returns an empty array. Text with no marker matches
 * returns a single text segment. The output preserves the input's
 * character order exactly — concatenating all segments' text +
 * marker reconstructs the original text.
 *
 * Pure — no module state, no DOM.
 */
export function parseAtomMentionSegments(text: string): AtomMentionSegment[] {
  if (text.length === 0) return [];
  const segments: AtomMentionSegment[] = [];
  let lastEnd = 0;
  // Fresh regex per call so `lastIndex` doesn't leak across invocations.
  const re = new RegExp(MENTION_SPAN_RE.source, MENTION_SPAN_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastEnd) {
      segments.push({ kind: "text", text: text.slice(lastEnd, match.index) });
    }
    segments.push({ kind: "mention", value: match[1] });
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < text.length) {
    segments.push({ kind: "text", text: text.slice(lastEnd) });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Verification — demote unverified mention atoms back to plain text
// ---------------------------------------------------------------------------

/**
 * Predicate the verification gate calls per recovered-mention atom.
 * Returns `true` when the mention's value is corroborated by a
 * same-turn assistant action (typically a `Read` / `Edit` / `Write` /
 * `NotebookEdit` tool_use whose `file_path` matches the mention).
 * Callers build this predicate from their turn-side view of tool
 * actions; see `UserMessageCell` in `tide-card-transcript.tsx`.
 */
export type MentionVerifier = (value: string) => boolean;

/**
 * Walk the substrate `(text, atoms)` and demote any recovered-mention
 * atom whose value fails the verifier — replacing the `U+FFFC` at
 * that position with `@${value}` (the user's literal `@`-prefixed
 * text) and removing the atom from the parallel array. Verified
 * mentions and real (id-bearing, e.g. image) atoms pass through
 * unchanged.
 *
 * **Why demote.** The submit-time marker (`` `@<value>` ``) round-
 * trips a chip's position + value through JSONL but can't distinguish
 * a real `@`-completion atom from a user who literally typed
 * backtick-`@`-text-backtick in their prose, nor from a user who
 * typed `@stable` and never engaged the completion popup. The wire
 * is symmetric in both cases. The render-time verifier — "did the
 * model actually engage with this file as a file?" — is the
 * tiebreaker. Unverified mentions render as plain `@value` text,
 * matching what the user saw before submit.
 *
 * **Which atoms count as "mentions".** A recovered-mention atom is
 * one synthesized by `synthesizeUserMessageFromBlocks` from a
 * `` `@<value>` `` marker: `type === "file"` AND `id === undefined`.
 * Real editor `@`-completion file atoms also look like this — they
 * don't carry an id either — and they correctly route through the
 * same verifier. Image atoms (with `type === "image"` and an `id`)
 * always pass through; they ride as separate image content blocks,
 * not through the marker.
 *
 * **Why `@`-prefix on demote.** The wire literal is
 * `` `@<value>` ``; the user typed `@<value>` (no backticks — those
 * were added by `wrapAtomMention` at submit). Rendering as `@value`
 * matches the user's input. Stripping the backticks too is correct;
 * if we left them, the demoted display would carry markup the user
 * never typed.
 *
 * Pure — no React, no DOM. Caller passes in the predicate.
 */
export function demoteUnverifiedMentions(
  text: string,
  atoms: ReadonlyArray<AtomSegment>,
  isVerified: MentionVerifier,
): { text: string; atoms: AtomSegment[] } {
  if (atoms.length === 0) return { text, atoms: [] };

  let outText = "";
  const outAtoms: AtomSegment[] = [];
  let atomIdx = 0;
  // `for…of` so we don't accidentally split a surrogate pair on a
  // future emoji-bearing path. `U+FFFC` is BMP so the visit count is
  // unchanged; this is the same defense as `buildWirePayload`'s walk.
  for (const ch of text) {
    if (ch !== TUG_ATOM_CHAR) {
      outText += ch;
      continue;
    }
    const atom = atoms[atomIdx];
    if (atom === undefined) {
      // Stray `U+FFFC` — pass through verbatim (matches `walkAtomText`'s
      // defensive `stray-ffc` branch and `buildWirePayload`'s
      // "atoms.length < count(U+FFFC)" handling).
      outText += ch;
      continue;
    }
    atomIdx += 1;
    const isRecoveredMention = atom.type === "file" && atom.id === undefined;
    if (isRecoveredMention && !isVerified(atom.value)) {
      // Demote: write the user's original `@`-prefixed text in place
      // of the chip placeholder; drop the atom.
      outText += "@" + atom.value;
      continue;
    }
    // Verified mention OR non-mention atom (image, etc.) — keep both
    // the placeholder and the atom in alignment.
    outText += ch;
    outAtoms.push(atom);
  }
  return { text: outText, atoms: outAtoms };
}
