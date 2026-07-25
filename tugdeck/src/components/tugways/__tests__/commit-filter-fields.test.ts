/**
 * `commitFilterFields` — what the History filter matches a commit on.
 *
 * The contract these pin: a commit is reachable by its hash (pasted at any
 * length, though rows show eight characters), by anything in its message, by
 * who wrote it and when, and by the paths it touched — and by nothing else,
 * so a term found only in a diff does not keep a row.
 *
 * Multi-term queries AND across the union of fields, which is what makes
 * "a path plus a word" a usable way to find one commit.
 */

import { describe, test, expect } from "bun:test";

import { commitFilterFields } from "../tug-history-list";
import { filterAndRank, filterQueryMatch } from "@/lib/text-match";
import type { GitLogCommit } from "@/lib/git-log-store";

const COMMIT: GitLogCommit = {
  sha: "eec07b495ede18478b70e293a6f8df320b6a30c1",
  subject: "tugways(session-history): swap metadata toggle to default emphasis",
  body: "The filled emphasis read as a selection state.\n\nTug-Dash: none",
  author: "Ken Kocienda",
  date: "2026-07-24",
  committer: "Ken Kocienda",
  committer_email: "kocienda@mac.com",
  committer_date: "2026-07-24T12:51:25-07:00",
  files: ["tugdeck/src/components/tugways/cards/session-history/view.tsx"],
};

function matches(query: string, commit: GitLogCommit = COMMIT): boolean {
  return filterQueryMatch(query, commitFilterFields(commit));
}

describe("commitFilterFields", () => {
  test("the hash matches at any prefix length, short or full", () => {
    expect(matches("eec07")).toBe(true);
    expect(matches("eec07b49")).toBe(true);
    expect(matches(COMMIT.sha)).toBe(true);
    expect(matches("ffff99")).toBe(false);
  });

  test("the subject and the body both match", () => {
    expect(matches("metadata toggle")).toBe(true);
    expect(matches("selection state")).toBe(true);
  });

  test("the details match — who committed, and when", () => {
    expect(matches("Kocienda")).toBe(true);
    expect(matches("kocienda@mac.com")).toBe(true);
    expect(matches("2026-07-24")).toBe(true);
  });

  test("a changed path matches, even when the message never names it", () => {
    expect(matches("session-history/view.tsx")).toBe(true);
    // The subject says nothing about `.tsx`; the file roster does.
    expect(matches("tsx")).toBe(true);
  });

  test("a commit with no file roster still matches on its message", () => {
    const merge: GitLogCommit = { ...COMMIT, files: [] };
    expect(matches("emphasis", merge)).toBe(true);
    expect(matches("view.tsx", merge)).toBe(false);
  });

  test("terms AND across fields — one in the path, one in the message", () => {
    expect(matches("view.tsx emphasis")).toBe(true);
    // The second term is nowhere in the commit, so the row is dropped even
    // though the first term hit.
    expect(matches("view.tsx bogusterm")).toBe(false);
  });

  test("an empty query keeps every commit, in its native order", () => {
    const older: GitLogCommit = { ...COMMIT, sha: "aaa111", subject: "older" };
    const commits = [COMMIT, older];
    expect(filterAndRank(commits, "", commitFilterFields)).toBe(commits);
  });

  test("filtering trims a list to the commits that match", () => {
    const rustish: GitLogCommit = {
      ...COMMIT,
      sha: "aaa111",
      subject: "tugcast(git): page the log route",
      body: "",
      files: ["tugrust/crates/tugcast/src/feeds/git.rs"],
    };
    const kept = filterAndRank([COMMIT, rustish], "git.rs", commitFilterFields);
    expect(kept.map((c) => c.sha)).toEqual(["aaa111"]);
  });
});
