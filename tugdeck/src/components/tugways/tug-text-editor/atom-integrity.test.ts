/**
 * atom-integrity.test.ts — command-atom demotion.
 *
 * Pins the position rule: a command atom pushed off position 0 by an
 * edit demotes to its literal `/name` text in the same transaction,
 * and a single undo restores both the edit and the chip.
 */

import { test, expect } from "bun:test";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import {
  addAtomsEffect,
  atomDecorationField,
  atomInvertedEffects,
  AtomWidget,
} from "./atom-decoration";
import type { WidgetType } from "@codemirror/view";
import { commandAtomDemotionFilter } from "./atom-integrity";

function atomTypes(state: EditorState): string[] {
  const out: string[] = [];
  const cur = state.field(atomDecorationField).iter();
  while (cur.value) {
    const widget = (cur.value.spec as { widget?: WidgetType }).widget;
    if (widget instanceof AtomWidget) out.push(widget.segment.type);
    cur.next();
  }
  return out;
}

/** An editor holding `⟨/tugplug:commit⟩ args…` — command atom leading. */
function seededEditor(tail = " go"): EditorState {
  const base = EditorState.create({
    doc: "",
    extensions: [
      history(),
      atomDecorationField,
      atomInvertedEffects,
      commandAtomDemotionFilter,
    ],
  });
  return base.update({
    changes: { from: 0, insert: TUG_ATOM_CHAR + tail },
    effects: addAtomsEffect.of([
      {
        position: 0,
        segment: {
          kind: "atom",
          type: "command",
          label: "tugplug:commit",
          value: "tugplug:commit",
        },
      },
    ]),
    selection: EditorSelection.cursor(1 + tail.length),
    userEvent: "input.tug-completion",
    // Keep the seed out of history: headless dispatches share a
    // timestamp, so history would otherwise group the seed with the
    // edit under test and one undo would remove both.
    annotations: Transaction.addToHistory.of(false),
  }).state;
}

function applyUndo(state: EditorState): EditorState {
  let out = state;
  undo({ state, dispatch: (tr) => (out = tr.state) });
  return out;
}

test("typing before a leading command atom demotes it to literal text", () => {
  const seeded = seededEditor();
  expect(atomTypes(seeded)).toEqual(["command"]);

  const typed = seeded.update({
    changes: { from: 0, insert: "x" },
    selection: EditorSelection.cursor(1),
    userEvent: "input.type",
  }).state;

  expect(typed.doc.toString()).toBe("x/tugplug:commit go");
  expect(atomTypes(typed)).toEqual([]);
});

test("the caret stays where the user's edit put it", () => {
  const typed = seededEditor().update({
    changes: { from: 0, insert: "x" },
    selection: EditorSelection.cursor(1),
    userEvent: "input.type",
  }).state;
  expect(typed.selection.main.head).toBe(1);
});

test("a single undo restores the chip and removes the typed text", () => {
  const seeded = seededEditor();
  const typed = seeded.update({
    changes: { from: 0, insert: "x" },
    selection: EditorSelection.cursor(1),
    userEvent: "input.type",
  }).state;
  expect(atomTypes(typed)).toEqual([]);

  const undone = applyUndo(typed);
  expect(undone.doc.toString()).toBe(`${TUG_ATOM_CHAR} go`);
  expect(atomTypes(undone)).toEqual(["command"]);
});

test("edits after the atom leave the leading chip alone", () => {
  const seeded = seededEditor();
  const appended = seeded.update({
    changes: { from: seeded.doc.length, insert: " now" },
    selection: EditorSelection.cursor(seeded.doc.length + 4),
    userEvent: "input.type",
  }).state;
  expect(atomTypes(appended)).toEqual(["command"]);
  expect(appended.doc.toString()).toBe(`${TUG_ATOM_CHAR} go now`);
});

test("non-command atoms are position-free and never demoted", () => {
  const base = EditorState.create({
    doc: "",
    extensions: [
      history(),
      atomDecorationField,
      atomInvertedEffects,
      commandAtomDemotionFilter,
    ],
  });
  const withFile = base.update({
    changes: { from: 0, insert: TUG_ATOM_CHAR },
    effects: addAtomsEffect.of([
      {
        position: 0,
        segment: { kind: "atom", type: "file", label: "a.ts", value: "a.ts" },
      },
    ]),
    userEvent: "input.tug-completion",
  }).state;

  const typed = withFile.update({
    changes: { from: 0, insert: "see " },
    selection: EditorSelection.cursor(4),
    userEvent: "input.type",
  }).state;
  expect(atomTypes(typed)).toEqual(["file"]);
  expect(typed.doc.toString()).toBe(`see ${TUG_ATOM_CHAR}`);
});
