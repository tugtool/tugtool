/**
 * gallery-z2-workshop.tsx — design-spike workshop for a configurable
 * Z2 status area.
 *
 * Two proposals, switchable, driven by one scripted mock session so
 * the surfaces feel alive:
 *
 *  - **Shelf** — the Z2 row grows an always-on one-line PULSE strip
 *    (the "color commentary" concept: an AI side-channel summarizing
 *    what is actually going on, beyond the STATE label) and a
 *    disclosure that opens a multi-lane shelf below the transcript:
 *    TASKS, JOBS, and the PULSE log pinned permanently visible. The
 *    shelf is **height-stable once configured** — five data rows per
 *    lane plus a sixth controls row (overflow counts, clear) — and
 *    steals that fixed height from the transcript area above it,
 *    exactly as the real Z2 row does (the transcript list is
 *    `flex: 1 1 auto`; the shelf is a sibling). Row chrome models the
 *    proposed Z2 layout: maximize at the LEFT end, the configure gear
 *    at the right end where maximize lives today.
 *
 *  - **Rack** — macOS-toolbar-style configuration, opened from the
 *    row's gear: a registry of status items, a live row you drag
 *    items into/out of/around (palette below, like Finder's
 *    "Customize Toolbar…" sheet), spacer + flexible-space items, and
 *    a restore-defaults action. PULSE is just another item — a
 *    flexible-width cell that soaks up leftover row space.
 *
 * Everything here is a workshop fixture: the session feed is a
 * scripted loop, and the rack config is session-local (production
 * would persist through tugbank defaults). The card exists to judge
 * look + interaction, not to ship plumbing.
 *
 * @module components/tugways/cards/gallery-z2-workshop
 */

import "./gallery-z2-workshop.css";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Settings,
  X,
} from "lucide-react";

import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugStatusCell } from "@/components/tugways/tug-status-cell";
import {
  TugProgressIndicator,
  type TugProgressIndicatorState,
} from "@/components/tugways/tug-progress-indicator";
import { useResponderForm } from "@/components/tugways/use-responder-form";

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
  /** The color commentator's line (the new side channel). */
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
// Proposal A — the Shelf
// ---------------------------------------------------------------------------

/** Per-lane data-row budget — the shelf never grows past this. */
const SHELF_LANE_ROWS = 5;

function ShelfProposal({ session }: { session: MockSession }): React.ReactElement {
  const [open, setOpen] = useState(true);
  const tasksLabel = countDone(session.tasks);
  const jobsLabel = countFinished(session.jobs);
  const pulseLines = session.commentaryLog.slice(-SHELF_LANE_ROWS);
  const overflow: string[] = [];
  if (session.tasks.length > SHELF_LANE_ROWS)
    overflow.push(`tasks +${session.tasks.length - SHELF_LANE_ROWS}`);
  if (session.jobs.length > SHELF_LANE_ROWS)
    overflow.push(`jobs +${session.jobs.length - SHELF_LANE_ROWS}`);
  if (session.commentaryLog.length > SHELF_LANE_ROWS)
    overflow.push(`pulse +${session.commentaryLog.length - SHELF_LANE_ROWS}`);
  return (
    <div className="z2ws-frame" data-slot="z2ws-shelf">
      <FakeTranscript />

      {/* The Z2 instrument row. Chrome models the proposed layout:
          maximize moves to the LEFT end; the configure gear takes the
          right end where maximize lives today; the shelf disclosure
          sits beside the gear. */}
      <div className="z2ws-row">
        <TugPushButton
          subtype="icon"
          icon={<Maximize2 size={12} />}
          aria-label="Maximize the prompt entry (inert in this spike)"
          title="Maximize (moves to the left end)"
          emphasis="ghost"
          size="xs"
        />
        <div className="z2ws-cells">
          <TugStatusCell priority="state" label="STATE" popover={<ShelfHint />}>
            <span className="z2ws-cell-value">{session.state}</span>
          </TugStatusCell>
          <TugStatusCell
            priority="tasks"
            label="TASKS"
            popover={<ShelfHint />}
            valueEmpty={session.tasks.length === 0}
          >
            <span className="z2ws-cell-value">{tasksLabel}</span>
          </TugStatusCell>
          <TugStatusCell
            priority="jobs"
            label="JOBS"
            popover={<ShelfHint />}
            valueEmpty={session.jobs.length === 0}
          >
            <span className="z2ws-cell-value">{jobsLabel}</span>
          </TugStatusCell>
        </div>
        <TugPushButton
          subtype="icon"
          icon={open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          aria-label={open ? "Close the status shelf" : "Open the status shelf"}
          title={open ? "Close shelf" : "Open shelf"}
          emphasis="ghost"
          size="xs"
          onClick={() => setOpen((o) => !o)}
        />
        <TugPushButton
          subtype="icon"
          icon={<Settings size={12} />}
          aria-label="Configure the status row (see the Rack proposal)"
          title="Configure status row — the Rack proposal"
          emphasis="ghost"
          size="xs"
        />
      </div>

      {/* The PULSE strip — the color-commentary concept, always on,
          one line, ambient. */}
      <div className="z2ws-strip" data-slot="z2ws-strip">
        <span className="z2ws-strip-legend">PULSE</span>
        <span key={session.beat} className="z2ws-strip-text">
          {session.commentary}
        </span>
      </div>

      {/* The shelf — pinned lanes, height-stable: five data rows per
          lane, then a sixth controls row. */}
      <div className="z2ws-shelf" data-open={open ? "true" : "false"}>
        <div className="z2ws-lanes">
        <div className="z2ws-lane">
          <div className="z2ws-lane-legend">TASKS</div>
          {session.tasks.length === 0 ? (
            <div className="z2ws-lane-empty">No task list active.</div>
          ) : (
            session.tasks.slice(0, SHELF_LANE_ROWS).map((t) => (
              <TugProgressIndicator
                key={t.subject}
                variant="pulsing-dot"
                glyphPosition="left"
                size={11}
                state={taskDotState(t.status)}
                label={t.subject}
                className="z2ws-lane-row"
              />
            ))
          )}
        </div>
        <div className="z2ws-lane">
          <div className="z2ws-lane-legend">JOBS</div>
          {session.jobs.length === 0 ? (
            <div className="z2ws-lane-empty">No background jobs.</div>
          ) : (
            session.jobs.slice(0, SHELF_LANE_ROWS).map((j) => (
              <div key={j.description} className="z2ws-lane-job">
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={11}
                  state={jobDotState(j.status)}
                  aria-label={j.status}
                />
                <span className="z2ws-lane-job-text">{j.description}</span>
                <span className="z2ws-lane-job-meta">
                  {j.kind} · {j.elapsedS}s
                </span>
              </div>
            ))
          )}
        </div>
        <div className="z2ws-lane z2ws-lane-wide">
          <div className="z2ws-lane-legend">PULSE</div>
          {pulseLines.map((line) => (
            <div key={line.atBeat} className="z2ws-lane-commentary">
              <span className="z2ws-lane-commentary-beat">
                {String(line.atBeat % SCRIPT.length).padStart(2, "0")}
              </span>
              <span className="z2ws-lane-commentary-text">{line.text}</span>
            </div>
          ))}
        </div>
        </div>

        {/* Sixth row — controls + overflow counts. Always present, so
            the shelf's height never moves once it is open. */}
        <div className="z2ws-shelf-footer" data-slot="z2ws-shelf-footer">
          <span className="z2ws-shelf-overflow">
            {overflow.length > 0 ? overflow.join(" · ") : "\u00a0"}
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
    </div>
  );
}

function ShelfHint(): React.ReactElement {
  return (
    <div className="z2ws-popover-hint">
      Popovers stay for quick glances — the shelf is for what you want
      permanently visible.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal B — the Rack
// ---------------------------------------------------------------------------

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

/**
 * The rack — a live Z2 row in macOS "Customize Toolbar…" mode. Drag
 * items from the palette into the row, drag within the row to
 * reorder, remove with the chip's ×; COMMENTARY and FLEX SPACE are
 * flexible-width. Config is session-local in this spike (production
 * persists via tugbank defaults).
 */
function RackProposal({ session }: { session: MockSession }): React.ReactElement {
  const [row, setRow] = useState<RackItemId[]>(RACK_DEFAULT);
  const [customizing, setCustomizing] = useState(true);
  const dragFrom = useRef<{ source: "palette" | "row"; index: number } | null>(null);

  const available = RACK_ITEMS.filter(
    (i) => i.repeatable === true || !row.includes(i.id),
  );

  const dropAt = useCallback(
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

  return (
      <div className="z2ws-frame" data-slot="z2ws-rack">
        <FakeTranscript />

        {/* The live row — also the drop target while customizing.
            Chrome models the proposed layout: maximize at the LEFT
            end, the configure gear at the right end. */}
        <div
          className="z2ws-rack-row"
          data-customizing={customizing ? "true" : "false"}
          onDragOver={(e) => {
            if (!customizing) return;
            e.preventDefault();
          }}
          onDrop={(e) => {
            if (!customizing) return;
            e.preventDefault();
            dropAt(row.length);
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
                  draggable={customizing}
                  onDragStart={() => {
                    dragFrom.current = { source: "row", index };
                  }}
                  onDragOver={(e) => {
                    if (!customizing) return;
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    if (!customizing) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const before = e.clientX < rect.left + rect.width / 2;
                    dropAt(before ? index : index + 1);
                  }}
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
            aria-label={customizing ? "Close the configure sheet" : "Configure the status row"}
            title="Configure status row"
            emphasis={customizing ? "tinted" : "ghost"}
            role="action"
            size="xs"
            onClick={() => setCustomizing((c) => !c)}
          />
        </div>

        {/* The customize sheet — Finder's "drag your favorite items…". */}
        {customizing ? (
          <div className="z2ws-rack-sheet" data-slot="z2ws-rack-sheet">
            <div className="z2ws-rack-sheet-title">
              Drag your favorite items into the status row…
            </div>
            <div className="z2ws-rack-palette">
              {available.map((spec, index) => (
                <div
                  key={spec.id}
                  className="z2ws-rack-chip"
                  draggable
                  onDragStart={() => {
                    dragFrom.current = { source: "palette", index };
                  }}
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
            <div className="z2ws-rack-sheet-controls">
              <span className="z2ws-rack-sheet-hint">
                Labels stay on — bare values mostly lose their meaning.
              </span>
              <div className="z2ws-rack-sheet-actions">
                <TugPushButton
                  emphasis="outlined"
                  role="action"
                  size="xs"
                  onClick={() => setRow(RACK_DEFAULT)}
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
  const [proposal, setProposal] = useState<"shelf" | "rack">("shelf");

  const proposalId = useId();
  const { ResponderScope } = useResponderForm({
    selectValue: {
      [proposalId]: (v: string) => setProposal(v as "shelf" | "rack"),
    },
  });

  return (
    <ResponderScope>
      <div className="cg-content z2ws" data-testid="gallery-z2-workshop">
        <div className="z2ws-toolbar">
          <TugChoiceGroup
            items={[
              { value: "shelf", label: "Shelf — pinned lanes + commentary" },
              { value: "rack", label: "Rack — customizable row" },
            ]}
            value={proposal}
            senderId={proposalId}
            size="sm"
          />
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

        {proposal === "shelf" ? (
          <ShelfProposal session={session} />
        ) : (
          <RackProposal session={session} />
        )}
      </div>
    </ResponderScope>
  );
}
