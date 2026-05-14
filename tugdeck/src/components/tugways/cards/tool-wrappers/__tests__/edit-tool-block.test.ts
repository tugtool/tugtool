/**
 * Pure-logic tests for `EditToolBlock`'s wire-narrowing and
 * diff-composition helpers, plus the `MultiEdit → Edit` dispatch alias.
 *
 * The wrapper component itself is decoration over composition
 * (`ToolWrapperChrome` + `DiffBlock`) — its behaviour is the four
 * exported pure helpers, which is what these tests pin:
 *
 *  - `narrowEditInput` / `narrowEditStructured` — defensive narrowing
 *    of the `unknown` wire props.
 *  - `structuredPatchToHunks` — the `diff`-package `structuredPatch`
 *    shape → `DiffHunk[]` conversion (line kinds + 1-based line
 *    numbers). This is the "synthetic Edit fixture → DiffBlock with
 *    correct hunks" gate.
 *  - `composeEditDiffData` — `structuredPatch` is the primary source
 *    (single edits AND `replace_all` uniformly); `(old_string,
 *    new_string)` `two-text` is the fallback.
 *  - `composeEditChangeCounts` — the header `+N −M` badge counts.
 *  - the `multiedit` alias resolves to the real `EditToolBlock`.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  EditToolBlock,
  composeEditChangeCounts,
  composeEditDiffData,
  narrowEditInput,
  narrowEditStructured,
  structuredPatchToHunks,
  type EditPatchHunk,
} from "../edit-tool-block";
import {
  _resetToolWrapperRegistryForTests,
  registerToolWrapper,
  resolveToolWrapper,
} from "../../tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowEditInput
// ---------------------------------------------------------------------------

describe("narrowEditInput", () => {
  test("keeps the four wire fields when well-typed", () => {
    expect(
      narrowEditInput({
        file_path: "/a/b.ts",
        old_string: "foo",
        new_string: "bar",
        replace_all: true,
      }),
    ).toEqual({
      file_path: "/a/b.ts",
      old_string: "foo",
      new_string: "bar",
      replace_all: true,
    });
  });

  test("drops mistyped fields and tolerates non-objects", () => {
    expect(
      narrowEditInput({ file_path: 42, old_string: "foo", replace_all: "yes" }),
    ).toEqual({
      file_path: undefined,
      old_string: "foo",
      new_string: undefined,
      replace_all: undefined,
    });
    expect(narrowEditInput(null)).toEqual({});
    expect(narrowEditInput("nope")).toEqual({});
    expect(narrowEditInput(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// narrowEditStructured
// ---------------------------------------------------------------------------

describe("narrowEditStructured", () => {
  test("narrows a well-formed structured result", () => {
    const result = narrowEditStructured({
      filePath: "/a/b.ts",
      oldString: "foo",
      newString: "bar",
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-foo", "+bar"] },
      ],
      // Fields the wrapper does not consume are ignored, not retained.
      userModified: true,
    });
    expect(result.filePath).toBe("/a/b.ts");
    expect(result.oldString).toBe("foo");
    expect(result.newString).toBe("bar");
    expect(result.structuredPatch).toHaveLength(1);
    expect(result).not.toHaveProperty("userModified");
  });

  test("drops malformed patch hunks; an all-malformed patch becomes undefined", () => {
    const result = narrowEditStructured({
      structuredPatch: [
        // Valid.
        { oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ["+x"] },
        // Missing `newLines`.
        { oldStart: 2, oldLines: 1, newStart: 2, lines: ["-y"] },
        // `lines` not an array.
        { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: "nope" },
      ],
    });
    expect(result.structuredPatch).toHaveLength(1);
    expect(result.structuredPatch![0].oldStart).toBe(1);

    expect(
      narrowEditStructured({ structuredPatch: [{ bogus: true }] }).structuredPatch,
    ).toBeUndefined();
    expect(narrowEditStructured({ structuredPatch: [] }).structuredPatch).toBeUndefined();
    expect(narrowEditStructured(null)).toEqual({});
  });

  test("filters non-string entries out of a hunk's lines", () => {
    const result = narrowEditStructured({
      structuredPatch: [
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", 7, "+b", null] },
      ],
    });
    expect(result.structuredPatch![0].lines).toEqual(["-a", "+b"]);
  });
});

// ---------------------------------------------------------------------------
// structuredPatchToHunks
// ---------------------------------------------------------------------------

describe("structuredPatchToHunks", () => {
  test("classifies line kinds and assigns 1-based per-side line numbers", () => {
    const patch: EditPatchHunk[] = [
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 3,
        lines: [" context-a", "-removed", "+added", " context-b"],
      },
    ];
    const [hunk] = structuredPatchToHunks(patch);
    expect(hunk.before_start).toBe(10);
    expect(hunk.before_count).toBe(3);
    expect(hunk.after_start).toBe(10);
    expect(hunk.after_count).toBe(3);
    expect(hunk.header).toBe("");
    expect(hunk.lines).toEqual([
      { kind: "context", content: "context-a", before_lineno: 10, after_lineno: 10 },
      { kind: "remove", content: "removed", before_lineno: 11, after_lineno: null },
      { kind: "add", content: "added", before_lineno: null, after_lineno: 11 },
      { kind: "context", content: "context-b", before_lineno: 12, after_lineno: 12 },
    ]);
  });

  test("skips the `\\ No newline at end of file` sentinel", () => {
    const patch: EditPatchHunk[] = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ["-old", "\\ No newline at end of file", "+new"],
      },
    ];
    const [hunk] = structuredPatchToHunks(patch);
    expect(hunk.lines.map((l) => l.kind)).toEqual(["remove", "add"]);
  });

  test("converts every hunk of a multi-hunk patch", () => {
    const patch: EditPatchHunk[] = [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+A"] },
      { oldStart: 50, oldLines: 1, newStart: 50, newLines: 1, lines: ["-a", "+A"] },
    ];
    const hunks = structuredPatchToHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].before_start).toBe(50);
    expect(hunks[1].lines[0]).toEqual({
      kind: "remove",
      content: "a",
      before_lineno: 50,
      after_lineno: null,
    });
  });
});

// ---------------------------------------------------------------------------
// composeEditDiffData
// ---------------------------------------------------------------------------

describe("composeEditDiffData", () => {
  test("uses structuredPatch as the primary source — DiffData{source:'hunks'}", () => {
    const data = composeEditDiffData(
      { file_path: "/a/b.ts" },
      {
        filePath: "/a/b.ts",
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-x", "+y"] },
        ],
      },
    );
    expect(data).toEqual({
      source: "hunks",
      filePath: "/a/b.ts",
      hunks: structuredPatchToHunks([
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-x", "+y"] },
      ]),
    });
  });

  test("a replace_all edit's structuredPatch carries every changed hunk", () => {
    // `replace_all` that touched 3 occurrences → 3 hunks. The wrapper
    // does not branch on `replace_all`: structuredPatch already IS the
    // full-file diff, so all three hunks flow straight through.
    const patch: EditPatchHunk[] = [
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-old", "+new"] },
      { oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ["-old", "+new"] },
      { oldStart: 88, oldLines: 1, newStart: 88, newLines: 1, lines: ["-old", "+new"] },
    ];
    const data = composeEditDiffData(
      { file_path: "/a/b.ts", old_string: "old", new_string: "new", replace_all: true },
      { filePath: "/a/b.ts", structuredPatch: patch },
    );
    expect(data?.source).toBe("hunks");
    expect(data?.source === "hunks" ? data.hunks : []).toHaveLength(3);
  });

  test("falls back to two-text from (old_string, new_string) when no structuredPatch", () => {
    const data = composeEditDiffData(
      { file_path: "/a/b.ts", old_string: "before", new_string: "after" },
      {},
    );
    expect(data).toEqual({
      source: "two-text",
      before: "before",
      after: "after",
      filePath: "/a/b.ts",
    });
  });

  test("the structured result's oldString/newString/filePath win over the input", () => {
    const data = composeEditDiffData(
      { file_path: "/from/input.ts", old_string: "input-old", new_string: "input-new" },
      { filePath: "/from/structured.ts", oldString: "struct-old", newString: "struct-new" },
    );
    expect(data).toEqual({
      source: "two-text",
      before: "struct-old",
      after: "struct-new",
      filePath: "/from/structured.ts",
    });
  });

  test("an empty filePath collapses to undefined (no empty header label)", () => {
    const data = composeEditDiffData(
      { old_string: "a", new_string: "b" },
      {},
    );
    expect(data).toEqual({ source: "two-text", before: "a", after: "b", filePath: undefined });
  });

  test("returns undefined when there is nothing to diff", () => {
    expect(composeEditDiffData({}, {})).toBeUndefined();
    expect(composeEditDiffData({ file_path: "/a/b.ts" }, {})).toBeUndefined();
    // old_string without new_string is not a diff.
    expect(composeEditDiffData({ old_string: "a" }, {})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeEditChangeCounts
// ---------------------------------------------------------------------------

describe("composeEditChangeCounts", () => {
  test("counts add / remove lines across all hunks of a 'hunks' DiffData", () => {
    const data = composeEditDiffData(
      {},
      {
        structuredPatch: [
          { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [" ctx", "-r", "+a1", "+a2"] },
          { oldStart: 9, oldLines: 1, newStart: 10, newLines: 0, lines: ["-r"] },
        ],
      },
    );
    expect(composeEditChangeCounts(data)).toEqual({ added: 2, removed: 2 });
  });

  test("returns undefined for the two-text fallback (counts unknown wrapper-side)", () => {
    const data = composeEditDiffData({ old_string: "a", new_string: "b" }, {});
    expect(composeEditChangeCounts(data)).toBeUndefined();
  });

  test("returns undefined when there is no diff data", () => {
    expect(composeEditChangeCounts(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MultiEdit → Edit dispatch alias
// ---------------------------------------------------------------------------

describe("MultiEdit alias", () => {
  test("MultiEdit (any casing) resolves to the real EditToolBlock", () => {
    // Self-contained: register the real wrapper, then resolve through
    // the `multiedit → edit` alias. Independent of module-load order.
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("edit", EditToolBlock);
    expect(resolveToolWrapper("edit")).toBe(EditToolBlock);
    expect(resolveToolWrapper("Edit")).toBe(EditToolBlock);
    expect(resolveToolWrapper("MultiEdit")).toBe(EditToolBlock);
    expect(resolveToolWrapper("multiedit")).toBe(EditToolBlock);
    expect(resolveToolWrapper("MULTIEDIT")).toBe(EditToolBlock);
  });
});
