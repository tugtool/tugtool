/**
 * tug-text-editor/atom-bind.ts — keep atoms from breaking away from
 * their adjacent punctuation when a line wraps.
 *
 * An atom renders as an inline *replaced* element (`<img>`, see
 * `tug-atom-img.ts`). The browser's line-breaking algorithm grants a
 * replaced element a break opportunity on BOTH of its edges, regardless
 * of what sits next to it — so `atom,` can break between the atom and
 * the comma, leaving the comma stranded at the start of the next visual
 * row. Real words don't do this: a run of non-whitespace glyphs is one
 * unbreakable unit, and the only break points are the surrounding
 * spaces.
 *
 * This field restores that word semantics. For every U+FFFC (the atom
 * placeholder character) it marks the maximal run of NON-whitespace
 * characters containing it with `white-space: nowrap` (`.cm-tug-atom-bind`,
 * styled in `tug-text-editor/theme.ts`). The run binds the atom to any
 * directly-abutting punctuation/letters so the pair wraps as a single
 * token — breaks fall on the spaces around the run, exactly as they
 * would for a plain word. Runs that are just the bare atom (a space on
 * each side) are skipped: the atom already wraps cleanly at those spaces
 * and the mark would be inert.
 *
 * The mark coexists with the `Decoration.replace` from
 * `atomDecorationField` (the mark fully contains the replace range — the
 * ordinary nest case for styling over a widget), so this is a second,
 * independent decoration source rather than a change to the atom field.
 *
 * Laws: [L02] derives from the CM6 document, not React state, [L06]
 *        appearance-only (a wrapping hint), [L19] file structure.
 */

import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";

/** The `white-space: nowrap` wrapper applied to an atom's non-space run. */
const atomBindMark = Decoration.mark({ class: "cm-tug-atom-bind" });

/**
 * The break characters that bound a run. Only the spaces the editor's
 * wrapping actually breaks on — ordinary space, tab, and the line
 * terminators (a run never crosses a line). Non-breaking space (U+00A0)
 * is deliberately excluded so an atom still binds across it.
 */
function isRunBoundary(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Build the nowrap marks for every atom-bearing non-whitespace run in
 * the document. Runs are emitted left-to-right and never overlap (the
 * scan resumes past each run's end), satisfying `RangeSetBuilder`'s
 * sorted-input contract.
 */
function buildAtomBindDecorations(doc: Text): DecorationSet {
  const text = doc.toString();
  const len = text.length;
  const builder = new RangeSetBuilder<Decoration>();
  let from = 0;
  for (;;) {
    const atom = text.indexOf(TUG_ATOM_CHAR, from);
    if (atom === -1) break;
    let start = atom;
    while (start > 0 && !isRunBoundary(text[start - 1])) start--;
    let end = atom + 1;
    while (end < len && !isRunBoundary(text[end])) end++;
    // Skip a run that is nothing but the atom itself — it already wraps
    // cleanly on the spaces flanking it, so a nowrap span buys nothing.
    if (end - start > 1) {
      builder.add(start, end, atomBindMark);
    }
    from = end;
  }
  return builder.finish();
}

/**
 * Field holding the atom-bind marks. Recomputed only when the document
 * changes (the marks are a pure function of the text); prompt documents
 * are short, so a full rescan is cheaper than incremental bookkeeping.
 */
export const atomBindField = StateField.define<DecorationSet>({
  create(state): DecorationSet {
    return buildAtomBindDecorations(state.doc);
  },
  update(value, tr): DecorationSet {
    return tr.docChanged ? buildAtomBindDecorations(tr.state.doc) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Extension bundle registering the atom-bind decorations. */
export const atomBindExt: Extension = atomBindField;
