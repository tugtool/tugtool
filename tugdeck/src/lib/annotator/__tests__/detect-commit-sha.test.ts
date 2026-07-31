/**
 * Pure-logic coverage for the commit-sha grammar.
 *
 * A sha has no structure — it is a run of hex — so this grammar's whole
 * job is to keep the question worth asking of the repository, which is
 * what actually decides. The interesting column is the words: English is
 * full of runs of hex, and asking git about every one of them would be a
 * subprocess per adjective.
 */

import { describe, expect, test } from "bun:test";

import { isCommitSha, scanCommitShas } from "../detect-commit-sha";

describe("isCommitSha — plausible shas", () => {
  const accepted = [
    "b089d34a8",
    "e95a2dab2",
    "4e18b46",
    "d925f7b9f",
    "0fc8b3c45",
    "35b3fb0cb1e2d4a5f6789012345678901234abcd",
  ];
  for (const sha of accepted) {
    test(sha, () => {
      expect(isCommitSha(sha)).toBe(true);
    });
  }
});

describe("isCommitSha — what it refuses", () => {
  const rejected: ReadonlyArray<[string, string]> = [
    ["too short for git's short form", "b089d3"],
    ["longer than a sha", "b089d34a8b089d34a8b089d34a8b089d34a8b089d34a8"],
    ["not hex", "b089d34ag"],
    ["uppercase — git writes shas lowercase", "B089D34A8"],
    // The rule that earns its keep: hex that is also a word. Without the
    // digit requirement each of these costs a `git show`.
    ["an all-letter hex word", "decade"],
    ["another", "facade"],
    ["another", "deadbeef"],
    ["another", "accedeed"],
    ["empty", ""],
  ];
  for (const [label, text] of rejected) {
    test(`${label}: ${JSON.stringify(text)}`, () => {
      expect(isCommitSha(text)).toBe(false);
    });
  }
});

describe("scanCommitShas — shas found in prose", () => {
  test("the shape the transcript actually writes", () => {
    const text = "Landed in b089d34a8 and e95a2dab2.";
    const found = scanCommitShas(text);
    expect(found.map((m) => m.sha)).toEqual(["b089d34a8", "e95a2dab2"]);
    // The trailing period is not part of the second sha.
    expect(text.slice(found[1].start, found[1].end)).toBe("e95a2dab2");
  });

  test("wrapping punctuation stays out of the run", () => {
    const text = "see (4e18b46) for it";
    const [only] = scanCommitShas(text);
    expect(text.slice(only.start, only.end)).toBe("4e18b46");
  });

  test("a sha is a whole token, never a fragment of one", () => {
    // A filename that happens to contain hex is not a commit reference.
    expect(scanCommitShas("cache-b089d34a8.tmp")).toEqual([]);
  });

  test("ordinary prose asks nothing of the repository", () => {
    expect(
      scanCommitShas("It took a decade to build the facade, added later."),
    ).toEqual([]);
  });
});
