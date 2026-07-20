/**
 * atom-type-over.test.ts — typing over a selection that covers an atom
 * replaces it, exercised headlessly on a real EditorState carrying a
 * real atom decoration (no DOM: the decision is pure state → spec).
 */

import { test, expect } from "bun:test";
import {
  EditorSelection,
  EditorState,
  Transaction,
} from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import {
  addAtomsEffect,
  atomDecorationField,
  atomInvertedEffects,
} from "./atom-decoration";
import { typeOverAtomChange } from "./atom-type-over";

/** `⟨/tugplug:implement⟩ foobar` — a command atom leading the doc. */
function seededEditor(): EditorState {
  const base = EditorState.create({
    doc: "",
    extensions: [history(), atomDecorationField, atomInvertedEffects],
  });
  return base.update({
    changes: { from: 0, insert: TUG_ATOM_CHAR + " foobar" },
    effects: addAtomsEffect.of([
      {
        position: 0,
        segment: {
          kind: "atom",
          type: "command",
          label: "tugplug:implement",
          value: "tugplug:implement",
        },
      },
    ]),
    selection: EditorSelection.cursor(1),
    // Keep the seed out of history so an undo under test removes only the
    // type-over, not the seeding insertion (headless dispatches share a
    // timestamp and would otherwise group).
    annotations: Transaction.addToHistory.of(false),
  }).state;
}

/** A plain keydown descriptor with sensible defaults. */
function key(
  k: string,
  over: Partial<Omit<Parameters<typeof typeOverAtomChange>[1], "key">> = {},
): Parameters<typeof typeOverAtomChange>[1] {
  return {
    key: k,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    ...over,
  };
}

/** Select exactly the atom (the U+FFFC at [0, 1)). */
function selectAtom(state: EditorState): EditorState {
  return state.update({ selection: EditorSelection.range(0, 1) }).state;
}

test("typing over a selected atom replaces it with the character", () => {
  const state = selectAtom(seededEditor());
  const spec = typeOverAtomChange(state, key("x"));
  expect(spec).not.toBeNull();
  const next = state.update(spec!).state;
  expect(next.doc.toString()).toBe("x foobar");
  // The atom decoration is gone — its backing U+FFFC was replaced.
  expect(next.field(atomDecorationField).size).toBe(0);
  // Caret parks after the inserted character.
  expect(next.selection.main.head).toBe(1);
});

test("a space types over the atom too", () => {
  const state = selectAtom(seededEditor());
  const spec = typeOverAtomChange(state, key(" "));
  expect(spec).not.toBeNull();
  expect(state.update(spec!).state.doc.toString()).toBe("  foobar");
});

test("a selection spanning the atom and trailing text replaces the whole run", () => {
  // Select the atom plus the following " fo" → [0, 4).
  const state = seededEditor().update({
    selection: EditorSelection.range(0, 4),
  }).state;
  const spec = typeOverAtomChange(state, key("z"));
  expect(spec).not.toBeNull();
  expect(state.update(spec!).state.doc.toString()).toBe("zobar");
});

test("a plain-text selection with no atom is left to the native path", () => {
  // Select "foobar" (no atom in range) — the handler yields (null).
  const state = seededEditor().update({
    selection: EditorSelection.range(2, 8),
  }).state;
  expect(typeOverAtomChange(state, key("x"))).toBeNull();
});

test("an empty selection is never a type-over", () => {
  const state = selectAtom(seededEditor()).update({
    selection: EditorSelection.cursor(1),
  }).state;
  expect(typeOverAtomChange(state, key("x"))).toBeNull();
});

test("non-printable, chorded, composing, and consumed keys are yielded", () => {
  const state = selectAtom(seededEditor());
  expect(typeOverAtomChange(state, key("Enter"))).toBeNull();
  expect(typeOverAtomChange(state, key("Backspace"))).toBeNull();
  expect(typeOverAtomChange(state, key("ArrowLeft"))).toBeNull();
  expect(typeOverAtomChange(state, key("v", { metaKey: true }))).toBeNull();
  expect(typeOverAtomChange(state, key("x", { ctrlKey: true }))).toBeNull();
  expect(typeOverAtomChange(state, key("x", { isComposing: true }))).toBeNull();
  expect(typeOverAtomChange(state, key("x", { defaultPrevented: true }))).toBeNull();
});

test("undo restores the replaced atom and its chip", () => {
  const state = selectAtom(seededEditor());
  const spec = typeOverAtomChange(state, key("x"));
  const typed = state.update(spec!).state;
  expect(typed.field(atomDecorationField).size).toBe(0);

  let undone = typed;
  undo({ state: typed, dispatch: (tr) => (undone = tr.state) });
  expect(undone.doc.toString()).toBe(TUG_ATOM_CHAR + " foobar");
  expect(undone.field(atomDecorationField).size).toBe(1);
});

test("a non-ASCII literal character types over", () => {
  const state = selectAtom(seededEditor());
  // e.g. macOS Option-a delivers key "å" — a single-code-unit literal.
  const spec = typeOverAtomChange(state, key("å"));
  expect(spec).not.toBeNull();
  expect(state.update(spec!).state.doc.toString()).toBe("å foobar");
});
