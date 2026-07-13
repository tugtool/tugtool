/**
 * Wire-contract test for the CHANGESET feed types.
 *
 * Validates the shared golden fixture (also deserialized by the Rust side
 * in tugcast-core) against the TS type guards, so a drifted mirror fails
 * here even when tsc is happy.
 */

import { describe, expect, test } from "bun:test";
import golden from "./fixtures/changeset-snapshot.golden.json";
import aggregateGolden from "./fixtures/workspaces-changeset-snapshot.golden.json";
import {
  isChangesetEntry,
  isChangesetFile,
  isChangesetSnapshot,
  isProjectChangeset,
  isWorkspacesChangesetSnapshot,
  type ChangesetSnapshot,
  type WorkspacesChangesetSnapshot,
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

describe("aggregate changeset wire contract", () => {
  test("golden fixture satisfies the aggregate guard", () => {
    expect(isWorkspacesChangesetSnapshot(aggregateGolden)).toBe(true);
    const snapshot = aggregateGolden as WorkspacesChangesetSnapshot;
    expect(snapshot.projects).toHaveLength(2);

    const [repo, nonRepo] = snapshot.projects;
    expect(repo.display_name).toBe("tugtool");
    expect(repo.no_repo).toBe(false);
    // The per-project payload is flattened onto the project (Spec S06).
    expect(repo.branch).toBe("main");
    expect(repo.workspace_key).toBe("a1b2c3d4e5f60718");
    expect(repo.changesets).toHaveLength(2);
    expect(repo.unattributed).toHaveLength(1);

    expect(nonRepo.display_name).toBe("scratchpad");
    expect(nonRepo.no_repo).toBe(true);
    expect(nonRepo.branch).toBe("");
    expect(nonRepo.changesets).toHaveLength(0);
  });

  test("aggregate guards reject shape drift", () => {
    expect(isWorkspacesChangesetSnapshot({})).toBe(false);
    expect(isWorkspacesChangesetSnapshot(null)).toBe(false);
    // A project missing its identity fields is not a ProjectChangeset even
    // though it is a valid ChangesetSnapshot.
    expect(isProjectChangeset(golden)).toBe(false);
    // A project missing the flattened snapshot payload is rejected too.
    expect(
      isProjectChangeset({ project_dir: "/x", display_name: "x", no_repo: true }),
    ).toBe(false);
  });

  test("CHANGESET_ALL feed id is registered at 0x24", () => {
    expect(FeedId.CHANGESET_ALL).toBe(0x24);
  });
});
