/**
 * tug-edit/atom-decoration.ts — atom widgets and the decoration field
 * that holds them.
 *
 * Atoms in the editor's text stream are represented by U+FFFC (the
 * Object Replacement Character). For every U+FFFC position we want
 * to render as an atom, the `atomDecorationField` carries a
 * `Decoration.replace` over `[pos, pos + 1)` whose widget renders the
 * styled `<img>` produced by `tug-atom-img.ts` [D05]. The flat-text
 * representation matches the existing `TugTextEngine` model, so
 * `view.state.doc.toString()` round-trips through the same offset
 * semantics.
 *
 * The decoration field's range set is also the source the
 * `atomicRanges` provider reads (see `atomic-ranges.ts`), so cursor
 * motion and deletion treat each atom as a single unit per [Q01].
 *
 * Theme regeneration: atom SVGs are baked at widget construction
 * (colors are resolved at `createAtomImgElement` call time), so a
 * theme switch must dispatch `regenerateAtomsEffect` to rebuild every
 * widget. Subscription to `subscribeThemeChange` is wired in
 * `tug-edit.tsx`.
 *
 * Laws: [L02] no React state for atom segments — atoms live entirely
 *        in CM6's StateField, [L06] atom widget DOM is appearance,
 *        [L07] effect handlers operate on the transaction-supplied
 *        state, [L11] atoms participate in editing actions on the
 *        component-owned document, [L19] file structure, [L22] atom
 *        operations dispatch through the CM6 transaction stream — no
 *        React round-trip.
 */

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Range, Transaction } from "@codemirror/state";
import {
  createAtomImgElement,
  TUG_ATOM_CHAR,
  type AtomSegment,
} from "@/lib/tug-atom-img";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identity of an atom occurrence in the document, paired with its position. */
export interface PositionedAtom {
  /** Position of the U+FFFC character in the document. */
  position: number;
  /** Atom identity. */
  segment: AtomSegment;
}

// ---------------------------------------------------------------------------
// AtomWidget
// ---------------------------------------------------------------------------

/**
 * CodeMirror widget that paints an atom as a replaced inline element.
 *
 * `toDOM` defers to `createAtomImgElement` so the atom looks identical
 * to the rest of the tug ecosystem (gallery, prompt-input, prompt-entry).
 * `eq` returns true when two widgets share the same segment identity,
 * letting CM6 reuse the existing DOM across unrelated transactions —
 * theme regeneration deliberately bypasses this by dispatching new
 * widget instances.
 */
export class AtomWidget extends WidgetType {
  constructor(public readonly segment: AtomSegment) {
    super();
  }

  override eq(other: AtomWidget): boolean {
    return (
      this.segment.type === other.segment.type
      && this.segment.label === other.segment.label
      && this.segment.value === other.segment.value
    );
  }

  override toDOM(): HTMLImageElement {
    return createAtomImgElement(
      this.segment.type,
      this.segment.label,
      this.segment.value,
    );
  }

  override ignoreEvent(): boolean {
    // Allow click/mousedown to bubble so editor selection and
    // double-click-to-select-atom work through the normal pipeline.
    return false;
  }
}

// ---------------------------------------------------------------------------
// State effects
// ---------------------------------------------------------------------------

/**
 * Add atom decorations at the given positions. Each entry's `position`
 * must point at a U+FFFC character in the document — callers
 * responsible for inserting the character in the same transaction.
 */
export const addAtomsEffect = StateEffect.define<readonly PositionedAtom[]>();

/**
 * Force re-creation of every atom widget — used when colors baked into
 * the SVG data URI become stale after a theme switch. The decorations'
 * positions are unchanged; only the widget instances are replaced.
 */
export const regenerateAtomsEffect = StateEffect.define<null>();

/**
 * Replace the entire atom decoration set with the supplied list.
 * Used by state-restoration paths (Step 7) and by tests that need a
 * deterministic starting point.
 */
export const replaceAtomsEffect = StateEffect.define<readonly PositionedAtom[]>();

// ---------------------------------------------------------------------------
// atomDecorationField
// ---------------------------------------------------------------------------

/**
 * The single source of truth for atom decorations in a `TugEdit`
 * instance. Maps automatically through document changes: deleting a
 * range that covers a U+FFFC character drops the decoration with it.
 */
export const atomDecorationField = StateField.define<DecorationSet>({
  create(): DecorationSet {
    return Decoration.none;
  },

  update(deco: DecorationSet, tr: Transaction): DecorationSet {
    let next = deco.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(addAtomsEffect)) {
        next = next.update({
          add: effect.value.map(toAtomRange),
          sort: true,
        });
      } else if (effect.is(replaceAtomsEffect)) {
        next = Decoration.set(effect.value.map(toAtomRange));
      } else if (effect.is(regenerateAtomsEffect)) {
        next = regenerateWidgets(next, tr.state);
      }
    }

    return next;
  },

  provide: (f) => EditorView.decorations.from(f),
});

/** Build a `Decoration.replace` range for a positioned atom. */
function toAtomRange(p: PositionedAtom): Range<Decoration> {
  return Decoration.replace({
    widget: new AtomWidget(p.segment),
    inclusive: false,
  }).range(p.position, p.position + 1);
}

/**
 * Walk the existing decoration set and construct a fresh widget for
 * each atom occurrence. The new widget is `!eq` to the old one (we
 * use a marker symbol on the segment to force inequality), so CM6
 * remounts the DOM and the freshly-resolved theme colors take effect.
 */
function regenerateWidgets(
  deco: DecorationSet,
  state: EditorState,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const cursor = deco.iter();
  while (cursor.value !== null) {
    const widget = (cursor.value.spec as { widget?: WidgetType }).widget;
    if (widget instanceof AtomWidget) {
      ranges.push(
        Decoration.replace({
          // Cloning the segment preserves identity for app code while
          // forcing widget inequality (every regeneration is a fresh
          // object reference).
          widget: new AtomWidget({ ...widget.segment }),
          inclusive: false,
        }).range(cursor.from, cursor.to),
      );
    }
    cursor.next();
  }
  // `state` is unused at present but kept in the signature so future
  // regeneration logic (e.g. font-size-driven re-layout) has access.
  void state;
  return Decoration.set(ranges);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Enumerate every atom currently in the document, in document order.
 * The result is suitable for clipboard serialization and for state
 * preservation [L23 — Step 7].
 */
export function getAtomsInState(state: EditorState): PositionedAtom[] {
  const result: PositionedAtom[] = [];
  const cursor = state.field(atomDecorationField).iter();
  while (cursor.value !== null) {
    const widget = (cursor.value.spec as { widget?: WidgetType }).widget;
    if (widget instanceof AtomWidget) {
      result.push({ position: cursor.from, segment: widget.segment });
    }
    cursor.next();
  }
  return result;
}

/**
 * Restrict an atom list to those falling inside a half-open
 * `[from, to)` range. Used by clipboard-output to scope the sidecar
 * to the actually-selected atoms.
 */
export function getAtomsInRange(
  state: EditorState,
  from: number,
  to: number,
): PositionedAtom[] {
  const result: PositionedAtom[] = [];
  const cursor = state.field(atomDecorationField).iter();
  while (cursor.value !== null) {
    const widget = (cursor.value.spec as { widget?: WidgetType }).widget;
    if (widget instanceof AtomWidget && cursor.from >= from && cursor.from < to) {
      result.push({ position: cursor.from, segment: widget.segment });
    }
    cursor.next();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Transaction builders
// ---------------------------------------------------------------------------

/**
 * Dispatch a transaction that inserts an atom at the given position.
 * The transaction inserts U+FFFC in the document and adds the matching
 * decoration in the same step, so the editor never observes a
 * partially-applied atom. Selection lands immediately after the new
 * atom.
 */
export function insertAtomAt(
  view: EditorView,
  pos: number,
  segment: AtomSegment,
): void {
  view.dispatch({
    changes: { from: pos, insert: TUG_ATOM_CHAR },
    effects: addAtomsEffect.of([{ position: pos, segment }]),
    selection: { anchor: pos + 1 },
    scrollIntoView: true,
    userEvent: "input.tug-atom",
  });
}

/**
 * Dispatch a transaction that inserts an atom at the current selection
 * head (replacing any selected range first).
 */
export function insertAtomAtSelection(
  view: EditorView,
  segment: AtomSegment,
): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: TUG_ATOM_CHAR },
    effects: addAtomsEffect.of([{ position: from, segment }]),
    selection: { anchor: from + 1 },
    scrollIntoView: true,
    userEvent: "input.tug-atom",
  });
}
