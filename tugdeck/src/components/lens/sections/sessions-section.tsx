/**
 * The Lens **Sessions** section — a read-only session *monitor* ([P12], the
 * lens-route-rework phase). One row per open session card, stacked two lines:
 *
 *   [phase dot]  <session name>
 *                <latest pulse line>      <activity sparkline>
 *
 * The name is resolved exactly like the Session card's title-bar chip
 * (`sessionChipDisplay`: user name → mnemonic tag → truncated id), minus its
 * "Session" caption. The pulse line + sparkline share one row and align the
 * same way the on-card `session-pulse-strip` does (minus the `PULSE` prefix).
 * The phase dot aligns with the name line.
 *
 * Clicking a row activates the bound card's pane (fronts it) and flashes its
 * title bar once (`focus-session-card`, [P04]). Rows are non-interactive stops
 * (`data-tug-focus="refuse"`): the click dispatches an action, never claims
 * first responder.
 *
 * The working surface — changed files, commit composer, dash join, git-init —
 * moved onto the Session card's `±` Changes view-route; the Lens no longer
 * commits or joins.
 *
 * Laws: [L02] every store enters React through `useSyncExternalStore` with a
 * referentially stable snapshot; [L06] no appearance state in React (the
 * dot/sparkline paint via CSS/WAAPI, the flash rides a CSS class on the pane
 * header).
 *
 * @module components/lens/sections/sessions-section
 */

import "./sessions-section.css";

import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import { GitBranch } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import { dispatchAction } from "@/action-dispatch";
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
import {
  cardSessionBindingStore,
  type CardSessionBinding,
} from "@/lib/card-session-binding-store";
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

// Sparkline shape — the same constants the on-card `session-pulse-strip` uses,
// so a session reads identically in the Lens and on its card.
const SPARKLINE_FULL_SCALE_CHARS = 1200;
const SPARKLINE_CURVE = sparklineCurves.gamma(0.6);
const SPARKLINE_WIDTH = 64;
const SPARKLINE_HEIGHT = 18;

/** One monitor row: a session and the card it is bound to. */
interface MonitorRow {
  cardId: string;
  tugSessionId: string;
  projectDir: string;
}

/**
 * One row per open session binding, deduped by `tugSessionId` in binding order
 * — the same binding walk `buildItems` used, minus the dash / unattributed
 * pseudo-entries (those live on the card now). Labels are resolved per row from
 * the session name / tag stores + the aggregate branch.
 */
function buildRows(
  bindings: ReadonlyMap<string, CardSessionBinding>,
): MonitorRow[] {
  const rows: MonitorRow[] = [];
  const seen = new Set<string>();
  for (const [cardId, binding] of bindings) {
    if (seen.has(binding.tugSessionId)) continue;
    seen.add(binding.tugSessionId);
    rows.push({
      cardId,
      tugSessionId: binding.tugSessionId,
      projectDir: binding.projectDir,
    });
  }
  return rows;
}

/** The open cards' bindings, read straight from the store ([L02]). */
function useOpenBindings(): ReadonlyMap<string, CardSessionBinding> {
  return useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    cardSessionBindingStore.getSnapshot,
  );
}

function useMonitorRows(): MonitorRow[] {
  const bindings = useOpenBindings();
  return useMemo(() => buildRows(bindings), [bindings]);
}

/**
 * The session's label, formatted EXACTLY like the Session card's title bar
 * ([P12]): `<project>/<session> (<branch>)` (branch omitted on `main`), name →
 * tag precedence, read reactively from the name / tag stores ([L02]). The
 * shared `sessionCardTitleOverride` keeps the row and the title bar identical.
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
 * The per-row phase dot — reads the bound card's `codeSessionStore` ([P12]).
 * Two nested `useSyncExternalStore` reads, each returning a referentially
 * stable snapshot ([L02]): the services bag (stable until a rebind) resolves
 * the store, then the store's own snapshot drives the dot. The phase input is
 * derived in render — NOT inside a `getSnapshot`, which must never mint a fresh
 * object (that is an infinite-render loop).
 */
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
  return (
    <TugSparkline
      getSeries={getSeries}
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

function SessionMonitorRow({
  row,
  branch,
}: {
  row: MonitorRow;
  branch: string | null;
}): React.ReactElement {
  const displayName = useSessionLabel(row.projectDir, row.tugSessionId, branch);
  const pulse = usePulse();
  const latest = latestLineForScope(pulse.lines, row.tugSessionId);
  // Plain text — the monitor row shows the raw pulse line; the KaTeX/markdown
  // rendering (`renderPulseLine`) is the on-card strip's richer surface.
  const pulseText = pulse.enabled && latest !== null ? latest.text : null;

  const activate = useCallback(() => {
    dispatchAction({ action: "focus-session-card", cardId: row.cardId });
  }, [row.cardId]);

  return (
    <div
      className="sessions-monitor-row"
      data-slot="sessions-monitor-row"
      data-testid="sessions-monitor-row"
      data-session-id={row.tugSessionId}
      // Read-only: the click activates a card via a dispatched action; it must
      // never pull first responder off wherever it sits ([P04]).
      data-tug-focus="refuse"
      data-no-activate=""
      role="button"
      tabIndex={-1}
      onClick={activate}
    >
      {/* Primary line — the phase dot aligns with the session name. */}
      <div className="sessions-monitor-line sessions-monitor-line-primary">
        <RowPhaseDot cardId={row.cardId} />
        <span className="sessions-monitor-name" title={displayName}>
          {displayName}
        </span>
      </div>
      {/* Secondary line — the pulse aligns with its sparkline (like the strip).
          A session with no current pulse line reads a muted "None" rather than
          an empty gap, so the row still reports its pulse state. */}
      <div className="sessions-monitor-line sessions-monitor-line-pulse">
        {pulseText !== null ? (
          <span className="sessions-monitor-pulse">{pulseText}</span>
        ) : (
          <span className="sessions-monitor-pulse sessions-monitor-pulse-none">
            None
          </span>
        )}
        <RowSparkline tugSessionId={row.tugSessionId} />
      </div>
    </div>
  );
}

/** The Lens band's collapsed summary: `N sessions`. */
function SessionsCollapsedSummary(): React.ReactElement {
  const rows = useMonitorRows();
  const n = rows.length;
  return <>{`${n} session${n === 1 ? "" : "s"}`}</>;
}

function SessionsSectionBody(): React.ReactElement {
  const rows = useMonitorRows();
  // One aggregate read for the whole section; each row's branch is projected
  // from it (the label reads `<project>/<session> (<branch>)`).
  const changesets = useChangesetAll();
  if (rows.length === 0) {
    return (
      <div data-slot="sessions-card" className="sessions-card sessions-card-empty">
        No open sessions
      </div>
    );
  }
  return (
    <div data-slot="sessions-card" className="sessions-card">
      <div className="sessions-scroll">
        <div className="sessions-monitor-rows">
          {rows.map((row) => (
            <SessionMonitorRow
              key={row.tugSessionId}
              row={row}
              branch={branchForProject(changesets, row.projectDir)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Register the Sessions Lens section. Called once at boot from `main.tsx`. The
 * body reads the app-level singletons directly (no host feed wiring), so it is
 * host-agnostic — nothing imported from `lens/` beyond the registry entry point.
 */
export function registerSessionsSection(): void {
  registerLensSection({
    kind: "sessions",
    title: "Sessions",
    glyph: <GitBranch size={14} />,
    collapsedSummary: () => <SessionsCollapsedSummary />,
    body: () => <SessionsSectionBody />,
  });
}
