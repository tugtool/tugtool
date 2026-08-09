/**
 * cards-session-cell.tsx — the session *monitor* row, as it appears for a
 * single-card session pane in the Lens's Cards section:
 *
 *   [dot] <session name>                         <slot layout>
 *   <description>
 *   <latest pulse line>                        <activity sparkline>
 *
 * The middle line is the agent's rolling description of the session, with the
 * session's creation date standing in until one is written — so the row is the
 * same height whatever the session is doing, and a deck with no model sees a row
 * that says something true rather than one that collapses. The standing-goal
 * level that used to sit here is gone: the description already says what the
 * session is for, and a goal beside it read as an echo.
 *
 * The name is the session identity's Line tier, resolved through
 * `useSessionIdentity` like every other identity surface. The row itself is
 * `TugSessionRow`, the shape the masthead and the new-session picker also wear:
 * how it divides a rail's width between the dot, the title, the slots, and the
 * activity with its tape is that component's decision, so what the gallery
 * approves is what the Lens wears, by construction rather than by two files
 * agreeing.
 *
 * The row carries `data-session-id` (which session this is) alongside the
 * uniform `data-lens-row-id` every pane row wears (the reorder's handle).
 *
 * Laws: [L02] every store enters React through `useSyncExternalStore`; [L06]
 * appearance (dot, sparkline) is CSS on engine attributes, never React state.
 *
 * @module components/lens/sections/cards-session-cell
 */

import React, { useCallback, useSyncExternalStore } from "react";

import { renderFilterHighlight } from "@/components/tugways/filter-highlight";
import { SlotPicker } from "@/components/lens/slot-picker";
import {
  TugSessionRow,
  TUG_SESSION_ROW_INDICATOR_SIZE,
  TUG_SESSION_ROW_SPARK_HEIGHT,
  TUG_SESSION_ROW_SPARK_WIDTH,
  TUG_SESSION_SPARK_CURVE,
  TUG_SESSION_SPARK_FULL_SCALE_CHARS,
} from "@/components/tugways/tug-session-row";
import { TugSessionIdentity } from "@/components/tugways/tug-session-identity";
import { TugSparkline } from "@/components/tugways/tug-sparkline";
import { SessionPhaseDot } from "@/components/tugways/session-phase-dot";
import {
  COMPACTING_PULSE_TEXT,
  compactionProgressStore,
  isCompactingCard,
} from "@/lib/compaction-progress-store";
import { useSessionIdentity } from "@/lib/session-identity";
import { latestLineForScope, usePulse } from "@/lib/pulse-store";
import { formatRestingStamp } from "@/lib/pulse-line/resting-line";
import { sessionActivityRestLine } from "@/lib/session-activity-line";
import { useSessionCreatedAtMs } from "@/lib/session-created-at";
import { useSessionLedger } from "@/lib/session-ledger-store";
import {
  ACTIVITY_BIN_MS,
  getSessionActivityStore,
  isRateChannel,
} from "@/lib/session-activity-store";

/** The per-row activity sparkline over the session's composite series. */
function RowSparkline({
  tugSessionId,
}: {
  tugSessionId: string;
}): React.ReactElement {
  const activityStore = getSessionActivityStore();
  const getSeries = useCallback(
    (nowMs: number): number[] =>
      activityStore !== null && tugSessionId.length > 0
        ? activityStore.compositeSeries(tugSessionId, nowMs)
        : [],
    [activityStore, tugSessionId],
  );
  // The tape's data-event clock, filtered to rate channels — this row draws
  // the composite of rate work, so gauge levels must not wake it.
  const subscribeActivity = useCallback(
    (wake: () => void): (() => void) =>
      activityStore !== null && tugSessionId.length > 0
        ? activityStore.subscribeActivity(tugSessionId, (channel) => {
            if (isRateChannel(channel)) wake();
          })
        : () => {},
    [activityStore, tugSessionId],
  );
  return (
    <TugSparkline
      getSeries={getSeries}
      subscribeActivity={subscribeActivity}
      binMs={ACTIVITY_BIN_MS}
      fullScale={TUG_SESSION_SPARK_FULL_SCALE_CHARS}
      curve={TUG_SESSION_SPARK_CURVE}
      width={TUG_SESSION_ROW_SPARK_WIDTH}
      height={TUG_SESSION_ROW_SPARK_HEIGHT}
      className="sessions-monitor-spark"
      title="Session activity — text, tokens, tools, and subagents"
    />
  );
}

export interface CardsSessionRowProps {
  cardId: string;
  tugSessionId: string;
  projectDir: string;
  /** The pane-row identity the reorder matches on. */
  orderKey: string;
  filterQuery: string;
  onRowPointerDown: (orderKey: string, event: React.PointerEvent) => void;
}

/** One monitor row: the shared `TugSessionRow`, fed live nodes. Every
 *  decision about how the row packs — which line the dot, the slots, and the
 *  sparkline ride, and what each costs the text beside it — belongs to that
 *  component and is auditioned in the Pulse Display gallery card, so what ships
 *  here is what was chosen there. This function's whole job is to supply the
 *  five parts from the stores. The `TugListView` cell wrapper still owns
 *  cursor / selection / click. */
export function CardsSessionRow({
  cardId,
  tugSessionId,
  projectDir,
  orderKey,
  filterQuery,
  onRowPointerDown,
}: CardsSessionRowProps): React.ReactElement {
  // The row's title is the identity's Line tier, rendered by the identity
  // component itself — `<name> : <callsign>` in two separately-sized runs, with
  // the filter mark painted inside each. Resolved through the one hook, so a
  // `/rename` or a reroll repaints here with no reload.
  const identity = useSessionIdentity(tugSessionId, { projectDir });
  const pulse = usePulse();
  const latest = latestLineForScope(pulse.lines, tugSessionId);
  // The compaction pin, exactly as the on-card strip wears it: a `/compact`
  // run streams nothing for minutes, so without it the row keeps showing the
  // last line from before the submit for the whole run.
  const compaction = useSyncExternalStore(
    compactionProgressStore.subscribe,
    compactionProgressStore.getSnapshot,
  );
  // The session's creation time — the date the resting line carries when the
  // session has never spoken.
  const createdAtMs = useSessionCreatedAtMs(cardId, tugSessionId, projectDir);
  // The session's own ledger row — the turn count, the on-disk size, and when it
  // last moved, which are the activity line's rest form.
  const ledger = useSessionLedger(projectDir);
  const row = ledger.rows.find((r) => r.session_id === tugSessionId) ?? null;
  // What the activity level says. A live beat is the beat; the two absences —
  // a finished turn's bare `Done` marker, and a session with no beats at all —
  // become the REST SENTENCE: how much conversation there has been, how big it
  // has grown, when it last moved, and that it is open for another turn. The row
  // is a monitor, so that is what it wears most of the time. Every row here is a
  // bound live card, so `Ready.` always closes the line.
  const restLine = sessionActivityRestLine({
    turnCount: row?.turn_count ?? 0,
    fileSize: row?.file_size ?? null,
    lastUsedAtMs: row?.last_used_at ?? null,
    hasCard: true,
  });
  const beat = pulse.enabled ? latest : null;
  const pulseText = isCompactingCard(compaction, cardId)
    ? COMPACTING_PULSE_TEXT
    : beat !== null
      ? beat.text
      : restLine;
  // The middle level: the agent's rolling description, with the session's
  // creation date standing in until one is written. The prompt rung [S02] puts
  // between them is the PICKER's — every row here is a bound live card, so there
  // is no freshly-scanned session whose only human-meaningful text is its own
  // first prompt.
  const description =
    identity?.description ??
    (createdAtMs !== null ? `Created ${formatRestingStamp(createdAtMs)}` : "");
  const descriptionStandIn = identity?.description == null;
  return (
    <TugSessionRow
      className="session-row-content lens-cards-row"
      data-session-id={tugSessionId}
      data-lens-row-id={orderKey}
      data-lens-row-group="sessions"
      data-lens-group-run="sessions"
      indicator={
        <SessionPhaseDot
          sessionId={tugSessionId}
          size={TUG_SESSION_ROW_INDICATOR_SIZE}
          // The ONLY place in the app that takes the dot's period jitter: a
          // list of separate sessions, each doing its own work.
          drift
        />
      }
      name={
        identity === null ? null : (
          // The row's own dot leads the line, so the identity renders its runs
          // only — one mark per row, never two.
          <TugSessionIdentity
            identity={identity}
            tier="line"
            dot={false}
            highlight={filterQuery}
          />
        )
      }
      slots={<SlotPicker cardId={cardId} />}
      // The row is its own reorder handle — a vertical drag from anywhere on
      // it that is not the slot picker carries it.
      onPointerDown={(e) => onRowPointerDown(orderKey, e)}
      description={renderFilterHighlight(description, filterQuery)}
      descriptionStandIn={descriptionStandIn}
      // Highlighted over what the line actually shows: the composed rest
      // sentence takes the mark; a live beat is not a searchable fact.
      activity={
        pulseText === restLine
          ? renderFilterHighlight(pulseText, filterQuery)
          : pulseText
      }
      sparkline={<RowSparkline tugSessionId={tugSessionId} />}
    />
  );
}
