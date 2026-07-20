/**
 * changes-zones — the Zone 2 summarizer and the release discard-preflight
 * selector ([P06]/[P14]), pure over snapshot data.
 */

import { describe, expect, it } from "bun:test";

import {
  alsoOnProjectSummary,
  alsoSessionRows,
  releasePreflight,
  type AlsoSessionRow,
} from "../changes-zones";
import type {
  DashChangesetEntry,
  ProjectChangeset,
  WorkspacesChangesetSnapshot,
} from "@/lib/changeset-types";
import golden from "@/__tests__/fixtures/workspaces-changeset-snapshot.golden.json";

const DATA = golden as WorkspacesChangesetSnapshot;
const PROJECT: ProjectChangeset = DATA.projects[0];
const OWN_SESSION = "sess-0197a2b4-c8d1-7e02-9f3a-b5c6d7e8f901";

function dash(overrides: Partial<DashChangesetEntry> = {}): DashChangesetEntry {
  return {
    kind: "dash",
    owner_id: "tugdash/snippets",
    display_name: "snippets",
    base: "main",
    rounds: 6,
    worktree: ".tug/worktrees/snippets",
    worktree_dirty: true,
    files: [],
    ...overrides,
  };
}

function session(fileCount: number, n = 1): AlsoSessionRow[] {
  return Array.from({ length: n }, (_, i) => ({
    ownerId: `sess-${i}`,
    displayName: `session ${i}`,
    live: false,
    fileCount,
  }));
}

describe("alsoSessionRows", () => {
  it("excludes the card's own session and fileless entries", () => {
    // The fixture's only session entry IS the card's own — Zone 2 is empty.
    expect(alsoSessionRows(PROJECT, OWN_SESSION)).toEqual([]);
    // From another card's perspective, the same entry is a Zone 2 row.
    const rows = alsoSessionRows(PROJECT, "sess-other");
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe("wire the changeset card");
    expect(rows[0].fileCount).toBe(2);
  });
});

describe("alsoOnProjectSummary", () => {
  it("returns null when no other owner has work", () => {
    expect(alsoOnProjectSummary([], [])).toBeNull();
  });

  it("summarizes one session's files", () => {
    expect(alsoOnProjectSummary(session(3), [])).toBe(
      "Also on this project: 1 session · 3 files",
    );
  });

  it("summarizes n sessions with the file total", () => {
    expect(alsoOnProjectSummary(session(2, 2), [])).toBe(
      "Also on this project: 2 sessions · 4 files",
    );
  });

  it("carries a single dash's name, rounds, and dirt inline", () => {
    expect(alsoOnProjectSummary(session(2, 2), [dash()])).toBe(
      "Also on this project: 2 sessions · 4 files · 1 dash (snippets · 6 rounds · dirty)",
    );
  });

  it("drops the dirty tag for a clean single dash and singularizes one round", () => {
    expect(
      alsoOnProjectSummary([], [dash({ rounds: 1, worktree_dirty: false })]),
    ).toBe("Also on this project: 1 dash (snippets · 1 round)");
  });

  it("collapses several dashes to a count", () => {
    expect(
      alsoOnProjectSummary(
        [],
        [dash(), dash({ owner_id: "tugdash/x", display_name: "x" })],
      ),
    ).toBe("Also on this project: 2 dashes");
  });
});

describe("releasePreflight ([P14])", () => {
  it("keeps the light confirm for a clean dash", () => {
    const pf = releasePreflight(dash({ rounds: 0, worktree_dirty: false }));
    expect(pf.kind).toBe("light");
  });

  it("expands to the discard preflight for rounds or dirt, with counts + subjects", () => {
    const withRounds = releasePreflight(
      dash({ rounds: 3, worktree_dirty: false, round_subjects: ["a", "b", "c"] }),
    );
    expect(withRounds.kind).toBe("discard");
    expect(withRounds.rounds).toBe(3);
    expect(withRounds.dirty).toBe(false);
    expect(withRounds.subjects).toEqual(["a", "b", "c"]);

    const dirtyOnly = releasePreflight(dash({ rounds: 0, worktree_dirty: true }));
    expect(dirtyOnly.kind).toBe("discard");
    expect(dirtyOnly.dirty).toBe(true);
    expect(dirtyOnly.subjects).toEqual([]);
  });

  it("reads the fixture dash's subjects off the wire", () => {
    const fixtureDash = PROJECT.changesets.find((c) => c.kind === "dash");
    expect(fixtureDash?.kind).toBe("dash");
    const pf = releasePreflight(fixtureDash as DashChangesetEntry);
    expect(pf.kind).toBe("discard");
    expect(pf.subjects).toHaveLength(3);
    expect(pf.subjects[0]).toBe("Journal the join teardown");
  });
});
