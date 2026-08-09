/**
 * cards-session-cell.tsx — the session *monitor* row, as it appears for a
 * single-card session pane in the Lens's Cards section:
 *
 *   [dot] <session name>                         <slot layout>
 *   <standing goal>
 *   <latest pulse line>                        <activity sparkline>
 *
 * The middle line is the agent's standing session overview — the same string the
 * card's masthead wears as its headline. Both PULSE lines always render, so the
 * row is the same height whatever the session is doing and a deck with no
 * model sees a row that stands in rather than one that collapses.
 *
 * The name is the session identity's Line tier, resolved through
 * `useSessionIdentity` like every other identity surface. The row itself is
 * `TugSessionRow`, the shared
 * component the Pulse Display gallery card auditions its fits on: how the row
 * divides its one line's width between the indicator, the name, the slots, and
 * the PULSE's three parts is that component's decision, so what the gallery
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
import { TugSparkline } from "@/components/tugways/tug-sparkline";
import { SessionPhaseDot } from "@/components/tugways/session-phase-dot";
import {
  COMPACTING_PULSE_TEXT,
  compactionProgressStore,
  isCompactingCard,
} from "@/lib/compaction-progress-store";
import { cardServicesStore } from "@/lib/card-services-store";
import {
  sessionIdentityLine,
  useSessionIdentity,
} from "@/lib/session-identity";
import {
  latestLineForScope,
  usePulse,
  usePulseOverview,
} from "@/lib/pulse-store";
import { restingActivityText } from "@/lib/pulse-line/resting-line";
import { useSessionLedger } from "@/lib/session-ledger-store";
import {
  ACTIVITY_BIN_MS,
  getSessionActivityStore,
  isRateChannel,
} from "@/lib/session-activity-store";

/** Stable no-op subscribe for a card whose services aren't constructed yet. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * When the session was made — the date half of the row's resting line.
 *
 * Same two sources, in the same order, as the Z2 control bar's "Session
 * created" metadata: the dev session ledger's `created_at` is the authority
 * (it is present at zero turns, which is exactly the state a resting row is
 * reporting on), with the replay-derived anchor covering the window before
 * the ledger answers. Null until one of them does.
 */
function useSessionCreatedAtMs(
  cardId: string,
  tugSessionId: string,
  projectDir: string,
): number | null {
  const services = useSyncExternalStore(cardServicesStore.subscribe, () =>
    cardServicesStore.getServices(cardId),
  );
  const store = services?.codeSessionStore ?? null;
  const replayCreatedAtMs = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store !== null ? () => store.getSnapshot().sessionCreatedAtMs : () => null,
    () => null,
  );
  const ledger = useSessionLedger(projectDir);
  const ledgerCreatedAtMs =
    ledger.rows.find((r) => r.session_id === tugSessionId)?.created_at ?? null;
  return ledgerCreatedAtMs ?? replayCreatedAtMs;
}

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
  // The row's name line is the identity's Line tier — `<project>/<callsign>`,
  // the same string the tab strip and the Window menu wear, resolved through
  // the one hook so a `/rename` or a reroll repaints here with no reload.
  const identity = useSessionIdentity(tugSessionId, { projectDir });
  const displayName = identity === null ? "" : sessionIdentityLine(identity);
  const pulse = usePulse();
  const latest = latestLineForScope(pulse.lines, tugSessionId);
  // The session's standing goal — the same string the card's strip wears as
  // its headline. Rendered on its own line here (L1) rather than inline, and
  // only when it exists: an absent overview costs the row no height.
  const overview = usePulseOverview(tugSessionId);
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
  // What the activity level says. A live beat is the beat; the two absences —
  // a finished turn's bare `Done` marker, and a session with no beats at all —
  // become the resting reading, which dates itself and says what the state is
  // (see `resting-line`). The row is a monitor, so those two are what it wears
  // most of the time.
  const pulseText = !pulse.enabled
    ? null
    : isCompactingCard(compaction, cardId)
      ? COMPACTING_PULSE_TEXT
      : restingActivityText(latest, createdAtMs);
  return (
    <TugSessionRow
      className="session-row-content lens-cards-row"
      data-session-id={tugSessionId}
      data-lens-row-id={orderKey}
      data-lens-row-group="sessions"
      data-lens-group-run="sessions"
      indicator={
        <SessionPhaseDot
          cardId={cardId}
          size={TUG_SESSION_ROW_INDICATOR_SIZE}
          // The ONLY place in the app that takes the dot's period jitter: a
          // list of separate sessions, each doing its own work.
          drift
        />
      }
      name={renderFilterHighlight(displayName, filterQuery)}
      slots={<SlotPicker cardId={cardId} />}
      // The row is its own reorder handle — a vertical drag from anywhere on
      // it that is not the slot picker carries it.
      onPointerDown={(e) => onRowPointerDown(orderKey, e)}
      intent={pulse.enabled && overview !== null ? overview.text : undefined}
      activity={pulseText ?? undefined}
      sparkline={<RowSparkline tugSessionId={tugSessionId} />}
    />
  );
}
