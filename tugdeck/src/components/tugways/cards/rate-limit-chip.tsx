/**
 * `RateLimitChip` — the Z4B subscription-quota indicator chip.
 *
 * A two-line `TugBadge` (`label-top` / `size="sm"`) carrying a `LIMIT`
 * caption over the time until the subscription window resets (`5h 23m` →
 * `59m` → `Rate-limited`). Pure indicator per [D13] — no click affordance;
 * the quota is claude's to report, not the user's to change.
 *
 * **The one state-driven-role Z4B chip ([D01]).** Where the neighbour chips
 * pin `role="agent"`, this chip escalates its role with the quota: `agent`
 * at rest, `caution` on a warning / overage, `danger` when the window is
 * exhausted or overage is rejected. The structural quota state ([L02] — read
 * from `SessionMetadataStore` via `useSyncExternalStore`) drives that role
 * and the visibility decision. Colour comes entirely from the role (the
 * badge's own tokens, [L20] — the chip never paints the composed badge's
 * chrome); the `data-status` / `data-overage` attributes are truthful DOM
 * reflections of state for inspection / tests, not colour sources.
 *
 * **Hides when there's nothing to say.** Per [#step-3] / [#q02-rate-limit-store]:
 * an `allowed` quota whose reset is more than 60 min out renders no chip;
 * every other status, and an allowed status near its reset, renders it.
 *
 * **Not width-stabilized ([R01]).** The countdown reflows the chip as it
 * ticks down — accepted by design, unlike the model / permission chips.
 *
 * **Tick is direct-DOM, never React ([L22]).** The structural quota state
 * drives the React shell (mount / role / format mode); a `setInterval`
 * mounted in `useLayoutEffect` rewrites the countdown `<span>`'s
 * `textContent` once a minute without re-entering React's render cycle. The
 * store update (~once per turn) is the only thing that re-renders the chip.
 *
 * Compositional component — composes `TugBadge`; its only own CSS is the
 * colour transition + overage treatment keyed on the data attributes. The
 * composed `TugBadge` keeps its own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] appearance via CSS/DOM,
 *       [L22] tick via store→DOM, [L19] authoring, [L20] composed tokens
 * Decisions: [D01] Z4B chrome anchor (state-driven role), [D04] metadata hub,
 *            [D13] indicator-only, [D18] strict shape, [R01] not stabilized
 *
 * @module components/tugways/cards/rate-limit-chip
 */

import "./rate-limit-chip.css";

import React, { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Clock, TriangleAlert } from "lucide-react";

import { TugBadge, type TugBadgeRole } from "@/components/tugways/tug-badge";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import {
  RATE_LIMIT_TICK_MS,
  formatResetCountdown,
  isRateLimitChipVisible,
  isRateLimitExhausted,
  rateLimitContent,
  rateLimitSeverity,
} from "@/lib/rate-limit";

/**
 * Test-only hooks the chip exposes when `window.__tugTestMode` is set, so the
 * app-test (at0095) can fire one countdown tick without waiting a real minute
 * and assert the tick writes the DOM without a React re-render. Never
 * populated in production (the flag is injected only by the DEBUG harness).
 */
declare global {
  interface Window {
    /** Fire one [L22] countdown tick (rewrites the span's textContent). */
    __atRateLimitTick?: () => void;
    /** Count of `RateLimitChip` renders, for the no-tick-rerender assertion. */
    __atRateLimitRenderCount?: number;
  }
}

const SEVERITY_ROLE: Record<ReturnType<typeof rateLimitSeverity>, TugBadgeRole> = {
  rest: "agent",
  caution: "caution",
  danger: "danger",
};

export interface RateLimitChipProps {
  /** Metadata store supplying the live `rateLimit` quota state. */
  sessionMetadataStore: SessionMetadataStore;
}

/**
 * Z4B indicator chip for the subscription quota. Returns `null` when the
 * quota is fine and its reset is far off; otherwise renders a two-line
 * `TugBadge` whose role tracks severity and whose countdown ticks via direct
 * DOM mutation.
 */
export function RateLimitChip({
  sessionMetadataStore,
}: RateLimitChipProps): React.ReactElement | null {
  const rateLimit = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    sessionMetadataStore.getSnapshot,
  ).rateLimit;

  // Commit-count probe ([L22] test): a dependency-less layout effect fires
  // once per React commit — and never on a countdown tick, since the tick is
  // a direct DOM write, not a commit. The app-test reads the delta across a
  // tick (expects zero), proving the tick stays out of React's render cycle.
  // In an effect (not the render body) so it is not a render-phase side
  // effect; gated to the harness so production never carries the counter.
  useLayoutEffect(() => {
    if (window.__tugTestMode === true) {
      window.__atRateLimitRenderCount =
        (window.__atRateLimitRenderCount ?? 0) + 1;
    }
  });

  // `now` is a render-time snapshot, not a tick — visibility is structural
  // ([#step-3]: "render once on structural change, not every tick"), so it
  // re-evaluates only when the store changes (~once per turn). The 60-min
  // near-reset window is generous enough not to need per-minute precision.
  const nowMs = Date.now();
  const visible = isRateLimitChipVisible(rateLimit, nowMs);
  const exhausted = rateLimit !== null && isRateLimitExhausted(rateLimit);

  // Keep the latest resetsAt in a ref so the tick closure (set up once per
  // visible/exhausted change) always reads fresh structural data without the
  // interval being torn down and rebuilt on every store update.
  const resetsAtRef = useRef(0);
  resetsAtRef.current = rateLimit?.resetsAt ?? 0;
  const countdownRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    // Only a live countdown ticks; the exhausted face is static text.
    if (!visible || exhausted) return;
    const span = countdownRef.current;
    if (span === null) return;
    const tick = (): void => {
      span.textContent = formatResetCountdown(resetsAtRef.current, Date.now());
    };
    tick();
    const id = window.setInterval(tick, RATE_LIMIT_TICK_MS);
    if (window.__tugTestMode === true) {
      window.__atRateLimitTick = tick;
    }
    return () => {
      window.clearInterval(id);
      if (window.__tugTestMode === true && window.__atRateLimitTick === tick) {
        window.__atRateLimitTick = undefined;
      }
    };
  }, [visible, exhausted]);

  if (!visible || rateLimit === null) return null;

  const severity = rateLimitSeverity(rateLimit);
  const content = rateLimitContent(rateLimit, nowMs);
  const resetLabel = exhausted
    ? formatResetCountdown(rateLimit.resetsAt, nowMs)
    : content;

  return (
    <TugBadge
      layout="label-top"
      label="Limit"
      size="sm"
      emphasis="tinted"
      role={SEVERITY_ROLE[severity]}
      icon={
        exhausted ? (
          <TriangleAlert aria-hidden="true" />
        ) : (
          <Clock aria-hidden="true" />
        )
      }
      data-slot="rate-limit-chip"
      data-status={rateLimit.status}
      data-overage={rateLimit.isUsingOverage ? "" : undefined}
      aria-label="Subscription rate limit"
      title={`Subscription limit (${rateLimit.status}) — resets in ${resetLabel}`}
    >
      <span className="rate-limit-chip-value" data-slot="rate-limit-value" ref={countdownRef}>
        {content}
      </span>
    </TugBadge>
  );
}
