import { describe, expect, test } from "bun:test";

import { reconcileHunkElection } from "@/lib/hunk-election";

const IDS = ["aaa", "bbb", "ccc"] as const;

describe("reconcileHunkElection", () => {
  test("no persisted election is whole-file: every box checked, no badge", () => {
    expect(reconcileHunkElection(IDS, null)).toEqual({
      elected: IDS,
      partial: null,
      stale: false,
    });
  });

  test("an election with no drift renders as itself", () => {
    expect(reconcileHunkElection(IDS, ["aaa", "ccc"])).toEqual({
      elected: ["aaa", "ccc"],
      partial: { elected: 2, total: 3 },
      stale: false,
    });
  });

  test("partial drift keeps the ids that survived and counts only those", () => {
    expect(reconcileHunkElection(IDS, ["aaa", "gone"])).toEqual({
      elected: ["aaa"],
      partial: { elected: 1, total: 3 },
      stale: false,
    });
  });

  test("electing every hunk is whole-file — no badge to disagree with", () => {
    expect(reconcileHunkElection(IDS, ["aaa", "bbb", "ccc"])).toEqual({
      elected: ["aaa", "bbb", "ccc"],
      partial: null,
      stale: false,
    });
  });

  // The case the badge exists for: checked boxes alone would read as a plain
  // whole-file landing, and the engine is about to refuse it.
  test("total drift checks every box and says so instead of counting", () => {
    expect(reconcileHunkElection(IDS, ["gone", "also-gone"])).toEqual({
      elected: IDS,
      partial: null,
      stale: true,
    });
  });

  test("an empty persisted election is total drift, not whole-file", () => {
    expect(reconcileHunkElection(IDS, [])).toEqual({
      elected: IDS,
      partial: null,
      stale: true,
    });
  });

  test("a file with no hunks has nothing to drift out of", () => {
    expect(reconcileHunkElection([], ["gone"])).toEqual({
      elected: [],
      partial: null,
      stale: false,
    });
    expect(reconcileHunkElection([], null)).toEqual({
      elected: [],
      partial: null,
      stale: false,
    });
  });

  test("the persisted order is what survives, not the file's", () => {
    expect(reconcileHunkElection(IDS, ["ccc", "aaa"]).elected).toEqual([
      "ccc",
      "aaa",
    ]);
  });
});
