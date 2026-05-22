/**
 * `TideDriftCaution` — card-chrome aggregate drift-caution chip.
 *
 * The *aggregate* half of the drift-caution strategy ([D04] / [Q03]
 * option (c)): one subtle chip in the Tide card's Z3 prompt-entry
 * chrome that counts every stream-json drift event the dispatch
 * detected across the session — unknown tool names, unknown
 * structured-result shapes, and a runtime `system_metadata.version`
 * that diverges from the pinned catalog. Clicking the chip opens a
 * popover listing each offending event. The inline-marker half — a
 * chip at the offending event itself — is `TideCautionBadge`, painted
 * by the tool-wrapper chrome; both surfaces read the same drift
 * detectors in `tide-assistant-renderer-dispatch`.
 *
 * Renders nothing when the session carries no drift — the common case
 * — so the chrome slot it occupies stays empty until drift appears.
 *
 * The drift aggregate is derived from the committed transcript plus
 * the session's runtime version: `summarizeDrift` is the pure walk;
 * this component is the [L02] store-subscription shell around it. A
 * drifted tool call in an in-flight (not-yet-committed) turn surfaces
 * once that turn commits — the chip is a session-level summary, not a
 * live per-streaming-event marker.
 *
 * Laws:
 *  - [L02] external state enters through `useSyncExternalStore` — the
 *    `CodeSessionStore` transcript and the `SessionMetadataStore`
 *    version are both subscribed, never copied into React state.
 *  - [L06] no React state for appearance — the popover's open/closed
 *    state is owned by the uncontrolled `TugPopover` (Radix), not by
 *    this component.
 *  - [L11] the chip emits no chain action — it is a popover trigger
 *    only; `TugPopover` owns the disclosure.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tide-drift-caution"` on the chip.
 *  - [L20] owns the `--tugx-drift-*` slot family; consumes the shared
 *    `--tugx-block-tone-caution-*` tones for the chip surface and
 *    composes `TideCautionBadge` (which keeps its own tokens).
 *
 * @module components/tugways/chrome/tide-drift-caution
 */

import "./tide-drift-caution.css";

import React, { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import {
  TugPopover,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import {
  logDriftEvent,
  summarizeDrift,
  type DriftEvent,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";

import { TideCautionBadge } from "./tide-caution-badge";

export interface TideDriftCautionProps {
  /**
   * Session store — its committed transcript is walked for tool-call
   * drift (unknown tool names, unknown structured-result shapes).
   */
  codeSessionStore: CodeSessionStore;
  /**
   * Session-metadata store — supplies `system_metadata.version` for
   * the version-drift check. Omitted in gallery / fixture mounts,
   * where version drift simply is not surfaced.
   */
  sessionMetadataStore?: SessionMetadataStore;
  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

/** Stable list key for a drift event row. */
function driftEventKey(event: DriftEvent): string {
  return `${event.caution.reason}:${event.toolUseId ?? "version"}`;
}

/**
 * Render the aggregate drift-caution chip, or `null` when the session
 * has no drift.
 */
export function TideDriftCaution({
  codeSessionStore,
  sessionMetadataStore,
  className,
}: TideDriftCautionProps): React.ReactElement | null {
  // Narrowed to `transcript` — the only snapshot field the drift walk
  // reads. The committed transcript array's reference changes once per
  // turn commit, so the chip does not re-render on every streaming
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

  if (summary.count === 0) return null;

  const cls =
    className === undefined
      ? "tide-drift-caution"
      : `tide-drift-caution ${className}`;

  return (
    <TugPopover>
      <TugPopoverTrigger>
        <button type="button" className={cls} data-slot="tide-drift-caution">
          ⚠ drift detected: {summary.count}{" "}
          {summary.count === 1 ? "event" : "events"}
        </button>
      </TugPopoverTrigger>
      <TugPopoverContent side="top" align="end" sideOffset={8} arrow>
        <div
          className="tide-drift-caution-report"
          data-slot="tide-drift-caution-report"
        >
          <div className="tide-drift-caution-report-title">
            stream-json drift
          </div>
          <ul className="tide-drift-caution-report-list">
            {summary.events.map((event) => (
              <li
                key={driftEventKey(event)}
                className="tide-drift-caution-report-row"
              >
                <TideCautionBadge caution={event.caution} />
                <span className="tide-drift-caution-report-detail">
                  {event.caution.detail ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </TugPopoverContent>
    </TugPopover>
  );
}
