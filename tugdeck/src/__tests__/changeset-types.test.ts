/**
 * Wire-contract test for the CHANGESET feed types.
 *
 * Validates the shared golden fixture (also deserialized by the Rust side
 * in tugcast-core) against the TS type guards, so a drifted mirror fails
 * here even when tsc is happy.
 */

import { describe, expect, test } from "bun:test";
import golden from "./fixtures/changeset-snapshot.golden.json";
import {
  isChangesetEntry,
  isChangesetFile,
  isChangesetSnapshot,
  type ChangesetSnapshot,
} from "@/lib/changeset-types";
import { FeedId } from "@/protocol";

describe("changeset wire contract", () => {
  test("golden fixture satisfies the snapshot guard", () => {
    expect(isChangesetSnapshot(golden)).toBe(true);
    const snapshot = golden as ChangesetSnapshot;
    expect(snapshot.branch).toBe("main");
    expect(snapshot.changesets).toHaveLength(2);
    expect(snapshot.unattributed).toHaveLength(1);

    const [session, dash] = snapshot.changesets;
    expect(session.kind).toBe("session");
    if (session.kind === "session") {
      expect(session.live).toBe(true);
      expect(session.files[1].ambiguous).toBe(true);
      expect(session.files[1].shared).toBe(true);
    }
    expect(dash.kind).toBe("dash");
    if (dash.kind === "dash") {
      expect(dash.base).toBe("main");
      expect(dash.rounds).toBe(3);
      expect(dash.worktree_dirty).toBe(false);
    }
  });

  test("guards reject shape drift", () => {
    expect(isChangesetSnapshot({})).toBe(false);
    expect(isChangesetSnapshot(null)).toBe(false);
    expect(isChangesetEntry({ kind: "session", owner_id: "x" })).toBe(false);
    expect(isChangesetEntry({ kind: "branch", owner_id: "x", display_name: "x", files: [] })).toBe(
      false,
    );
    expect(
      isChangesetFile({
        path: "a",
        git_status: ".M",
        op: "edit",
        origin: "exact",
        ambiguous: false,
        shared: false,
        last_touched: "not-a-number",
      }),
    ).toBe(false);

    const missingUnattributed = { ...(golden as Record<string, unknown>) };
    delete missingUnattributed.unattributed;
    expect(isChangesetSnapshot(missingUnattributed)).toBe(false);
  });

  test("CHANGESET feed id is registered at 0x23", () => {
    expect(FeedId.CHANGESET).toBe(0x23);
  });
});
