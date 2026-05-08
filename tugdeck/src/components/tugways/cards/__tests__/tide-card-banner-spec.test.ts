/**
 * Unit tests for `deriveTideCardBannerSpec` — the pure precedence
 * helper that decides which banner kind the Tide card surfaces.
 *
 * The helper is pure and synchronous, so each test crafts a minimal
 * `CodeSessionSnapshot` and asserts the returned spec. No render,
 * no real store. The precedence chain (preflight > error > transport
 * > replay-timeout > replay-loading > none, with replay-loading via
 * active phase gated on `sessionMode === "resume"`) is exercised
 * branch-by-branch, plus the dismissed-error fall-through.
 */

import { describe, it, expect } from "bun:test";

import {
  deriveTideCardBannerSpec,
  type TideCardBannerSpec,
} from "@/components/tugways/cards/tide-card-banner-spec";
import type {
  CodeSessionSnapshot,
  TurnEntry,
} from "@/lib/code-session-store";
import { STREAMING_PATHS } from "@/lib/code-session-store/types";

/**
 * Minimal `TurnEntry` stub for tests that only care about
 * `transcript.length`. The helper reads the count to drive
 * `turnsCount` on the replay-loading spec; the entry's content
 * is irrelevant to that derivation. Per-field correctness is
 * exercised by the store's own tests.
 */
function fakeTurn(msgId: string): TurnEntry {
  return {
    msgId,
    userMessage: { text: "", attachments: [], submitAt: 0 },
    thinking: "",
    assistant: "",
    toolCalls: [],
    result: "success",
    endedAt: 0,
  };
}

function baseSnap(
  overrides: Partial<CodeSessionSnapshot> = {},
): CodeSessionSnapshot {
  return {
    phase: "idle",
    transportState: "online",
    tugSessionId: "tug-1",
    displayLabel: "test",
    // Default fixtures to "new" — Step 2 will exercise both modes
    // explicitly. Step 1 is purely additive (the helper does not yet
    // read sessionMode), so this default does not affect any existing
    // assertion in this file.
    sessionMode: "new",
    activeMsgId: null,
    canSubmit: true,
    canInterrupt: false,
    pendingApproval: null,
    pendingQuestion: null,
    queuedSends: 0,
    transcript: [],
    inflightUserMessage: null,
    pendingDraftRestore: null,
    streamingPaths: STREAMING_PATHS,
    lastCost: null,
    lastError: null,
    lastReplayResult: null,
    replayPreflightActive: false,
    replaySoftBudgetElapsed: false,
    replayTimeoutDwellActive: false,
    ...overrides,
  };
}

describe("deriveTideCardBannerSpec — precedence chain", () => {
  it("returns kind=none when nothing of interest is true", () => {
    const spec = deriveTideCardBannerSpec(baseSnap(), { dismissedAt: null });
    expect(spec).toEqual({ kind: "none" } satisfies TideCardBannerSpec);
  });

  it("error wins when lastError is set with a banner-routable cause", () => {
    const at = 1_700_000_000_000;
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "session_state_errored",
          message: "boom",
          at,
        },
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({
      kind: "error",
      cause: "session_state_errored",
      message: "boom",
      at,
    });
  });

  it("error wins over transport-state when both are present", () => {
    const at = 1_700_000_000_000;
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "transport_closed",
          message: "transport closed",
          at,
        },
        transportState: "offline",
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("error");
  });

  it("dismissed error falls through; transport banner takes its place", () => {
    const at = 1_700_000_000_000;
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "session_state_errored",
          message: "boom",
          at,
        },
        transportState: "offline",
      }),
      { dismissedAt: at },
    );
    expect(spec).toEqual({ kind: "transport", state: "offline" });
  });

  it("dismissed error falls through to kind=none when no other condition fires", () => {
    const at = 1_700_000_000_000;
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "wire_error",
          message: "boom",
          at,
        },
      }),
      { dismissedAt: at },
    );
    expect(spec).toEqual({ kind: "none" });
  });

  it("a fresh error (different at) re-raises after a dismiss", () => {
    const dismissedAt = 1_700_000_000_000;
    const newAt = dismissedAt + 1000;
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "wire_error",
          message: "different boom",
          at: newAt,
        },
      }),
      { dismissedAt },
    );
    expect(spec.kind).toBe("error");
    if (spec.kind === "error") {
      expect(spec.at).toBe(newAt);
      expect(spec.message).toBe("different boom");
    }
  });

  it("resume_failed never surfaces (intercepted upstream by useTideCardObserver)", () => {
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "resume_failed",
          message: "stale id",
          at: 1_700_000_000_000,
        },
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("none");
  });

  it("transport offline surfaces the transport spec when no error is set", () => {
    const spec = deriveTideCardBannerSpec(
      baseSnap({ transportState: "offline" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "transport", state: "offline" });
  });

  it("transport restoring surfaces the transport spec when no error is set", () => {
    const spec = deriveTideCardBannerSpec(
      baseSnap({ transportState: "restoring" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "transport", state: "restoring" });
  });

  it("preflight wins over a transient error during the cold-boot bridge", () => {
    // Even if a stale frame replays an error into the new store
    // during cold boot, the preflight beat keeps the banner stable.
    // Once preflight clears (replay_started / replay_complete /
    // transport_close / 12s tick) normal precedence resumes and the
    // error surfaces if still set.
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        replayPreflightActive: true,
        lastError: {
          cause: "session_state_errored",
          message: "stale flash",
          at: 1_700_000_000_000,
        },
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "replay-loading", turnsCount: null });
  });

  it("preflight wins over a transient transport blip during the cold-boot bridge", () => {
    // Same logic as the error case: a brief offline/restoring blip
    // during cold boot shouldn't flash a transport banner over the
    // resume UX.
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        replayPreflightActive: true,
        transportState: "offline",
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "replay-loading", turnsCount: null });
  });

  it("once preflight clears, suppressed errors surface naturally", () => {
    const at = 1_700_000_000_000;
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        replayPreflightActive: false,
        lastError: {
          cause: "session_state_errored",
          message: "real error",
          at,
        },
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({
      kind: "error",
      cause: "session_state_errored",
      message: "real error",
      at,
    });
  });
});

/**
 * Branch 5 of the precedence chain — replay-loading driven by
 * `phase === "replaying"` (the live JSONL replay window). This
 * branch is gated on `sessionMode === "resume"` because the
 * new-mode JSONL-missing round-trip has nothing user-visible to
 * communicate; banner mount during that window would steal caret
 * focus from the just-focused editor for the duration of the
 * banner's `minMountedMs` + exit animation. See module docstring
 * branch 5 / [V03] in `tugplan-tide-session-init-orchestration.md`
 * for the full rationale.
 *
 * Branch 1 (preflight) is *not* mode-gated by the helper itself —
 * production correctness depends on `notifyResumeBindingLanded()`
 * being gated upstream in `cardServicesStore`. The helper takes
 * the snapshot at face value. The third test below pins that
 * surface so a future reader does not assume branch 1 is mode-aware
 * and remove the upstream gate by mistake. ([R01])
 *
 * [L11] the banner is a status surface, not a responder; this
 *       helper makes the kind decision and the consumer renders;
 *       there is no state ownership change here.
 * [L23] suppressing the silly banner *removes* a transition that
 *       was destroying caret state — this gate is L23-positive.
 */
describe("deriveTideCardBannerSpec — replay-loading via active phase", () => {
  it("returns kind=none for new mode during the JSONL-missing round-trip", () => {
    // Models the production new-session bind path: services
    // construct, `sendRequestReplay` fires, `replay_started` lands
    // → `phase === "replaying"`. With `sessionMode: "new"` the
    // helper returns `none`; the banner never mounts and the
    // freshly-focused editor keeps its caret.
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        phase: "replaying",
        sessionMode: "new",
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "none" });
  });

  it("returns kind=replay-loading with turnsCount=null for resume mode pre-soft-budget", () => {
    // Soft-budget flag has not yet flipped: the banner shows the
    // generic "Loading session…" copy without a turn count.
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        phase: "replaying",
        sessionMode: "resume",
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "replay-loading", turnsCount: null });
  });

  it("returns kind=replay-loading with the transcript count once soft-budget elapses (resume mode)", () => {
    // After the soft-budget timer fires, the banner promotes its
    // copy to "Loading session… (N turns)". The count comes from
    // the transcript already committed during the replay window.
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        phase: "replaying",
        sessionMode: "resume",
        replaySoftBudgetElapsed: true,
        transcript: [fakeTurn("m1"), fakeTurn("m2")],
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "replay-loading", turnsCount: 2 });
  });

  it("preflight branch is NOT mode-gated by the helper itself (production guard is upstream)", () => {
    // Defensive: if `replayPreflightActive: true` ever appears with
    // `sessionMode: "new"`, branch 1 still fires. Production never
    // emits this combination because `cardServicesStore` only calls
    // `notifyResumeBindingLanded()` for resume bindings, but the
    // helper's surface contract is "trust the snapshot." Removing
    // the upstream gate must not silently change the helper's
    // behavior, so this case is pinned. [R01]
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        replayPreflightActive: true,
        sessionMode: "new",
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "replay-loading", turnsCount: null });
  });

  it("kind=none when phase is replaying but neither preflight nor resume mode applies (new-mode tail)", () => {
    // Edge-case completeness: the soft-budget flag is irrelevant for
    // new-mode because branch 5 short-circuits to `none` before
    // reading it. This test pins that semantics so a future helper
    // refactor that re-orders the conditions does not accidentally
    // surface the banner for a new-mode tail.
    const spec = deriveTideCardBannerSpec(
      baseSnap({
        phase: "replaying",
        sessionMode: "new",
        replaySoftBudgetElapsed: true,
        transcript: [fakeTurn("m1")],
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "none" });
  });
});
