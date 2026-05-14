/**
 * Pure-logic tests for `GrepToolBlock`'s wire-narrowing helpers, the
 * content-mode / files-only-mode body selection, and the `Grep`
 * dispatch routing.
 *
 * The wrapper component itself is decoration over composition
 * (`ToolWrapperChrome` + an `embedded` `SearchResultBlock` or
 * `PathListBlock`) — its behaviour *is* the exported pure helpers:
 *
 *  - `narrowGrepInput` / `narrowGrepStructured` — defensive narrowing
 *    of the `unknown` wire props.
 *  - `composeGrepMode` — picks the body kind from the result shape:
 *    `files` → content mode, `filenames` → files-only mode.
 *  - `composeGrepSearchData` — `structured_result` → `SearchResultData`
 *    (content mode); deep-narrows per-file / per-match wire shapes.
 *  - `composeGrepPathListData` — `structured_result` → `PathListData`
 *    (files-only mode); mirrors `GlobToolBlock`.
 *  - `composeGrepMatchCountLabel` / `composeGrepFileCountLabel` — the
 *    header `{N} matches` / `{M} files` badges.
 *  - the dispatch routes `Grep` (any casing) to the real
 *    `GrepToolBlock`.
 *
 * The two synthetic-fixture tests are the [#step-16] gates: a content-
 * mode Grep result narrows to a grouped `SearchResultData`, and a
 * files-only-mode result narrows to a `PathListData`.
 *
 * No DOM: per the project's testing policy these are `bun:test`
 * pure-logic assertions, not fake-DOM render tests.
 */

import { describe, expect, test } from "bun:test";

import {
  GrepToolBlock,
  composeGrepFileCountLabel,
  composeGrepMatchCountLabel,
  composeGrepMode,
  composeGrepPathListData,
  composeGrepSearchData,
  narrowGrepInput,
  narrowGrepStructured,
  type GrepStructuredResult,
} from "../grep-tool-block";
import {
  _resetToolWrapperRegistryForTests,
  registerToolWrapper,
  resolveToolWrapper,
} from "../../tide-assistant-renderer-dispatch";

// ---------------------------------------------------------------------------
// Synthetic fixtures — the catalog has no Grep probe, so [#step-16]
// specifies synthetic content-mode / files-only-mode results.
// ---------------------------------------------------------------------------

/** Content-mode Grep result — per-file grouped matches with spans + context. */
const CONTENT_FIXTURE: unknown = {
  mode: "content",
  numFiles: 2,
  numMatches: 3,
  truncated: false,
  files: [
    {
      path: "src/alpha.ts",
      matches: [
        {
          line: 12,
          text: "const useStore = createStore();",
          spans: [[6, 14]],
          before: [{ line: 11, text: "// store wiring" }],
          after: [{ line: 13, text: "export { useStore };" }],
        },
        {
          line: 40,
          text: "useStore.subscribe(listener);",
          spans: [[0, 8]],
        },
      ],
    },
    {
      path: "src/beta.ts",
      matches: [
        {
          line: 5,
          text: "import { useStore } from './alpha';",
          spans: [[9, 17]],
        },
      ],
    },
  ],
};

/** Files-only-mode Grep result — the `output_mode: files_with_matches` shape. */
const FILES_FIXTURE: unknown = {
  mode: "files_with_matches",
  numFiles: 2,
  truncated: false,
  filenames: ["src/alpha.ts", "src/beta.ts"],
};

// ---------------------------------------------------------------------------
// narrowGrepInput
// ---------------------------------------------------------------------------

describe("narrowGrepInput", () => {
  test("keeps the wire fields when well-typed (output_mode → outputMode)", () => {
    expect(
      narrowGrepInput({
        pattern: "useStore",
        path: "/repo/src",
        glob: "*.ts",
        output_mode: "content",
      }),
    ).toEqual({
      pattern: "useStore",
      path: "/repo/src",
      glob: "*.ts",
      outputMode: "content",
    });
  });

  test("drops mistyped fields and tolerates non-objects", () => {
    expect(narrowGrepInput({ pattern: 42, glob: ["x"] })).toEqual({
      pattern: undefined,
      path: undefined,
      glob: undefined,
      outputMode: undefined,
    });
    expect(narrowGrepInput(null)).toEqual({});
    expect(narrowGrepInput("nope")).toEqual({});
    expect(narrowGrepInput(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// narrowGrepStructured
// ---------------------------------------------------------------------------

describe("narrowGrepStructured", () => {
  test("narrows a content-mode result", () => {
    const result = narrowGrepStructured(CONTENT_FIXTURE);
    expect(result.mode).toBe("content");
    expect(result.numFiles).toBe(2);
    expect(result.numMatches).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.files?.length).toBe(2);
    expect(result.files?.[0].path).toBe("src/alpha.ts");
    expect(result.files?.[0].matches?.length).toBe(2);
    // `filenames` is absent in content mode.
    expect(result.filenames).toBeUndefined();
  });

  test("narrows a files-only-mode result", () => {
    const result = narrowGrepStructured(FILES_FIXTURE);
    expect(result.filenames).toEqual(["src/alpha.ts", "src/beta.ts"]);
    expect(result.numFiles).toBe(2);
    // `files` is absent in files-only mode.
    expect(result.files).toBeUndefined();
  });

  test("filters junk entries out of files and filenames", () => {
    const result = narrowGrepStructured({
      files: [{ path: "ok.ts" }, null, 7, "nope"],
      filenames: ["a.ts", 3, null, "b.ts"],
    });
    expect(result.files?.length).toBe(1);
    expect(result.files?.[0].path).toBe("ok.ts");
    expect(result.filenames).toEqual(["a.ts", "b.ts"]);
  });

  test("tolerates non-objects", () => {
    expect(narrowGrepStructured(null)).toEqual({});
    expect(narrowGrepStructured("nope")).toEqual({});
    expect(narrowGrepStructured(undefined)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// composeGrepMode
// ---------------------------------------------------------------------------

describe("composeGrepMode", () => {
  test("files present → content mode", () => {
    expect(composeGrepMode({ files: [] })).toBe("content");
  });

  test("filenames present (no files) → files mode", () => {
    expect(composeGrepMode({ filenames: [] })).toBe("files");
  });

  test("files wins when both are present", () => {
    expect(composeGrepMode({ files: [], filenames: [] })).toBe("content");
  });

  test("neither present → undefined (drift / streaming)", () => {
    expect(composeGrepMode({})).toBeUndefined();
    expect(composeGrepMode({ numFiles: 3 })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeGrepSearchData
// ---------------------------------------------------------------------------

describe("composeGrepSearchData", () => {
  test("a content-mode result composes grouped files with no truncation", () => {
    const data = composeGrepSearchData(narrowGrepStructured(CONTENT_FIXTURE));
    expect(data).toBeDefined();
    if (data === undefined) throw new Error("unreachable");
    expect(data.truncatedAt).toBeUndefined();
    expect(data.files.map((f) => f.path)).toEqual([
      "src/alpha.ts",
      "src/beta.ts",
    ]);
    expect(data.files[0].matches.length).toBe(2);
    const firstMatch = data.files[0].matches[0];
    expect(firstMatch.line).toBe(12);
    expect(firstMatch.spans).toEqual([[6, 14]]);
    expect(firstMatch.before).toEqual([{ line: 11, text: "// store wiring" }]);
    expect(firstMatch.after).toEqual([
      { line: 13, text: "export { useStore };" },
    ]);
    // The second match has no context — `before` / `after` stay undefined.
    expect(data.files[0].matches[1].before).toBeUndefined();
    expect(data.files[0].matches[1].after).toBeUndefined();
  });

  test("a truncated result carries numFiles as the truncatedAt total", () => {
    const data = composeGrepSearchData(
      narrowGrepStructured({
        files: [{ path: "a.ts", matches: [] }],
        numFiles: 80,
        truncated: true,
      }),
    );
    expect(data?.truncatedAt).toBe(80);
  });

  test("drops files with no path and matches with bad shapes / junk spans", () => {
    const data = composeGrepSearchData(
      narrowGrepStructured({
        files: [
          { matches: [] }, // no path → dropped
          {
            path: "real.ts",
            matches: [
              { line: 1, text: "ok", spans: [[0, 2], "junk", [1]] },
              { line: "bad", text: "x" }, // bad line type → dropped
              { text: "no line" }, // missing line → dropped
            ],
          },
        ],
      }),
    );
    expect(data?.files.length).toBe(1);
    expect(data?.files[0].path).toBe("real.ts");
    expect(data?.files[0].matches.length).toBe(1);
    // Only the well-typed `[0, 2]` span survives the narrowing.
    expect(data?.files[0].matches[0].spans).toEqual([[0, 2]]);
  });

  test("an empty files array still composes a zero-file result", () => {
    expect(composeGrepSearchData({ files: [] })).toEqual({
      files: [],
      truncatedAt: undefined,
    });
  });

  test("no files array at all composes undefined (files-only mode / drift)", () => {
    expect(composeGrepSearchData({ filenames: ["a.ts"] })).toBeUndefined();
    expect(composeGrepSearchData({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeGrepPathListData
// ---------------------------------------------------------------------------

describe("composeGrepPathListData", () => {
  test("a files-only-mode result composes a PathListData", () => {
    expect(
      composeGrepPathListData(narrowGrepStructured(FILES_FIXTURE)),
    ).toEqual({
      paths: ["src/alpha.ts", "src/beta.ts"],
      truncatedAt: undefined,
    });
  });

  test("a truncated files-only result carries the truncatedAt total", () => {
    expect(
      composeGrepPathListData({
        filenames: ["a.ts", "b.ts"],
        numFiles: 100,
        truncated: true,
      }),
    ).toEqual({ paths: ["a.ts", "b.ts"], truncatedAt: 100 });
  });

  test("no filenames array composes undefined (content mode / drift)", () => {
    expect(composeGrepPathListData({ files: [] })).toBeUndefined();
    expect(composeGrepPathListData({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// composeGrepMatchCountLabel / composeGrepFileCountLabel
// ---------------------------------------------------------------------------

describe("composeGrepMatchCountLabel", () => {
  test("prefers numMatches and pluralizes", () => {
    expect(composeGrepMatchCountLabel({ numMatches: 0 })).toBe("0 matches");
    expect(composeGrepMatchCountLabel({ numMatches: 1 })).toBe("1 match");
    expect(composeGrepMatchCountLabel({ numMatches: 12 })).toBe("12 matches");
  });

  test("falls back to summing per-file match counts in content mode", () => {
    const structured: GrepStructuredResult = {
      files: [
        { path: "a.ts", matches: [{}, {}] },
        { path: "b.ts", matches: [{}] },
      ],
    };
    expect(composeGrepMatchCountLabel(structured)).toBe("3 matches");
  });

  test("undefined when no match count is knowable (files-only mode)", () => {
    expect(composeGrepMatchCountLabel({ filenames: ["a.ts"] })).toBeUndefined();
    expect(composeGrepMatchCountLabel({})).toBeUndefined();
  });
});

describe("composeGrepFileCountLabel", () => {
  test("prefers numFiles and pluralizes", () => {
    expect(composeGrepFileCountLabel({ numFiles: 0 })).toBe("0 files");
    expect(composeGrepFileCountLabel({ numFiles: 1 })).toBe("1 file");
    expect(composeGrepFileCountLabel({ numFiles: 3 })).toBe("3 files");
  });

  test("falls back to the files length, then the filenames length", () => {
    expect(
      composeGrepFileCountLabel({ files: [{ path: "a.ts" }, { path: "b.ts" }] }),
    ).toBe("2 files");
    expect(composeGrepFileCountLabel({ filenames: ["a.ts"] })).toBe("1 file");
  });

  test("undefined when no file count is knowable", () => {
    expect(composeGrepFileCountLabel({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Synthetic-fixture gates — [#step-16]
// ---------------------------------------------------------------------------

describe("synthetic Grep fixture — content mode → SearchResultBlock", () => {
  test("the content-mode fixture narrows to a grouped SearchResultData", () => {
    const structured = narrowGrepStructured(CONTENT_FIXTURE);
    expect(composeGrepMode(structured)).toBe("content");

    const searchData = composeGrepSearchData(structured);
    expect(searchData).toBeDefined();
    if (searchData === undefined) throw new Error("unreachable");
    // Two files, three matches grouped under them — the shape
    // `SearchResultBlock` renders as collapsible file groups.
    expect(searchData.files.length).toBe(2);
    expect(
      searchData.files.reduce((sum, f) => sum + f.matches.length, 0),
    ).toBe(3);

    // The header badges reflect the same counts.
    expect(composeGrepMatchCountLabel(structured)).toBe("3 matches");
    expect(composeGrepFileCountLabel(structured)).toBe("2 files");
  });
});

describe("synthetic Grep fixture — files-only mode → PathListBlock", () => {
  test("the files-only-mode fixture narrows to a PathListData", () => {
    const structured = narrowGrepStructured(FILES_FIXTURE);
    expect(composeGrepMode(structured)).toBe("files");

    const pathListData = composeGrepPathListData(structured);
    expect(pathListData).toEqual({
      paths: ["src/alpha.ts", "src/beta.ts"],
      truncatedAt: undefined,
    });

    // No match count in files-only mode; the file count still shows.
    expect(composeGrepMatchCountLabel(structured)).toBeUndefined();
    expect(composeGrepFileCountLabel(structured)).toBe("2 files");
  });
});

// ---------------------------------------------------------------------------
// Dispatch routing — Grep → GrepToolBlock
// ---------------------------------------------------------------------------

describe("Grep dispatch routing", () => {
  test("resolveToolWrapper routes Grep (any casing) to GrepToolBlock", () => {
    // Re-establish a hermetic registry so this assertion is
    // independent of module-load order.
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("grep", GrepToolBlock);
    expect(resolveToolWrapper("grep")).toBe(GrepToolBlock);
    expect(resolveToolWrapper("Grep")).toBe(GrepToolBlock);
    expect(resolveToolWrapper("GREP")).toBe(GrepToolBlock);
  });
});
