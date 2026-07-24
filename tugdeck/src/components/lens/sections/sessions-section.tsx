/**
 * The Lens **Sessions** section — a read-only session *monitor* rendered as a
 * `TugListView`. One row per open session card, stacked two lines:
 *
 *   [phase dot]  <session name>
 *                <latest pulse line>      <activity sparkline>
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
 * (`sessionCardTitleOverride`); the pulse line + sparkline share the second
 * row and align the same way the on-card `session-pulse-strip` does.
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
import { setSectionHasContent } from "@/components/lens/lens-section-content";
import {
  getFilterQuery,
  getFilterVersion,
  subscribeFilterQuery,
} from "@/components/lens/lens-filter-store";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
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
import {
  sparklineCurves,
  TugSparkline,
} from "@/components/tugways/tug-sparkline";
import {
  TugProgressIndicator,
  type TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";
import {
  sessionSessionPhaseKey,
  sessionSessionPhaseVisual,
  type SessionPhaseInput,
} from "@/lib/code-session-store/session-phase-visual";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { cardServicesStore } from "@/lib/card-services-store";
import { sessionNameStore } from "@/lib/session-name-store";
import { sessionTagStore } from "@/lib/session-tag-store";
import { sessionCardTitleOverride } from "@/lib/session-card-title";
import { branchForProject, useChangesetAll } from "@/lib/changeset-all-store";
import { latestLineForScope, usePulse } from "@/lib/pulse-store";
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
      size={12}
      phase={sessionSessionPhaseKey(input)}
      phaseVisual={PHASE_VISUAL}
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
 *  enclosing `TugListView`). The phase dot leads; the name is the title, the
 *  latest pulse line the subtitle, and the activity sparkline the trailing
 *  accessory. The `TugListView` cell wrapper owns cursor / selection / click. */
function SessionRowContent({ row }: { row: MonitorRow }): React.ReactElement {
  const ctx = React.useContext(SessionsCellContext);
  const filterQuery = useSessionsFilterQuery();
  const changesets = useChangesetAll();
  const branch = branchForProject(changesets, row.projectDir);
  const displayName = useSessionLabel(row.projectDir, row.tugSessionId, branch);
  const pulse = usePulse();
  const latest = latestLineForScope(pulse.lines, row.tugSessionId);
  const pulseText = pulse.enabled && latest !== null ? latest.text : null;
  return (
    <TugListRow
      className="session-row-content"
      data-session-id={row.tugSessionId}
      leading={
        <span className="session-row-lead">
          {ctx !== null ? (
            <BlockGrip
              onPointerDown={(e) => ctx.onGripPointerDown(row.tugSessionId, e)}
            />
          ) : null}
          <RowPhaseDot cardId={row.cardId} />
        </span>
      }
      title={renderFilterHighlight(displayName, filterQuery)}
      titleSize="sm"
      subtitle={
        pulseText !== null ? (
          <span className="sessions-monitor-pulse">{pulseText}</span>
        ) : (
          <span className="sessions-monitor-pulse sessions-monitor-pulse-none">
            None
          </span>
        )
      }
      trailing={<RowSparkline tugSessionId={row.tugSessionId} />}
    />
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

  // Publish content so the Lens skips this band for the Cmd-L seed / Tab walk
  // when it is empty (an empty list is not a focus stop).
  useLayoutEffect(() => {
    setSectionHasContent(host.focusGroup, hasContent);
    return () => setSectionHasContent(host.focusGroup, false);
  }, [host.focusGroup, hasContent]);

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
