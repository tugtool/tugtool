import { beforeEach, describe, expect, it } from "bun:test";

import {
  CommitDialogController,
  evaluateCommitLandGate,
} from "@/lib/commit-dialog-controller";
import { ShadeViewController } from "@/lib/shade-view-controller";
import { ChangesRouteController } from "@/lib/changes-route-controller";
import { _resetChangesetDraftStoreForTest } from "@/lib/changeset-draft-store";
import type { CodeSessionStore } from "@/lib/code-session-store";

// Isolate from any draft store a prior test left attached — `show(seed)`
// writes the seed through `getChangesetDraftStore()`, so a leaked instance
// with a half-wired connection would throw. Null means the guarded `?.` no-ops.
beforeEach(() => {
  _resetChangesetDraftStoreForTest();
});

// A real ChangesRouteController with no aggregate store attached — its snapshot
// is the empty derivation, which is all the transition tests read.
function makeChanges(): ChangesRouteController {
  return new ChangesRouteController(
    { tugSessionId: "sess", workspaceKey: "ws", projectDir: "/repo" },
    null,
  );
}

// The controller only reads `canInterrupt` in the land path; the transition
// tests never land, so an inert idle store suffices.
const IDLE_SESSION = {
  getSnapshot: () => ({ canInterrupt: false }),
  subscribe: () => () => {},
} as unknown as CodeSessionStore;

function makeController(shade: ShadeViewController): CommitDialogController {
  return new CommitDialogController({
    changesController: makeChanges(),
    shadeViewController: shade,
    codeSessionStore: IDLE_SESSION,
  });
}

describe("evaluateCommitLandGate", () => {
  const base = { turnInProgress: false, commitPhase: "idle" as const, message: "msg", fileCount: 2 };

  it("passes when idle with a message and files", () => {
    expect(evaluateCommitLandGate(base)).toEqual({ ok: true });
  });

  it("blocks on a turn first, then a pending commit, then empty changeset, then empty message", () => {
    expect(evaluateCommitLandGate({ ...base, turnInProgress: true })).toEqual({
      ok: false,
      reason: "turn",
    });
    expect(evaluateCommitLandGate({ ...base, commitPhase: "pending" })).toEqual({
      ok: false,
      reason: "pending",
    });
    expect(evaluateCommitLandGate({ ...base, fileCount: 0 })).toEqual({
      ok: false,
      reason: "empty-changeset",
    });
    expect(evaluateCommitLandGate({ ...base, message: "   " })).toEqual({
      ok: false,
      reason: "empty-message",
    });
  });
});

describe("CommitDialogController transitions", () => {
  it("show opens the dialog and hides the shade", () => {
    const shade = new ShadeViewController();
    shade.show("changes");
    const controller = makeController(shade);

    controller.show();
    expect(controller.getSnapshot().open).toBe(true);
    expect(shade.getSnapshot()).toBe("none");
  });

  it("carries a seed message on the snapshot", () => {
    const controller = makeController(new ShadeViewController());
    controller.show("Fix the flux capacitor");
    expect(controller.getSnapshot()).toEqual({
      open: true,
      seedMessage: "Fix the flux capacitor",
    });
    controller.show("   ");
    expect(controller.getSnapshot().seedMessage).toBeNull();
  });

  it("hide closes the dialog", () => {
    const controller = makeController(new ShadeViewController());
    controller.show();
    controller.hide();
    expect(controller.getSnapshot().open).toBe(false);
  });

  it("opening the shade while the dialog is open closes the dialog (mutual exclusion)", () => {
    const shade = new ShadeViewController();
    const controller = makeController(shade);
    controller.show();
    expect(controller.getSnapshot().open).toBe(true);

    shade.show("changes");
    expect(controller.getSnapshot().open).toBe(false);
  });

  it("notifies subscribers on open and close", () => {
    const controller = makeController(new ShadeViewController());
    let notes = 0;
    controller.subscribe(() => {
      notes += 1;
    });
    controller.show();
    controller.hide();
    expect(notes).toBe(2);
  });
});
