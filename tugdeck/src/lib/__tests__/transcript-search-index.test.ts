/**
 * transcript-search-index — pure-logic coverage for the DOM-free row
 * projections and the per-unit search shape.
 *
 * Markdown-rendered kinds (assistant text, thinking, user bodies, scheduled
 * notes) reduce block HTML to text through a scratch DOM element, so their
 * fidelity is covered by the find fidelity app-test, not here (no fake DOM —
 * banned). This file pins the DOM-free behavior: which kinds project at all
 * (ghost/tool excluded; shell command+output as two expansion-gated units),
 * ANSI stripping and the terminal line cap, the rows↔numberOfItems
 * alignment, and `searchSegments` ordering semantics.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import { buildTranscriptSearchSegments } from "@/lib/transcript-search-index";
import { searchSegments, type RowSegment } from "@/lib/transcript-search";
import { stripAnsi } from "@/lib/ansi/strip-ansi";
import {
  _resetToolBlockRegistryForTests,
  registerToolBlock,
} from "@/components/tugways/cards/session-assistant-renderer-dispatch";
import { BashToolBlock } from "@/components/tugways/cards/blocks/bash-tool-block";
import { ReadToolBlock } from "@/components/tugways/cards/blocks/read-tool-block";
import { ToolBlockExpansionState } from "@/components/tugways/blocks/expansion-state";
import type { SessionTranscriptDataSource, SessionRowDescriptor } from "@/lib/session-transcript-data-source";
import type { PropertyStore } from "@/components/tugways/property-store";

// The tool-block registry is populated by an app-boot side-effect module the
// test process never imports; the index resolves wrappers through it, so seed
// the one entry these projections key on.
beforeAll(() => {
  _resetToolBlockRegistryForTests();
  registerToolBlock("bash", BashToolBlock);
  registerToolBlock("read", ReadToolBlock);
});

const NO_OPTIONS = { caseSensitive: false, wholeWord: false, grep: false };

/** Minimal PropertyStore stand-in: the index only calls `get`. */
const emptyStore = { get: () => undefined } as unknown as PropertyStore;

/** Fixture data source over a fixed descriptor list. */
function fixtureSource(rows: SessionRowDescriptor[]): SessionTranscriptDataSource {
  return {
    numberOfItems: () => rows.length,
    rowAt: (i: number) => rows[i],
  } as unknown as SessionTranscriptDataSource;
}

function buildRows(
  rows: SessionRowDescriptor[],
  expansion: ToolBlockExpansionState = new ToolBlockExpansionState(),
): string[][] {
  // Projection assertions compare unit TEXTS; the segment kind is `dom` for
  // everything this file covers (editor segments are app-test territory).
  return buildTranscriptSearchSegments(fixtureSource(rows), emptyStore, expansion).map(
    (segments) => segments.map((seg) => seg.text),
  );
}

/** Wrap plain strings as `dom` segments for `searchSegments` fixtures. */
function domRows(rows: readonly (readonly string[])[]): RowSegment[][] {
  return rows.map((parts) => parts.map((text) => ({ kind: "dom" as const, text })));
}

function ghostRow(): SessionRowDescriptor {
  return { kind: "ghost", turnKey: "g1" } as unknown as SessionRowDescriptor;
}

function shellRow(): SessionRowDescriptor {
  return {
    kind: "shell",
    turnKey: "s1",
    turn: {
      turnKey: "s1",
      messages: [
        {
          kind: "shell_exchange",
          messageKey: "m1",
          exchangeId: "sh-1",
          command: "ls -la",
          output: "total 0",
        },
      ],
    },
  } as unknown as SessionRowDescriptor;
}

function assistantRow(messages: unknown[]): SessionRowDescriptor {
  return {
    kind: "assistant",
    turnKey: "t1",
    messageStart: 0,
    messageEnd: messages.length,
    turn: { turnKey: "t1", messages },
  } as unknown as SessionRowDescriptor;
}

describe("buildTranscriptSearchRows — DOM-free projections", () => {
  test("rows array aligns 1:1 with numberOfItems", () => {
    const rows = buildRows([ghostRow(), shellRow(), ghostRow()]);
    expect(rows.length).toBe(3);
  });

  test("ghost rows project no units", () => {
    const rows = buildRows([ghostRow()]);
    expect(rows[0]).toEqual([]);
  });

  test("an expanded shell row projects command + output as two units", () => {
    const rows = buildRows([shellRow()]);
    expect(rows[0]).toEqual(["ls -la", "total 0"]);
  });

  test("a collapsed shell row projects nothing", () => {
    const expansion = new ToolBlockExpansionState();
    expansion.set("sh-1", true, false); // user collapsed the exchange
    const rows = buildRows([shellRow()], expansion);
    expect(rows[0]).toEqual([]);
  });

  test("shell output is ANSI-stripped and line-capped", () => {
    const noisy =
      "\u001b[31mred\u001b[0m line\n" +
      Array.from({ length: 12_000 }, (_, i) => `l${i}`).join("\n");
    const row = {
      kind: "shell",
      turnKey: "s2",
      turn: {
        turnKey: "s2",
        messages: [
          {
            kind: "shell_exchange",
            messageKey: "m1",
            exchangeId: "sh-2",
            command: "noise",
            output: noisy,
          },
        ],
      },
    } as unknown as SessionRowDescriptor;
    const rows = buildRows([row]);
    const output = rows[0]![1]!;
    expect(output.startsWith("red line")).toBe(true);
    // 10k-line retention cap mirrors the DOM's TerminalBlock.
    expect(output.split("\n").length).toBe(10_000);
  });

  function bashMessage(overrides: Record<string, unknown> = {}): unknown {
    return {
      kind: "tool_use",
      messageKey: "m1",
      toolUseId: "tu1",
      toolName: "Bash",
      input: { command: "echo hi" },
      status: "done",
      result: "hi out",
      structuredResult: null,
      toolWallMs: 1,
      ...overrides,
    };
  }

  /** Expansion state with `tu1` expanded (replayed tool blocks default collapsed). */
  function expandedTu1(): ToolBlockExpansionState {
    const expansion = new ToolBlockExpansionState();
    expansion.set("tu1", false, true);
    return expansion;
  }

  test("a collapsed tool_use projects no units (the default for history)", () => {
    const rows = buildRows([assistantRow([bashMessage()])]);
    expect(rows[0]).toEqual([]);
  });

  test("an expanded Bash call projects command + terminal output", () => {
    const rows = buildRows([assistantRow([bashMessage()])], expandedTu1());
    expect(rows[0]).toEqual(["echo hi", "hi out"]);
  });

  test("expanded Bash with structured streams projects stdout then stderr", () => {
    const rows = buildRows(
      [
        assistantRow([
          bashMessage({
            structuredResult: { stdout: "out line", stderr: "err line" },
          }),
        ]),
      ],
      expandedTu1(),
    );
    expect(rows[0]).toEqual(["echo hi", "out line\nerr line"]);
  });

  test("a streaming Bash call projects the command only (no body yet)", () => {
    const rows = buildRows(
      [assistantRow([bashMessage({ status: "pending", result: null })])],
      expandedTu1(),
    );
    expect(rows[0]).toEqual(["echo hi"]);
  });

  test("a diff-routed Bash body projects the command only", () => {
    const diff = [
      "diff --git a/f.txt b/f.txt",
      "index 000..111 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const rows = buildRows(
      [
        assistantRow([
          bashMessage({ input: { command: "git diff" }, result: diff }),
        ]),
      ],
      expandedTu1(),
    );
    expect(rows[0]).toEqual(["git diff"]);
  });

  test("a commit receipt projects nothing (the command row is replaced)", () => {
    const rows = buildRows(
      [
        assistantRow([
          bashMessage({
            input: { command: 'git commit -m "msg"' },
            result: "[main abc1234] msg\n 1 file changed",
          }),
        ]),
      ],
      expandedTu1(),
    );
    expect(rows[0]).toEqual([]);
  });

  test("an expanded Read call projects its file content as an editor segment", () => {
    const row = assistantRow([
      bashMessage({
        toolName: "Read",
        input: { file_path: "/tmp/x.ts" },
        result: "     1\tline",
        structuredResult: {
          type: "text",
          file: { content: "const x = 1;\nconst y = 2;", filePath: "/tmp/x.ts" },
        },
      }),
    ]);
    const segments = buildTranscriptSearchSegments(
      fixtureSource([row]),
      emptyStore,
      expandedTu1(),
    );
    expect(segments[0]).toEqual([
      { kind: "editor", key: "tu1", text: "const x = 1;\nconst y = 2;" },
    ]);
  });

  test("a Read call without structured file content projects nothing", () => {
    const row = assistantRow([
      bashMessage({
        toolName: "Read",
        input: { file_path: "/tmp/x.ts" },
        result: "ENOENT",
        status: "error",
        structuredResult: null,
      }),
    ]);
    const segments = buildTranscriptSearchSegments(
      fixtureSource([row]),
      emptyStore,
      expandedTu1(),
    );
    expect(segments[0]).toEqual([]);
  });

  test("keyed dom segments ride through to matches (terminal fold targets)", () => {
    const rows = buildTranscriptSearchSegments(
      fixtureSource([shellRow()]),
      emptyStore,
      new ToolBlockExpansionState(),
    );
    expect(rows[0]).toEqual([
      { kind: "dom", text: "ls -la" },
      { kind: "dom", text: "total 0", key: "sh-1" },
    ]);
  });

  test("a subagent child tool call projects nothing even when expanded", () => {
    const rows = buildRows(
      [assistantRow([bashMessage({ parentToolUseId: "agent-1" })])],
      expandedTu1(),
    );
    expect(rows[0]).toEqual([]);
  });

  test("compact system notes project their divider label verbatim", () => {
    const row = assistantRow([
      { kind: "system_note", messageKey: "m1", source: "compact", text: "Compacted 12 turns" },
    ]);
    const rows = buildRows([row]);
    expect(rows[0]).toEqual(["Compacted 12 turns"]);
  });

  test("unrendered system notes (source: other) project nothing", () => {
    const row = assistantRow([
      { kind: "system_note", messageKey: "m1", source: "other", text: "invisible text" },
    ]);
    const rows = buildRows([row]);
    expect(rows[0]).toEqual([]);
  });

  test("a user row with no message projects nothing", () => {
    const row = { kind: "user", turnKey: "t1" } as unknown as SessionRowDescriptor;
    const rows = buildRows([row]);
    expect(rows[0]).toEqual([]);
  });
});

describe("searchSegments — per-unit semantics", () => {
  test("matches order by row, then segment, then offset — and carry segment tags", () => {
    const rows = domRows([["b a", "a"], [], ["a b a"]]);
    const matches = searchSegments(rows, "a", NO_OPTIONS);
    expect(matches.map((m) => m.row)).toEqual([0, 0, 2, 2]);
    // Segment-relative offsets: row 0 segment 0 hit at 2, segment 1 hit at 0.
    expect(matches[0]).toEqual({
      row: 0, start: 2, end: 3, segment: 0, segmentKind: "dom", segmentKey: undefined,
    });
    expect(matches[1]).toEqual({
      row: 0, start: 0, end: 1, segment: 1, segmentKind: "dom", segmentKey: undefined,
    });
  });

  test("editor segments carry their owning key", () => {
    const rows: RowSegment[][] = [
      [
        { kind: "dom", text: "prose a" },
        { kind: "editor", key: "tu9", text: "file a" },
      ],
    ];
    const matches = searchSegments(rows, "a", NO_OPTIONS);
    expect(matches).toHaveLength(2);
    expect(matches[0]!.segmentKind).toBe("dom");
    expect(matches[1]).toMatchObject({
      segment: 1, segmentKind: "editor", segmentKey: "tu9",
    });
  });

  test("a query never matches across segment boundaries", () => {
    const rows = domRows([["prefix-end", "start-suffix"]]);
    expect(searchSegments(rows, "endstart", NO_OPTIONS)).toEqual([]);
    expect(searchSegments(rows, "end", NO_OPTIONS)).toHaveLength(1);
    expect(searchSegments(rows, "start", NO_OPTIONS)).toHaveLength(1);
  });

  test("invalid grep and empty query yield zero matches", () => {
    const rows = domRows([["anything"]]);
    expect(searchSegments(rows, "", NO_OPTIONS)).toEqual([]);
    expect(
      searchSegments(rows, "(", { ...NO_OPTIONS, grep: true }),
    ).toEqual([]);
  });

  test("the match limit caps the walk", () => {
    const rows = domRows([["aaaa", "aaaa"]]);
    expect(searchSegments(rows, "a", NO_OPTIONS, 5)).toHaveLength(5);
  });
});

describe("stripAnsi", () => {
  test("plain text passes through untouched (fast path)", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });

  test("SGR color sequences are removed", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m and \u001b[1;32mgreen\u001b[0m")).toBe(
      "red and green",
    );
  });

  test("OSC hyperlinks and titles are removed", () => {
    expect(stripAnsi("\u001b]8;;https://x\u0007label\u001b]8;;\u0007")).toBe("label");
    expect(stripAnsi("\u001b]0;title\u0007body")).toBe("body");
  });

  test("cursor movement and two-character escapes are removed", () => {
    expect(stripAnsi("a\u001b[2Kb\u001b[1Ac")).toBe("abc");
    expect(stripAnsi("x\u001b=y")).toBe("xy");
  });
});
