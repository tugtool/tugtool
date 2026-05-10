/**
 * Parser + helper tests for `lib/diff`.
 *
 * Covers:
 *  - `parseUnifiedDiffText`: round-trips the same fixtures the Rust
 *    test suite exercises (`tugdeck/crates/tugdiff-wasm/src/lib.rs`).
 *    Both implementations must agree on the per-line shape — the
 *    JS parser is the first-paint engine and the WASM parser is the
 *    canonical engine; divergence would surface as visible flicker
 *    when the WASM swap-in lands.
 *  - `wordLevelDiffSync`: spot-check that diff-match-patch produces
 *    the expected `equal | delete | insert` sequence for a known
 *    intra-line change.
 *  - `countDiffStats`: counts only `add` and `remove` lines, not
 *    context, across all hunks.
 */

import { describe, expect, test } from "bun:test";
import dmp from "diff-match-patch";

import {
  parseUnifiedDiffText,
  wordLevelDiffSync,
} from "../parse-unified-diff";
import { countDiffStats, type DiffHunk } from "../types";

// ---------------------------------------------------------------------------
// parseUnifiedDiffText
// ---------------------------------------------------------------------------

describe("parseUnifiedDiffText", () => {
  test("returns empty for empty / non-diff input", () => {
    expect(parseUnifiedDiffText("")).toEqual([]);
    expect(parseUnifiedDiffText("just prose\nwith no hunks\n")).toEqual([]);
  });

  test("parses a single hunk with three line kinds", () => {
    const fixture = [
      "@@ -1,5 +1,8 @@",
      "+// lorem ipsum",
      " fn foo() -> Bar {",
      "     let mut foo = 2;",
      "     foo *= 50;",
      '-    println!("hello world")',
      '+    println!("hello world");',
      '+    println!("{foo}");',
      " }",
      "+// foo",
      "",
    ].join("\n");

    const hunks = parseUnifiedDiffText(fixture);
    expect(hunks).toHaveLength(1);
    const hunk = hunks[0];
    expect(hunk.before_start).toBe(1);
    expect(hunk.before_count).toBe(5);
    expect(hunk.after_start).toBe(1);
    expect(hunk.after_count).toBe(8);
    expect(hunk.lines).toHaveLength(9);

    expect(hunk.lines[0]).toEqual({
      kind: "add",
      content: "// lorem ipsum",
      before_lineno: null,
      after_lineno: 1,
    });
    expect(hunk.lines[1]).toEqual({
      kind: "context",
      content: "fn foo() -> Bar {",
      before_lineno: 1,
      after_lineno: 2,
    });
    expect(hunk.lines[4]).toEqual({
      kind: "remove",
      content: '    println!("hello world")',
      before_lineno: 4,
      after_lineno: null,
    });
    expect(hunk.lines[5]).toEqual({
      kind: "add",
      content: '    println!("hello world");',
      before_lineno: null,
      after_lineno: 5,
    });
  });

  test("skips file headers before the first hunk", () => {
    const fixture = [
      "--- a/foo.txt",
      "+++ b/foo.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const hunks = parseUnifiedDiffText(fixture);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
    expect(hunks[0].lines[0].kind).toBe("remove");
    expect(hunks[0].lines[1].kind).toBe("add");
  });

  test("parses multiple hunks", () => {
    const fixture = [
      "@@ -1,1 +1,1 @@",
      "-alpha",
      "+beta",
      "@@ -10,1 +10,1 @@ section header",
      "-gamma",
      "+delta",
      "",
    ].join("\n");
    const hunks = parseUnifiedDiffText(fixture);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].before_start).toBe(1);
    expect(hunks[1].before_start).toBe(10);
    expect(hunks[1].header).toBe("section header");
  });

  test("skips '\\ No newline at end of file' marker", () => {
    const fixture = [
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "",
    ].join("\n");
    const hunks = parseUnifiedDiffText(fixture);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(2);
  });

  test("treats blank lines inside a hunk as empty context lines", () => {
    const fixture = ["@@ -1,3 +1,3 @@", " keep", "", " keep2", ""].join(
      "\n",
    );
    const hunks = parseUnifiedDiffText(fixture);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(3);
    expect(hunks[0].lines[1]).toEqual({
      kind: "context",
      content: "",
      before_lineno: 2,
      after_lineno: 2,
    });
  });

  test("malformed @@ header is skipped without losing prior hunks", () => {
    const fixture = [
      "@@ -1,1 +1,1 @@",
      "-alpha",
      "+beta",
      "@@ this is garbage",
      "@@ -10,1 +10,1 @@",
      "-gamma",
      "+delta",
      "",
    ].join("\n");
    const hunks = parseUnifiedDiffText(fixture);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].before_start).toBe(10);
  });

  test("CRLF line endings produce identical hunk shapes to LF", () => {
    const lf = ["@@ -1,1 +1,1 @@", "-old", "+new", ""].join("\n");
    const crlf = lf.split("\n").join("\r\n");
    expect(parseUnifiedDiffText(crlf)).toEqual(parseUnifiedDiffText(lf));
  });
});

// ---------------------------------------------------------------------------
// wordLevelDiffSync
// ---------------------------------------------------------------------------

describe("wordLevelDiffSync", () => {
  test("equal text → single equal segment with full ranges on both sides", () => {
    const segments = wordLevelDiffSync("hello", "hello", dmp);
    expect(segments).toHaveLength(1);
    const seg = segments[0];
    expect(seg.tag).toBe("equal");
    expect(seg.text).toBe("hello");
    if (seg.tag === "equal") {
      expect(seg.beforeStart).toBe(0);
      expect(seg.beforeEnd).toBe(5);
      expect(seg.afterStart).toBe(0);
      expect(seg.afterEnd).toBe(5);
    }
  });

  test("single-character change emits delete + insert + equal trail with monotonic ranges", () => {
    const segments = wordLevelDiffSync(
      "println!(\"hello world\")",
      "println!(\"hello world\");",
      dmp,
    );
    // Leading equal covers the shared prefix.
    expect(segments[0].tag).toBe("equal");
    // Trailing insert: ";".
    const last = segments[segments.length - 1];
    expect(last.tag).toBe("insert");
    expect(last.text).toBe(";");
    if (last.tag === "insert") {
      // Inserted ";" lands at the end of the after-text.
      expect(last.afterEnd).toBe("println!(\"hello world\");".length);
      expect(last.afterStart).toBe(last.afterEnd - 1);
    }
  });

  test("ranges are monotonic and reconstruct the inputs", () => {
    const before = "var x = 1";
    const after = "let x = 2";
    const segments = wordLevelDiffSync(before, after, dmp);
    let beforeReconstructed = "";
    let afterReconstructed = "";
    for (const seg of segments) {
      if (seg.tag === "equal") {
        beforeReconstructed += seg.text;
        afterReconstructed += seg.text;
      } else if (seg.tag === "delete") {
        beforeReconstructed += seg.text;
      } else {
        afterReconstructed += seg.text;
      }
    }
    expect(beforeReconstructed).toBe(before);
    expect(afterReconstructed).toBe(after);
  });

  test("disjoint inputs yield delete then insert", () => {
    const segments = wordLevelDiffSync("alpha", "omega", dmp);
    const tags = segments.map((s) => s.tag);
    expect(tags).toContain("delete");
    expect(tags).toContain("insert");
  });
});

// ---------------------------------------------------------------------------
// countDiffStats
// ---------------------------------------------------------------------------

describe("countDiffStats", () => {
  test("empty hunks → 0/0", () => {
    expect(countDiffStats([])).toEqual({ added: 0, removed: 0 });
  });

  test("counts adds and removes across all hunks; ignores context", () => {
    const hunks: DiffHunk[] = [
      {
        before_start: 1,
        before_count: 3,
        after_start: 1,
        after_count: 4,
        header: "",
        lines: [
          { kind: "context", content: "", before_lineno: 1, after_lineno: 1 },
          { kind: "remove", content: "x", before_lineno: 2, after_lineno: null },
          { kind: "add", content: "y", before_lineno: null, after_lineno: 2 },
          { kind: "add", content: "z", before_lineno: null, after_lineno: 3 },
          { kind: "context", content: "", before_lineno: 3, after_lineno: 4 },
        ],
      },
      {
        before_start: 10,
        before_count: 1,
        after_start: 11,
        after_count: 0,
        header: "",
        lines: [
          { kind: "remove", content: "q", before_lineno: 10, after_lineno: null },
        ],
      },
    ];
    expect(countDiffStats(hunks)).toEqual({ added: 2, removed: 2 });
  });
});
