/**
 * `TelemetryInspector` — first inspector tab. Surfaces per-turn
 * telemetry (Step 20.3 fields) for the selected card. Live in-flight
 * clocks tick via `useLifecycleTick`.
 *
 * Data path:
 *   - Card services come from `cardServicesStore.getServices(cardId)`
 *     read via `useSyncExternalStore` (per [L02]).
 *   - The public `CodeSessionSnapshot` provides transcript + identity.
 *   - The internal `CodeSessionState` (via the dev-only accessor)
 *     provides live-clock anchors (`awaitingApprovalSince`, etc.).
 *   - The projection helper turns both into `(label, value, fieldPath)`
 *     tuples that `FieldRow` renders.
 *
 * Conformance: [L02], [L19], [L20] (reads only `--tugx-devpanel-*`
 * slots), read-only — no mutations of the card session.
 *
 * @module components/tug-dev-panel/inspectors/telemetry-inspector
 */

import React, { useCallback, useState, useSyncExternalStore } from "react";

import { cardServicesStore } from "@/lib/card-services-store";
import { useLifecycleTick } from "@/lib/code-session-store/hooks/use-lifecycle-tick";
import { TugPushButton } from "@/components/tugways/tug-push-button";

import { copyAsJson } from "../copy-as-json";
import { FieldRow } from "../field-row";
import { FieldSection } from "../field-section";

import { projectTelemetryInspector } from "./telemetry-projection";

export interface TelemetryInspectorProps {
  selectedCardId: string | null;
}

export const TelemetryInspector: React.FC<TelemetryInspectorProps> = ({
  selectedCardId,
}) => {
  // Subscribe to cardServicesStore so the inspector re-renders when
  // the selected card's services bag appears or disappears.
  const services = useSyncExternalStore(
    cardServicesStore.subscribe,
    useCallback(() => {
      return selectedCardId === null
        ? null
        : cardServicesStore.getServices(selectedCardId);
    }, [selectedCardId]),
  );

  // Subscribe to the card's CodeSessionStore. Snapshot rebuilds
  // already happen whenever the reducer notifies, so we get the
  // freshest internal state in lockstep with the snapshot.
  const snapshot = useSyncExternalStore(
    useCallback(
      (cb) => services?.codeSessionStore.subscribe(cb) ?? (() => {}),
      [services],
    ),
    useCallback(
      () => services?.codeSessionStore.getSnapshot() ?? null,
      [services],
    ),
  );

  // Drive the live tick at 1Hz while a turn is in flight. When no
  // services / snapshot is available, fall back to an "idle" phase
  // so the tick stays at zero.
  const phase = snapshot?.phase ?? "idle";
  const tickAt = useLifecycleTick(phase, 1000);

  const internalState = services?.codeSessionStore._getInternalStateForDevPanel() ?? null;

  const sections = projectTelemetryInspector({
    state: internalState,
    transcript: snapshot?.transcript ?? [],
    tickAt,
    tugSessionId: snapshot?.tugSessionId ?? null,
    displayLabel: snapshot?.displayLabel ?? null,
  });

  const [copyStatus, setCopyStatus] = useState<"idle" | "ok" | "fail">("idle");
  const handleCopy = useCallback(async () => {
    const payload = {
      tugSessionId: snapshot?.tugSessionId ?? null,
      displayLabel: snapshot?.displayLabel ?? null,
      phase: snapshot?.phase ?? null,
      transportState: snapshot?.transportState ?? null,
      transcript: snapshot?.transcript ?? [],
      // Surface the internal state's live-clock anchors so a paste
      // captures everything needed to reproduce a given moment.
      internalLiveAnchors: internalState
        ? {
            awaitingApprovalSince: internalState.awaitingApprovalSince,
            awaitingApprovalAccumulatedMs: internalState.awaitingApprovalAccumulatedMs,
            transportNonOnlineSince: internalState.transportNonOnlineSince,
            transportDowntimeAccumulatedMs: internalState.transportDowntimeAccumulatedMs,
            transportReconnectCount: internalState.transportReconnectCount,
            lastStreamEventAt: internalState.lastStreamEventAt,
            maxStreamGapMs: internalState.maxStreamGapMs,
            firstAssistantDeltaAt: internalState.firstAssistantDeltaAt,
            firstToolUseAt: internalState.firstToolUseAt,
            interruptInFlight: internalState.interruptInFlight,
          }
        : null,
      tickAt,
    };
    const ok = await copyAsJson(payload);
    setCopyStatus(ok ? "ok" : "fail");
    setTimeout(() => setCopyStatus("idle"), 1500);
  }, [snapshot, internalState, tickAt]);

  return (
    <div className="tug-devpanel-inspector tug-devpanel-inspector-telemetry">
      <div className="tug-devpanel-inspector-toolbar">
        <TugPushButton
          size="xs"
          emphasis="outlined"
          role="action"
          onClick={handleCopy}
          disabled={selectedCardId === null}
        >
          {copyStatus === "ok"
            ? "Copied!"
            : copyStatus === "fail"
              ? "Copy failed"
              : "Copy as JSON"}
        </TugPushButton>
      </div>
      {sections.map((section) => (
        <FieldSection key={section.title} title={section.title}>
          {section.rows.map((row) => (
            <FieldRow
              key={`${section.title}/${row.label}`}
              label={row.label}
              value={row.value}
              fieldPath={row.fieldPath}
              hint={row.hint}
            />
          ))}
        </FieldSection>
      ))}
    </div>
  );
};
TelemetryInspector.displayName = "TelemetryInspector";
