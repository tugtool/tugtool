/**
 * Pure-logic tests for `NotebookEditToolBlock`'s wire-narrowing
 * helpers, edit-mode resolution, and dispatch routing.
 *
 * The wrapper itself is decoration over composition (`ToolBlockChrome`
 * + `embedded` `DiffBlock` / `FileBlock` + `MiddleEllipsisPath`) —
 * its behaviour *is* the exported pure helpers:
 *
 *  - `narrowNotebookEditInput` / `narrowNotebookEditStructured` —
 *    defensive narrowing of the wire props (with edit_mode and
 *    cell_type whitelisted against the known enum).
 *  - `resolveNotebookEditMode` — prefers structured, falls back to
 *    input, defaults to `replace`.
 *  - The dispatch routes `NotebookEdit` to the real
 *    `NotebookEditToolBlock` (via `BESPOKE_FACTORY_BY_NAME`).
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  NotebookEditToolBlock,
  narrowNotebookEditInput,
  narrowNotebookEditStructured,
  resolveNotebookEditMode,
} from "../notebook-edit-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../dev-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowNotebookEditInput
// ---------------------------------------------------------------------------

describe("narrowNotebookEditInput", () => {
  test("keeps the wire fields when well-typed", () => {
    expect(
      narrowNotebookEditInput({
        notebook_path: "/tmp/x.ipynb",
        new_source: "print('hi')",
        cell_id: "cell-2",
        cell_type: "code",
        edit_mode: "replace",
      }),
    ).toEqual({
      notebook_path: "/tmp/x.ipynb",
      new_source: "print('hi')",
      cell_id: "cell-2",
      cell_type: "code",
      edit_mode: "replace",
    });
  });

  test("drops unknown enum values for cell_type / edit_mode", () => {
    expect(
      narrowNotebookEditInput({
        notebook_path: "/x.ipynb",
        cell_type: "raw",
        edit_mode: "rewrite",
      }),
    ).toEqual({
      notebook_path: "/x.ipynb",
      new_source: undefined,
      cell_id: undefined,
      cell_type: undefined,
      edit_mode: undefined,
    });
  });

  test("tolerates non-objects", () => {
    expect(narrowNotebookEditInput(null)).toEqual({});
    expect(narrowNotebookEditInput("nope")).toEqual({});
    expect(narrowNotebookEditInput(undefined)).toEqual({});
  });
});

describe("narrowNotebookEditStructured", () => {
  test("keeps the wire fields when well-typed", () => {
    expect(
      narrowNotebookEditStructured({
        notebookPath: "/x.ipynb",
        cellId: "c1",
        cellType: "markdown",
        editMode: "insert",
        oldSource: "old",
        newSource: "new",
      }),
    ).toEqual({
      notebookPath: "/x.ipynb",
      cellId: "c1",
      cellType: "markdown",
      editMode: "insert",
      oldSource: "old",
      newSource: "new",
    });
  });

  test("drops unknown enum values silently", () => {
    expect(
      narrowNotebookEditStructured({
        editMode: "rewrite",
        cellType: "raw",
      }),
    ).toEqual({
      notebookPath: undefined,
      cellId: undefined,
      cellType: undefined,
      editMode: undefined,
      oldSource: undefined,
      newSource: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveNotebookEditMode
// ---------------------------------------------------------------------------

describe("resolveNotebookEditMode", () => {
  test("prefers the structured mode", () => {
    expect(
      resolveNotebookEditMode({ edit_mode: "replace" }, { editMode: "insert" }),
    ).toBe("insert");
  });

  test("falls back to the input mode", () => {
    expect(
      resolveNotebookEditMode({ edit_mode: "delete" }, {}),
    ).toBe("delete");
  });

  test("defaults to `replace` when neither side provides a mode", () => {
    expect(resolveNotebookEditMode({}, {})).toBe("replace");
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing — NotebookEdit → NotebookEditToolBlock
// ---------------------------------------------------------------------------

describe("NotebookEdit dispatch routing", () => {
  test("BESPOKE_FACTORY_BY_NAME maps notebookedit to NotebookEditToolBlock", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("notebookedit")).toBe(
      NotebookEditToolBlock,
    );
  });
});
