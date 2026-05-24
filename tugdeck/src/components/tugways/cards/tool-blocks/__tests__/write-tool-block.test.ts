/**
 * Pure-logic tests for `WriteToolBlock`'s wire-narrowing helpers,
 * file-data composition, header chip text, and dispatch routing.
 *
 * The wrapper itself is decoration over composition (`ToolBlockChrome`
 * + `embedded` `FileBlock` + `MiddleEllipsisPath`) — its behaviour
 * *is* the exported pure helpers:
 *
 *  - `narrowWriteInput` / `narrowWriteStructured` — defensive
 *    narrowing of the wire props.
 *  - `composeWriteFileData` — `(input, structured)` → `FileData`,
 *    with the structured value preferred over the input.
 *  - `composeWriteSizeLabel` — header `{N} lines` chip text.
 *  - `composeWriteCreatedLabel` — header `new` / `overwrite` chip.
 *  - The dispatch routes `Write` to the real `WriteToolBlock` (via
 *    `BESPOKE_FACTORY_BY_NAME`).
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  WriteToolBlock,
  composeWriteCreatedLabel,
  composeWriteFileData,
  composeWriteSizeLabel,
  narrowWriteInput,
  narrowWriteStructured,
} from "../write-tool-block";
import { BESPOKE_FACTORY_BY_NAME } from "../../tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// narrowWriteInput / narrowWriteStructured
// ---------------------------------------------------------------------------

describe("narrowWriteInput", () => {
  test("keeps the wire fields when well-typed", () => {
    expect(
      narrowWriteInput({
        file_path: "/tmp/hello.txt",
        content: "hello world",
      }),
    ).toEqual({
      file_path: "/tmp/hello.txt",
      content: "hello world",
    });
  });

  test("drops mistyped fields and tolerates non-objects", () => {
    expect(narrowWriteInput({ file_path: 42, content: ["bad"] })).toEqual({
      file_path: undefined,
      content: undefined,
    });
    expect(narrowWriteInput(null)).toEqual({});
    expect(narrowWriteInput("nope")).toEqual({});
    expect(narrowWriteInput(undefined)).toEqual({});
  });
});

describe("narrowWriteStructured", () => {
  test("keeps the wire fields when well-typed", () => {
    expect(
      narrowWriteStructured({
        filePath: "/tmp/hello.txt",
        content: "hello world",
        created: true,
      }),
    ).toEqual({
      filePath: "/tmp/hello.txt",
      content: "hello world",
      created: true,
    });
  });

  test("drops mistyped fields and tolerates non-objects", () => {
    expect(narrowWriteStructured({ created: "yes" })).toEqual({
      filePath: undefined,
      content: undefined,
      created: undefined,
    });
    expect(narrowWriteStructured(null)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// composeWriteFileData
// ---------------------------------------------------------------------------

describe("composeWriteFileData", () => {
  test("prefers the structured filePath + content over the input", () => {
    expect(
      composeWriteFileData(
        { file_path: "/tmp/from-input", content: "from input" },
        { filePath: "/tmp/from-structured", content: "from structured" },
      ),
    ).toEqual({
      filePath: "/tmp/from-structured",
      content: "from structured",
    });
  });

  test("falls back to the input when structured is missing fields", () => {
    expect(
      composeWriteFileData(
        { file_path: "/tmp/x", content: "from input" },
        {},
      ),
    ).toEqual({ filePath: "/tmp/x", content: "from input" });
  });

  test("returns undefined when neither side has content", () => {
    expect(
      composeWriteFileData({ file_path: "/tmp/x" }, {}),
    ).toBeUndefined();
  });

  test("uses empty-string path when both sides omit it", () => {
    expect(
      composeWriteFileData({ content: "x" }, {}),
    ).toEqual({ filePath: "", content: "x" });
  });
});

// ---------------------------------------------------------------------------
// composeWriteSizeLabel
// ---------------------------------------------------------------------------

describe("composeWriteSizeLabel", () => {
  test("pluralizes", () => {
    expect(composeWriteSizeLabel("")).toBe("0 lines");
    expect(composeWriteSizeLabel("hello")).toBe("1 line");
    expect(composeWriteSizeLabel("hello\nworld")).toBe("2 lines");
    expect(composeWriteSizeLabel("a\nb\nc\nd\ne")).toBe("5 lines");
  });

  test("undefined when there is no content", () => {
    expect(composeWriteSizeLabel(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeWriteCreatedLabel
// ---------------------------------------------------------------------------

describe("composeWriteCreatedLabel", () => {
  test("created=true → 'new'", () => {
    expect(composeWriteCreatedLabel(true)).toBe("new");
  });

  test("created=false → 'overwrite'", () => {
    expect(composeWriteCreatedLabel(false)).toBe("overwrite");
  });

  test("undefined → undefined (chip suppressed)", () => {
    expect(composeWriteCreatedLabel(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing — Write → WriteToolBlock
// ---------------------------------------------------------------------------

describe("Write dispatch routing", () => {
  test("BESPOKE_FACTORY_BY_NAME maps write to WriteToolBlock", () => {
    expect(BESPOKE_FACTORY_BY_NAME.get("write")).toBe(WriteToolBlock);
  });
});
