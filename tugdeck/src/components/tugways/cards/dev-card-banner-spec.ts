/**
 * Pure derivation of the Dev card's `<TugPaneBanner>` spec from the
 * `CodeSessionSnapshot` plus a small UI-local context (the dismissed
 * error timestamp). The body renders **one** banner whose props
 * are computed by mapping the spec's discriminated kind to
 * `TugPaneBanner` props.
 *
 * The banner is reserved for genuine **breakage** — only the `error`
 * kind. It is the one surface allowed to lock the card (it sets `inert`
 * on the pane body), which is the right cost for a session that can't be
 * reached and needs an explicit dismiss.
 *
 * Every *transient*, self-healing interruption — API retries, transport
 * blips, the replay-timeout dwell, and forward-compat unknown events —
 * was once a `status`-variant banner here, but a banner locks the prompt
 * for a notice that doesn't warrant it. Those now route to non-blocking
 * top-right pane bulletins (`transient-notice.ts` +
 * `TransientNoticeController`), driven directly off the store. So this
 * helper is down to two outcomes: `error` or `none`.
 *
 * Why a separate module: the helper is pure, takes a snapshot, and
 * returns a discriminated union. Testing it in isolation
 * (`dev-card-banner-spec.test.ts`) verifies the branch without spinning
 * up a real card render. The body does the spec → `TugPaneBanner` props
 * mapping inline since that's a presentational concern best read
 * alongside the JSX that consumes it.
 */

import type { CodeSessionSnapshot } from "@/lib/code-session-store";

/**
 * Subset of `LastErrorCause` that the card banner-routes. The full
 * cause includes `resume_failed`, which is intercepted upstream by
 * `useDevCardObserver` (the binding is cleared and the picker
 * re-presents with notice), so the card never banners it.
 */
export type BannerErrorCause = Exclude<
  NonNullable<CodeSessionSnapshot["lastError"]>["cause"],
  "resume_failed"
>;

/** Discriminated union returned by `deriveDevCardBannerSpec`. */
export type DevCardBannerSpec =
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
    };

/**
 * UI-local context the helper needs in addition to the snapshot.
 * `dismissedAt` is the `at` of the last-dismissed error: a Dismiss click
 * stamps it, suppressing that exact error until a fresh one (different
 * `at`) arrives.
 */
export interface DevCardBannerCtx {
  dismissedAt: number | null;
}

/**
 * Pure derivation. The banner shows only genuine breakage:
 * - `error` when `lastError` is set, banner-routable (not `resume_failed`),
 *   and not user-dismissed
 * - `none` otherwise
 *
 * Transient interruptions (retry / transport / replay-timeout dwell /
 * unknown-event) are NOT banners — they route to top-right pane bulletins
 * via `TransientNoticeController`. The cold-restore loading window is the
 * `DevRestoring` placeholder; this helper runs only once `DevCardBody` is
 * mounted, i.e. after the restore has resolved.
 */
export function deriveDevCardBannerSpec(
  snap: CodeSessionSnapshot,
  ctx: DevCardBannerCtx,
): DevCardBannerSpec {
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
  return { kind: "none" };
}
