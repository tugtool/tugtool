import { describe, expect, test } from "bun:test";

import {
  applyHistoryStep,
  EMPTY_UNDO_LABEL_STACKS,
  undoLabelForUserEvent,
  type UndoLabelStacks,
} from "../undo-labels";

describe("undoLabelForUserEvent", () => {
  test("maps the macOS menu nouns", () => {
    expect(undoLabelForUserEvent("input.type")).toBe("Typing");
    expect(undoLabelForUserEvent("input.type.compose")).toBe("Typing");
    expect(undoLabelForUserEvent("input.tug-completion")).toBe("Typing");
    expect(undoLabelForUserEvent("input.paste")).toBe("Paste");
    expect(undoLabelForUserEvent("delete.cut")).toBe("Cut");
    expect(undoLabelForUserEvent("delete.backward")).toBe("Delete");
    expect(undoLabelForUserEvent("delete.selection")).toBe("Delete");
    expect(undoLabelForUserEvent("input.drop")).toBe("Drag");
    expect(undoLabelForUserEvent("input.tug-atom-drop")).toBe("Drag");
    expect(undoLabelForUserEvent("move.drop")).toBe("Drag");
  });

  test("unknown events map to the plain title", () => {
    expect(undoLabelForUserEvent(null)).toBe("");
    expect(undoLabelForUserEvent("select")).toBe("");
    expect(undoLabelForUserEvent("weird.event")).toBe("");
  });
});

describe("applyHistoryStep", () => {
  const edit = (
    stacks: UndoLabelStacks,
    label: string,
    undoDepthAfter: number,
    redoDepthAfter = 0,
  ) => applyHistoryStep(stacks, { kind: "edit", label, undoDepthAfter, redoDepthAfter });

  test("a new history event pushes its label", () => {
    const s = edit(EMPTY_UNDO_LABEL_STACKS, "Typing", 1);
    expect(s.done).toEqual(["Typing"]);
    expect(s.undone).toEqual([]);
  });

  test("a merged edit (depth unchanged) keeps the event's first label", () => {
    let s = edit(EMPTY_UNDO_LABEL_STACKS, "Typing", 1);
    s = edit(s, "Typing", 1); // grouped keystroke
    expect(s.done).toEqual(["Typing"]);
  });

  test("distinct events stack distinct labels", () => {
    let s = edit(EMPTY_UNDO_LABEL_STACKS, "Typing", 1);
    s = edit(s, "Paste", 2);
    expect(s.done).toEqual(["Typing", "Paste"]);
  });

  test("undo moves the top label to the redo side; redo moves it back", () => {
    let s = edit(EMPTY_UNDO_LABEL_STACKS, "Typing", 1);
    s = edit(s, "Paste", 2);
    s = applyHistoryStep(s, { kind: "undo", label: "", undoDepthAfter: 1, redoDepthAfter: 1 });
    expect(s.done).toEqual(["Typing"]);
    expect(s.undone).toEqual(["Paste"]);
    s = applyHistoryStep(s, { kind: "redo", label: "", undoDepthAfter: 2, redoDepthAfter: 0 });
    expect(s.done).toEqual(["Typing", "Paste"]);
    expect(s.undone).toEqual([]);
  });

  test("a fresh edit clears the redo side (depth resync)", () => {
    let s = edit(EMPTY_UNDO_LABEL_STACKS, "Typing", 1);
    s = applyHistoryStep(s, { kind: "undo", label: "", undoDepthAfter: 0, redoDepthAfter: 1 });
    expect(s.undone).toEqual(["Typing"]);
    s = edit(s, "Paste", 1, 0); // new edit → CM6 drops the undone branch
    expect(s.done).toEqual(["Paste"]);
    expect(s.undone).toEqual([]);
  });

  test("resync trims the oldest labels when history is culled", () => {
    let s: UndoLabelStacks = { done: ["Typing", "Paste", "Delete"], undone: [] };
    // CM6 trimmed to maxDepth: reported depth is 2 → oldest drops.
    s = edit(s, "Typing", 3); // merged-shape call with depth 3 → unchanged top
    s = applyHistoryStep(s, { kind: "edit", label: "Cut", undoDepthAfter: 3, redoDepthAfter: 0 });
    expect(s.done).toEqual(["Typing", "Paste", "Delete"]);
    const culled = edit(s, "Cut", 2);
    expect(culled.done).toEqual(["Paste", "Delete"]);
  });

  test("resync pads unknown events with the plain label", () => {
    // Depth grew by 2 in one step (unlabeled path): pad the oldest end.
    const s = edit(EMPTY_UNDO_LABEL_STACKS, "Paste", 2);
    expect(s.done).toEqual(["", "Paste"]);
  });
});
