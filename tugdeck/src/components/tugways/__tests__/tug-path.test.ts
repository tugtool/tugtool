/**
 * tug-path.test.ts — where a path splits for a middle ellipsis.
 *
 * The split is the whole contract: everything visible about the truncation is
 * decided by which characters land in the run that shrinks and which land in
 * the run that stays. The flexing itself is CSS and is asserted in the app,
 * where a real box does real shrinking.
 */

import { describe, expect, test } from "bun:test";

import { splitPath } from "../tug-path";

describe("splitPath, by filename", () => {
  test("the whole filename is pinned and the directory chain shrinks", () => {
    // The reader is looking for the name. A split that pinned a fixed count
    // would take the head off exactly that word.
    expect(splitPath("/Users/ken/src/tugtool/notes.md")).toEqual({
      head: "/Users/ken/src/tugtool",
      tail: "/notes.md",
    });
  });

  test("a bare filename is all tail — there is nothing to give up", () => {
    expect(splitPath("notes.md")).toEqual({ head: "", tail: "notes.md" });
  });

  test("a root-level absolute path keeps its leading slash on the tail", () => {
    // The slash at index 0 is not a separator between two runs, it is the
    // path's first character; splitting there would leave an empty head and a
    // tail that had lost the mark saying the path is absolute.
    expect(splitPath("/notes.md")).toEqual({ head: "", tail: "/notes.md" });
  });

  test("a trailing separator leaves the last directory as the tail", () => {
    expect(splitPath("/Users/ken/src/")).toEqual({
      head: "/Users/ken/src",
      tail: "/",
    });
  });
});

describe("splitPath, by character count", () => {
  test("pins exactly the requested trailing characters", () => {
    const { head, tail } = splitPath("/Users/ken/src/tugtool/notes.md", 10);
    expect(tail).toBe("l/notes.md");
    expect(tail).toHaveLength(10);
    expect(head + tail).toBe("/Users/ken/src/tugtool/notes.md");
  });

  test("a path shorter than the count is all tail", () => {
    expect(splitPath("a.md", 20)).toEqual({ head: "", tail: "a.md" });
  });

  test("the two runs always reconstruct the path, under either rule", () => {
    // A split that dropped or duplicated a character would render a path the
    // reader could not paste, which no amount of correct flexing would fix.
    for (const path of ["/a/b/c.ts", "c.ts", "/c.ts", "/a/very/long/chain/of/dirs/file.name.ts"]) {
      const byName = splitPath(path);
      expect(byName.head + byName.tail, path).toBe(path);
      const byCount = splitPath(path, 20);
      expect(byCount.head + byCount.tail, path).toBe(path);
    }
  });
});
