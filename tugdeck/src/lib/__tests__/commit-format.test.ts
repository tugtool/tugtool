/**
 * Unit tests for `lib/commit-format` — the one vocabulary five surfaces use
 * to state a commit's shape.
 *
 * These cases came from the `commitSummary` suite this module replaced: the
 * formatter is no longer a string builder for a `title` attribute, but the
 * facts it has to get right (pluralization, a side that contributed nothing,
 * a binary, the roster cap) did not change with the surface.
 */

import { describe, expect, test } from "bun:test";

import {
  commitRoster,
  deltaCounts,
  fileCountLabel,
  statLine,
  statLineFrom,
  statusMark,
  totalsOf,
  type CommitFileShape,
} from "@/lib/commit-format";

const file = (over: Partial<CommitFileShape> = {}): CommitFileShape => ({
  path: "src/a.ts",
  status: "modified",
  added: 4,
  removed: 1,
  ...over,
});

describe("statusMark", () => {
  test("answers in letters for the status words git reports", () => {
    expect(statusMark("created")).toBe("A");
    expect(statusMark("modified")).toBe("M");
    expect(statusMark("deleted")).toBe("D");
    expect(statusMark("renamed")).toBe("R");
  });

  test("passes through a vocabulary that is already letters", () => {
    expect(statusMark("A")).toBe("A");
    expect(statusMark("d")).toBe("D");
  });

  test("falls back to M for a word it does not know", () => {
    expect(statusMark("typechanged")).toBe("M");
  });
});

describe("deltaCounts", () => {
  test("states both sides", () => {
    expect(deltaCounts(12, 3)).toBe("+12 −3");
  });

  test("drops a side that contributed nothing", () => {
    expect(deltaCounts(9, 0)).toBe("+9");
    expect(deltaCounts(0, 7)).toBe("−7");
  });

  test("is empty for a file that changed no lines", () => {
    expect(deltaCounts(0, 0)).toBe("");
  });
});

describe("fileCountLabel", () => {
  test("agrees its noun with the count", () => {
    expect(fileCountLabel(1)).toBe("1 file");
    expect(fileCountLabel(2)).toBe("2 files");
    expect(fileCountLabel(0)).toBe("0 files");
  });
});

describe("totalsOf", () => {
  test("sums both sides across the roster", () => {
    expect(totalsOf([file({ added: 4, removed: 1 }), file({ added: 6, removed: 2 })])).toEqual(
      { added: 10, removed: 3 },
    );
  });
});

describe("statLine", () => {
  test("states the count and the totals", () => {
    expect(statLine([file({ added: 4, removed: 1 }), file({ added: 36, removed: 11 })])).toBe(
      "2 files changed, +40 −12",
    );
  });

  test("pluralizes for a single file", () => {
    expect(statLine([file({ added: 4, removed: 1 })])).toBe("1 file changed, +4 −1");
  });

  test("drops the tail when nothing changed textually", () => {
    expect(statLine([file({ added: 0, removed: 0 })])).toBe("1 file changed");
  });

  test("takes pre-summed totals when a surface has no roster", () => {
    expect(statLineFrom(33, 3461, 128)).toBe("33 files changed, +3461 −128");
  });
});

describe("commitRoster", () => {
  test("marks each entry and states its counts", () => {
    const { entries, hidden } = commitRoster([
      file({ path: "a.ts", status: "created", added: 9, removed: 0 }),
    ]);
    expect(hidden).toBe(0);
    expect(entries).toEqual([{ path: "a.ts", mark: "A", counts: "+9" }]);
  });

  test("caps the list and says how many it dropped", () => {
    const many = Array.from({ length: 11 }, (_, i) => file({ path: `f${i}.ts` }));
    const { entries, hidden } = commitRoster(many);
    expect(entries).toHaveLength(8);
    expect(hidden).toBe(3);
  });

  test("an explicit limit lifts the cap for a copy payload", () => {
    const many = Array.from({ length: 11 }, (_, i) => file({ path: `f${i}.ts` }));
    const { entries, hidden } = commitRoster(many, many.length);
    expect(entries).toHaveLength(11);
    expect(hidden).toBe(0);
  });

  test("a binary file carries no counts", () => {
    const { entries } = commitRoster([file({ path: "logo.png", added: 0, removed: 0 })]);
    expect(entries[0]!.counts).toBe("");
  });
});
