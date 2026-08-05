import { describe, expect, test } from "bun:test";

import { electionToPersist, reconcileHunkElection } from "@/lib/hunk-election";

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

describe("defaultElection — the own-hunk default ([P12])", () => {
  test("no own hunks is the whole-file default it always was", () => {
    expect(reconcileHunkElection(IDS, null, [])).toEqual({
      elected: IDS,
      partial: null,
      stale: false,
    });
    expect(reconcileHunkElection(IDS, null, undefined)).toEqual({
      elected: IDS,
      partial: null,
      stale: false,
    });
  });

  test("own hunks on a contended file default-elect just those", () => {
    expect(reconcileHunkElection(IDS, null, ["aaa", "ccc"])).toEqual({
      elected: ["aaa", "ccc"],
      partial: { elected: 2, total: 3 },
      stale: false,
    });
  });

  test("owning every hunk is whole-file, not a 3-of-3 badge", () => {
    expect(reconcileHunkElection(IDS, null, ["aaa", "bbb", "ccc"])).toEqual({
      elected: IDS,
      partial: null,
      stale: false,
    });
  });

  // A default is not a statement, so it cannot have drifted — falling back to
  // whole-file is right where a *user's* stale election reads as `stale`.
  test("a default that no longer matches the file falls back to whole-file", () => {
    expect(reconcileHunkElection(IDS, null, ["gone"])).toEqual({
      elected: IDS,
      partial: null,
      stale: false,
    });
  });

  test("what the user stated always beats the default", () => {
    expect(reconcileHunkElection(IDS, ["bbb"], ["aaa"])).toEqual({
      elected: ["bbb"],
      partial: { elected: 1, total: 3 },
      stale: false,
    });
  });
});

describe("electionToPersist — what a toggle writes back", () => {
  test("a partial set persists as itself", () => {
    expect(electionToPersist(IDS, ["aaa", "bbb"], [])).toEqual(["aaa", "bbb"]);
  });

  test("all checked with no own hunks clears the entry", () => {
    expect(electionToPersist(IDS, ["aaa", "bbb", "ccc"], [])).toBeNull();
    expect(electionToPersist(IDS, ["aaa", "bbb", "ccc"], undefined)).toBeNull();
  });

  // The regression this function exists for: on a contended path `null`
  // defaults to own hunks, so clearing on all-checked would revert the click.
  test("all checked on a contended path persists the full list", () => {
    expect(electionToPersist(IDS, ["aaa", "bbb", "ccc"], ["aaa"])).toEqual([
      "aaa",
      "bbb",
      "ccc",
    ]);
  });

  test("all checked while owning every hunk clears — default agrees", () => {
    expect(
      electionToPersist(IDS, ["aaa", "bbb", "ccc"], ["aaa", "bbb", "ccc"]),
    ).toBeNull();
  });

  test("all checked with a fully drifted default clears — default agrees", () => {
    expect(electionToPersist(IDS, ["aaa", "bbb", "ccc"], ["gone"])).toBeNull();
  });

  test("round trip: what persists renders back as the same boxes", () => {
    const persisted = electionToPersist(IDS, ["aaa", "bbb", "ccc"], ["aaa"]);
    expect(reconcileHunkElection(IDS, persisted, ["aaa"])).toEqual({
      elected: ["aaa", "bbb", "ccc"],
      partial: null,
      stale: false,
    });
  });
});
