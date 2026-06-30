/**
 * DevLiveActivityLine — the foot-of-transcript "what's happening right
 * now" line that keeps the card from reading as dead while the agent
 * works between visible output.
 *
 * The transcript renders only committed turn content, so a foreground
 * tool grinding, the loop idling while background jobs run, or a retry
 * backing off all look like a hang. This single line — sat just above
 * the pulse strip — folds the live wire signals into one compact
 * status, derived purely by {@link selectLiveActivity} from this card's
 * {@link CodeSessionStore} snapshot.
 *
 * It is intentionally EPHEMERAL: it shows the present and settles to
 * `idle` (collapsed) when nothing is happening. The persistent record
 * of a background job lives in the JOBS cell / its settled transcript
 * marker, not here.
 *
 * Laws: [L02] store read via `useSyncExternalStore` (the snapshot ref is
 *       stable per dispatch, so the derived activity is memoized on it);
 *       [L06] the pulsing-dot's motion is WAAPI inside TugProgressIndicator
 *       — opacity never passes through React state; only the line's TEXT
 *       (what is happening) is React state, which is content, not
 *       appearance;
 *       [L19] `.tsx`/`.css` pair, `data-slot="dev-live-activity-line"`.
 *
 * @module components/tugways/cards/dev-live-activity-line
 */

import "./dev-live-activity-line.css";

import React, { useMemo, useSyncExternalStore } from "react";

import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import type { CodeSessionStore } from "@/lib/code-session-store";
import {
  selectLiveActivity,
  type LiveActivityKind,
} from "@/lib/code-session-store/select-live-activity";

/**
 * Map an activity class onto the pulsing-dot's tone role. Recovery and
 * the user's stop read as `caution`; ordinary work reads `agent`.
 */
function dotRole(kind: LiveActivityKind): "agent" | "caution" {
  return kind === "retrying" || kind === "interrupting" ? "caution" : "agent";
}

export function DevLiveActivityLine({
  codeSessionStore,
}: {
  codeSessionStore: CodeSessionStore;
}): React.ReactElement | null {
  const snapshot = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  // The snapshot ref is stable between no-op dispatches ([D11]), so the
  // derivation recomputes only on a real state change.
  const activity = useMemo(() => selectLiveActivity(snapshot), [snapshot]);

  // Collapsed when idle — the line claims no height until work begins,
  // so a resting card stays quiet. `data-active` lets the CSS animate
  // the reveal without React driving appearance.
  if (!activity.active) return null;

  return (
    <div
      className="dev-live-activity-line"
      data-slot="dev-live-activity-line"
      data-kind={activity.kind}
      role="status"
      aria-live="polite"
    >
      <TugProgressIndicator
        variant="pulsing-dot"
        size={10}
        state="running"
        role={dotRole(activity.kind)}
        className="dev-live-activity-dot"
        aria-hidden
      />
      <span className="dev-live-activity-label">{activity.label}</span>
      {activity.detail !== undefined ? (
        <span className="dev-live-activity-detail">{activity.detail}</span>
      ) : null}
    </div>
  );
}
