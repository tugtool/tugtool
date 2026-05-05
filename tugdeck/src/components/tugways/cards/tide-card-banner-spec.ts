/**
 * Pure derivation of the Tide card's `<TugPaneBanner>` spec from the
 * `CodeSessionSnapshot` plus a small UI-local context (the dismissed
 * error timestamp). The body renders **one** banner whose props
 * are computed by mapping the spec's discriminated kind to
 * `TugPaneBanner` props — the precedence chain in this helper is the
 * single source of truth for "which banner surface is showing".
 *
 * Precedence (highest first):
 *
 *   1. **replay-loading via preflight** — `replayPreflightActive` is
 *      true. The cold-boot bridge between binding rehydrate and the
 *      first `replay_started` event is informational; the user
 *      explicitly asked to resume a session and is waiting for it.
 *      During this window we suppress transient errors and transport
 *      blips so the banner stays a stable "Loading conversation"
 *      beat instead of flashing through error / transport / loading
 *      kinds during a noisy startup. Preflight clears on the first
 *      of `replay_started` / `replay_complete` / `transport_close` /
 *      a 12s last-resort tick — at which point normal precedence
 *      resumes.
 *   2. **error** — `lastError` is set, the cause is banner-routable
 *      (i.e. not `resume_failed`), and the error has not been
 *      user-dismissed by `at` timestamp.
 *   3. **transport** — `transportState !== "online"`. Covers
 *      idle-offline (and, defensively, restoring; the gate already
 *      routes restoring to a backdrop, so this branch is a no-op
 *      in production).
 *   4. **replay-timeout** — the most recent replay completed with a
 *      `replay_timeout` outcome and the dwell window (1.5s) is still
 *      active. Surfaces the failure copy briefly before dismissing.
 *   5. **replay-loading via active phase** — `phase === "replaying"`
 *      (live replay window). The soft-budget flag promotes the
 *      banner copy from the generic "Loading conversation…" to the
 *      count-aware "Loading conversation… (N turns)" once the wait
 *      has lasted long enough that progress detail reads as
 *      reassurance rather than noise.
 *   6. **none** — no banner.
 *
 * Why a separate module: the helper is pure, takes a snapshot, and
 * returns a discriminated union. Testing it in isolation
 * (`tide-card-banner-spec.test.ts`) verifies the precedence chain
 * branch-by-branch without spinning up a real card render. The body
 * does the spec → `TugPaneBanner` props mapping inline since that's
 * a presentational concern best read alongside the JSX that consumes
 * it.
 */

import type { CodeSessionSnapshot } from "@/lib/code-session-store";

/**
 * Subset of `LastErrorCause` that the card banner-routes. The full
 * cause includes `resume_failed`, which is intercepted upstream by
 * `useTideCardObserver` (the binding is cleared and the picker
 * re-presents with notice), so the card never banners it.
 */
export type BannerErrorCause = Exclude<
  NonNullable<CodeSessionSnapshot["lastError"]>["cause"],
  "resume_failed"
>;

/** Discriminated union returned by `deriveTideCardBannerSpec`. */
export type TideCardBannerSpec =
  | { kind: "none" }
  | {
      kind: "error";
      cause: BannerErrorCause;
      message: string;
      /**
       * Reducer-stamped `Date.now()` from when the error was
       * recorded. Threaded through to the Dismiss button so a click
       * stamps `dismissedAt`, suppressing this exact error; a fresh
       * error (different `at`) re-raises naturally.
       */
      at: number;
    }
  | {
      kind: "transport";
      state: "offline" | "restoring";
    }
  | {
      kind: "replay-loading";
      /**
       * Number of turns committed to the transcript so far in this
       * replay window. `null` until the soft-budget flag elapses (or
       * during the preflight beat where no replay window has opened
       * yet). The body promotes the copy from "Loading conversation…"
       * to "Loading conversation… (N turns)" once a non-null count
       * lands.
       */
      turnsCount: number | null;
    }
  | { kind: "replay-timeout" };

/**
 * UI-local context the helper needs in addition to the snapshot.
 * Today only `dismissedAt` (the `at` timestamp of the last-dismissed
 * error). Future fields stay in this object so the helper signature
 * doesn't churn each time we surface a new transient banner state.
 */
export interface TideCardBannerCtx {
  dismissedAt: number | null;
}

/**
 * Pure derivation. Mutually exclusive by construction:
 * - preflight wins over everything (cold-boot bridge — see module
 *   docstring for why we suppress transient errors here)
 * - error wins next when present and not dismissed
 * - transport wins when no error is showing and the wire is not online
 * - replay-timeout wins over the active-phase replay-loading (the
 *   dwell is brief and stamps the most-recent outcome before any new
 *   window opens)
 * - replay-loading covers the live replay window
 * - none otherwise
 */
export function deriveTideCardBannerSpec(
  snap: CodeSessionSnapshot,
  ctx: TideCardBannerCtx,
): TideCardBannerSpec {
  if (snap.replayPreflightActive) {
    return { kind: "replay-loading", turnsCount: null };
  }
  if (
    snap.lastError !== null &&
    snap.lastError.cause !== "resume_failed" &&
    snap.lastError.at !== ctx.dismissedAt
  ) {
    return {
      kind: "error",
      cause: snap.lastError.cause as BannerErrorCause,
      message: snap.lastError.message,
      at: snap.lastError.at,
    };
  }
  if (snap.transportState !== "online") {
    return { kind: "transport", state: snap.transportState };
  }
  if (snap.replayTimeoutDwellActive) {
    return { kind: "replay-timeout" };
  }
  if (snap.phase === "replaying") {
    return {
      kind: "replay-loading",
      turnsCount: snap.replaySoftBudgetElapsed ? snap.transcript.length : null,
    };
  }
  return { kind: "none" };
}
