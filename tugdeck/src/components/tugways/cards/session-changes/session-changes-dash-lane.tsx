/**
 * `SessionChangesDashLane` — the Changes shade's dash lane.
 *
 * A dash is not a claim. Rendered in session-file grammar a dash branch reads
 * as one — so it gets its own species of row: name · base · rounds · dirty ·
 * stage, its own fold, and no claim, disclaim, or hunk-election affordance
 * anywhere inside it. The lane's one diff affordance is the whole-range
 * pop-out, because the server's range diff takes no pathspec and the dash is
 * the unit anyway.
 *
 * The card's own dash — the one its session is mated to — renders first and
 * expanded. Every other dash in the project folds under one summary line.
 * The fold is view-scope state: the shade is a glance surface, dismiss and
 * forget, so nothing here is persisted.
 *
 * Read-only by design in this era: the maintained join draft renders as ink,
 * never as an editor, and the lane offers no landing verb.
 *
 * Laws: [L02] the lane takes its data as props from the view's
 * `useSyncExternalStore` reads; [L06] tone and state paint through CSS and
 * data attributes; [L19] the row composes `TugBadge` / `TugListRow` /
 * `BlockFoldCue` / `PopOutDiffButton` rather than hand-rolling chrome.
 *
 * @module components/tugways/cards/session-changes/session-changes-dash-lane
 */

import "./session-changes-dash-lane.css";

import React, { useState } from "react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugStatusMark } from "@/components/tugways/tug-status-mark";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { PopOutDiffButton } from "@/components/tugways/tug-changes-list";
import type { DiffDescriptor } from "@/lib/git-diff-store";
import type { DashChangesetEntry } from "@/lib/changeset-types";

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/** The lane's two groups: the card's own dash, then everything else. */
export interface DashLaneOrder {
  /** The dash this card's session is mated to, or null when unbound. */
  fronted: DashChangesetEntry | null;
  /** Every other dash in the project, in snapshot order. */
  rest: DashChangesetEntry[];
}

/**
 * Split the project's dashes into the fronted one and the rest.
 *
 * The match is on the **owner key**, never the name: a stale binding to a dead
 * incarnation of a reused name must not front the wrong dash. An unmatched
 * binding is simply an unbound lane — which is also what the one-recompose
 * window after a bind that minted a new id should show.
 */
export function orderDashLane(
  dashes: readonly DashChangesetEntry[],
  boundDashId: string | null,
): DashLaneOrder {
  const fronted =
    boundDashId !== null
      ? (dashes.find((entry) => entry.owner_id === boundDashId) ?? null)
      : null;
  return {
    fronted,
    rest: dashes.filter((entry) => entry !== fronted),
  };
}

/** The dash's git ref — `branch`, falling back to the older sender's spelling. */
export function dashBranchRef(entry: DashChangesetEntry): string {
  return entry.branch ?? `tugdash/${entry.display_name}`;
}

function roundsLabel(rounds: number): string {
  return rounds === 1 ? "1 round" : `${rounds} rounds`;
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

function DashRow({
  entry,
  projectRoot,
  fronted,
  expanded,
  onToggle,
}: {
  entry: DashChangesetEntry;
  projectRoot: string;
  fronted: boolean;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}): React.ReactElement {
  const descriptor: DiffDescriptor = {
    kind: "range",
    root: projectRoot,
    worktree: entry.worktree,
    base: entry.base,
    branch: dashBranchRef(entry),
  };
  // A dash with nothing past its base and a clean worktree has no range to
  // show; offering the pop-out would open an empty card.
  const hasRange = entry.rounds > 0 || entry.worktree_dirty;
  const subjects = entry.round_subjects ?? [];
  const steps =
    entry.step_current !== undefined && entry.step_total !== undefined
      ? `step ${entry.step_current}/${entry.step_total}`
      : null;

  return (
    <div
      className="session-changes-dash-row"
      data-slot="session-changes-dash-row"
      data-dash={entry.display_name}
      data-fronted={fronted ? "true" : undefined}
      data-expanded={expanded ? "true" : undefined}
    >
      <TugListRow
        variant="flush"
        density="compact"
        leading={
          <TugBadge emphasis="tinted" role="data" size="2xs">
            {entry.display_name}
          </TugBadge>
        }
        trailing={
          <span className="session-changes-dash-row-trailing">
            {hasRange ? (
              <PopOutDiffButton
                descriptor={descriptor}
                label={`Open the ${entry.display_name} dash diff in a card`}
              />
            ) : null}
            <BlockFoldCue
              collapsed={!expanded}
              onToggle={(nextCollapsed) => onToggle(!nextCollapsed)}
              collapsedLabel="Expand dash"
              ariaLabelExpand={`Show details for dash ${entry.display_name}`}
              ariaLabelCollapse={`Hide details for dash ${entry.display_name}`}
              size="2xs"
              subtype="icon"
              stabilizeScroll={false}
              data-slot="session-changes-dash-fold"
            />
          </span>
        }
      >
        <span className="session-changes-dash-facts">
          <span className="session-changes-dash-base">{entry.base}</span>
          <span className="session-changes-dash-sep">·</span>
          <span className="session-changes-dash-rounds">
            {roundsLabel(entry.rounds)}
          </span>
          {entry.worktree_dirty ? (
            <>
              <span className="session-changes-dash-sep">·</span>
              <span className="session-changes-dash-dirty">dirty</span>
            </>
          ) : null}
          {entry.stage !== undefined ? (
            <>
              <span className="session-changes-dash-sep">·</span>
              <span className="session-changes-dash-stage">{entry.stage}</span>
            </>
          ) : null}
          {steps !== null ? (
            <>
              <span className="session-changes-dash-sep">·</span>
              <span className="session-changes-dash-step">{steps}</span>
            </>
          ) : null}
        </span>
      </TugListRow>
      {expanded ? (
        <div className="session-changes-dash-detail">
          {subjects.length > 0 ? (
            <ul
              className="session-changes-dash-subjects"
              data-slot="session-changes-dash-subjects"
            >
              {subjects.map((subject, index) => (
                <li key={`${index}:${subject}`}>{subject}</li>
              ))}
            </ul>
          ) : null}
          {entry.files.length > 0 ? (
            <ul
              className="session-changes-dash-files"
              data-slot="session-changes-dash-files"
            >
              {entry.files.map((file) => (
                <li key={file.path}>
                  <TugStatusMark status={file.git_status} />
                  <span className="session-changes-dash-file-path">{file.path}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {entry.draft !== undefined ? (
            <div
              className="session-changes-dash-draft"
              data-slot="session-changes-dash-draft"
            >
              <div className="session-changes-dash-draft-label">Join draft</div>
              <div className="session-changes-dash-draft-message">
                {entry.draft.message}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

export interface SessionChangesDashLaneProps {
  /** The project's dash entries, in snapshot order. */
  dashes: readonly DashChangesetEntry[];
  /** The owner key of the dash this card's session is mated to, if any. */
  boundDashId: string | null;
  /** Absolute checkout root — the range descriptor's `root`. */
  projectRoot: string;
}

export function SessionChangesDashLane({
  dashes,
  boundDashId,
  projectRoot,
}: SessionChangesDashLaneProps): React.ReactElement | null {
  // Per-dash expansion overrides. The default is "expanded exactly when this
  // is the card's own dash", so a bind that arrives while the shade is open
  // fronts and opens the new dash without the reader touching anything.
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [restCollapsed, setRestCollapsed] = useState(true);

  if (dashes.length === 0) return null;

  const { fronted, rest } = orderDashLane(dashes, boundDashId);
  const isExpanded = (entry: DashChangesetEntry): boolean =>
    overrides[entry.owner_id] ?? entry === fronted;
  const toggle = (entry: DashChangesetEntry, next: boolean): void => {
    setOverrides((prev) => ({ ...prev, [entry.owner_id]: next }));
  };
  const restLabel =
    fronted !== null
      ? `Also on this project: ${rest.length} ${rest.length === 1 ? "dash" : "dashes"}`
      : `Dashes: ${rest.length}`;

  return (
    <div className="session-changes-dash-lane" data-slot="session-changes-dash-lane">
      {fronted !== null ? (
        <>
          <div
            className="session-changes-dash-lane-label"
            data-slot="session-changes-dash-lane-fronted-label"
          >
            This card&rsquo;s dash
          </div>
          <DashRow
            entry={fronted}
            projectRoot={projectRoot}
            fronted
            expanded={isExpanded(fronted)}
            onToggle={(next) => toggle(fronted, next)}
          />
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          <div
            className="session-changes-dash-lane-label session-changes-dash-lane-rest-label"
            data-slot="session-changes-dash-lane-rest-label"
          >
            <span>{restLabel}</span>
            <BlockFoldCue
              collapsed={restCollapsed}
              onToggle={setRestCollapsed}
              collapsedLabel="Show dashes"
              expandedLabel="Hide dashes"
              ariaLabelExpand="Show the project's other dashes"
              ariaLabelCollapse="Hide the project's other dashes"
              size="2xs"
              subtype="icon"
              stabilizeScroll={false}
              data-slot="session-changes-dash-lane-fold"
            />
          </div>
          {!restCollapsed
            ? rest.map((entry) => (
                <DashRow
                  key={entry.owner_id}
                  entry={entry}
                  projectRoot={projectRoot}
                  fronted={false}
                  expanded={isExpanded(entry)}
                  onToggle={(next) => toggle(entry, next)}
                />
              ))
            : null}
        </>
      ) : null}
    </div>
  );
}
