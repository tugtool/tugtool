/**
 * join-mode-controller — the land gate, the outcome derivation, and the
 * controller's lifecycle ([P01], [P05]).
 *
 * The gate is commit's, field for field, with one reason swapped: the third
 * check is what is being landed rather than how many files are selected. That
 * parity is the point — two landing gates that disagreed about "a turn is
 * running" would be worse than one that is imprecise — so the table below walks
 * the reasons in the same precedence order commit's does.
 *
 * The controller half drives the real verb and draft singletons attached to a
 * fake connection, the way the verb-store suites do, so `enter`'s preview is a
 * real frame on a real store rather than a spy.
 */

import { beforeEach, afterEach, describe, expect, it } from "bun:test";

import {
  JoinModeController,
  deriveJoinOutcome,
  evaluateJoinLandGate,
  joinDisabledReason,
  joinTargetFromEntry,
  type JoinTarget,
} from "@/lib/join-mode-controller";
import {
  _resetChangesetDraftStoreForTest,
  attachChangesetDraftStore,
} from "@/lib/changeset-draft-store";
import {
  _resetChangesetVerbStoreForTest,
  attachChangesetVerbStore,
} from "@/lib/changeset-verb-store";
import { _resetChangesetJoinStoreForTest } from "@/lib/changeset-join-store";
import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { CommitModeController } from "@/lib/commit-mode-controller";
import type { DashChangesetEntry } from "@/lib/changeset-types";

describe("joinDisabledReason", () => {
  // The regression this pins: a real `base-dirt` blocker derives `blocked`,
  // the gate refuses on the outcome, and the composer's land button used to
  // report a constant that named no cause — leaving a disabled button, a
  // generated message, and no way to learn what was wrong.
  it("names the cause for a preview that came back blocked", () => {
    expect(joinDisabledReason("outcome", "blocked")).toBe(
      "Clear what blocks this join first",
    );
  });

  it("reports the turn and the round trip before the outcome has a say", () => {
    expect(joinDisabledReason("turn", "blocked")).toBe(
      "Wait for the turn to finish",
    );
    expect(joinDisabledReason("pending", "blocked")).toBe("Previewing…");
  });

  it("distinguishes conflicted, empty, and never-previewed", () => {
    expect(joinDisabledReason("outcome", "conflicted")).toBe(
      "Resolve the conflicts first",
    );
    expect(joinDisabledReason("outcome", "empty")).toBe("Nothing to join");
    expect(joinDisabledReason("outcome", "unknown")).toBe("Not previewed yet");
  });
});

describe("evaluateJoinLandGate", () => {
  const base = {
    turnInProgress: false,
    joinPhase: "preview" as const,
    outcome: "clean" as const,
    candidateCommit: null,
    message: "land it",
  };

  it("passes over a clean preview with a message", () => {
    expect(evaluateJoinLandGate(base)).toEqual({ ok: true });
  });

  it("fails first on a running turn, before every other reason", () => {
    expect(
      evaluateJoinLandGate({
        ...base,
        turnInProgress: true,
        joinPhase: "pending",
        outcome: "blocked",
        message: "",
      }),
    ).toEqual({ ok: false, reason: "turn" });
  });

  it("fails on a pending round trip before the outcome / message checks", () => {
    expect(
      evaluateJoinLandGate({ ...base, joinPhase: "pending", outcome: "blocked", message: "" }),
    ).toEqual({ ok: false, reason: "pending" });
  });

  it("fails on the outcome before the message check", () => {
    expect(evaluateJoinLandGate({ ...base, outcome: "blocked", message: "" })).toEqual({
      ok: false,
      reason: "outcome",
    });
  });

  it("refuses a preview that came back with blockers", () => {
    // The face that carries blockers derives `blocked`, and blocked never lands.
    expect(evaluateJoinLandGate({ ...base, outcome: "blocked" })).toEqual({
      ok: false,
      reason: "outcome",
    });
  });

  it("lands a resolved candidate even though the history conflicted", () => {
    expect(
      evaluateJoinLandGate({ ...base, outcome: "conflicted", candidateCommit: "cafe1234" }),
    ).toEqual({ ok: true });
  });

  it("fails on an empty (whitespace) message when everything else is ready", () => {
    expect(evaluateJoinLandGate({ ...base, message: "   " })).toEqual({
      ok: false,
      reason: "empty-message",
    });
  });
});

describe("deriveJoinOutcome", () => {
  const base = {
    joinPhase: "preview" as const,
    conflicts: [] as readonly string[],
    blockers: [] as readonly { kind: string; detail: string; paths: readonly string[] }[],
    candidateCommit: null as string | null,
  };
  const blocker = (kind: string) => ({ kind, detail: `${kind} detail`, paths: [] });

  it("reads a clean preview as clean", () => {
    expect(deriveJoinOutcome(base)).toBe("clean");
  });

  it("reads no round trip yet as unknown, and one in flight as previewing", () => {
    expect(deriveJoinOutcome({ ...base, joinPhase: "idle" })).toBe("unknown");
    expect(deriveJoinOutcome({ ...base, joinPhase: "pending" })).toBe("previewing");
  });

  it("calls out empty separately from the other blockers", () => {
    expect(deriveJoinOutcome({ ...base, blockers: [blocker("empty")] })).toBe("empty");
    expect(deriveJoinOutcome({ ...base, blockers: [blocker("off-base")] })).toBe("blocked");
    // Empty wins when it arrives beside another blocker: release is the act.
    expect(
      deriveJoinOutcome({ ...base, blockers: [blocker("off-base"), blocker("empty")] }),
    ).toBe("empty");
  });

  it("reads conflicting paths as conflicted, and a candidate as landable", () => {
    expect(deriveJoinOutcome({ ...base, conflicts: ["a.ts"] })).toBe("conflicted");
    expect(
      deriveJoinOutcome({ ...base, conflicts: ["a.ts"], candidateCommit: "cafe1234" }),
    ).toBe("clean");
  });

  it("reads a verb-level refusal as blocked rather than as landable", () => {
    expect(deriveJoinOutcome({ ...base, joinPhase: "error" })).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Controller — real verb / draft singletons over a fake connection.
// ---------------------------------------------------------------------------

interface Sent {
  action: string;
  body: Record<string, unknown>;
}

const sent: Sent[] = [];

function fakeConnection(): never {
  return {
    onFrame: () => () => {},
    sendControlFrame: (action: string, body: Record<string, unknown>) => {
      sent.push({ action, body });
    },
  } as never;
}

const DASH_ENTRY: DashChangesetEntry = {
  kind: "dash",
  owner_id: "tugdash/join-lane#1",
  display_name: "join-lane",
  base: "main",
  rounds: 2,
  worktree: ".tug/worktrees/join-lane",
  worktree_dirty: false,
  files: [],
  draft: {
    fingerprint: "abc123",
    message: "the maintained join message",
    updated_at: 0,
    edited: false,
  },
};

function fakeChangesController(): ChangesRouteController {
  let notify: (() => void) | null = null;
  const controller = {
    entryKey: "session:s1",
    projectDir: "/p",
    workspaceKey: "/p",
    tugSessionId: "s1",
    subscribe: (listener: () => void) => {
      notify = listener;
      return () => {
        notify = null;
      };
    },
    getSnapshot: () => ({
      entry: null,
      dashes: [DASH_ENTRY],
      unattributed: [],
      orphaned: [],
      project: { project_dir: "/p" },
      committedPaths: new Set<string>(),
    }),
    commit: () => {},
    requestDraft: () => {},
    /** Test hook: fire the subscription without changing anything. */
    _notify: () => notify?.(),
  };
  return controller as unknown as ChangesRouteController;
}

function fakeCodeSessionStore(canInterrupt: boolean): CodeSessionStore {
  return {
    subscribe: () => () => {},
    getSnapshot: () => ({ canInterrupt }),
  } as unknown as CodeSessionStore;
}

function fakeCommitMode(): CommitModeController & { exits: number } {
  const stub = {
    exits: 0,
    exit(): void {
      stub.exits += 1;
    },
  };
  return stub as unknown as CommitModeController & { exits: number };
}

const TARGET: JoinTarget = joinTargetFromEntry(DASH_ENTRY);

beforeEach(() => {
  sent.length = 0;
  _resetChangesetDraftStoreForTest();
  _resetChangesetVerbStoreForTest();
  _resetChangesetJoinStoreForTest();
  attachChangesetVerbStore(fakeConnection());
  attachChangesetDraftStore(fakeConnection());
});

afterEach(() => {
  _resetChangesetDraftStoreForTest();
  _resetChangesetVerbStoreForTest();
  _resetChangesetJoinStoreForTest();
});

describe("JoinModeController", () => {
  function build(canInterrupt = false) {
    const commitMode = fakeCommitMode();
    const changesController = fakeChangesController();
    const controller = new JoinModeController({
      changesController,
      codeSessionStore: fakeCodeSessionStore(canInterrupt),
      commitModeController: commitMode,
    });
    return { controller, commitMode, changesController };
  }

  it("enter seeds an edited dash draft and exits commit mode", () => {
    const { controller, commitMode } = build();
    controller.enter(TARGET, "a seeded join message");

    expect(controller.getSnapshot().active).toBe(true);
    expect(controller.getSnapshot().seedMessage).toBe("a seeded join message");
    expect(controller.getSnapshot().dash?.name).toBe("join-lane");
    expect(commitMode.exits).toBe(1);

    const draft = sent.find((s) => s.action === "changeset_draft_set");
    expect(draft?.body).toMatchObject({
      owner_kind: "dash",
      owner_id: DASH_ENTRY.owner_id,
      message: "a seeded join message",
      edited: true,
    });
    controller.dispose();
  });

  it("enter fires exactly one preview", () => {
    const { controller } = build();
    controller.enter(TARGET);

    const previews = sent.filter((s) => s.action === "changeset_join");
    expect(previews).toHaveLength(1);
    expect(previews[0]?.body).toEqual({ project_dir: "/p", dash: "join-lane", preview: true });
    controller.dispose();
  });

  it("opens on the dash's maintained draft when nothing was seeded", () => {
    const { controller } = build();
    controller.enter(TARGET);
    expect(controller.getSnapshot().persistedMessage).toBe("the maintained join message");
    expect(controller.getSnapshot().seedMessage).toBe(null);
    // Nothing was typed, so nothing was written.
    expect(sent.some((s) => s.action === "changeset_draft_set")).toBe(false);
    controller.dispose();
  });

  it("keeps the snapshot referentially stable across an unrelated notification", () => {
    const { controller, changesController } = build();
    controller.enter(TARGET);
    const before = controller.getSnapshot();
    (changesController as unknown as { _notify: () => void })._notify();
    expect(controller.getSnapshot()).toBe(before);
    controller.dispose();
  });

  it("land is a no-op when the gate fails, and the mode stays up", () => {
    // Mid-turn: the gate's first reason, so nothing is sent.
    const { controller } = build(true);
    controller.enter(TARGET);
    sent.length = 0;
    controller.land("land it");
    expect(sent.filter((s) => s.action === "changeset_join")).toHaveLength(0);
    expect(controller.getSnapshot().active).toBe(true);
    controller.dispose();
  });

  it("exit clears the target and the seed", () => {
    const { controller } = build();
    controller.enter(TARGET, "seed");
    controller.exit();
    const snapshot = controller.getSnapshot();
    expect(snapshot.active).toBe(false);
    expect(snapshot.dash).toBe(null);
    expect(snapshot.seedMessage).toBe(null);
    controller.dispose();
  });

  it("dispose releases every subscription ([L27])", () => {
    const { controller, changesController } = build();
    let fires = 0;
    controller.subscribe(() => {
      fires += 1;
    });
    controller.dispose();
    (changesController as unknown as { _notify: () => void })._notify();
    expect(fires).toBe(0);
  });
});
