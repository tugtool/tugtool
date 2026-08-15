/**
 * The resolve lane's face, derived from the ladder's real frames.
 *
 * The store's own bookkeeping is proved in `changeset-join-store.test.ts`;
 * what this adds is the lane's reading of it — which face is up at each phase,
 * and whether the join has become landable. The frames are driven through the
 * store's real CONTROL ingest, so the derivation is exercised against what the
 * ladder actually sends rather than against a hand-built state.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  attachChangesetJoinStore,
  _ingestJoinFrameForTest,
  _resetChangesetJoinStoreForTest,
} from "../changeset-join-store";
import { deriveResolveFace } from "@/components/tugways/cards/session-changes/session-changes-dash-landing";
import { deriveJoinOutcome } from "../join-mode-controller";

const fakeConn = { onFrame: () => () => {} } as never;
const K = { project_dir: "/p", dash: "demo" };

const conflictedJoin = {
  joinPhase: "preview" as const,
  conflicts: ["a.rs"],
  blockers: [],
};

beforeEach(() => _resetChangesetJoinStoreForTest());

describe("the resolve lane's face", () => {
  test("offers the ladder, shows its progress, then lands the candidate", () => {
    const store = attachChangesetJoinStore(fakeConn);
    const face = (): string => {
      const state = store.state("/p", "demo");
      const outcome = deriveJoinOutcome({
        ...conflictedJoin,
        candidateCommit: state.candidateCommit,
      });
      return deriveResolveFace(outcome, state.phase, state.candidateCommit);
    };

    // Conflicted and untried: the ladder is the act that clears it.
    expect(face()).toBe("offer");

    _ingestJoinFrameForTest({
      action: "changeset_join_resolve_delta",
      ...K,
      path: "a.rs",
      rung: "ai",
      status: "streaming",
      text: "merging",
    });
    expect(face()).toBe("progress");

    _ingestJoinFrameForTest({
      action: "changeset_join_resolve_ok",
      ...K,
      resolved: [{ path: "a.rs", resolved_by: "ai" }],
      unresolved: [],
      candidate_commit: "cafe1234",
      shape: "squash",
    });
    expect(face()).toBe("resolved");
    // And the join itself is landable now — a resolved candidate outranks the
    // conflicts it was built from.
    expect(
      deriveJoinOutcome({ ...conflictedJoin, candidateCommit: "cafe1234" }),
    ).toBe("clean");
  });

  test("an ok with unresolved files is the ladder's dead end, with nothing to land", () => {
    const store = attachChangesetJoinStore(fakeConn);
    _ingestJoinFrameForTest({
      action: "changeset_join_resolve_ok",
      ...K,
      resolved: [{ path: "a.rs", resolved_by: "rerere" }],
      unresolved: ["b.rs"],
      shape: "squash",
    });
    const state = store.state("/p", "demo");
    expect(state.candidateCommit).toBe(null);
    expect(deriveResolveFace("conflicted", state.phase, state.candidateCommit)).toBe(
      "partial",
    );
    expect(
      deriveJoinOutcome({ ...conflictedJoin, candidateCommit: null }),
    ).toBe("conflicted");
  });

  test("a resolved phase with no candidate reads as the dead end too", () => {
    expect(deriveResolveFace("conflicted", "resolved", null)).toBe("partial");
  });

  test("the ladder's refusal surfaces as its own face, and a clean join has none", () => {
    expect(deriveResolveFace("conflicted", "error", null)).toBe("error");
    expect(deriveResolveFace("clean", "idle", null)).toBe("none");
    expect(deriveResolveFace("blocked", "idle", null)).toBe("none");
  });
});
