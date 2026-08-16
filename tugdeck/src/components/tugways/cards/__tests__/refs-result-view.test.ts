/**
 * refs-result-view — the pure projection from a run's numbered `TextRef[]`
 * to the body kind that renders it, and to the text Share carries.
 *
 * The load-bearing property is [P15]: every path that leaves this module is
 * absolute. A relative path renders perfectly and then silently does not
 * open, so the failure has no visible symptom until someone clicks.
 */
import { describe, expect, it } from "bun:test";

import {
  composeRefsCopyText,
  composeRefsShareText,
  joinRefPath,
  refsFindablePaths,
  refsToPathListData,
  refsToSearchResultData,
} from "@/components/tugways/cards/refs-result-view";
import { composeContextPrefix, splitLeadingContext } from "@/lib/pending-context-store";
import { parseLinePreview } from "@/lib/refs-session-store";
import type { RefsResultMessage, TextRef } from "@/lib/code-session-store/types";

/**
 * A wire ref. `preview` is written as the plain line these fixtures mean;
 * `parseLinePreview` turns it into the one full-width window the wire's
 * older shape decodes to, so a test says what it is testing rather than
 * spelling out a windowed preview it does not care about.
 */
function ref(
  over: Partial<Omit<TextRef, "preview">> & {
    index: number;
    path: string;
    preview?: string;
  },
): TextRef {
  const { preview, ...rest } = over;
  return {
    line: null,
    columns: [],
    preview: preview === undefined ? null : parseLinePreview(preview),
    ...rest,
  };
}

function message(over: Partial<RefsResultMessage> = {}): RefsResultMessage {
  return {
    kind: "refs_result",
    messageKey: "m1",
    createdAt: 1000,
    runId: "r1",
    opKind: "search",
    command: "/search foo",
    root: "/proj",
    refs: [],
    inFlight: false,
    cancelled: false,
    notice: null,
    startedAtMs: 1000,
    settledAtMs: 1200,
    ...over,
  } as RefsResultMessage;
}

describe("joinRefPath — the wire is relative, the view is absolute ([P15])", () => {
  it("joins a relative path onto the run's root", () => {
    expect(joinRefPath("/proj", "src/a.ts")).toBe("/proj/src/a.ts");
  });

  it("tolerates a trailing slash on the root without doubling it", () => {
    expect(joinRefPath("/proj/", "src/a.ts")).toBe("/proj/src/a.ts");
  });

  it("leaves an already-absolute path alone", () => {
    expect(joinRefPath("/proj", "/elsewhere/a.ts")).toBe("/elsewhere/a.ts");
  });

  it("leaves the path alone when there is no root, rather than inventing one", () => {
    // A restore with no project dir: un-annotated is honest, a fabricated
    // absolute path is not.
    expect(joinRefPath("", "src/a.ts")).toBe("src/a.ts");
  });
});

describe("refsToPathListData — a match run's rows", () => {
  it("emits absolute paths in emission order", () => {
    const data = refsToPathListData("/proj", [
      ref({ index: 1, path: "src/b.ts" }),
      ref({ index: 2, path: "src/a.ts" }),
    ]);
    expect(data.paths).toEqual(["/proj/src/b.ts", "/proj/src/a.ts"]);
  });

  it("carries each ref's number alongside its path", () => {
    const data = refsToPathListData("/proj", [
      ref({ index: 4, path: "src/b.ts" }),
      ref({ index: 5, path: "src/a.ts" }),
    ]);
    expect(data.numbers).toEqual([4, 5]);
  });
});

describe("refsToSearchResultData — a search run's groups", () => {
  const refs = [
    ref({ index: 1, path: "src/a.ts", line: 4, preview: "foo one", columns: [[0, 3]] }),
    ref({ index: 2, path: "src/b.ts", line: 9, preview: "foo two", columns: [[0, 3]] }),
    ref({ index: 3, path: "src/a.ts", line: 12, preview: "foo three", columns: [[0, 3]] }),
  ];

  it("groups by file in first-appearance order, never renumbering ([P12])", () => {
    const data = refsToSearchResultData("/proj", refs);
    expect(data.files.map((f) => f.path)).toEqual(["/proj/src/a.ts", "/proj/src/b.ts"]);
    // Ref 3 joins ref 1's group; the emission order inside the group holds.
    expect(data.files[0].matches.map((m) => m.line)).toEqual([4, 12]);
  });

  it("passes column spans through unchanged ([P14])", () => {
    const spans = [
      [2, 5],
      [14, 20],
    ] as ReadonlyArray<readonly [number, number]>;
    const data = refsToSearchResultData("/proj", [
      ref({ index: 1, path: "a.ts", line: 1, preview: "x", columns: spans }),
    ]);
    expect(data.files[0].matches[0].spans).toEqual(spans);
  });

  it("renders a ref with no line or preview without inventing either", () => {
    const data = refsToSearchResultData("/proj", [ref({ index: 1, path: "a.ts" })]);
    expect(data.files[0].matches[0]).toEqual({
      line: 0,
      preview: { lineLength: 0, windows: [] },
      spans: [],
      refNumber: 1,
    });
  });

  it("carries the wire's windows through as the match's preview", () => {
    // A hit inside a minified line: the feed sent a window that starts 300
    // chars in, and the block has to be told where it starts or it cannot
    // place the span that lands in it.
    const data = refsToSearchResultData("/proj", [
      {
        index: 1,
        path: "bundle.js",
        line: 1,
        columns: [[310, 316]],
        preview: {
          lineLen: 9000,
          segments: [{ col: 278, text: "…thirty-two chars…needle…and more" }],
          elidedMatches: 2,
        },
      },
    ]);
    const match = data.files[0].matches[0];
    expect(match.preview.lineLength).toBe(9000);
    expect(match.preview.windows).toEqual([
      { col: 278, text: "…thirty-two chars…needle…and more" },
    ]);
    expect(match.preview.elidedMatches).toBe(2);
    // And the spans stay in whole-line coordinates ([P14]) — they are what
    // the editor's reveal reads, so a rebase here would land the cursor 278
    // chars early.
    expect(match.spans).toEqual([[310, 316]]);
  });

  it("carries each ref's number, so the row shows what `/ref N` opens", () => {
    // Not the position in the group — the ref's own number. Ref 3 is the
    // SECOND row of the first file's group, and it still reads 3.
    const data = refsToSearchResultData("/proj", refs);
    expect(data.files[0].matches.map((m) => m.refNumber)).toEqual([1, 3]);
    expect(data.files[1].matches.map((m) => m.refNumber)).toEqual([2]);
  });
});

describe("refsFindablePaths — the projection half of transcript Find", () => {
  it("gives one path per row for a match run, as the row DRAWS it", () => {
    // Workspace-relative, because that is the text on screen — Find searches
    // what the reader sees, not the payload behind it.
    const msg = message({
      opKind: "match",
      refs: [ref({ index: 1, path: "a.ts" }), ref({ index: 2, path: "b.ts" })],
    });
    expect(refsFindablePaths(msg)).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps a path from outside the root whole", () => {
    const msg = message({
      opKind: "match",
      refs: [ref({ index: 1, path: "/elsewhere/a.ts" })],
    });
    expect(refsFindablePaths(msg)).toEqual(["/elsewhere/a.ts"]);
  });

  it("gives one path per FILE GROUP for a search run, not one per match", () => {
    // The DOM marks file headers, not match lines — two matches in one file
    // are one findable unit, and the index must agree or the k-th index match
    // stops being the k-th painted one.
    const msg = message({
      refs: [
        ref({ index: 1, path: "a.ts", line: 1, preview: "foo" }),
        ref({ index: 2, path: "a.ts", line: 7, preview: "foo" }),
      ],
    });
    expect(refsFindablePaths(msg)).toEqual(["a.ts"]);
  });
});

describe("composeRefsShareText — the one bridge into context ([P03])", () => {
  it("carries the command and every ref, with absolute paths", () => {
    const text = composeRefsShareText(
      message({
        refs: [ref({ index: 1, path: "src/a.ts", line: 4, preview: "  const foo = 1" })],
      }),
    );
    expect(text).toContain("/search foo");
    expect(text).toContain("1  /proj/src/a.ts:4  const foo = 1");
  });

  it("caps a huge run and says so, rather than pushing it all into a turn", () => {
    const refs = Array.from({ length: 5 }, (_, i) =>
      ref({ index: i + 1, path: `f${i}.ts` }),
    );
    const text = composeRefsShareText(message({ refs }), 2);
    expect(text).toContain("f0.ts");
    expect(text).toContain("f1.ts");
    expect(text).not.toContain("f2.ts");
    expect(text).toContain("2 of 5 refs shown");
  });

  it("lengthens the fence past a backtick run in a matched line", () => {
    const text = composeRefsShareText(
      message({
        refs: [ref({ index: 1, path: "a.md", line: 1, preview: "``` fenced" })],
      }),
    );
    expect(text.startsWith("````\n")).toBe(true);
  });

  it("round-trips through the durable `<tug-context source=\"refs\">` sentinel", () => {
    // The half of Share a reload — not a click — would expose: the sentinel
    // travels inside the user message into the session JSONL, so the user-row
    // renderer has to split back out what the composer prepended.
    const body = composeRefsShareText(
      message({ refs: [ref({ index: 1, path: "src/a.ts", line: 4, preview: "foo" })] }),
    );
    const prefix = composeContextPrefix([{ source: "refs", ref: "r1", body }]);
    expect(prefix).not.toBeNull();
    const { blocks, rest } = splitLeadingContext(`${prefix ?? ""}what did I find?`);
    expect(blocks.length).toBe(1);
    expect(blocks[0].source).toBe("refs");
    expect(blocks[0].ref).toBe("r1");
    expect(blocks[0].body).toContain("/proj/src/a.ts:4");
    expect(rest).toBe("what did I find?");
  });
});

describe("composeRefsCopyText — the header's Copy payload", () => {
  it("writes one line per ref, numbered as the run numbered them", () => {
    const text = composeRefsCopyText(
      message({
        opKind: "match",
        refs: [ref({ index: 1, path: "a.ts" }), ref({ index: 2, path: "b.ts" })],
      }),
    );
    expect(text).toBe("1  /proj/a.ts\n2  /proj/b.ts");
  });
});
