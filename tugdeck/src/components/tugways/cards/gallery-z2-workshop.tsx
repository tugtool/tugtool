/**
 * gallery-z2-workshop.tsx — design-spike workshop for a configurable
 * Z2 status area: one unified demo of the whole experience.
 *
 * The surface composes three ideas that earlier iterations explored
 * as separate proposals:
 *
 *  - **The row** — a configurable instrument row (macOS-toolbar
 *    style): a registry of status items rendered in user order, with
 *    spacer / flexible-space items. Chrome models the proposed Z2
 *    layout: maximize at the LEFT end; at the right end the configure
 *    gear sits inboard and the shelf disclosure takes the very end.
 *
 *  - **The shelf** — pinned lanes below the transcript (TASKS, JOBS,
 *    PULSE; three max, arranged in the configure sheet), opened by
 *    the chevron. Height-stable once open: five data rows per lane
 *    plus a sixth controls row. In a multi-lane arrangement each lane
 *    legend carries an explicit expand/contract affordance — click to
 *    focus one lane (the others contract to a peek column), click
 *    again to share evenly. The shelf steals its fixed height from
 *    the transcript above (the real Z2 mechanism: the list is
 *    `flex: 1 1 auto`; the shelf is a sibling).
 *
 *  - **PULSE** — the "color commentary" concept: an AI side-channel
 *    line summarizing what is actually going on, beyond the STATE
 *    label. PULSE surfaces exactly ONCE, by priority: as a row item
 *    if configured there; else as a pinned lane when the shelf is
 *    open with a PULSE lane; else as the ambient one-line strip under
 *    the row. No duplication.
 *
 * The gear opens Finder's "Customize Toolbar…" translated: drag items
 * between the palette and the live row, reorder, remove; arrange the
 * shelf lanes the same way. Everything is driven by a looping
 * scripted mock session (play/pause/restart) so the surfaces feel
 * alive. Config is session-local in this spike — production would
 * persist via tugbank defaults. The card exists to judge look +
 * interaction, not to ship plumbing.
 *
 * @module components/tugways/cards/gallery-z2-workshop
 */

import "./gallery-z2-workshop.css";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsLeftRight,
  ChevronsRightLeft,
  GripVertical,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Settings,
  X,
} from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  TugProgressIndicator,
  type TugProgressIndicatorState,
} from "@/components/tugways/tug-progress-indicator";

// ---------------------------------------------------------------------------
// Mock session script — one looping "match" the surfaces narrate.
// ---------------------------------------------------------------------------

interface MockTask {
  subject: string;
  status: "pending" | "in_progress" | "completed";
}

interface MockJob {
  description: string;
  kind: "bash" | "monitor";
  status: "running" | "completed" | "failed" | "stopped";
  elapsedS: number;
}

interface Beat {
  /** STATE cell title (the play-by-play). */
  state: string;
  /** The PULSE line (the color-commentary side channel). */
  commentary?: string;
  tasks?: MockTask[];
  jobs?: MockJob[];
}

const T = (subject: string, status: MockTask["status"]): MockTask => ({
  subject,
  status,
});

/** A believable ~30s session arc, looped by the player. */
const SCRIPT: Beat[] = [
  {
    state: "Idle",
    commentary: "Quiet board. Last session shipped the popover rework.",
    tasks: [],
    jobs: [],
  },
  {
    state: "Awaiting first response",
    commentary: "You asked for the focus-engine refactor — Claude is reading the request.",
  },
  {
    state: "Streaming",
    commentary: "Plan forming: three files implicated, reducer first, tests in parallel.",
  },
  {
    state: "Running tools",
    commentary: "Four-step task list on the board; opening reducer.ts now.",
    tasks: [
      T("Extract shared gate predicate", "in_progress"),
      T("Rewire popover callbacks", "pending"),
      T("Update fixture tests", "pending"),
      T("Sweep stale docstrings", "pending"),
    ],
  },
  {
    state: "Running tools",
    commentary: "Test suite kicked to a background shell so editing can continue.",
    jobs: [{ description: "bun test (full sweep)", kind: "bash", status: "running", elapsedS: 2 }],
  },
  {
    state: "Running tools",
    commentary: "Gate predicate landed — the same check now guards both insert paths.",
    tasks: [
      T("Extract shared gate predicate", "completed"),
      T("Rewire popover callbacks", "in_progress"),
      T("Update fixture tests", "pending"),
      T("Sweep stale docstrings", "pending"),
    ],
    jobs: [{ description: "bun test (full sweep)", kind: "bash", status: "running", elapsedS: 9 }],
  },
  {
    state: "Running tools",
    commentary: "Background tests came back green — 3,546 passing. Popover wiring is next.",
    jobs: [
      { description: "bun test (full sweep)", kind: "bash", status: "completed", elapsedS: 14 },
      { description: "watch HMR errors", kind: "monitor", status: "running", elapsedS: 1 },
    ],
  },
  {
    state: "Streaming",
    commentary: "Callbacks rewired; fixtures updating to the new shapes.",
    tasks: [
      T("Extract shared gate predicate", "completed"),
      T("Rewire popover callbacks", "completed"),
      T("Update fixture tests", "in_progress"),
      T("Sweep stale docstrings", "pending"),
    ],
  },
  {
    state: "Idle",
    commentary: "All four tasks done. Diff touches 3 files; the HMR watcher saw no errors.",
    tasks: [
      T("Extract shared gate predicate", "completed"),
      T("Rewire popover callbacks", "completed"),
      T("Update fixture tests", "completed"),
      T("Sweep stale docstrings", "completed"),
    ],
    jobs: [
      { description: "bun test (full sweep)", kind: "bash", status: "completed", elapsedS: 14 },
      { description: "watch HMR errors", kind: "monitor", status: "stopped", elapsedS: 22 },
    ],
  },
];

const BEAT_MS = 3200;

interface MockSession {
  state: string;
  commentary: string;
  /** Rolling commentary log, newest last. */
  commentaryLog: ReadonlyArray<{ atBeat: number; text: string }>;
  tasks: MockTask[];
  jobs: MockJob[];
  beat: number;
}

const INITIAL_SESSION: MockSession = {
  state: "Idle",
  commentary: SCRIPT[0].commentary ?? "",
  commentaryLog: [{ atBeat: 0, text: SCRIPT[0].commentary ?? "" }],
  tasks: [],
  jobs: [],
  beat: 0,
};

/** Fold one beat into the session (carry-forward semantics). */
function applyBeat(prev: MockSession, beatIndex: number): MockSession {
  const beat = SCRIPT[beatIndex % SCRIPT.length];
  const isLoopStart = beatIndex % SCRIPT.length === 0;
  const commentary = beat.commentary ?? prev.commentary;
  return {
    state: beat.state,
    commentary,
    commentaryLog:
      beat.commentary !== undefined
        ? [
            ...(isLoopStart ? [] : prev.commentaryLog.slice(-5)),
            { atBeat: beatIndex, text: beat.commentary },
          ]
        : prev.commentaryLog,
    tasks: beat.tasks ?? (isLoopStart ? [] : prev.tasks),
    jobs: beat.jobs ?? (isLoopStart ? [] : prev.jobs),
    beat: beatIndex,
  };
}

/** Drive the looping script; returns the session + player controls. */
function useMockSession(): {
  session: MockSession;
  playing: boolean;
  togglePlaying: () => void;
  reset: () => void;
} {
  const [session, setSession] = useState<MockSession>(INITIAL_SESSION);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setSession((prev) => applyBeat(prev, prev.beat + 1));
    }, BEAT_MS);
    return () => clearInterval(timer);
  }, [playing]);
  return {
    session,
    playing,
    togglePlaying: () => setPlaying((p) => !p),
    reset: () => setSession(INITIAL_SESSION),
  };
}

// ---------------------------------------------------------------------------
// Shared mini-renderers
// ---------------------------------------------------------------------------

function taskDotState(status: MockTask["status"]): TugProgressIndicatorState {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "running";
  return "stopped";
}

function jobDotState(status: MockJob["status"]): TugProgressIndicatorState {
  if (status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "aborted";
  return "stopped";
}

function countDone(tasks: MockTask[]): string {
  if (tasks.length === 0) return "None";
  return `${tasks.filter((t) => t.status === "completed").length}/${tasks.length}`;
}

function countFinished(jobs: MockJob[]): string {
  if (jobs.length === 0) return "None";
  return `${jobs.filter((j) => j.status !== "running").length}/${jobs.length}`;
}

/** Fake transcript filler — the zone the shelf steals height from. */
function FakeTranscript(): React.ReactElement {
  return (
    <div className="z2ws-transcript" aria-hidden>
      {[78, 62, 88, 45, 70, 84, 56, 73, 66, 90, 52, 80].map((w, i) => (
        <div key={i} className="z2ws-transcript-line" style={{ width: `${w}%` }} />
      ))}
      <div className="z2ws-transcript-label">transcript — cedes height to the shelf</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration vocabulary — row items + shelf lanes.
// ---------------------------------------------------------------------------

type LaneId = "tasks" | "jobs" | "pulse";

const LANE_LABELS: Record<LaneId, string> = {
  tasks: "TASKS",
  jobs: "JOBS",
  pulse: "PULSE",
};

const ALL_LANES: LaneId[] = ["tasks", "jobs", "pulse"];
const DEFAULT_LANES: LaneId[] = ["tasks", "jobs", "pulse"];

type RackItemId =
  | "state"
  | "time"
  | "tokens"
  | "context"
  | "tasks"
  | "jobs"
  | "pulse"
  | "space"
  | "flex";

interface RackItemSpec {
  id: RackItemId;
  label: string;
  /** Spacers can appear multiple times; instruments are one-shot. */
  repeatable?: boolean;
  /** Flexible items soak leftover row width. */
  flexible?: boolean;
}

const RACK_ITEMS: RackItemSpec[] = [
  { id: "state", label: "STATE" },
  { id: "time", label: "TIME" },
  { id: "tokens", label: "TOKENS" },
  { id: "context", label: "CONTEXT" },
  { id: "tasks", label: "TASKS" },
  { id: "jobs", label: "JOBS" },
  { id: "pulse", label: "PULSE", flexible: true },
  { id: "space", label: "SPACE", repeatable: true },
  { id: "flex", label: "FLEX SPACE", repeatable: true, flexible: true },
];

const RACK_DEFAULT: RackItemId[] = ["state", "time", "tokens", "context", "tasks", "jobs"];

function rackSpec(id: RackItemId): RackItemSpec {
  return RACK_ITEMS.find((i) => i.id === id)!;
}

function rackValue(id: RackItemId, session: MockSession): string {
  switch (id) {
    case "state":
      return session.state;
    case "time":
      return `0m ${String((session.beat * 3) % 60).padStart(2, "0")}s`;
    case "tokens":
      return `${(4.2 + session.beat * 1.7).toFixed(1)}K`;
    case "context":
      return `${(25 + session.beat * 2).toFixed(1)}K / 1.00M`;
    case "tasks":
      return countDone(session.tasks);
    case "jobs":
      return countFinished(session.jobs);
    case "pulse":
      return session.commentary;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// The shelf — pinned lanes, height-stable.
// ---------------------------------------------------------------------------

/** Per-lane data-row budget — the shelf never grows past this. */
const SHELF_LANE_ROWS = 5;

function laneOverflowCount(id: LaneId, session: MockSession): number {
  const total =
    id === "tasks"
      ? session.tasks.length
      : id === "jobs"
        ? session.jobs.length
        : session.commentaryLog.length;
  return Math.max(0, total - SHELF_LANE_ROWS);
}

/** One lane's data rows — uniform `.z2ws-lane-item` typography. */
function LaneRows({
  id,
  session,
}: {
  id: LaneId;
  session: MockSession;
}): React.ReactElement {
  if (id === "tasks") {
    if (session.tasks.length === 0) {
      return <div className="z2ws-lane-empty">No task list active.</div>;
    }
    return (
      <>
        {session.tasks.slice(0, SHELF_LANE_ROWS).map((t) => (
          <div key={t.subject} className="z2ws-lane-item">
            <TugProgressIndicator
              variant="pulsing-dot"
              size={11}
              state={taskDotState(t.status)}
              aria-label={t.status}
            />
            <span className="z2ws-lane-item-text">{t.subject}</span>
          </div>
        ))}
      </>
    );
  }
  if (id === "jobs") {
    if (session.jobs.length === 0) {
      return <div className="z2ws-lane-empty">No background jobs.</div>;
    }
    return (
      <>
        {session.jobs.slice(0, SHELF_LANE_ROWS).map((j) => (
          <div key={j.description} className="z2ws-lane-item">
            <TugProgressIndicator
              variant="pulsing-dot"
              size={11}
              state={jobDotState(j.status)}
              aria-label={j.status}
            />
            <span className="z2ws-lane-item-text">{j.description}</span>
            <span className="z2ws-lane-item-meta">
              {j.kind} · {j.elapsedS}s
            </span>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {session.commentaryLog.slice(-SHELF_LANE_ROWS).map((line) => (
        <div key={line.atBeat} className="z2ws-lane-item">
          <span className="z2ws-lane-item-meta">
            {String(line.atBeat % SCRIPT.length).padStart(2, "0")}
          </span>
          <span className="z2ws-lane-item-text z2ws-lane-item-prose">
            {line.text}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Drag visuals — the TugTabBar grammar translated to HTML5 dnd:
 * a styled ghost follows the pointer (via `setDragImage` on a
 * transient clone), the source dims (`data-dragging`), and an
 * absolute 2px insertion caret glides (`transition: left`) to the
 * resolved drop position inside the target container.
 */
function startDragGhost(e: React.DragEvent, label: string): void {
  e.dataTransfer.effectAllowed = "move";
  const ghost = document.createElement("div");
  ghost.className = "z2ws-drag-ghost";
  ghost.textContent = label;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 14, 14);
  window.setTimeout(() => ghost.remove(), 0);
}

interface InsertionPoint {
  index: number;
  /** Caret x in px, relative to the drop container's left edge. */
  x: number;
}

/**
 * Resolve the insertion point from the pointer x vs item midpoints —
 * the same approach as the tab bar's reorder math — plus the caret's
 * x (the left edge of the item at `index`, or the right edge of the
 * last item for an append).
 */
function computeInsertion(
  container: HTMLElement,
  itemSelector: string,
  clientX: number,
): InsertionPoint {
  const containerRect = container.getBoundingClientRect();
  const els = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  if (els.length === 0) return { index: 0, x: 8 };
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (clientX < r.left + r.width / 2) {
      return { index: i, x: r.left - containerRect.left - 2 };
    }
  }
  const last = els[els.length - 1].getBoundingClientRect();
  return { index: els.length, x: last.right - containerRect.left + 2 };
}

/**
 * The shelf body — lanes per the configured arrangement, then the
 * always-present sixth controls row. Each lane legend (in a
 * multi-lane arrangement) carries an explicit expand/contract
 * affordance — chevrons-apart to expand, chevrons-together to share
 * again — so the focus interaction is discoverable, not a secret
 * click target.
 *
 * While customizing, the shelf IS the lane editor — no schematic
 * elsewhere: lanes get drag grips and an × in their legends (focus
 * toggling pauses), drag a lane to reorder in place with a live
 * insertion caret, and the lane palette sits directly beneath the
 * shelf. The zero-lane state keeps the lane band's exact height and
 * remains a drop target, so emptying the shelf never moves anything.
 */
function Shelf({
  session,
  lanes,
  open,
  customizing,
  onLanesChange,
}: {
  session: MockSession;
  lanes: LaneId[];
  open: boolean;
  customizing: boolean;
  onLanesChange: (lanes: LaneId[]) => void;
}): React.ReactElement {
  const [focused, setFocused] = useState<LaneId | null>(null);
  const [caret, setCaret] = useState<InsertionPoint | null>(null);
  const [draggingLane, setDraggingLane] = useState<LaneId | null>(null);
  const laneDragFrom = useRef<{ source: "palette" | "shelf"; index: number } | null>(
    null,
  );
  const laneAvailable = ALL_LANES.filter((id) => !lanes.includes(id));

  const commitLaneDrop = useCallback(
    (targetIndex: number) => {
      const from = laneDragFrom.current;
      if (from === null) return;
      const next = lanes.slice();
      if (from.source === "shelf") {
        const [moved] = next.splice(from.index, 1);
        next.splice(
          targetIndex > from.index ? targetIndex - 1 : targetIndex,
          0,
          moved,
        );
      } else {
        const id = laneAvailable[from.index];
        if (id === undefined || next.includes(id) || next.length >= 3) return;
        next.splice(targetIndex, 0, id);
      }
      laneDragFrom.current = null;
      onLanesChange(next);
    },
    [lanes, laneAvailable, onLanesChange],
  );

  const clearDragVisuals = useCallback(() => {
    setCaret(null);
    setDraggingLane(null);
  }, []);

  const overflow = lanes
    .map((id) => ({ id, count: laneOverflowCount(id, session) }))
    .filter((o) => o.count > 0)
    .map((o) => `${LANE_LABELS[o.id].toLowerCase()} +${o.count}`);

  return (
    <>
      <div className="z2ws-shelf" data-open={open ? "true" : "false"}>
        {lanes.length === 0 ? (
          <div
            className="z2ws-lanes z2ws-lanes-none"
            onDragOver={(e) => {
              if (!customizing) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              if (!customizing) return;
              e.preventDefault();
              commitLaneDrop(0);
              clearDragVisuals();
            }}
          >
            <span className="z2ws-lane-empty">
              No lanes configured — drag some in below.
            </span>
          </div>
        ) : (
          <div
            className="z2ws-lanes"
            data-lane-count={lanes.length}
            onDragOver={(e) => {
              if (!customizing || laneDragFrom.current === null) return;
              e.preventDefault();
              setCaret(
                computeInsertion(e.currentTarget, ".z2ws-lane", e.clientX),
              );
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setCaret(null);
              }
            }}
            onDrop={(e) => {
              if (!customizing) return;
              e.preventDefault();
              const point = computeInsertion(
                e.currentTarget,
                ".z2ws-lane",
                e.clientX,
              );
              commitLaneDrop(point.index);
              clearDragVisuals();
            }}
          >
            {lanes.map((id, index) => (
              <div
                key={id}
                className="z2ws-lane"
                data-lane={id}
                data-customizing={customizing ? "true" : undefined}
                data-dragging={draggingLane === id ? "true" : undefined}
                data-focus={
                  customizing || focused === null
                    ? "none"
                    : focused === id
                      ? "self"
                      : "other"
                }
                draggable={customizing}
                onDragStart={(e) => {
                  laneDragFrom.current = { source: "shelf", index };
                  setDraggingLane(id);
                  startDragGhost(e, LANE_LABELS[id]);
                }}
                onDragEnd={clearDragVisuals}
              >
                {customizing ? (
                  <div className="z2ws-lane-legend z2ws-lane-legend-editing">
                    <span className="z2ws-rack-grip" aria-hidden>
                      <GripVertical size={10} />
                    </span>
                    <span className="z2ws-lane-legend-text">
                      {LANE_LABELS[id]}
                    </span>
                    <button
                      type="button"
                      className="z2ws-lane-remove"
                      aria-label={`Remove the ${LANE_LABELS[id]} lane`}
                      onClick={() =>
                        onLanesChange(lanes.filter((_, i) => i !== index))
                      }
                    >
                      <X size={9} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="z2ws-lane-legend"
                    aria-pressed={focused === id}
                    title={
                      focused === id
                        ? "Contract — share the shelf again"
                        : "Expand this lane"
                    }
                    onClick={() => setFocused((f) => (f === id ? null : id))}
                    disabled={lanes.length < 2}
                  >
                    <span className="z2ws-lane-legend-text">
                      {LANE_LABELS[id]}
                    </span>
                    {lanes.length > 1 ? (
                      <span className="z2ws-lane-legend-affordance" aria-hidden>
                        {focused === id ? (
                          <ChevronsRightLeft size={11} />
                        ) : (
                          <ChevronsLeftRight size={11} />
                        )}
                      </span>
                    ) : null}
                  </button>
                )}
                <LaneRows id={id} session={session} />
              </div>
            ))}
            {caret !== null ? (
              <div
                className="z2ws-insert-indicator"
                style={{ left: `${caret.x}px` }}
                aria-hidden
              />
            ) : null}
          </div>
        )}

        {/* Sixth row — controls + overflow counts. Always present, so
            the shelf's height never moves once it is open. */}
        <div className="z2ws-shelf-footer" data-slot="z2ws-shelf-footer">
          <span className="z2ws-shelf-overflow">
            {overflow.length > 0 ? overflow.join(" · ") : " "}
          </span>
          <div className="z2ws-shelf-actions">
            <TugPushButton emphasis="ghost" role="action" size="xs">
              More…
            </TugPushButton>
            <TugPushButton emphasis="ghost" role="action" size="xs">
              Clear
            </TugPushButton>
          </div>
        </div>
      </div>

      {/* The lane palette — directly under the section it edits. A
          fixed-height single-line strip, so adding or removing lanes
          never moves the configurator. */}
      {customizing ? (
        <div className="z2ws-config-panel" data-slot="z2ws-lane-palette">
          <span className="z2ws-config-panel-title">
            {laneAvailable.length > 0
              ? "Drag lanes into the shelf (three max)…"
              : "All lanes are on the shelf."}
          </span>
          <div className="z2ws-rack-palette">
            {laneAvailable.map((id, index) => (
              <div
                key={id}
                className="z2ws-rack-chip"
                draggable
                onDragStart={(e) => {
                  laneDragFrom.current = { source: "palette", index };
                  startDragGhost(e, LANE_LABELS[id]);
                }}
                onDragEnd={clearDragVisuals}
                onDoubleClick={() =>
                  lanes.length < 3 && onLanesChange([...lanes, id])
                }
                title="Drag into the shelf (or double-click to append)"
              >
                {LANE_LABELS[id]}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The unified demo — one Z2 area: configurable row, PULSE, shelf.
// Each section edits IN PLACE while customizing, with its palette
// directly beneath it — the live surface is the configurator; there
// is no separate schematic. Every configure surface is height-stable:
// adding or removing items never moves the layout.
// ---------------------------------------------------------------------------

function UnifiedZ2Demo({ session }: { session: MockSession }): React.ReactElement {
  const [row, setRow] = useState<RackItemId[]>(RACK_DEFAULT);
  const [lanes, setLanes] = useState<LaneId[]>(DEFAULT_LANES);
  const [shelfOpen, setShelfOpen] = useState(true);
  const [customizing, setCustomizing] = useState(false);
  const [rowCaret, setRowCaret] = useState<InsertionPoint | null>(null);
  const [draggingCell, setDraggingCell] = useState<number | null>(null);
  const dragFrom = useRef<{ source: "palette" | "row"; index: number } | null>(null);

  const available = RACK_ITEMS.filter(
    (i) => i.repeatable === true || !row.includes(i.id),
  );

  // Customizing edits the shelf in place, so the shelf shows while the
  // gear is open even if the user keeps it closed otherwise.
  const effectiveShelfOpen = shelfOpen || customizing;

  // PULSE surfaces exactly once, by priority: row item → open shelf
  // lane → the ambient strip. The strip is the fallback, never a
  // duplicate. While customizing, the strip SLOT stays mounted either
  // way (live strip or a placeholder note) so toggling PULSE between
  // its homes never shifts the configurator's height.
  const pulseInRow = row.includes("pulse");
  const pulseInOpenShelf = effectiveShelfOpen && lanes.includes("pulse");
  const showStrip = !pulseInRow && !pulseInOpenShelf;

  const commitRowDrop = useCallback(
    (targetIndex: number) => {
      const from = dragFrom.current;
      if (from === null) return;
      setRow((prev) => {
        const next = prev.slice();
        if (from.source === "row") {
          const [moved] = next.splice(from.index, 1);
          next.splice(
            targetIndex > from.index ? targetIndex - 1 : targetIndex,
            0,
            moved,
          );
        } else {
          const id = available[from.index]?.id;
          if (id === undefined) return prev;
          if (!rackSpec(id).repeatable && next.includes(id)) return prev;
          next.splice(targetIndex, 0, id);
        }
        return next;
      });
      dragFrom.current = null;
    },
    [available],
  );

  const clearRowDragVisuals = useCallback(() => {
    setRowCaret(null);
    setDraggingCell(null);
  }, []);

  return (
    <div className="z2ws-frame" data-slot="z2ws-demo">
      <FakeTranscript />

      {/* The instrument row — renders the configured items; doubles as
          the drop target while customizing. Chrome: maximize LEFT;
          gear inboard; shelf disclosure at the very end. */}
      <div
        className="z2ws-rack-row"
        data-customizing={customizing ? "true" : "false"}
        onDragOver={(e) => {
          if (!customizing || dragFrom.current === null) return;
          e.preventDefault();
          setRowCaret(
            computeInsertion(e.currentTarget, ".z2ws-rack-cell", e.clientX),
          );
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setRowCaret(null);
          }
        }}
        onDrop={(e) => {
          if (!customizing) return;
          e.preventDefault();
          const point = computeInsertion(
            e.currentTarget,
            ".z2ws-rack-cell",
            e.clientX,
          );
          commitRowDrop(point.index);
          clearRowDragVisuals();
        }}
      >
        <TugPushButton
          subtype="icon"
          icon={<Maximize2 size={12} />}
          aria-label="Maximize the prompt entry (inert in this spike)"
          title="Maximize (moves to the left end)"
          emphasis="ghost"
          size="xs"
        />
        {row.length === 0 ? (
          <div className="z2ws-rack-empty">Drag items here…</div>
        ) : (
          row.map((id, index) => {
            const spec = rackSpec(id);
            return (
              <div
                key={`${id}-${index}`}
                className="z2ws-rack-cell"
                data-kind={id}
                data-flexible={spec.flexible ? "true" : undefined}
                data-dragging={draggingCell === index ? "true" : undefined}
                draggable={customizing}
                onDragStart={(e) => {
                  dragFrom.current = { source: "row", index };
                  setDraggingCell(index);
                  startDragGhost(e, spec.label);
                }}
                onDragEnd={clearRowDragVisuals}
              >
                {customizing ? (
                  <span className="z2ws-rack-grip" aria-hidden>
                    <GripVertical size={10} />
                  </span>
                ) : null}
                {id === "space" || id === "flex" ? (
                  <span className="z2ws-rack-space-glyph">
                    {id === "flex" ? "↔" : "·"}
                  </span>
                ) : (
                  <span className="z2ws-rack-cell-stack">
                    <span className="z2ws-rack-cell-legend">{spec.label}</span>
                    <span
                      className="z2ws-rack-cell-value"
                      data-kind={id}
                      title={rackValue(id, session)}
                    >
                      {rackValue(id, session)}
                    </span>
                  </span>
                )}
                {customizing ? (
                  <button
                    type="button"
                    className="z2ws-rack-remove"
                    aria-label={`Remove ${spec.label} from the row`}
                    onClick={() =>
                      setRow((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <X size={9} />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
        <TugPushButton
          subtype="icon"
          icon={<Settings size={12} />}
          aria-label={customizing ? "Finish configuring the status area" : "Configure the status area"}
          title="Configure status area"
          emphasis={customizing ? "tinted" : "ghost"}
          role="action"
          size="xs"
          onClick={() => setCustomizing((c) => !c)}
        />
        <TugPushButton
          subtype="icon"
          icon={shelfOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          aria-label={shelfOpen ? "Close the status shelf" : "Open the status shelf"}
          title={shelfOpen ? "Close shelf" : "Open shelf"}
          emphasis="ghost"
          size="xs"
          onClick={() => setShelfOpen((o) => !o)}
        />
        {rowCaret !== null ? (
          <div
            className="z2ws-insert-indicator"
            style={{ left: `${rowCaret.x}px` }}
            aria-hidden
          />
        ) : null}
      </div>

      {/* The row's item palette — directly under the section it edits.
          Fixed-height single-line strip: adding or removing items
          never moves the configurator. */}
      {customizing ? (
        <div className="z2ws-config-panel" data-slot="z2ws-row-palette">
          <span className="z2ws-config-panel-title">
            {available.length > 0
              ? "Drag items into the status row…"
              : "Every item is in the row."}
          </span>
          <div className="z2ws-rack-palette">
            {available.map((spec, index) => (
              <div
                key={spec.id}
                className="z2ws-rack-chip"
                draggable
                onDragStart={(e) => {
                  dragFrom.current = { source: "palette", index };
                  startDragGhost(e, spec.label);
                }}
                onDragEnd={clearRowDragVisuals}
                onDoubleClick={() =>
                  setRow((prev) =>
                    !spec.repeatable && prev.includes(spec.id)
                      ? prev
                      : [...prev, spec.id],
                  )
                }
                title="Drag into the row (or double-click to append)"
              >
                {spec.label}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* The PULSE strip — fallback surface only (see the priority
          rule above). While customizing, the slot stays mounted at
          fixed height with a placeholder when suppressed, so moving
          PULSE between its homes never shifts the layout. */}
      {showStrip ? (
        <div className="z2ws-strip" data-slot="z2ws-strip">
          <span className="z2ws-strip-legend">PULSE</span>
          <span key={session.beat} className="z2ws-strip-text">
            {session.commentary}
          </span>
        </div>
      ) : customizing ? (
        <div className="z2ws-strip" data-suppressed="true" data-slot="z2ws-strip">
          <span className="z2ws-strip-legend">PULSE</span>
          <span className="z2ws-strip-text z2ws-strip-placeholder">
            {pulseInRow
              ? "in the status row — the strip stands down"
              : "pinned on the shelf — the strip stands down"}
          </span>
        </div>
      ) : null}

      <Shelf
        session={session}
        lanes={lanes}
        open={effectiveShelfOpen}
        customizing={customizing}
        onLanesChange={setLanes}
      />

      {/* Configure footer — global actions only; each section's
          options live directly beneath that section. */}
      {customizing ? (
        <div className="z2ws-config-footer" data-slot="z2ws-config-footer">
          <span className="z2ws-rack-sheet-hint">
            Labels stay on — bare values mostly lose their meaning.
          </span>
          <div className="z2ws-rack-sheet-actions">
            <TugPushButton
              emphasis="outlined"
              role="action"
              size="xs"
              onClick={() => {
                setRow(RACK_DEFAULT);
                setLanes(DEFAULT_LANES);
              }}
            >
              Restore Defaults
            </TugPushButton>
            <TugPushButton
              emphasis="filled"
              role="action"
              size="xs"
              onClick={() => setCustomizing(false)}
            >
              Done
            </TugPushButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryZ2Workshop — public export
// ---------------------------------------------------------------------------

export function GalleryZ2Workshop(): React.ReactElement {
  const { session, playing, togglePlaying, reset } = useMockSession();
  return (
    <div className="cg-content z2ws" data-testid="gallery-z2-workshop">
      <div className="z2ws-toolbar">
        <TugLabel emphasis="calm">
          One Z2 area — the gear configures, the chevron pins, PULSE surfaces once.
        </TugLabel>
        <div className="z2ws-player">
          <TugPushButton
            subtype="icon"
            icon={playing ? <Pause size={13} /> : <Play size={13} />}
            aria-label={playing ? "Pause the mock session" : "Play the mock session"}
            emphasis="ghost"
            size="xs"
            onClick={togglePlaying}
          />
          <TugPushButton
            subtype="icon"
            icon={<RotateCcw size={13} />}
            aria-label="Restart the mock session"
            emphasis="ghost"
            size="xs"
            onClick={reset}
          />
          <TugLabel className="z2ws-player-beat" mono emphasis="calm">
            {`beat ${String(session.beat % SCRIPT.length).padStart(2, "0")}`}
          </TugLabel>
        </div>
      </div>

      <UnifiedZ2Demo session={session} />
    </div>
  );
}
