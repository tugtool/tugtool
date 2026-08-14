/**
 * The Lens Dashes section's projection and its collapsed summary, over the
 * shared golden snapshot.
 *
 * The two facts worth pinning are the ones a reader would be misled by: a dash
 * with no bound sessions reads *parked*, and so does one from a sender that
 * omits `bound_sessions` entirely — absence of evidence is the quiet mark, not
 * a live claim.
 */

import { describe, expect, test } from "bun:test";

import golden from "@/__tests__/fixtures/workspaces-changeset-snapshot.golden.json";
import type {
  DashChangesetEntry,
  ProjectChangeset,
  WorkspacesChangesetSnapshot,
} from "@/lib/changeset-types";
import {
  dashRowsFromSnapshot,
  dashesCollapsedSummary,
} from "../dashes-section";

const DATA = golden as WorkspacesChangesetSnapshot;

/** The golden project, with `changesets` replaced wholesale. */
function projectWith(entries: ProjectChangeset["changesets"]): ProjectChangeset {
  return { ...DATA.projects[0]!, changesets: entries };
}

const GOLDEN_DASH = DATA.projects
  .flatMap((project) => project.changesets)
  .find((entry): entry is DashChangesetEntry => entry.kind === "dash")!;

describe("dashRowsFromSnapshot", () => {
  test("projects the golden dash with its stage and bound session", () => {
    const rows = dashRowsFromSnapshot(DATA);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.ownerId).toBe(GOLDEN_DASH.owner_id);
    expect(row.name).toBe("fix-join");
    expect(row.stage).toBe("draft-ready");
    expect(row.boundSessions.length).toBe(1);
    expect(row.parked).toBe(false);
    // Step counters are not minted in this era; the ink stays dark.
    expect(row.steps).toBeNull();
  });

  test("session entries never become rows", () => {
    const sessions = DATA.projects
      .flatMap((project) => project.changesets)
      .filter((entry) => entry.kind === "session");
    expect(sessions.length).toBeGreaterThan(0);
    expect(dashRowsFromSnapshot(DATA).length).toBe(1);
  });

  test("no bound sessions reads parked", () => {
    const parked: DashChangesetEntry = { ...GOLDEN_DASH, bound_sessions: [] };
    const rows = dashRowsFromSnapshot({ projects: [projectWith([parked])] });
    expect(rows[0]!.parked).toBe(true);
  });

  test("an absent bound_sessions field reads parked, never live", () => {
    const older: DashChangesetEntry = { ...GOLDEN_DASH, bound_sessions: undefined };
    const rows = dashRowsFromSnapshot({ projects: [projectWith([older])] });
    expect(rows[0]!.parked).toBe(true);
    expect(rows[0]!.boundSessions).toEqual([]);
  });

  test("step counters render only when both halves arrive", () => {
    const half: DashChangesetEntry = { ...GOLDEN_DASH, step_current: 2 };
    expect(
      dashRowsFromSnapshot({ projects: [projectWith([half])] })[0]!.steps,
    ).toBeNull();
    const both: DashChangesetEntry = { ...GOLDEN_DASH, step_current: 2, step_total: 5 };
    expect(
      dashRowsFromSnapshot({ projects: [projectWith([both])] })[0]!.steps,
    ).toBe("step 2/5");
  });

  test("the project suffix appears only when it disambiguates", () => {
    const one = dashRowsFromSnapshot(DATA);
    expect(one[0]!.projectLabel).toBeNull();

    const second: ProjectChangeset = {
      ...projectWith([{ ...GOLDEN_DASH, owner_id: "tugdash/other#2" }]),
      display_name: "other-project",
      project_dir: "/tmp/other-project",
    };
    const two = dashRowsFromSnapshot({
      projects: [projectWith([GOLDEN_DASH]), second],
    });
    expect(two.map((row) => row.projectLabel)).toEqual([
      DATA.projects[0]!.display_name,
      "other-project",
    ]);
  });

  test("a project with no dashes never contributes a disambiguator", () => {
    const dashless = projectWith(
      DATA.projects[0]!.changesets.filter((entry) => entry.kind !== "dash"),
    );
    const rows = dashRowsFromSnapshot({
      projects: [projectWith([GOLDEN_DASH]), { ...dashless, display_name: "quiet" }],
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.projectLabel).toBeNull();
  });
});

describe("dashesCollapsedSummary", () => {
  test("says so when there are none", () => {
    expect(dashesCollapsedSummary([])).toBe("No dashes");
  });

  test("counts one dash in the singular", () => {
    expect(dashesCollapsedSummary(dashRowsFromSnapshot(DATA))).toBe("1 dash");
  });

  test("appends the parked count when any are parked", () => {
    const rows = dashRowsFromSnapshot({
      projects: [
        projectWith([
          GOLDEN_DASH,
          { ...GOLDEN_DASH, owner_id: "tugdash/idle#2", bound_sessions: [] },
        ]),
      ],
    });
    expect(dashesCollapsedSummary(rows)).toBe("2 dashes · 1 parked");
  });
});
