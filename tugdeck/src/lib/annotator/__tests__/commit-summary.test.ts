/**
 * Unit tests for `commitSummary` — the hover that says what a bare sha IS.
 */

import { describe, expect, test } from "bun:test";

import { commitSummary } from "@/lib/annotator/commit-summary";
import type { CommitFacts } from "@/lib/annotator/commit-resolution";

const facts = (over: Partial<CommitFacts> = {}): CommitFacts => ({
  subject: "gazette(ref-resolve): resolve refs against real fs/git",
  author: "Ken Kocienda",
  date: "2026-08-12",
  files: [{ path: "a.ts", status: "modified", added: 4, removed: 1 }],
  ...over,
});

describe("commitSummary", () => {
  test("leads with the subject, then attribution, then the sha", () => {
    const lines = commitSummary("957d2350b422", facts()).split("\n");
    expect(lines[0]).toBe("gazette(ref-resolve): resolve refs against real fs/git");
    expect(lines[1]).toBe("Ken Kocienda · 2026-08-12");
    // The hover is where the WHOLE hash belongs — the chip only shows eight.
    expect(lines[2]).toBe("957d2350b422");
  });

  test("counts the files and totals the churn", () => {
    const text = commitSummary(
      "abc1234",
      facts({
        files: [
          { path: "a.ts", status: "modified", added: 4, removed: 1 },
          { path: "b.css", status: "created", added: 9, removed: 0 },
        ],
      }),
    );
    expect(text).toContain("2 files changed, +13 −1");
  });

  test("a single file is singular", () => {
    expect(commitSummary("abc1234", facts())).toContain("1 file changed, +4 −1");
  });

  test("each file carries its status mark and its counts", () => {
    const text = commitSummary(
      "abc1234",
      facts({
        files: [
          { path: "gone.ts", status: "deleted", added: 0, removed: 12 },
          { path: "new.ts", status: "created", added: 7, removed: 0 },
        ],
      }),
    );
    expect(text).toContain("D  gone.ts  −12");
    expect(text).toContain("A  new.ts  +7");
  });

  test("a binary file reports no counts rather than a bare zero", () => {
    const text = commitSummary(
      "abc1234",
      facts({
        files: [{ path: "icon.png", status: "modified", added: 0, removed: 0 }],
      }),
    );
    expect(text).toContain("M  icon.png");
    expect(text).not.toContain("icon.png  +");
    expect(text).toContain("1 file changed");
  });

  test("a long commit lists a capped set and says how many it dropped", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      path: `f${i}.ts`,
      status: "modified",
      added: 1,
      removed: 0,
    }));
    const text = commitSummary("abc1234", facts({ files: many }));
    expect(text).toContain("11 files changed");
    expect(text).toContain("f7.ts");
    expect(text).not.toContain("f8.ts");
    expect(text).toContain("… and 3 more");
  });

  test("a commit with no recorded subject still opens on something", () => {
    const text = commitSummary(
      "abc1234",
      facts({ subject: "", author: "", date: "" }),
    );
    expect(text.split("\n")[0]).toBe("abc1234");
  });
});
