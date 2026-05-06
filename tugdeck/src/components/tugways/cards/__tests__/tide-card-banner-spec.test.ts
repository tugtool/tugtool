/**
 * Unit tests for `deriveTideCardBannerSpec` — the pure precedence
 * helper that decides which banner kind the Tide card surfaces.
 *
 * The helper is pure and synchronous, so each test crafts a minimal
 * `CodeSessionSnapshot` and asserts the returned spec. No render,
 * no real store. Each branch of the precedence chain
 * (error > transport > none) gets a dedicated case plus a
 * dismissed-error fall-through.
 */

import { describe, it, expect } from "bun:test";

import {
  deriveTideCardBannerSpec,
  type TideCardBannerSpec,
} from "@/components/tugways/cards/tide-card-banner-spec";
import type { CodeSessionSnapshot } from "@/lib/code-session-store";
import { STREAMING_PATHS } from "@/lib/code-session-store/types";

function baseSnap(
  overrides: Partial<CodeSessionSnapshot> = {},
): CodeSessionSnapshot {
  return {
    phase: "idle",
    transportState: "online",
    tugSessionId: "tug-1",
    displayLabel: "test",
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
