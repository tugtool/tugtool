/**
 * Unit tests for `deriveDevCardBannerSpec` — the pure precedence
 * helper that decides which banner kind the Dev card surfaces.
 *
 * The helper is pure and synchronous, so each test crafts a minimal
 * `CodeSessionSnapshot` and asserts the returned spec. No render, no
 * real store. The precedence chain (error > transport > replay-timeout
 * > none) is exercised branch-by-branch, plus the dismissed-error
 * fall-through.
 *
 * The `replay-loading` kind was retired — the
 * cold-restore loading window is the `DevRestoring` placeholder, not
 * a banner, and this helper now runs only once the body is mounted.
 * The last describe block pins that retirement: a preflight-active or
 * `phase === "replaying"` snapshot no longer produces a banner.
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
    pendingDraftRestore: null,
    lastCost: null,
    apiRetry: null,
    permissionDenials: [],
    liveTurnUsage: null,
    sessionInitTokens: null,
    lastContextBreakdown: null,
    lastError: null,
    lastReplayResult: null,
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

describe("deriveDevCardBannerSpec — precedence chain", () => {
  it("returns kind=none when nothing of interest is true", () => {
    const spec = deriveDevCardBannerSpec(baseSnap(), { dismissedAt: null });
    expect(spec).toEqual({ kind: "none" } satisfies DevCardBannerSpec);
  });

  it("error wins when lastError is set with a banner-routable cause", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
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
    const spec = deriveDevCardBannerSpec(
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
    const spec = deriveDevCardBannerSpec(
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
    const spec = deriveDevCardBannerSpec(
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
    const spec = deriveDevCardBannerSpec(
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

  it("attachment_rejected surfaces as an error banner — does NOT escalate to session-dead overlay (Step 3.5.1)", () => {
    // Distinct from session_state_errored / wire_error: this cause is
    // transient input-validation feedback (drop / paste of an
    // unsupported file). The banner appears, the user reads it, the
    // next successful turn clears it. The session-dead overlay
    // (the "card can't reach its session" alert with the unplug icon)
    // is suppressed by `sessionErrored` in `dev-card.tsx`.
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

  it("transport offline surfaces the transport spec when no error is set", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ transportState: "offline" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "transport", state: "offline" });
  });

  it("transport restoring surfaces the transport spec when no error is set", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ transportState: "restoring" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "transport", state: "restoring" });
  });

  it("replay-timeout surfaces while the dwell window is active", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ replayTimeoutDwellActive: true }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "replay-timeout" });
  });

  it("error outranks an active replay-timeout dwell", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        replayTimeoutDwellActive: true,
        lastError: { cause: "wire_error", message: "boom", at },
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("error");
  });

  it("transport outranks an active replay-timeout dwell", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ replayTimeoutDwellActive: true, transportState: "offline" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "transport", state: "offline" });
  });
});

describe("deriveDevCardBannerSpec — api-retry", () => {
  const retry = {
    attempt: 3,
    maxRetries: 10,
    deadline: 1_700_000_010_000,
    error: "rate_limit",
    errorStatus: 429,
  };

  it("surfaces a classified api-retry spec when apiRetry is set", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ apiRetry: retry }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({
      kind: "api-retry",
      severity: "transient",
      label: "Rate limited",
      attempt: 3,
      maxRetries: 10,
      deadline: 1_700_000_010_000,
    } satisfies DevCardBannerSpec);
  });

  it("classifies a likely-fatal category as fatal severity", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        apiRetry: { ...retry, error: "authentication_failed", errorStatus: 401 },
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("api-retry");
    if (spec.kind === "api-retry") {
      expect(spec.severity).toBe("likely-fatal");
      expect(spec.label).toBe("Authentication failed");
    }
  });

  it("a hard error outranks an api-retry", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        apiRetry: retry,
        lastError: { cause: "wire_error", message: "boom", at },
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("error");
  });

  it("api-retry outranks a transport blip and a replay-timeout dwell", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        apiRetry: retry,
        transportState: "offline",
        replayTimeoutDwellActive: true,
      }),
      { dismissedAt: null },
    );
    expect(spec.kind).toBe("api-retry");
  });

  it("a dismissed error falls through to the api-retry banner", () => {
    const at = 1_700_000_000_000;
    const spec = deriveDevCardBannerSpec(
      baseSnap({
        apiRetry: retry,
        lastError: { cause: "wire_error", message: "boom", at },
      }),
      { dismissedAt: at },
    );
    expect(spec.kind).toBe("api-retry");
  });
});

/**
 * The `replay-loading` banner kind was retired. The
 * cold-restore loading window is now held by the `DevRestoring`
 * placeholder, and `deriveDevCardBannerSpec` runs only once
 * `DevCardBody` is mounted — after the restore has resolved. These
 * tests pin that the replay-window signals (`replayPreflightActive`,
 * `phase === "replaying"`) no longer produce a banner, and — the
 * inverse of the old precedence — no longer suppress an error or
 * transport banner either.
 */
describe("deriveDevCardBannerSpec — replay-loading retired (D.2.A)", () => {
  it("replayPreflightActive alone produces no banner", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ replayPreflightActive: true }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "none" });
  });

  it("phase=replaying in resume mode produces no banner", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ phase: "replaying", sessionMode: "resume" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "none" });
  });

  it("phase=replaying in new mode produces no banner", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ phase: "replaying", sessionMode: "new" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "none" });
  });

  it("preflight no longer masks an error — the error surfaces", () => {
    // Old behavior: a preflight beat suppressed transient errors so a
    // stale frame couldn't flash the banner. With the body now held
    // unmounted across the whole cold-restore window, this helper
    // never runs during preflight; if it somehow does, the error is
    // shown rather than swallowed.
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

  it("preflight no longer masks a transport blip — the transport banner surfaces", () => {
    const spec = deriveDevCardBannerSpec(
      baseSnap({ replayPreflightActive: true, transportState: "offline" }),
      { dismissedAt: null },
    );
    expect(spec).toEqual({ kind: "transport", state: "offline" });
  });
});
