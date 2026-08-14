/**
 * dashes-section.tsx — the Lens **Dashes** section: one row per inflight dash,
 * across every open project.
 *
 * The Lens is the account-global surface and `ChangesetAllStore` is the
 * account-global snapshot it already reads, so this section is a projection
 * and nothing more — no feed, no store of record, no second copy of anything.
 * Rows key on the dash's **owner key**, which makes two incarnations of a
 * reused name distinct for free.
 *
 * A dash reads in dash grammar here too — name, stage, and who is working it —
 * never in the grammar of a card or a file. What the row answers that no other
 * surface does is *whether anyone is on it*: a dash with live bound sessions
 * wears a phase dot and offers a jump to the card holding one; a dash with
 * none wears the parked mark, which is a quiet glyph rather than a dot,
 * because "nobody is working this" is not a state of work.
 *
 * **Liveness is a leaf.** Phase lives on per-card `codeSessionStore` snapshots
 * that move on every transcript event; a row projection subscribed to that
 * would wake the whole section per event. So {@link DashPhaseDot} mounts the
 * subscription at the dot, the section's data pass never reads phase, and a
 * reducer wake repaints one glyph.
 *
 * Read-only, deliberately: this era ships no landing verb, so the row offers
 * no join, no release, and no adopt. It says what is true and gets out of the
 * way.
 *
 * Laws: [L02] the aggregate and the bindings enter React through
 * `useSyncExternalStore`; [L03] the section's content declaration is a
 * `useLayoutEffect`; [L06] the parked mark and the row's tone are CSS on DOM
 * attributes, never React state; [L11] the jump dispatches
 * `focus-session-card` rather than reaching into a card; [L13] the dot's
 * motion is the progress indicator's; [L19] rows compose `TugListView` /
 * `TugListRow` rather than hand-rolling list focus.
 *
 * @module components/lens/sections/dashes-section
 */

import "./dashes-section.css";

import React, { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { CircleDashed, GitBranch } from "lucide-react";

import { dispatchCommand } from "@/command-dispatch";
import { LENS_LIST_PRESENTATION } from "@/components/lens/lens-list-presentation";
import { setSectionContent } from "@/components/lens/lens-section-content";
import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { SessionPhaseDot } from "@/components/tugways/session-phase-dot";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDataSource,
  TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import { TugTooltip } from "@/components/tugways/tug-tooltip";
import {
  cardIdForSession,
  useCardIdForSession,
} from "@/lib/card-session-binding-store";
import { useChangesetAll } from "@/lib/changeset-all-store";
import type {
  DashChangesetEntry,
  WorkspacesChangesetSnapshot,
} from "@/lib/changeset-types";

const SECTION_KIND = "dashes";

/** The dot's box in the Lens rail — the compact tier, matched to the row's
 *  single line rather than to the Cards section's monitor rows. */
const DASH_DOT_SIZE = 10;

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** One dash, flattened out of the aggregate for the section's list. */
export interface DashRow {
  /** The dash's owner key — this row's identity, unique per incarnation. */
  ownerId: string;
  /** The dash's short name. */
  name: string;
  /** The derived stage word, or null from a sender that sends none. */
  stage: string | null;
  /** `step i/N`, only when the server sent both halves. */
  steps: string | null;
  /** Live sessions mated to this dash — empty is how *parked* reads. */
  boundSessions: string[];
  /** True when no live session is working this dash. */
  parked: boolean;
  /** The owning project's name, when more than one project has dashes. */
  projectLabel: string | null;
}

function rowFromEntry(
  entry: DashChangesetEntry,
  projectLabel: string | null,
): DashRow {
  const boundSessions = entry.bound_sessions ?? [];
  return {
    ownerId: entry.owner_id,
    name: entry.display_name,
    stage: entry.stage ?? null,
    steps:
      entry.step_current !== undefined && entry.step_total !== undefined
        ? `step ${entry.step_current}/${entry.step_total}`
        : null,
    boundSessions,
    // Absence of evidence renders the quiet mark, never a live claim: an older
    // sender omits `bound_sessions` entirely, and that is not a reason to say
    // somebody is working.
    parked: boundSessions.length === 0,
    projectLabel,
  };
}

/**
 * Every inflight dash across every open project, in project-enumeration order
 * then entry order.
 *
 * The project disambiguator only appears when it disambiguates: with one
 * project holding dashes, every row's suffix would say the same thing.
 */
export function dashRowsFromSnapshot(
  snapshot: WorkspacesChangesetSnapshot,
): DashRow[] {
  const withDashes = snapshot.projects.filter((project) =>
    project.changesets.some((entry) => entry.kind === "dash"),
  );
  const disambiguate = withDashes.length > 1;
  return withDashes.flatMap((project) =>
    project.changesets
      .filter((entry): entry is DashChangesetEntry => entry.kind === "dash")
      .map((entry) =>
        rowFromEntry(entry, disambiguate ? project.display_name : null),
      ),
  );
}

/** The band's one-line reading when the section is collapsed. */
export function dashesCollapsedSummary(rows: readonly DashRow[]): string {
  if (rows.length === 0) return "No dashes";
  const parked = rows.filter((row) => row.parked).length;
  const dashes = `${rows.length} ${rows.length === 1 ? "dash" : "dashes"}`;
  return parked > 0 ? `${dashes} · ${parked} parked` : dashes;
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

/**
 * The row's liveness mark ([P05]).
 *
 * Reads the first bound session — the dot answers "is someone working this
 * dash right now", not "who", and `bound_sessions` carries live sessions only,
 * so the first one is as good an answer as the set. `useSessionPhase` reports
 * `idle` for a session this deck cannot reach, which is the honest reading for
 * a dash being worked in another window.
 */
function DashPhaseDot({ sessionId }: { sessionId: string }): React.ReactElement {
  return <SessionPhaseDot sessionId={sessionId} size={DASH_DOT_SIZE} drift />;
}

/** The parked mark: a quiet glyph, deliberately not a dot at rest — a dash
 *  nobody is working is not a state of work. */
function DashParkedMark(): React.ReactElement {
  return (
    <TugTooltip content="Parked — no live session is working this dash">
      <span
        className="lens-dashes-parked"
        data-slot="lens-dashes-parked"
        aria-label="Parked"
      >
        <CircleDashed size={DASH_DOT_SIZE + 2} />
      </span>
    </TugTooltip>
  );
}

/**
 * A jump to the card holding one of this dash's sessions.
 *
 * Subscribed (`useCardIdForSession`) rather than resolved once, because this
 * decides whether to OFFER the gesture: a chip that kept offering a click into
 * a card that has closed is worse than no chip. A session with no open card
 * renders as inert muted text — the fact is still true, there is just nowhere
 * to go.
 */
function DashSessionJump({ sessionId }: { sessionId: string }): React.ReactElement {
  const cardId = useCardIdForSession(sessionId);
  const label = sessionId.slice(0, 8);
  if (cardId === null) {
    return (
      <span className="lens-dashes-jump-inert" data-slot="lens-dashes-jump-inert">
        {label}
      </span>
    );
  }
  return (
    <TugBadge
      emphasis="tinted"
      role="action"
      size="2xs"
      className="lens-dashes-jump"
      data-slot="lens-dashes-jump"
      title="Front the card working this dash"
      onClick={(event) => {
        event.stopPropagation();
        dispatchCommand("focus-session-card", { cardId });
      }}
    >
      {label}
    </TugBadge>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** A flat, immutable list over one projection pass. A new projection makes a
 *  new source; there is no mutation to subscribe to. */
class DashRowsDataSource implements TugListViewDataSource {
  constructor(readonly rows: readonly DashRow[]) {}
  numberOfItems(): number {
    return this.rows.length;
  }
  idForIndex(index: number): string {
    return this.rows[index]!.ownerId;
  }
  kindForIndex(): string {
    return "dash";
  }
  subscribe(): () => void {
    return () => {};
  }
  getVersion(): unknown {
    return this.rows;
  }
}

const DashCell: TugListViewCellRenderer<DashRowsDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<DashRowsDataSource>) => {
  const row = dataSource.rows[index];
  if (row === undefined) return null;
  return (
    <TugListRow
      className="lens-dashes-row"
      variant="flush"
      density="compact"
      data-slot="lens-dashes-row"
      data-dash={row.name}
      data-parked={row.parked ? "true" : undefined}
      leading={
        row.parked ? (
          <DashParkedMark />
        ) : (
          <DashPhaseDot sessionId={row.boundSessions[0]!} />
        )
      }
      trailing={
        row.boundSessions.length > 0 ? (
          <span className="lens-dashes-jumps">
            {row.boundSessions.map((sessionId) => (
              <DashSessionJump key={sessionId} sessionId={sessionId} />
            ))}
          </span>
        ) : undefined
      }
    >
      <span className="lens-dashes-facts">
        <span className="lens-dashes-name">{row.name}</span>
        {row.stage !== null ? (
          <span className="lens-dashes-stage">{row.stage}</span>
        ) : null}
        {row.steps !== null ? (
          <span className="lens-dashes-step">{row.steps}</span>
        ) : null}
        {row.projectLabel !== null ? (
          <span className="lens-dashes-project">{row.projectLabel}</span>
        ) : null}
      </span>
    </TugListRow>
  );
};

const DASH_CELL_RENDERERS = { dash: DashCell };

function useDashRows(): DashRow[] {
  const snapshot = useChangesetAll();
  return useMemo(() => dashRowsFromSnapshot(snapshot), [snapshot]);
}

function DashesCollapsedSummary(): React.ReactElement {
  return <>{dashesCollapsedSummary(useDashRows())}</>;
}

function DashesSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const rows = useDashRows();
  const dataSource = useMemo(() => new DashRowsDataSource(rows), [rows]);
  const populated = rows.length > 0;

  // The band's arrow walk needs to know whether there is anything in here to
  // walk onto, and it needs to know it before the first key event — hence
  // layout effect, not effect ([L03]).
  useLayoutEffect(() => {
    setSectionContent(host.focusGroup, {
      navigable: populated,
      populated,
    });
    return () =>
      setSectionContent(host.focusGroup, { navigable: false, populated: false });
  }, [host.focusGroup, populated]);

  // Activating a row is the same gesture as its jump chip: front the card
  // working this dash. A dash nobody's card holds has nowhere to go, so
  // activation is a no-op rather than a guess.
  const delegate = useMemo<TugListViewDelegate>(() => {
    const activate = (index: number): void => {
      const row = rows[index];
      if (row === undefined) return;
      for (const sessionId of row.boundSessions) {
        const cardId = cardIdForSession(sessionId);
        if (cardId !== null) {
          dispatchCommand("focus-session-card", { cardId });
          return;
        }
      }
    };
    return { onSelect: activate, onActivate: activate };
  }, [rows]);

  if (!populated) {
    return (
      <div className="lens-section-empty" data-slot="lens-dashes-empty">
        None
      </div>
    );
  }

  return (
    <div className="lens-dashes-section" data-slot="lens-dashes-section">
      <TugListView<DashRowsDataSource>
        dataSource={dataSource}
        delegate={delegate}
        cellRenderers={DASH_CELL_RENDERERS}
        scrollKey="lens-dashes"
        inline
        rowLayout="flush"
        focusGroup={host.focusGroup}
        commitOnEnter="act"
        {...LENS_LIST_PRESENTATION}
        className="lens-dashes-list"
      />
    </div>
  );
}

/** Register the Dashes section. Called once at boot from `main.tsx`. */
export function registerDashesSection(): void {
  registerLensSection({
    kind: SECTION_KIND,
    // A dash IS a branch plus a worktree, and this is the glyph that says so.
    glyph: <GitBranch size={14} />,
    title: "Dashes",
    collapsedSummary: () => <DashesCollapsedSummary />,
    body: (host) => <DashesSectionBody host={host} />,
  });
}
