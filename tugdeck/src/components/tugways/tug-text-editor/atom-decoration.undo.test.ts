/**
 * atom-decoration.undo.test.ts — undo integrity for atom insertions.
 *
 * Guards the invariant the preflight drop pipeline relies on: an
 * attachment drop is ONE document mutation (text + atoms in a single
 * `addAtomsEffect` transaction), so a single undo removes the whole
 * drop cleanly — no atom widget is resurrected and no bare U+FFFC
 * "tofu" is left behind.
 *
 * This is the regression that killed the earlier "insert skeleton, then
 * async-repair on failure" design: the repair was a second transaction
 * that DELETED the skeleton atom, and `atomInvertedEffects` faithfully
 * re-added it on undo — resurrecting a broken pending chip. Preflighting
 * removes the repair transaction entirely; this test pins that a
 * one-shot mixed insert undoes to empty.
 */

import { test, expect } from "bun:test";
import { EditorState, Transaction } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import {
  atomDecorationField,
  atomInvertedEffects,
  addAtomsEffect,
} from "./atom-decoration";

function decoCount(state: EditorState): number {
  let n = 0;
  const cur = state.field(atomDecorationField).iter();
  while (cur.value) {
    n++;
    cur.next();
  }
  return n;
}

function seededEditor(): EditorState {
  return EditorState.create({
    doc: "",
    extensions: [history(), atomDecorationField, atomInvertedEffects],
  });
}

function applyUndo(state: EditorState): EditorState {
  let out = state;
  undo({ state, dispatch: (tr) => (out = tr.state) });
  return out;
}

// Mirror the transaction insertMixedAt dispatches: one change carrying
// interleaved text + U+FFFC, one addAtomsEffect for the atom positions.
function mixedInsert(
  state: EditorState,
  pos: number,
  items: ReadonlyArray<{ kind: "atom"; label: string } | { kind: "text"; text: string }>,
): EditorState {
  let insert = "";
  const positioned: Array<{ position: number; segment: import("@/lib/tug-atom-img").AtomSegment }> = [];
  items.forEach((item, i) => {
    if (i > 0) insert += " ";
    if (item.kind === "atom") {
      positioned.push({
        position: pos + insert.length,
        segment: { kind: "atom", type: "image", label: item.label, value: item.label, id: item.label },
      });
      insert += TUG_ATOM_CHAR;
    } else {
      insert += item.text;
    }
  });
  return state.update({
    changes: { from: pos, insert },
    effects: addAtomsEffect.of(positioned),
    userEvent: "input.tug-atom-drop",
    annotations: Transaction.addToHistory.of(true),
  }).state;
}

test("single undo removes a mixed atom+text drop cleanly", () => {
  const after = mixedInsert(seededEditor(), 0, [
    { kind: "atom", label: "image-1" },
    { kind: "text", text: "notes.zip" },
  ]);
  expect(decoCount(after)).toBe(1);
  expect(after.doc.toString()).toBe(`${TUG_ATOM_CHAR} notes.zip`);

  const undone = applyUndo(after);
  expect(undone.doc.toString()).toBe("");
  // No resurrected widget, no leftover tofu char.
  expect(decoCount(undone)).toBe(0);
});

test("rejected-image-as-text drop undoes with no atom at all", () => {
  // Preflight degrades a rejected image to filename text — the drop
  // carries no atom, so undo is a plain text removal.
  const after = mixedInsert(seededEditor(), 0, [{ kind: "text", text: "diagram.svg" }]);
  expect(decoCount(after)).toBe(0);
  expect(after.doc.toString()).toBe("diagram.svg");

  const undone = applyUndo(after);
  expect(undone.doc.toString()).toBe("");
  expect(decoCount(undone)).toBe(0);
});
