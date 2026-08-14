/**
 * The dash lane's ordering, over the shared golden snapshot.
 *
 * The fronting rule keys on the owner key, never the display name — the whole
 * point being that a stale binding to a dead incarnation of a reused name must
 * not front the wrong dash.
 */

import { describe, expect, test } from "bun:test";

import golden from "@/__tests__/fixtures/workspaces-changeset-snapshot.golden.json";
import type {
  DashChangesetEntry,
  WorkspacesChangesetSnapshot,
} from "@/lib/changeset-types";
import {
  dashBranchRef,
  orderDashLane,
} from "../session-changes-dash-lane";

const DATA = golden as WorkspacesChangesetSnapshot;

const DASHES: DashChangesetEntry[] = DATA.projects
  .flatMap((project) => project.changesets)
  .filter((entry): entry is DashChangesetEntry => entry.kind === "dash");

describe("orderDashLane", () => {
  test("the golden snapshot carries a dash to order", () => {
    expect(DASHES.length).toBeGreaterThan(0);
    expect(DASHES[0]!.display_name).toBe("fix-join");
  });

  test("the bound owner key fronts its dash", () => {
    const bound = DASHES[0]!;
    const order = orderDashLane(DASHES, bound.owner_id);
    expect(order.fronted).toBe(bound);
    expect(order.rest).not.toContain(bound);
    expect(order.rest.length).toBe(DASHES.length - 1);
  });

  test("an unbound card fronts nothing and folds everything", () => {
    const order = orderDashLane(DASHES, null);
    expect(order.fronted).toBeNull();
    expect(order.rest).toEqual(DASHES);
  });

  test("a binding to a dead incarnation fronts nothing", () => {
    // Same name, different id — the haunting case the owner-key match retires.
    const stale = `tugdash/${DASHES[0]!.display_name}#0-deadbeef`;
    const order = orderDashLane(DASHES, stale);
    expect(order.fronted).toBeNull();
    expect(order.rest).toEqual(DASHES);
  });

  test("an empty lane orders to nothing", () => {
    const order = orderDashLane([], "tugdash/whatever#1");
    expect(order.fronted).toBeNull();
    expect(order.rest).toEqual([]);
  });

  test("later dashes front just as well as the first", () => {
    const second: DashChangesetEntry = { ...DASHES[0]!, owner_id: "tugdash/b#2", display_name: "b" };
    const order = orderDashLane([DASHES[0]!, second], second.owner_id);
    expect(order.fronted).toBe(second);
    expect(order.rest).toEqual([DASHES[0]!]);
  });
});

describe("dashBranchRef", () => {
  test("uses the sent branch when present", () => {
    expect(dashBranchRef(DASHES[0]!)).toBe("tugdash/fix-join");
  });

  test("falls back to the tugdash/<name> spelling for an older sender", () => {
    const older: DashChangesetEntry = { ...DASHES[0]!, branch: undefined };
    expect(dashBranchRef(older)).toBe("tugdash/fix-join");
  });
});
