/**
 * SessionMasthead — the three lines a Session card wears in pane chrome.
 *
 *   [dot] <name> : <callsign>     ← identity, and whether it is working
 *   <description>                 ← the agent's synopsis, or a stand-in
 *   <activity>               ~~~  ← the voice, with its activity sparkline
 *
 * Three levels of the same session, widening as they go down: what it IS, what
 * it is FOR, and what it is doing this second.
 *
 * **The shape is `TugSessionRow`'s, not this component's.** The masthead, the
 * Lens rows, and the new-session picker rows show the same thing, so they wear
 * one authoring of it and the component library is the consistency mechanism
 * ([D132]). What stays local is what is genuinely the masthead's: the dwell
 * queue that paces the beat, the two popovers, the telemetry widget, and the
 * chrome geometry — the row is mounted with its list-row padding zeroed and
 * each of its three lines told what to stop short of, because the pane's
 * control cluster occupies only the FIRST of the tier's three bands.
 *
 * The pane owns the chrome SLOT and its geometry; this component owns what is
 * inside it and every store behind those lines. That split is what keeps
 * session-domain machinery — the PULSE feed, the activity series, the
 * `pulse/enabled` default, the telemetry the popover reports — out of pane
 * code while chrome stays the pane's ([L09]). The precedent is the Session
 * card mounting `TugPaneBanner`: pane-class furniture, session-class content
 * inside it.
 *
 * The width control does not render on a masthead-bearing pane ([D132]): the
 * title row is identity plus its own telemetry wave, and width is reachable by
 * its command and by the Lens's width presets. Everything else in the pane's
 * controls cluster stays — the slot-stack badge, the `…` section menu, and the
 * close X.
 *
 * Keyed by `sessionId`, which is all the pane knows and all it should: the
 * chrome names a session and this component resolves what to say about it.
 * Identity comes through `useSessionIdentity`, so a rename or a callsign
 * reroll repaints the masthead with no reload and no pane involvement.
 *
 * The masthead never reflows. Every line truncates rather than wrapping, the
 * description line holds its place when empty, and the slot's height is a
 * fixed token — a chrome tier that changed height with its content would move
 * the card beneath it on every pulse.
 *
 * The trailing widget opens the telemetry popover: branch, state, turns,
 * stamps, and the citation with a copy affordance. A popover is where the copy
 * lives rather than a hover surface, because a hover-dismissed panel puts its
 * own button out of the pointer's reach — and rather than a `TugPlacard`,
 * which renders in place and needs its caller to own the vertical axis inside
 * a positioned ancestor, a contract a clipping 72px chrome tier cannot honour.
 *
 * Laws: [L02] every store enters through `useSyncExternalStore`;
 *       [L06] appearance via CSS/DOM, never React state;
 *       [L09] chrome is the pane's — the pane mounts this into a slot it owns;
 *       [L19] `.tsx`/`.css` pair with `data-slot`;
 *       [L20] `TugPulse` is composed through its published knobs only.
 */

import "./session-masthead.css";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Waves } from "lucide-react";

import { TugCopyBadge } from "@/components/tugways/tug-copy-badge";
import {
  TugPopover,
  TugPopoverAnchor,
  TugPopoverContent,
  TugPopoverTrigger,
} from "@/components/tugways/tug-popover";
import {
  TugPopupListEmpty,
  TugPopupListFrame,
  TugPopupListItem,
  TugPopupListItemText,
  TugPopupListScroller,
  TugPopupListToneDot,
} from "@/components/tugways/tug-popup-list";
import { SessionPulseCard } from "@/components/tugways/cards/pulse-card";
import { SessionPhaseDot } from "@/components/tugways/session-phase-dot";
import { useCopyableButton } from "@/components/tugways/use-copyable-text";
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import { formatRestingStamp } from "@/lib/pulse-line/resting-line";
import { sessionActivityRestLine } from "@/lib/session-activity-line";
import { useSessionCreatedAtMs } from "@/lib/session-created-at";
import { writeSessionAtomToClipboard } from "@/lib/session-atom";
import { TugSessionIdentity } from "@/components/tugways/tug-session-identity";
import {
  TugSparkline,
} from "@/components/tugways/tug-sparkline";
import {
  TUG_SESSION_ROW_STACK_DOT_SIZE,
  TUG_SESSION_SPARK_CURVE,
  TUG_SESSION_SPARK_FULL_SCALE_CHARS,
  TugSessionRow,
} from "@/components/tugways/tug-session-row";
import { cardServicesStore } from "@/lib/card-services-store";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { useSessionBranch } from "@/lib/changeset-all-store";
import {
  COMPACTING_PULSE_TEXT,
  compactionProgressStore,
  isCompactingCard,
} from "@/lib/compaction-progress-store";
import {
  groupPulseHistory,
  latestLineForScope,
  linesForScope,
  usePulse,
  type PulseLineEntry,
} from "@/lib/pulse-store";
import {
  ACTIVITY_BIN_MS,
  getSessionActivityStore,
  isRateChannel,
} from "@/lib/session-activity-store";
import { sessionCitation, useSessionIdentity } from "@/lib/session-identity";
import {
  getSessionLedgerStore,
  useSessionLedger,
} from "@/lib/session-ledger-store";

/**
 * Sparkline box in the masthead's PULSE line. The line runs the full card
 * width, and the tape is its only graphic, so it takes twice the Lens row's
 * 64 — the span shown is the same (`VISIBLE_SECONDS`); width buys resolution.
 * The height rides the line's `--tugx-pulse-bar-height: 18px` bar.
 */
const SPARKLINE_WIDTH = 128;
const SPARKLINE_HEIGHT = 18;

/**
 * The masthead's dot box. The row's denser cut, not the Lens's 28: the masthead
 * is a 72px chrome tier and a dot that size would out-shout the name it marks.
 */
const MASTHEAD_DOT_SIZE = TUG_SESSION_ROW_STACK_DOT_SIZE;

/**
 * Every line holds the masthead at least this long before the next replaces
 * it. This pacing is what makes the voice readable rather than a strobe: the
 * machine's commentary arrives in bursts, and a line that flickered past in
 * 200ms would be a texture rather than a sentence.
 */
export const MIN_DWELL_MS = 1_800;

/** What the activity line is showing: a live beat, or the rest sentence. */
interface DisplayEntry {
  key: string;
  text: string;
  /**
   * Not a beat. The rest sentence and the compaction pin are both facts the
   * masthead composed rather than news the session sent, so neither goes
   * through the markdown pipeline and neither is what a line copy carries.
   */
  placeholder: boolean;
  /** Swap this entry in the moment it arrives, skipping the dwell — the
   *  user's own clear and the compaction pin both answer a gesture. */
  immediate?: boolean;
}

/**
 * The rest-line entry: the activity grammar's sentence, shown whenever there is
 * no live beat.
 *
 * Keyed BY ITS TEXT, and `immediate`, so the numbers land the moment they move —
 * a constant key would hold the previous sentence on screen after a turn end
 * refreshed the very facts it reports.
 */
function restEntry(text: string): DisplayEntry {
  return {
    key: `__activity_rest__:${text}`,
    text,
    placeholder: true,
    immediate: true,
  };
}

/**
 * The compaction pin. A `/compact` turn streams nothing for minutes, and the
 * submit that opened it cleared the line — so without this the whole run reads
 * as an idle `None`, which is exactly when the user has pulled the progress
 * sheet down and has only this line to go on. Held for the run's lifetime, not
 * the sheet's.
 */
const COMPACTING_ENTRY: DisplayEntry = Object.freeze({
  key: "__pulse_compacting__",
  text: COMPACTING_PULSE_TEXT,
  placeholder: false,
  immediate: true,
});

/**
 * The dwell queue: `target` is what the store wants shown; `current` is what
 * the masthead shows. A swap happens immediately when the current line has
 * dwelt long enough (or the target is marked `immediate`); otherwise the
 * newest target waits out the remainder. A swap replaces the text INSTANTLY —
 * one node, no animation, because two different strings cross-fading in one
 * box interleave their glyphs into a smash.
 *
 * Local presentation data: refs and timers, changing WHAT text exists rather
 * than how it looks, so no appearance passes through React state ([L06]/[L22]).
 */
function useDwellDisplay(target: DisplayEntry): { current: DisplayEntry } {
  const [current, setCurrent] = useState<DisplayEntry>(target);
  const currentKeyRef = useRef(target.key);
  const lastSwapAtRef = useRef(0);
  const pendingRef = useRef<DisplayEntry | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    currentKeyRef.current = current.key;
  }, [current.key]);

  const swap = useCallback((next: DisplayEntry): void => {
    setCurrent((prev) => (prev.key === next.key ? prev : next));
    lastSwapAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (target.key === currentKeyRef.current) {
      pendingRef.current = null;
      return;
    }
    // The user's own clear (submit → placeholder) and the compaction pin feel
    // immediate; dwell only paces the machine's stream.
    if (target.immediate === true) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      swap(target);
      return;
    }
    const remaining = lastSwapAtRef.current + MIN_DWELL_MS - Date.now();
    if (remaining <= 0 && timerRef.current === null) {
      swap(target);
      return;
    }
    // Within the dwell: the newest target wins when the window opens.
    pendingRef.current = target;
    if (timerRef.current === null) {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending !== null) swap(pending);
      }, Math.max(remaining, 0));
    }
  }, [target, swap]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { current };
}

export interface SessionMastheadProps {
  /** Which session the chrome is about. The only key the pane supplies. */
  sessionId: string;
  /**
   * The card wearing this chrome. Supplies the project dir for the panel's
   * workspace facts — a pane fact the pane already holds, not session state.
   */
  cardId?: string;
}

/**
 * The activity sparkline, reading this session's composite series straight off
 * the app-scoped store. The tape samples imperatively off React's render path
 * and scrolls under WAAPI ([L06]/[L13]).
 */
function MastheadSparkline({
  sessionId,
}: {
  sessionId: string;
}): React.ReactElement {
  const activityStore = getSessionActivityStore();
  const getSeries = useCallback(
    (nowMs: number): number[] =>
      activityStore !== null && sessionId.length > 0
        ? activityStore.compositeSeries(sessionId, nowMs)
        : [],
    [activityStore, sessionId],
  );
  // Filtered to rate channels: this tape draws the composite of rate work, so
  // gauge levels — which move whether or not the session works — must not
  // wake it.
  const subscribeActivity = useCallback(
    (wake: () => void): (() => void) =>
      activityStore !== null && sessionId.length > 0
        ? activityStore.subscribeActivity(sessionId, (channel) => {
            if (isRateChannel(channel)) wake();
          })
        : () => {},
    [activityStore, sessionId],
  );
  return (
    <TugSparkline
      getSeries={getSeries}
      subscribeActivity={subscribeActivity}
      binMs={ACTIVITY_BIN_MS}
      fullScale={TUG_SESSION_SPARK_FULL_SCALE_CHARS}
      curve={TUG_SESSION_SPARK_CURVE}
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      title="Session activity — text, tokens, tools, and subagents"
    />
  );
}

/** How many recent pulses the activity line's popover lists. */
const PULSE_HISTORY_COUNT = 8;

/**
 * Raw-text form of a beat for the clipboard: `intent › text`. The history
 * popover's rows carry their group's intent, which is the level that survives
 * there; the masthead's own line copies the beat alone, since the standing goal
 * no longer rides the line beside it.
 */
function composeLineCopy(intent: string | undefined, text: string): string {
  return intent !== undefined ? `${intent} › ${text}` : text;
}

/**
 * The activity line's popover body: the recent pulses for this session, newest
 * first, GROUPED by intent so a retained goal heads its run of beats instead
 * of repeating on each row. An empty history reads as a quiet placeholder.
 */
function SessionPulseHistory({
  lines,
}: {
  lines: readonly PulseLineEntry[];
}): React.ReactElement {
  const groups = React.useMemo(() => groupPulseHistory(lines), [lines]);
  return (
    <TugPopupListFrame
      title="Recent pulses"
      kind="item"
      className="session-pulse-history"
      data-slot="session-pulse-history"
    >
      {groups.length === 0 ? (
        <TugPopupListEmpty>No pulses yet.</TugPopupListEmpty>
      ) : (
        <TugPopupListScroller data-slot="session-pulse-history-body">
          {groups.map((group) => (
            <div className="session-pulse-history-group" key={group.beats[0].key}>
              {group.intent !== undefined ? (
                <SessionPulseHistoryIntent intent={group.intent} />
              ) : null}
              {group.beats.map((beat) => (
                <SessionPulseHistoryBeat
                  key={beat.key}
                  text={beat.text}
                  intent={group.intent}
                />
              ))}
            </div>
          ))}
        </TugPopupListScroller>
      )}
    </TugPopupListFrame>
  );
}

/** A group's intent heading — the goal in calm muted prose (emphasis
 *  flattened in CSS), shown once above its beats. */
function SessionPulseHistoryIntent({
  intent,
}: {
  intent: string;
}): React.ReactElement {
  const render = React.useMemo(() => renderPulseLine(intent), [intent]);
  return (
    <div className="session-pulse-history-intent">
      {render.html.length === 0 ? (
        <>{intent}</>
      ) : (
        <span dangerouslySetInnerHTML={{ __html: render.html }} />
      )}
    </div>
  );
}

/** One beat row: a leading tone dot + the live action, the primary reading of
 *  the row. Right-click copies the raw `intent › beat`. */
function SessionPulseHistoryBeat({
  text,
  intent,
}: {
  text: string;
  intent?: string;
}): React.ReactElement {
  const render = React.useMemo(() => renderPulseLine(text), [text]);
  const copy = useCopyableButton(composeLineCopy(intent, text));
  const primary =
    render.html.length === 0 ? (
      <>{text}</>
    ) : (
      <span dangerouslySetInnerHTML={{ __html: render.html }} />
    );
  return (
    <TugPopupListItem
      ref={copy.ref as React.Ref<HTMLDivElement>}
      onContextMenu={copy.onContextMenu}
      className="session-pulse-history-beat"
      indicator={<TugPopupListToneDot tone="default" />}
    >
      <TugPopupListItemText primary={primary} />
      {copy.contextMenu}
    </TugPopupListItem>
  );
}

/**
 * The activity run. The pulse-line library owns fidelity and safety
 * (math-first split, sanitized markdown, KaTeX, total-function fallback); this
 * only re-renders once a lazy KaTeX load resolves, then every render is
 * synchronous. `html: ""` is the library's render-as-plain-text signal.
 *
 * The activity is a tool call, so backticked paths and commands are exactly
 * what the markdown pipeline is for. The headline beside it is one
 * model-written sentence with no markup in it, so that one renders as plain
 * text rather than paying for a second pipeline.
 */
function PulseLineText({
  entry,
  className,
}: {
  entry: DisplayEntry;
  className: string;
}): React.ReactElement {
  const [engineEpoch, bumpEngineReady] = React.useReducer(
    (n: number) => n + 1,
    0,
  );
  // engineEpoch keys the memo so the resolved KaTeX engine re-renders the SAME
  // entry with real typesetting (the first pass showed the escaped source
  // while the engine loaded).
  const render = React.useMemo(
    () => (entry.placeholder ? null : renderPulseLine(entry.text)),
    [entry, engineEpoch],
  );
  React.useEffect(() => {
    const pending = render?.pending;
    if (pending == null) return;
    let live = true;
    void pending.then(() => {
      if (live) bumpEngineReady();
    });
    return () => {
      live = false;
    };
  }, [render]);
  if (render === null || render.html.length === 0) {
    return <span className={className}>{entry.text}</span>;
  }
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: render.html }}
    />
  );
}

/** One telemetry row: a quiet label and its value. */
function TelemetryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="session-masthead-telemetry-row">
      <span className="session-masthead-telemetry-label">{label}</span>
      <span className="session-masthead-telemetry-value">{children}</span>
    </div>
  );
}

/** A stamp as a local date-time, or an em dash when the ledger has none. */
function stamp(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleString();
}

/**
 * The birth stamp, and what to call it.
 *
 * A `/compact`-born session is a "fake new" session — an implementation
 * detail of compaction rather than a genuinely new one — so its birth reads
 * "Compacted" rather than "Created". The date is the same fact either way;
 * only the verb changes.
 *
 * A LEAF, and that is the point: `compactionSeed` lives on the per-card
 * `codeSessionStore`, whose snapshot is the whole session state. Reading it
 * up in `SessionMasthead` would wake the masthead on every transcript event —
 * the exact churn [P15] keeps out of the identity path. Here the subscription
 * is a boolean selector inside the telemetry panel, and a closed popover
 * mounts no content, so it exists only while the panel is open.
 */
function TelemetryBirthRow({
  cardId,
  createdAtMs,
}: {
  cardId: string | undefined;
  createdAtMs: number | null | undefined;
}): React.ReactElement {
  const services = useSyncExternalStore(cardServicesStore.subscribe, () =>
    cardId === undefined ? null : cardServicesStore.getServices(cardId),
  );
  const store = services?.codeSessionStore ?? null;
  const compacted = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store !== null
      ? () => store.getSnapshot().compactionSeed !== null
      : () => false,
    () => false,
  );
  return (
    <TelemetryRow label={compacted ? "Compacted" : "Created"}>
      {stamp(createdAtMs)}
    </TelemetryRow>
  );
}

/** Stable no-op subscribe for a card whose services aren't constructed yet. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

export function SessionMasthead({
  sessionId,
  cardId,
}: SessionMastheadProps): React.ReactElement {
  // The project dir behind this chrome. Read from the card binding — a pane
  // fact — rather than carried on the identity record, which deliberately
  // holds only the project's leaf name for display.
  const projectDir = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(
      () =>
        cardId === undefined
          ? ""
          : cardSessionBindingStore.getBinding(cardId)?.projectDir ?? "",
      [cardId],
    ),
  );
  // The branch is telemetry: it rides the record for the panel and never
  // reaches a rendered name.
  const branch = useSessionBranch(projectDir.length > 0 ? projectDir : null);
  const identity = useSessionIdentity(sessionId, {
    projectDir: projectDir.length > 0 ? projectDir : undefined,
    branch,
  });
  const ledger = useSessionLedger(projectDir);
  // Ask for this workspace's rows once. `useSessionLedger` is a read: it never
  // fetches, and the ledger store DROPS a `session_updated` push for a workspace
  // it has not listed — so a bound card in a project nothing opened the picker
  // for would never see its own turn count, size, or last-used stamp, which is
  // exactly what the activity line reports at rest. An event kick, not a state
  // mirror ([L02]), and the same one the picker already performs on open.
  // Latched only on a kick that actually landed: the store singleton does not
  // exist until the connection is up, and the masthead mounts before that — a
  // ref set on the way past would swallow the one request this ever makes.
  const refreshedDirRef = useRef<string | null>(null);
  useEffect(() => {
    if (refreshedDirRef.current === projectDir || projectDir.length === 0) return;
    const store = getSessionLedgerStore();
    if (store === null) return;
    refreshedDirRef.current = projectDir;
    store.refresh(projectDir);
  }, [projectDir, ledger.status]);
  const pulse = usePulse();
  // A manual `/compact` run started from THIS card. The wire is silent for its
  // whole duration, so the pin is the only thing the line can say about it;
  // the daemon's own `Compacted context` beat closes it out.
  const compaction = useSyncExternalStore(
    compactionProgressStore.subscribe,
    compactionProgressStore.getSnapshot,
  );
  const [historyOpen, setHistoryOpen] = React.useState(false);
  /*
    The PULSE line's own DOM node, so the recent-pulses popover can anchor to
    the run the reader is looking at. An ANCHOR rather than a trigger: the
    stage already carries a right-click copy and its own click toggle, and
    composing Radix's trigger onto an element with click choreography of its
    own is exactly the pointerdown/pointerup fight `TugPopoverAnchor` exists
    to avoid.
  */
  const stageElRef = useRef<HTMLElement | null>(null);

  // Lines cleared by this card's last submit stay hidden; the next turn's
  // voice repopulates the line.
  const latest = latestLineForScope(
    pulse.lines,
    sessionId,
    pulse.cleared.get(sessionId),
  );
  const row = ledger.rows.find((r) => r.session_id === sessionId) ?? null;
  // Not `row.created_at`: the shared resolver also reads the card's own
  // replay anchor, which is the only source for a freshly-bound card in a
  // project nothing has listed yet — exactly the state the stamp rung is for.
  const createdAtMs = useSessionCreatedAtMs(cardId, sessionId, projectDir);
  // At rest the activity line reports the session's own facts — the turn count,
  // the on-disk size, when it last moved, and whether it is open for another
  // turn. `Ready.` needs a bound card, and a masthead always has one.
  const restLine = sessionActivityRestLine({
    turnCount: row?.turn_count ?? 0,
    fileSize: row?.file_size ?? null,
    lastUsedAtMs: row?.last_used_at ?? null,
    hasCard: cardId !== undefined,
  });
  const target: DisplayEntry = isCompactingCard(compaction, cardId)
    ? COMPACTING_ENTRY
    : latest !== null
      ? { key: latest.key, text: latest.text, placeholder: false }
      : restEntry(restLine);
  const { current } = useDwellDisplay(target);
  // The last few pulses for this session — shown in the activity line's popover.
  const history = linesForScope(pulse.lines, sessionId, PULSE_HISTORY_COUNT);
  // Right-click → Copy the current beat's raw text. A composed rest sentence is
  // not a beat and copies nothing; the atom copy on the title is what that row
  // offers instead.
  const copyLine = useCopyableButton(
    current.placeholder ? "" : current.text,
  );
  // Right-click the TITLE → Copy the session atom's full flavor set: the
  // citation as plain text with the atom sidecar beside it, so a paste back
  // into a Tug surface returns the chip rather than the string ([D132]).
  const copyAtom = useCopyableButton(
    sessionCitation(identity, { project: true }),
    () => writeSessionAtomToClipboard(identity),
  );
  // One node, two readers: the copy hook's own callback ref and the popover's
  // anchor ref.
  const copyRef = copyLine.ref;
  const stageRef = useCallback(
    (el: HTMLElement | null): void => {
      stageElRef.current = el;
      copyRef(el);
    },
    [copyRef],
  );

  // The description line's three rungs ([D132]): the agent's synopsis, else the
  // session's own first prompt, else the date it was created. The lower two are
  // facts STANDING IN for a line nobody has written yet, so they are marked as
  // such and painted a step quieter. A never-summarized session — every external
  // one the scanner has just found — has the user's own prompt as the only
  // human-meaningful text the row holds, which is why that rung is here at all.
  //
  // No null branch on the identity: `sessionId` is a string and
  // `useSessionIdentity`'s non-null overload answers with a record.
  const prompt = row?.last_user_prompt?.trim() ?? "";
  const description =
    identity.description ??
    (prompt.length > 0
      ? prompt
      : createdAtMs !== null
        ? `Created ${formatRestingStamp(createdAtMs)}`
        : null);
  const descriptionStandIn = identity.description === null;

  return (
    <div className="session-masthead" data-slot="session-masthead">
      <TugSessionRow
        className="session-masthead-row"
        indicator={
          <SessionPhaseDot sessionId={sessionId} size={MASTHEAD_DOT_SIZE} />
        }
        name={
          // The row's dot leads the line, so the identity renders its runs
          // only. Right-click on the title copies the atom.
          <span
            ref={copyAtom.ref as React.Ref<HTMLSpanElement>}
            onContextMenu={copyAtom.onContextMenu}
            className="session-masthead-title"
          >
            <TugSessionIdentity identity={identity} tier="line" dot={false} />
          </span>
        }
        description={description ?? ""}
        descriptionStandIn={descriptionStandIn}
        // The activity line. When the `pulse/enabled` default is off the line
        // still exists and still reports the session's own facts — chrome that
        // got shorter when a preference changed would move every card in the
        // pane, and the rest sentence is true either way.
        activity={
          <PulseLineText
            entry={pulse.enabled ? current : restEntry(restLine)}
            className="session-masthead-pulse-text"
          />
        }
        sparkline={
          pulse.enabled ? (
            /*
              The compact sparkline is the entry point to the expanded Activity
              card: clicking it opens a popover of per-channel small-multiples
              for this session.
            */
            <TugPopover>
              <TugPopoverTrigger>
                <button
                  type="button"
                  className="session-masthead-spark-trigger"
                  tabIndex={-1}
                  data-tug-focus="refuse"
                  data-no-activate=""
                  aria-label="Session pulse detail"
                >
                  <MastheadSparkline sessionId={sessionId} />
                </button>
              </TugPopoverTrigger>
              <TugPopoverContent side="bottom" align="end" sideOffset={8} arrow>
                <SessionPulseCard session={sessionId} />
              </TugPopoverContent>
            </TugPopover>
          ) : undefined
        }
        stageProps={{
          ref: stageRef as React.Ref<HTMLSpanElement>,
          onContextMenu: copyLine.onContextMenu,
          onClick: () => setHistoryOpen((open) => !open),
          className: "session-masthead-stage",
        }}
      />
      {copyAtom.contextMenu}
      {copyLine.contextMenu}

      {/*
        The recent-pulses history, anchored on the line it is the history OF.
        This used to hang off the `PULSE` pill, and the pill is now a
        placeholder rather than a permanent label — so the affordance moves to
        the reading itself: click what you are reading to see more of it.

        dismissOnChainActivity=false: a row's right-click → Copy dispatches the
        `copy` action through the responder chain, which would otherwise read as
        foreign chain activity and close this popover mid-copy. The copy
        originates from WITHIN the popover, so it must not dismiss it; Escape,
        click-outside, and a second click on the line still close it.
      */}
      <TugPopover
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        dismissOnChainActivity={false}
      >
        <TugPopoverAnchor virtualRef={stageElRef} />
        <TugPopoverContent side="bottom" align="start" sideOffset={8} arrow>
          <SessionPulseHistory lines={history} />
        </TugPopoverContent>
      </TugPopover>

      {/*
        The telemetry widget: everything identity deliberately does not say.

        A POPOVER, not a placard. `TugPlacard` renders in place and asks its
        caller to own the vertical axis inside a positioned ancestor — a
        contract a 72px chrome tier with `overflow: hidden` cannot honour, so
        the panel opened clipped by the bar it was mounted in and painted over
        the lines beside it. The popover portals to the deck's canvas overlay
        and positions itself against this button, which is what every other
        chrome affordance in the masthead already does.
      */}
      <TugPopover dismissOnChainActivity={false}>
        <TugPopoverTrigger>
          <button
            type="button"
            className="session-masthead-widget"
            data-slot="session-masthead-widget"
            // Chrome, like the close button — never a card-cycle focus stop,
            // and never steals first responder from the card's content.
            tabIndex={-1}
            data-tug-focus="refuse"
            data-no-activate=""
            aria-label="Session telemetry"
            title="Session telemetry"
          >
            <Waves size={14} aria-hidden />
          </button>
        </TugPopoverTrigger>
        <TugPopoverContent side="bottom" align="end" sideOffset={8} arrow>
          <TugPopupListFrame
            title="Session"
            kind="item"
            className="session-masthead-telemetry"
            data-slot="session-masthead-telemetry"
          >
            <div className="session-masthead-telemetry-body">
              {/* The two copyable forms side by side, each labeled by what a
                  paste of it yields: the atom returns the chip, the citation is
                  flat text for anywhere outside Tug. */}
              <TelemetryRow label="Atom">
                <TugSessionIdentity
                  identity={identity}
                  tier="chip"
                  size="2xs"
                  className="session-masthead-telemetry-atom"
                />
              </TelemetryRow>
              <TelemetryRow label="Branch">{identity.branch ?? "—"}</TelemetryRow>
              <TelemetryRow label="State">
                {row?.state ?? identity.state ?? "—"}
              </TelemetryRow>
              <TelemetryRow label="Turns">{row?.turn_count ?? "—"}</TelemetryRow>
              {/* The card's Z0 load-control bar used to carry this same line;
                  the telemetry panel is where session telemetry lives now, so
                  it says it once. */}
              <TelemetryBirthRow cardId={cardId} createdAtMs={createdAtMs} />
              <TelemetryRow label="Last used">{stamp(row?.last_used_at)}</TelemetryRow>
              <TelemetryRow label="Citation">
                {/* The citation is the sanctioned flat-text form, and the only
                    place monospace appears in session identity. */}
                <TugCopyBadge
                  value={sessionCitation(identity, { project: true })}
                  className="session-masthead-telemetry-citation"
                />
              </TelemetryRow>
            </div>
          </TugPopupListFrame>
        </TugPopoverContent>
      </TugPopover>
    </div>
  );
}
