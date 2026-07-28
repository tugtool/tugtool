/**
 * The Lens **Sessions** section — a read-only session *monitor* rendered as a
 * `TugListView`. One row per open session card, stacked (L1):
 *
 *   [phase dot]  <session name>            <slot layout>   [grip]
 *                <standing goal>
 *                <latest pulse line>      <activity sparkline>
 *
 * The middle line is the local model's session overview — the same string the
 * card's strip wears as its headline. It is there only when one exists, so a
 * row is genuinely two heights and a deck with no model sees the two-line row
 * it always had.
 *
 * The list is authored into the section's focus group (`host.focusGroup`), so
 * it is one Tab stop in the Lens: arrows rove the movement cursor over the
 * rows, and Space/Enter/click activate the row's bound card
 * (`focus-session-card`) — the monitor has no "selected but not activated"
 * state, so `onSelect` and `onActivate` are the same act. The section
 * remembers its last-activated session so Cmd-L / Tab re-seed the cursor onto
 * it (`initialSelectedIndex`).
 *
 * The name is resolved exactly like the Session card's title-bar chip
 * (`sessionCardTitleOverride`); the goal and activity lines wear the same
 * tones and sizes as the on-card `session-pulse-strip`'s two runs, so a
 * session reads identically in both places. The slot layout rides the name
 * line, so the arrangement affordance never crowds the pulse.
 *
 * Laws: [L02] every store enters React through `useSyncExternalStore`; [L06]
 * appearance (cursor ring, selection, dot/sparkline) is CSS on engine
 * attributes, never React state; [L22] the FocusManager owns the cursor.
 *
 * @module components/lens/sections/sessions-section
 */

import "./sessions-section.css";

import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { GitBranch } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { renderFilterHighlight } from "@/components/tugways/filter-highlight";
import { setSectionContent } from "@/components/lens/lens-section-content";
import {
  getFilterQuery,
  getFilterVersion,
  subscribeFilterQuery,
} from "@/components/lens/lens-filter-store";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import { SlotPicker } from "@/components/lens/slot-picker";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { useBlockReorder } from "@/components/lens/block-reorder";
import { lensStore } from "@/lib/lens-store/lens-store";
import { dispatchAction } from "@/action-dispatch";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugLabel } from "@/components/tugways/tug-label";
import {
  sparklineCurves,
  TugSparkline,
} from "@/components/tugways/tug-sparkline";
import {
  TugProgressIndicator,
  type TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";
import { dotDriftFor } from "@/components/tugways/internal/tug-progress-pulsing-dot";
import {
  sessionSessionPhaseKey,
  sessionSessionPhaseVisual,
  type SessionPhaseInput,
} from "@/lib/code-session-store/session-phase-visual";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import {
  COMPACTING_PULSE_TEXT,
  compactionProgressStore,
  isCompactingCard,
} from "@/lib/compaction-progress-store";
import { cardServicesStore } from "@/lib/card-services-store";
import { sessionNameStore } from "@/lib/session-name-store";
import { sessionTagStore } from "@/lib/session-tag-store";
import { sessionCardTitleOverride } from "@/lib/session-card-title";
import { branchForProject, useChangesetAll } from "@/lib/changeset-all-store";
import {
  latestLineForScope,
  usePulse,
  usePulseOverview,
} from "@/lib/pulse-store";
import {
  ACTIVITY_BIN_MS,
  getSessionActivityStore,
} from "@/lib/session-activity-store";
import {
  buildSessionRows,
  useLensSessionsDataSource,
  type LensSessionsDataSource,
  type MonitorRow,
} from "./sessions-data-source";

// The reorder-drag matches each row by its stable `data-session-id` on the row
// content element; the FLIP translates that element, the store commit persists
// the new order.
const ROW_SELECTOR = ".session-row-content[data-session-id]";
const ROW_KIND_ATTR = "data-session-id";

// Sparkline shape — the same constants the on-card `session-pulse-strip` uses,
// so a session reads identically in the Lens and on its card.
const SPARKLINE_FULL_SCALE_CHARS = 1200;
const SPARKLINE_CURVE = sparklineCurves.gamma(0.6);
const SPARKLINE_WIDTH = 64;
const SPARKLINE_HEIGHT = 18;

// The section's remembered selection — the last-activated session id, mapped
// to a cursor seed on the next Cmd-L / Tab into the section ([P10] selection
// memory). Session-local; a fresh launch starts at the first row. Module-level
// because it must outlive the section body's unmount across a collapse toggle;
// valid while the Lens is a singleton card.
let lastSelectedSessionId: string | null = null;

/** The open cards' bindings, read straight from the store ([L02]). */
function useOpenBindings() {
  return useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    cardSessionBindingStore.getSnapshot,
  );
}

/** This section's kind — the key its filter query lives under. */
const SECTION_KIND = "sessions";

/** The band's live filter query, read straight from the store ([L02]). */
function useSessionsFilterQuery(): string {
  useSyncExternalStore(subscribeFilterQuery, getFilterVersion);
  return getFilterQuery(SECTION_KIND);
}

/** Row verbs the section body hands the module-level cell — the reorder grip. */
interface SessionsCellContextValue {
  onGripPointerDown: (id: string, event: React.PointerEvent) => void;
}
const SessionsCellContext =
  React.createContext<SessionsCellContextValue | null>(null);

/**
 * The session's label, formatted EXACTLY like the Session card's title bar:
 * `<project>/<session> (<branch>)` (branch omitted on `main`), name → tag
 * precedence, read reactively from the name / tag stores ([L02]).
 */
function useSessionLabel(
  projectDir: string,
  tugSessionId: string,
  branch: string | null,
): string {
  const name = useSyncExternalStore(
    sessionNameStore.subscribe,
    useCallback(() => sessionNameStore.getName(tugSessionId), [tugSessionId]),
  );
  const tag = useSyncExternalStore(
    sessionTagStore.subscribe,
    useCallback(() => sessionTagStore.getTag(tugSessionId), [tugSessionId]),
  );
  return sessionCardTitleOverride(projectDir, name, tag, branch);
}

/** Quiet, offline-tinted phase input used until a card's services exist. */
const OFFLINE_PHASE_INPUT: SessionPhaseInput = {
  phase: "idle",
  transportState: "offline",
  interruptInFlight: false,
};

const PHASE_VISUAL: (key: string) => TugProgressIndicatorPhaseVisual =
  sessionSessionPhaseVisual;

/** Stable no-op subscribe for a card whose services aren't constructed yet. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Glyph box for the row's phase dot — the knob for its SIZE. Its vertical
 * position is the separate `--tugx-lens-sessions-dot-rise` knob in
 * `sessions-section.css`.
 *
 * This is the BOX, not the dot: the `pulsing-dot` sheds a ring that
 * travels out to the box edge, and the dot itself paints at 60% of the box at
 * the top of its breath (35% at the bottom). So a running row reads as a
 * `0.6 × size` dot throwing a ring the full width of the box — at 32, a 19px
 * dot inside a 32px ring.
 *
 * A settled row is deliberately smaller, and by the variant's own doing: the
 * component's presence ladder draws stopped / completed in to half the box and
 * paused / aborted to 0.7 of it. At 32 that is a 16px quiet ring against the
 * running row's 32px — which is the whole reason this size is legible from
 * across the room without every idle session shouting along with it.
 *
 * Ceiling before the row grows: the two text lines total 38px (a 19px title
 * over a 19px pulse line), so any size up to ~38 leaves the row height alone.
 * At 32 that leaves only ~3px of slack per side, which is why the rise knob
 * next door sits near zero — see `sessions-section.css`.
 */
const ROW_PHASE_DOT_SIZE = 28;

/** The per-row phase dot — reads the bound card's `codeSessionStore`. */
function RowPhaseDot({ cardId }: { cardId: string }): React.ReactElement {
  const services = useSyncExternalStore(cardServicesStore.subscribe, () =>
    cardServicesStore.getServices(cardId),
  );
  const store = services?.codeSessionStore ?? null;
  const snap = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store !== null ? store.getSnapshot : () => null,
    () => null,
  );
  const input: SessionPhaseInput =
    snap !== null
      ? {
          phase: snap.phase,
          transportState: snap.transportState,
          interruptInFlight: snap.interruptInFlight,
        }
      : OFFLINE_PHASE_INPUT;
  return (
    <TugProgressIndicator
      variant="pulsing-dot"
      size={ROW_PHASE_DOT_SIZE}
      phase={sessionSessionPhaseKey(input)}
      phaseVisual={PHASE_VISUAL}
      // The ONLY place in the app that takes the dot's period jitter. This is
      // a list of separate sessions, each doing its own work, and on one exact
      // period a column of them reads as a single mechanism with several
      // heads; a few percent of spread pulls them apart over a dozen breaths.
      // Everywhere else — a Z2 STATE cell, a tool-call header — the dots
      // belong to one thing and must stay locked, so they take the nominal
      // period. Keyed on the card so a session keeps its rate across a filter,
      // a reorder, or a scroll out of view and back.
      style={dotDriftFor(cardId)}
      aria-hidden
    />
  );
}

/** The per-row activity sparkline over the session's composite series. */
function RowSparkline({ tugSessionId }: { tugSessionId: string }): React.ReactElement {
  const activityStore = getSessionActivityStore();
  const getSeries = useCallback(
    (nowMs: number): number[] =>
      activityStore !== null && tugSessionId.length > 0
        ? activityStore.compositeSeries(tugSessionId, nowMs)
        : [],
    [activityStore, tugSessionId],
  );
  // Dormancy wake channel — an idle session's row costs nothing until its
  // next activity frame, which wakes the tape in the same tick.
  const subscribeActivity = useCallback(
    (wake: () => void): (() => void) =>
      activityStore !== null && tugSessionId.length > 0
        ? activityStore.subscribeRateActivity(tugSessionId, wake)
        : () => {},
    [activityStore, tugSessionId],
  );
  return (
    <TugSparkline
      getSeries={getSeries}
      subscribeActivity={subscribeActivity}
      binMs={ACTIVITY_BIN_MS}
      fullScale={SPARKLINE_FULL_SCALE_CHARS}
      curve={SPARKLINE_CURVE}
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      className="sessions-monitor-spark"
      title="Session activity — text, tokens, tools, and subagents"
    />
  );
}

/** One monitor row, composed on the shared `TugListRow` chrome (padding,
 *  hover, divider, and the movement-cursor caret come from the row + the
 *  enclosing `TugListView`). The phase dot leads and the reorder grip trails;
 *  in between, the content column is authored by hand as two lines:
 *
 *    line 1 — the session name, with the slot layout right-aligned past it
 *    line 2 — the latest pulse line, with the activity sparkline past it
 *
 *  The hand-authored column is what keeps the arrangement affordance off the
 *  pulse line: on the row's `title`/`subtitle` path a trailing accessory spans
 *  both lines, so the slots and the pulse text end up competing for the same
 *  run. The `TugListView` cell wrapper still owns cursor / selection / click. */
function SessionRowContent({ row }: { row: MonitorRow }): React.ReactElement {
  const ctx = React.useContext(SessionsCellContext);
  const filterQuery = useSessionsFilterQuery();
  const changesets = useChangesetAll();
  const branch = branchForProject(changesets, row.projectDir);
  const displayName = useSessionLabel(row.projectDir, row.tugSessionId, branch);
  const pulse = usePulse();
  const latest = latestLineForScope(pulse.lines, row.tugSessionId);
  // The session's standing goal — the same string the card's strip wears as
  // its headline. Rendered on its own line here (L1) rather than inline, and
  // only when it exists: an absent overview costs the row no height.
  const overview = usePulseOverview(row.tugSessionId);
  // The compaction pin, exactly as the on-card strip wears it: a `/compact`
  // run streams nothing for minutes, so without it the row keeps showing the
  // last line from before the submit for the whole run.
  const compaction = useSyncExternalStore(
    compactionProgressStore.subscribe,
    compactionProgressStore.getSnapshot,
  );
  const pulseText = !pulse.enabled
    ? null
    : isCompactingCard(compaction, row.cardId)
      ? COMPACTING_PULSE_TEXT
      : latest !== null
        ? latest.text
        : null;
  return (
    <TugListRow
      className="session-row-content"
      data-session-id={row.tugSessionId}
      leading={<RowPhaseDot cardId={row.cardId} />}
      grip={
        ctx !== null ? (
          <BlockGrip
            onPointerDown={(e) => ctx.onGripPointerDown(row.tugSessionId, e)}
          />
        ) : undefined
      }
    >
      <span className="session-row-headline">
        <TugLabel className="tug-list-row-title" size="sm" maxLines={1}>
          {renderFilterHighlight(displayName, filterQuery)}
        </TugLabel>
        <SlotPicker cardId={row.cardId} />
      </span>
      {pulse.enabled && overview !== null ? (
        <span className="session-row-intent-line">
          <span
            className="session-row-intent"
            data-slot="session-row-intent"
          >
            {overview.text}
          </span>
        </span>
      ) : null}
      <span className="session-row-pulse-line">
        {pulseText !== null ? (
          <span className="sessions-monitor-pulse">{pulseText}</span>
        ) : (
          <span className="sessions-monitor-pulse sessions-monitor-pulse-none">
            None
          </span>
        )}
        <RowSparkline tugSessionId={row.tugSessionId} />
      </span>
    </TugListRow>
  );
}

/** The `"session"` cell renderer — queries the data source for its row. */
const SessionCell: TugListViewCellRenderer<LensSessionsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<LensSessionsDataSource>) => {
  return <SessionRowContent row={dataSource.rowAt(index)} />;
};

const SESSIONS_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<LensSessionsDataSource>
> = { session: SessionCell };

/** The Lens band's collapsed summary: `N sessions`. */
function SessionsCollapsedSummary(): React.ReactElement {
  const bindings = useOpenBindings();
  const n = useMemo(() => buildSessionRows(bindings).length, [bindings]);
  return <>{`${n} session${n === 1 ? "" : "s"}`}</>;
}

function SessionsSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const bindings = useOpenBindings();
  const sessionOrder = useSyncExternalStore(
    lensStore.subscribe,
    useCallback(() => lensStore.getSnapshot().sessionOrder, []),
  );
  const filterQuery = useSessionsFilterQuery();
  // Labels are built from the name / tag stores at recompute time, so their
  // versions are inputs: a name or tag arriving late must re-run the filter.
  const nameVersion = useSyncExternalStore(
    sessionNameStore.subscribe,
    sessionNameStore.getVersion,
  );
  const tagVersion = useSyncExternalStore(
    sessionTagStore.subscribe,
    sessionTagStore.getVersion,
  );
  const dataSource = useLensSessionsDataSource({
    bindings,
    order: sessionOrder,
    filterQuery,
    nameVersion,
    tagVersion,
  });
  const count = dataSource.numberOfItems();
  const filtering = dataSource.isFiltering();
  // Content is what the list SHOWS: a section filtered to zero is not a focus
  // stop, exactly like an empty one. The band's field registers separately, so
  // it stays reachable and clearable.
  const hasContent = count > 0;
  // …and what it holds BEFORE the filter, which is the separate question the
  // band's filter field turns on: a section filtered to zero still has items.
  const hasItems = dataSource.unfilteredCount() > 0;

  // Reorder by grip: commit on drop ([Q02]). Rows match by their stable
  // `data-session-id`; the FLIP animates the row content, the store commit
  // persists the new user order. New sessions (absent from `sessionOrder`)
  // stay at the bottom until the user moves them.
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const { onGripPointerDown: beginGripReorder } = useBlockReorder({
    containerRef: listWrapRef,
    caretRef,
    getVisibleOrder: () => dataSource.visibleOrder(),
    commit: (order) => lensStore.setSessionOrder([...order]),
    selector: ROW_SELECTOR,
    kindAttr: ROW_KIND_ATTR,
  });
  // Reorder is unavailable while a filter is active: the drop order describes
  // only the VISIBLE rows and `setSessionOrder` persists the whole arrangement,
  // so committing a partial order would scramble the hidden rows. The grips
  // hide via `data-filter-active` + CSS ([L06]) and the handler no-ops.
  const onGripPointerDown = useCallback(
    (id: string, event: React.PointerEvent): void => {
      if (filtering) return;
      beginGripReorder(id, event);
    },
    [filtering, beginGripReorder],
  );
  const cellContext = useMemo<SessionsCellContextValue>(
    () => ({ onGripPointerDown }),
    [onGripPointerDown],
  );

  // Publish what this band holds: `navigable` so the Lens skips it for the
  // Cmd-L seed / Tab walk when the list shows nothing, `populated` so the band
  // knows whether there is anything to filter at all.
  useLayoutEffect(() => {
    setSectionContent(host.focusGroup, {
      navigable: hasContent,
      populated: hasItems,
    });
    return () =>
      setSectionContent(host.focusGroup, {
        navigable: false,
        populated: false,
      });
  }, [host.focusGroup, hasContent, hasItems]);

  const initialSelectedIndex = useMemo(() => {
    if (lastSelectedSessionId === null) return undefined;
    const i = dataSource.indexForId(lastSelectedSessionId);
    return i >= 0 ? i : undefined;
    // Recompute when membership changes (the data source version bumps `count`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, count]);

  // A monitor row has no "selected but not activated" state: Space/click
  // (`onSelect`) and Enter (`onActivate`) both front the bound card and
  // remember the session for the next cursor seed ([P11]/[P10]).
  const delegate = useMemo<TugListViewDelegate>(() => {
    const activate = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row === undefined) return;
      lastSelectedSessionId = row.tugSessionId;
      dispatchAction({ action: "focus-session-card", cardId: row.cardId });
    };
    return { onSelect: activate, onActivate: activate };
  }, [dataSource]);

  return (
    <div className="sessions-section">
      {count === 0 ? (
        // Render the empty label INSTEAD of the list: an empty `flex: 1 1 auto`
        // list would grow to fill the section and push the label down, opening a
        // gap under the band (and paint an empty framed box). "No matches" is
        // the distinct filtered-to-zero face.
        <div className="sessions-card-empty" data-testid="lens-sessions-empty">
          {dataSource.unfilteredCount() > 0 ? "No matches" : "None"}
        </div>
      ) : (
        <div
          className="sessions-list-wrap"
          ref={listWrapRef}
          data-filter-active={filtering ? "true" : undefined}
        >
          <BlockDropCaret ref={caretRef} />
          <SessionsCellContext value={cellContext}>
            <TugListView<LensSessionsDataSource>
              dataSource={dataSource}
              delegate={delegate}
              cellRenderers={SESSIONS_CELL_RENDERERS}
              scrollKey="lens-sessions"
              ringPlacement="inset"
              inline
              rowLayout="flush"
              focusGroup={hasContent ? host.focusGroup : undefined}
              commitOnEnter="act"
              initialSelectedIndex={initialSelectedIndex}
              className="lens-sessions-list"
            />
          </SessionsCellContext>
        </div>
      )}
    </div>
  );
}

/**
 * Register the Sessions Lens section. Called once at boot from `main.tsx`. The
 * body reads app-level singletons directly (no host feed wiring), so it is
 * host-agnostic — it takes only the `focusGroup` from the host.
 */
export function registerSessionsSection(): void {
  registerLensSection({
    kind: SECTION_KIND,
    title: "Sessions",
    filterable: true,
    glyph: <GitBranch size={14} />,
    collapsedSummary: () => <SessionsCollapsedSummary />,
    body: (host) => <SessionsSectionBody host={host} />,
  });
}
