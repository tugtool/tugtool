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
 *   1. **error** — `lastError` is set, the cause is banner-routable
 *      (i.e. not `resume_failed`), and the error has not been
 *      user-dismissed by `at` timestamp.
 *   2. **transport** — `transportState !== "online"`. Covers
 *      idle-offline (and, defensively, restoring; the gate already
 *      routes restoring to a backdrop, so this branch is a no-op
 *      in production).
 *   3. **none** — no banner.
 *
 * Replay-loading / replay-timeout cases will be added in the next
 * commit when the gate stops routing those phases to a backdrop. For
 * now `none` is the terminal branch.
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
    };

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
 * - error wins when present and not dismissed
 * - transport wins when no error is showing and the wire is not online
 * - none otherwise
 */
export function deriveTideCardBannerSpec(
  snap: CodeSessionSnapshot,
  ctx: TideCardBannerCtx,
): TideCardBannerSpec {
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
  return { kind: "none" };
}
