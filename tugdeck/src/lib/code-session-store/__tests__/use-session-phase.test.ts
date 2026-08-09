/**
 * The doubt rule, and the fold that carries it.
 *
 * `useSessionPhase` walks session → card → services → snapshot, and that walk
 * only exists in a running app; the picker row for a closed session is covered
 * by an app-test. What IS a decision rather than plumbing is what the hook
 * answers when the walk comes up empty, and that lives in
 * `sessionPhaseFromSnapshot`, which is pure.
 */

import { describe, expect, test } from "bun:test";

import type { JobItem } from "../select-jobs";
import { sessionSessionPhaseVisual } from "../session-phase-visual";
import {
  sessionPhaseFromSnapshot,
  type SessionPhaseSource,
} from "../use-session-phase";

function snapshot(over: Partial<SessionPhaseSource> = {}): SessionPhaseSource {
  return {
    phase: "idle",
    transportState: "online",
    interruptInFlight: false,
    jobs: [],
    pendingAsk: null,
    ...over,
  };
}

describe("unknown liveness reads idle, never danger", () => {
  test("no snapshot — no card, or services not yet constructed — is idle", () => {
    expect(sessionPhaseFromSnapshot(null)).toBe("idle");
  });

  test("idle is not the danger role, which is what makes the fallback safe", () => {
    // The two halves of the decision have to be checked together: answering
    // `idle` would buy nothing if `idle` painted red, and this is the mapping
    // the retired offline fallback went through to get there.
    expect(sessionSessionPhaseVisual("idle").role).not.toBe("danger");
    expect(sessionSessionPhaseVisual("offline").role).toBe("danger");
  });

  test("a card whose transport is genuinely offline still reads danger", () => {
    // Doubt is not failure, but failure is still failure: a session with a live
    // card and a dead wire has something real to report.
    expect(
      sessionPhaseFromSnapshot(snapshot({ transportState: "offline" })),
    ).toBe("offline");
  });
});

describe("the fold reports what the snapshot holds", () => {
  test("a quiet session is idle", () => {
    expect(sessionPhaseFromSnapshot(snapshot())).toBe("idle");
  });

  test("agents running with no turn in flight is background, not idle", () => {
    const job: JobItem = {
      jobId: "j1",
      source: "claude",
      kind: "agent",
      toolUseId: "t1",
      description: "auditing the theme tokens",
      status: "running",
      startedAtMs: 0,
      endedAtMs: null,
    };
    expect(
      sessionPhaseFromSnapshot(snapshot({ phase: "idle", jobs: [job] })),
    ).toBe("background");
  });

  test("a turn in flight reports its own phase", () => {
    expect(sessionPhaseFromSnapshot(snapshot({ phase: "streaming" }))).toBe(
      "streaming",
    );
  });
});
