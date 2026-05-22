/**
 * `TideVersionBadge` — always-on Claude Code version badge for the
 * Tide card's Z3 prompt-entry chrome.
 *
 * Shows the running Claude Code stream-json version at all times, and
 * escalates to a caution tone when the dispatch detected drift across
 * the session ([D04] / [Q03]) — an unknown tool name, an unknown
 * structured-result shape, or a `major.minor` version line that
 * differs from the validated baseline. Anthropic ships Claude Code
 * patch releases almost daily; the badge stays quiet through that
 * churn (a patch difference is not drift) and goes loud only when
 * something genuinely worth attention happened.
 *
 * Two display states:
 *  - *quiet* — no drift: the badge shows just the running version
 *    (`Claude Code 2.1.148`) in a neutral tone.
 *  - *caution* — drift detected: an amber tone, a warning icon, and
 *    the running + validated versions plus the drift count.
 *
 * The badge is always a popover trigger: even with no drift, clicking
 * it reports the running and validated versions — the version we have
 * and the version we are working against. When there is drift the
 * popover also lists each offending event. The inline-marker half of
 * the strategy — a chip at the offending event itself — is
 * `TideCautionBadge`, painted by the tool-wrapper chrome; both
 * surfaces read the same drift detectors in
 * `tide-assistant-renderer-dispatch`.
 *
 * The aggregate is derived from the committed transcript plus the
 * session's runtime version: `summarizeDrift` is the pure walk; this
 * component is the [L02] store-subscription shell around it. A drifted
 * tool call in an in-flight (not-yet-committed) turn surfaces once
 * that turn commits — the badge is a session-level summary, not a live
 * per-streaming-event marker.
 *
 * Renders nothing until the session reports a version (`system_metadata`
 * has not arrived yet) — there is no version to show.
 *
 * Laws:
 *  - [L02] external state enters through `useSyncExternalStore` — the
 *    `CodeSessionStore` transcript and the `SessionMetadataStore`
 *    version are both subscribed, never copied into React state.
 *  - [L06] no React state for appearance — the popover's open/closed
 *    state is owned by the uncontrolled `TugPopover` (Radix), and the
 *    quiet/caution treatment is pure render from the derived summary.
 *  - [L11] the badge emits no chain action — it is a popover trigger
 *    only; `TugPopover` owns the disclosure.
 *  - [L19] file pair (`.tsx` + `.css`); the report node carries
 *    `data-slot="tide-version-badge-report"`.
 *  - [L20] owns only the `--tugx-verbadge-*` report-geometry slots;
 *    composes `TugBadge` (the chip) and `TideCautionBadge` (the report
 *    rows), each of which keeps its own tokens.
 *
 * @module components/tugways/chrome/tide-version-badge
 */

import "./tide-version-badge.css";

import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { TriangleAlert } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import {
  VALIDATED_CC_VERSION,
  logDriftEvent,
  summarizeDrift,
  type DriftEvent,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";

import { TideCautionBadge } from "./tide-caution-badge";

export interface TideVersionBadgeProps {
  /**
   * Session store — its committed transcript is walked for tool-call
   * drift (unknown tool names, unknown structured-result shapes).
   */
  codeSessionStore: CodeSessionStore;
  /**
   * Session-metadata store — supplies `system_metadata.version`, both
   * for display and for the version-drift check. Omitted in gallery /
   * fixture mounts, where the badge has no version to show.
   */
  sessionMetadataStore?: SessionMetadataStore;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

/** Stable list key for a drift event row. */
function driftEventKey(event: DriftEvent): string {
  return `${event.caution.reason}:${event.toolUseId ?? "version"}`;
}

/** `1 event` / `N events`. */
function eventCountLabel(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

/**
 * Render the always-on version badge, or `null` until the session has
 * reported a version.
 */
export function TideVersionBadge({
  codeSessionStore,
  sessionMetadataStore,
  className,
}: TideVersionBadgeProps): React.ReactElement | null {
  // Narrowed to `transcript` — the only snapshot field the drift walk
  // reads. The committed transcript array's reference changes once per
  // turn commit, so the badge does not re-render on every streaming
  // delta the way a whole-snapshot subscription would.
  const transcript = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().transcript,
      [codeSessionStore],
    ),
  );
  const version = useSyncExternalStore(
    useCallback(
      (listener) =>
        sessionMetadataStore !== undefined
          ? sessionMetadataStore.subscribe(listener)
          : () => {},
      [sessionMetadataStore],
    ),
    useCallback(
      () => sessionMetadataStore?.getSnapshot().version ?? null,
      [sessionMetadataStore],
    ),
  );

  const summary = useMemo(() => {
    const toolCalls = transcript.flatMap((turn) => turn.toolCalls);
    return summarizeDrift({ toolCalls, version });
  }, [transcript, version]);

  // Triage logging. `logDriftEvent` dedupes by occurrence, so this
  // effect re-running on unrelated renders never spams the console.
  useEffect(() => {
    for (const event of summary.events) logDriftEvent(event);
  }, [summary]);

  // No version yet — `system_metadata` has not landed. Nothing to show.
  if (version === null) return null;

  const hasDrift = summary.count > 0;
  const cls =
    className === undefined
      ? "tide-version-badge"
      : `tide-version-badge ${className}`;

  // Quiet: just the running version. Caution: the running version,
  // the validated baseline when it actually differs, and the drift
  // count.
  let face: string;
  if (!hasDrift) {
    face = `Claude Code ${version}`;
  } else if (version !== VALIDATED_CC_VERSION) {
    face = `Claude Code ${version} · validated ${VALIDATED_CC_VERSION} · ${eventCountLabel(summary.count)}`;
  } else {
    face = `Claude Code ${version} · ${eventCountLabel(summary.count)}`;
  }

  return (
    <TugPopover>
      <TugPopoverTrigger>
        <TugBadge
          role={hasDrift ? "caution" : "data"}
          emphasis="tinted"
          size="sm"
          icon={hasDrift ? <TriangleAlert aria-hidden="true" /> : undefined}
          className={cls}
        >
          {face}
        </TugBadge>
      </TugPopoverTrigger>
      <TugPopoverContent side="top" align="end" sideOffset={8} arrow>
        <div
          className="tide-version-badge-report"
          data-slot="tide-version-badge-report"
        >
          <div className="tide-version-badge-report-title">
            Claude Code stream-json
          </div>
          <div className="tide-version-badge-versions">
            <div className="tide-version-badge-version-row">
              <span className="tide-version-badge-version-label">running</span>
              <span className="tide-version-badge-version-value">{version}</span>
            </div>
            <div className="tide-version-badge-version-row">
              <span className="tide-version-badge-version-label">
                validated
              </span>
              <span className="tide-version-badge-version-value">
                {VALIDATED_CC_VERSION}
              </span>
            </div>
          </div>
          {hasDrift && (
            <ul className="tide-version-badge-report-list">
              {summary.events.map((event) => (
                <li
                  key={driftEventKey(event)}
                  className="tide-version-badge-report-row"
                >
                  <TideCautionBadge caution={event.caution} />
                  <span className="tide-version-badge-report-detail">
                    {event.caution.detail ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </TugPopoverContent>
    </TugPopover>
  );
}
