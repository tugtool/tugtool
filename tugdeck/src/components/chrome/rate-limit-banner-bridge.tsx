/**
 * RateLimitBannerProvider — the single, app-level subscription-quota banner
 * ([#step-3.5], [D24]).
 *
 * The quota is **account-global**, so this is one banner for the whole deck —
 * never one per card. It is the sibling of {@link TugBannerProvider} (the
 * reconnection banner): always mounted at the deck root, fed by an app-level
 * store, rendering a single `TugBanner` (status variant) whose visibility is
 * state-driven. It differs from that bridge in one deliberate way — it is
 * **L02-clean**: external state enters through `useSyncExternalStore` over
 * {@link RateLimitStore}, not the bridge's `useState` + `useEffect`
 * connection-callback copy.
 *
 * Trigger (grounded in the CLI v2.1.158 `status` enum, see `lib/rate-limit.ts`):
 * hidden while `allowed`; `caution` "Approaching usage limit…" on
 * `allowed_warning`; `danger` "Usage limit reached…" on `rejected` (requests
 * are being refused — error-grade, and the terminal pops a blocking menu in
 * this state). `overageStatus` alone never escalates.
 *
 * The reset countdown is computed at render from the live `resetsAt` and
 * refreshes whenever a fresh `rate_limit_event` lands; it does not tick on a
 * timer — one low-frequency app-level surface does not warrant the [L22]
 * machinery a per-row hot path would.
 *
 * Laws: [L02] store subscription, [L06] appearance via the composed TugBanner
 *
 * @module components/chrome/rate-limit-banner-bridge
 */

import React, { useSyncExternalStore } from "react";

import { TugBanner } from "@/components/tugways/tug-banner";
import type { RateLimitStore } from "../../lib/rate-limit-store";
import { formatResetCountdown, rateLimitBannerState } from "../../lib/rate-limit";

export interface RateLimitBannerProviderProps {
  /** App-level account-global quota store (constructed once at deck boot). */
  store: RateLimitStore;
}

/**
 * Render the one deck-wide rate-limit banner. Hidden unless the account quota
 * is approaching or at its limit.
 */
export function RateLimitBannerProvider({
  store,
}: RateLimitBannerProviderProps): React.ReactElement {
  const rateLimit = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const state = rateLimitBannerState(rateLimit);
  const visible = state !== "ok";

  let message = "";
  if (rateLimit !== null && visible) {
    const resets = formatResetCountdown(rateLimit.resetsAt, Date.now());
    message =
      state === "limited"
        ? `Usage limit reached — resets in ${resets} · check usage at claude.ai`
        : `Approaching usage limit — resets in ${resets} · check usage at claude.ai`;
  }

  return (
    <TugBanner
      // `rate-limit-banner` distinguishes this from the always-mounted
      // reconnection banner (both are status-variant `tug-banner`s).
      className="rate-limit-banner"
      visible={visible}
      variant="status"
      tone={state === "limited" ? "danger" : "caution"}
      message={message}
      icon="triangle-alert"
    />
  );
}
