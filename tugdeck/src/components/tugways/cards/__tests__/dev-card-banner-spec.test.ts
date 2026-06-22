/**
 * Unit tests for `deriveDevCardBannerSpec` — the pure helper that decides
 * whether the Dev card surfaces its (locking) breakage banner.
 *
 * The banner is reserved for genuine breakage: the helper returns only
 * `error` or `none`. Every transient interruption (api-retry, transport,
 * replay-timeout dwell, unknown-event) now routes to non-blocking top-right
 * pane bulletins via `TransientNoticeController` — so a snapshot carrying
 * those conditions, with no `lastError`, must produce `none` here. The last
 * describe block pins that reservation.
 *
 * The helper is pure and synchronous, so each test crafts a minimal
 * `CodeSessionSnapshot` and asserts the returned spec. No render, no real
 * store.
 */

import { describe, it, expect } from "bun:test";

import {
  deriveDevCardBannerSpec,
  type DevCardBannerSpec,
} from "@/components/tugways/cards/dev-card-banner-spec";
import type { CodeSessionSnapshot } from "@/lib/code-session-store";

function baseSnap(
  overrides: Partial<CodeSessionSnapshot> = {},
): CodeSessionSnapshot {
  return {
    phase: "idle",
    transportState: "online",
    interruptInFlight: false,
    tugSessionId: "tug-1",
    displayLabel: "test",
    sessionMode: "new",
    restoreWindowTurns: 25,
    activeMsgId: null,
    canSubmit: true,
    canInterrupt: false,
    pendingApproval: null,
    pendingQuestion: null,
    queuedSends: [],
    transcript: [],
    rewindPreviews: new Map(),
    lastRewindResult: null,
    activeTurn: null,
    wakeTrigger: null,
    jobs: [],
    pendingDraftRestore: null,
    lastCost: null,
    apiRetry: null,
    refusalFallback: null,
    outputTruncated: false,
    unknownEvent: null,
    compactionSeed: null,
    permissionDenials: [],
    liveTurnUsage: null,
    sessionInitTokens: null,
    lastContextBreakdown: null,
    lastError: null,
    lastReplayResult: null,
    replayEverCompleted: false,
    replayWindow: null,
    sessionCreatedAtMs: null,
    loadingPrevious: false,
    loadingPreviousTarget: 0,
    loadingPreviousLoaded: 0,
    replayPreflightActive: false,
    replaySoftBudgetElapsed: false,
    replayTimeoutDwellActive: false,
    awaitingApprovalIntervals: [],
    awaitingApprovalSegmentStartedAt: null,
    transportDowntimeIntervals: [],
    transportDowntimeSegmentStartedAt: null,
    interruptInFlightIntervals: [],
    interruptInFlightSegmentStartedAt: null,
    ...overrides,
  };
}

describe("deriveDevCardBannerSpec — breakage only", () => {
  it("returns kind=none when nothing of interest is true", () => {
    const spec = deriveDevCardBannerSpec(baseSnap(), { dismissedAt: null });
    expect(spec).toEqual({ kind: "none" } satisfies DevCardBannerSpec);
  });

  it("error surfaces when lastError is set with a banner-routable cause", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        lastError: { cause: "session_state_errored", message: "boom", at },
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

  it("error wins even when a transport blip is also present", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        lastError: { cause: "transport_closed", message: "closed", at },
        transportState: "offline",
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("error");
  });

  it("a dismissed error falls through to none (transient blips don't banner)", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        lastError: { cause: "session_state_errored", message: "boom", at },
        transportState: "offline",
      }),
      { dismissedAt: at },
    );
    expect(spec).toEqual({ kind: "none" });
  });

  it("a fresh error (different at) re-raises after a dismiss", () => {
    const dismissedAt = 1_700_000_000_000;
    const newAt = dismissedAt + 1000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        lastError: { cause: "wire_error", message: "different boom", at: newAt },
      }),
      { dismissedAt },
    );
    expect(spec.kind).toBe("error");
    if (spec.kind === "error") {
      expect(spec.at).toBe(newAt);
      expect(spec.message).toBe("different boom");
    }
  });

  it("attachment_rejected surfaces as an error banner", () => {
    const at = 1_700_000_000_500;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        lastError: {
          cause: "attachment_rejected",
          message: "Unsupported file type: foo.pdf.",
          at,
        },
      }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({
      kind: "error",
      cause: "attachment_rejected",
      message: "Unsupported file type: foo.pdf.",
      at,
    });
  });

  it("resume_failed never surfaces (intercepted upstream by useDevCardObserver)", () => {
    const spec = deriveDevCardBannerSpec(
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
});

describe("deriveDevCardBannerSpec — transient conditions no longer banner", () => {
  it("transport offline alone produces no banner (it's a bulletin now)", () => {
    expect(
      deriveDevCardBannerSpec(baseSnap({ transportState: "offline" }), {
        dismissedAt: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("transport restoring alone produces no banner", () => {
    expect(
      deriveDevCardBannerSpec(baseSnap({ transportState: "restoring" }), {
        dismissedAt: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("an active api-retry produces no banner", () => {
    expect(
      deriveDevCardBannerSpec(
        baseSnap({
          apiRetry: {
            attempt: 3,
            maxRetries: 10,
            deadline: 1_700_000_010_000,
            error: "rate_limit",
            errorStatus: 429,
          },
        }),
        { dismissedAt: null },
      ),
    ).toEqual({ kind: "none" });
  });

  it("an active replay-timeout dwell produces no banner", () => {
    expect(
      deriveDevCardBannerSpec(baseSnap({ replayTimeoutDwellActive: true }), {
        dismissedAt: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("an unknown-event produces no banner", () => {
    expect(
      deriveDevCardBannerSpec(
        baseSnap({
          unknownEvent: {
            originalType: "future_telemetry",
            payloadHexPreview: "7b7d",
            at: 1_700_000_005_000,
          },
        }),
        { dismissedAt: null },
      ),
    ).toEqual({ kind: "none" });
  });

  it("a real error still wins over any concurrent transient condition", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        transportState: "offline",
        replayTimeoutDwellActive: true,
        apiRetry: {
          attempt: 1,
          maxRetries: 10,
          deadline: 1_700_000_010_000,
          error: "overloaded",
          errorStatus: 529,
        },
        lastError: { cause: "wire_error", message: "boom", at },
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("error");
  });
});

/**
 * The cold-restore loading window is the `DevRestoring` placeholder, not a
 * banner; this helper runs only once the body is mounted. These pin that the
 * replay-window signals never produce a banner and never suppress an error.
 */
describe("deriveDevCardBannerSpec — replay-loading retired", () => {
  it("replayPreflightActive alone produces no banner", () => {
    expect(
      deriveDevCardBannerSpec(baseSnap({ replayPreflightActive: true }), {
        dismissedAt: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("phase=replaying produces no banner", () => {
    expect(
      deriveDevCardBannerSpec(
        baseSnap({ phase: "replaying", sessionMode: "resume" }),
        { dismissedAt: null },
      ),
    ).toEqual({ kind: "none" });
  });

  it("preflight no longer masks an error — the error surfaces", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        replayPreflightActive: true,
        lastError: { cause: "session_state_errored", message: "boom", at },
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
});
