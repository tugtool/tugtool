/**
 * `SessionChangesView` — the read-only changes glance ([P02]). Rides the
 * bottom-anchored passive TugSheet `shade` over the live transcript and shows
 * the card's changed files: the session's attributed files plus the project's
 * unattributed files, per-file inline diffs, and the non-repo git-init
 * affordance. It answers "what's changed?" — glanceable, dismiss-and-forget.
 *
 * The sheet is passive ([P17]): the composer below keeps focus (⇧⌘C is the
 * toggle; landing a commit lives in the composer's `!changes` route + Z5), so
 * the view carries no Done button, no header X, and seeds no key view. The
 * file rows are `TugChangesList` ([P01]); the header keeps only its fold-all
 * cue + whole-diff pop-out, and the git-init affordance sits in the body.
 *
 * Laws: [L02] the controller + git-init verb store enter React through
 * `useSyncExternalStore`; [L06] no appearance state in React (status tones and
 * hover affordances paint via CSS); [L26] per-file diff bodies collapse by
 * unmount inside `TugChangesList`'s rows.
 *
 * @module components/tugways/cards/session-changes/session-changes-view
 */

import "./session-changes-view.css";

import React, { useCallback, useState, useSyncExternalStore } from "react";
import { CircleCheck, GitCommitHorizontal } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import {
  TugChangesList,
  PopOutDiffButton,
  diffablePathsOf,
  fileExpandKey,
  type TugChangesListEntry,
} from "@/components/tugways/tug-changes-list";
import type { DiffDescriptor } from "@/lib/git-diff-store";
import { useChangesetGitInit } from "@/lib/changeset-verb-store";
import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";

/**
 * Hint on the git-init button while a Claude turn runs. Viewing changes
 * mid-turn is free; Initialize git is a durable verb and waits for the turn to
 * end — the gate that stays with the viewer after the commit/join verbs left.
 */
const TURN_GATE_HINT = "Unavailable while a turn is running";

// ---------------------------------------------------------------------------
// Non-repo project: "Initialize git" affordance
// ---------------------------------------------------------------------------

function NonRepoBody({
  projectDir,
  turnInProgress,
}: {
  projectDir: string;
  turnInProgress: boolean;
}) {
  const { phase, error, init } = useChangesetGitInit(projectDir);
  return (
    <div className="session-changes-non-repo" role="group" data-testid="session-changes-non-repo">
      <div className="session-changes-non-repo-message">
        This directory is not a git repository.
      </div>
      <TugPushButton
        emphasis="outlined"
        role="accent"
        onClick={init}
        disabled={phase === "pending" || turnInProgress}
        title={turnInProgress ? TURN_GATE_HINT : undefined}
        data-testid="session-changes-git-init"
      >
        Initialize git
      </TugPushButton>
      {phase === "error" && error !== null ? (
        <div className="session-changes-non-repo-error">{error}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface SessionChangesViewProps {
  /** Repo-relative project directory the card is bound to. */
  projectDir: string | null;
  /** The per-card Changes controller — the changeset snapshot ([P07]). */
  changesController: ChangesRouteController;
  /**
   * The card's Claude session store — read for the turn-in-progress signal
   * that gates the git-init verb while a turn runs. Viewing changes mid-turn
   * is free; only the durable git-init waits.
   */
  codeSessionStore: CodeSessionStore;
}

export function SessionChangesView({
  projectDir,
  changesController,
  codeSessionStore,
}: SessionChangesViewProps): React.ReactElement {
  const snap = useSyncExternalStore(
    changesController.subscribe,
    changesController.getSnapshot,
  );
  const project = snap.project;
  // `canInterrupt` is true exactly while a turn can be stopped (one is
  // running), so it is the turn-in-progress signal ([L02]).
  const turnInProgress = useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().canInterrupt === true,
  );

  const sessionFiles = snap.entry?.files ?? [];

  // Per-file collapse state is owned HERE (view scope), keyed by
  // `${entryId}|${path}`, so the Expand All / Collapse All / Diff controls
  // live once in the shade banner and act across every head entry.
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(new Set());
  const onToggleFile = useCallback(
    (entryId: string, path: string, collapsed: boolean) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        const key = fileExpandKey(entryId, path);
        if (collapsed) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [],
  );

  // The shade header is the section band chrome ([P02]) — a `BlockStrip` at
  // `altitude="section"`, grip-less: the Changes glyph + title on the left,
  // the fold-all cue + Diff pop-out on the right. No X: the passive sheet is
  // dismissed by ⇧⌘C (the composer keeps focus).
  const buildHeader = (actions?: React.ReactNode): React.ReactElement => (
    <BlockStrip
      altitude="section"
      className="tool-call-header"
      dataTestid="session-changes-header"
      leading={
        <span className="tool-call-header-leading" aria-hidden="true">
          <GitCommitHorizontal size={14} />
        </span>
      }
      name="Changes"
      actions={actions}
    />
  );

  // The view fills the sheet's shade body ([P17]): the header strip pinned
  // above, the scrolling view below. The passive shade seeds no key view and
  // carries no action row — landing a commit lives in the composer's Z5. The
  // shade panel (geometry, scrim, grabber, modality) is
  // `TugSheetContent presentation="shade"` — mounted by the Session card.
  const shell = (
    children: React.ReactNode,
    actions?: React.ReactNode,
  ): React.ReactElement => (
    <>
      <div className="tug-sheet-shade-header">{buildHeader(actions)}</div>
      <div
        className="session-changes-view"
        data-slot="session-changes-view"
        data-tug-focus="refuse"
      >
        {children}
      </div>
    </>
  );

  if (project.no_repo) {
    return shell(
      <NonRepoBody
        projectDir={projectDir ?? project.project_dir}
        turnInProgress={turnInProgress}
      />,
    );
  }

  const sessionItem: TugChangesListEntry | null =
    snap.entry !== null
      ? { kind: "session", id: changesController.entryKey, project, entry: snap.entry }
      : null;
  const unattributedItem: TugChangesListEntry | null =
    snap.unattributed.length > 0
      ? {
          kind: "unattributed",
          id: `unattributed:${project.project_dir}`,
          project,
          files: snap.unattributed,
        }
      : null;
  const hasSessionFiles = sessionFiles.length > 0;
  const isEmpty = !hasSessionFiles && unattributedItem === null;

  // The head entries (session + unattributed) the banner controls act on.
  // Every diffable file across them yields one expand key; the whole-view Diff
  // pop-out is a `head` diff over their union of paths.
  const headEntries: TugChangesListEntry[] = [
    ...(sessionItem !== null && hasSessionFiles ? [sessionItem] : []),
    ...(unattributedItem !== null ? [unattributedItem] : []),
  ];
  const combinedKeys: string[] = headEntries.flatMap((entry) =>
    diffablePathsOf(entry).map((path) => fileExpandKey(entry.id, path)),
  );
  const combinedDiffPaths: string[] = headEntries.flatMap((entry) =>
    diffablePathsOf(entry),
  );
  const combinedDescriptor: DiffDescriptor | null =
    combinedDiffPaths.length > 0
      ? { kind: "head", root: project.project_dir, paths: combinedDiffPaths }
      : null;

  // Fold-all cue: the standard section chevron, but it expands / collapses
  // ALL files rather than accordioning the header. `allExpanded` derives the
  // chevron direction; the toggle sets the whole key set at once.
  const allExpanded =
    combinedKeys.length > 0 && combinedKeys.every((k) => expandedKeys.has(k));
  const headerActions =
    combinedKeys.length > 1 || combinedDescriptor !== null ? (
      <>
        {combinedKeys.length > 1 ? (
          <BlockFoldCue
            collapsed={!allExpanded}
            onToggle={(nextCollapsed) =>
              setExpandedKeys(nextCollapsed ? new Set() : new Set(combinedKeys))
            }
            collapsedLabel="Expand all"
            expandedLabel="Collapse all"
            ariaLabelExpand="Expand all files"
            ariaLabelCollapse="Collapse all files"
            size="xs"
            subtype="icon"
            stabilizeScroll={false}
            data-slot="session-changes-fold-all"
          />
        ) : null}
        {combinedDescriptor !== null ? (
          <PopOutDiffButton
            descriptor={combinedDescriptor}
            label="Open the whole diff in a card"
          />
        ) : null}
      </>
    ) : undefined;

  return shell(
    <div className="session-changes-view-body">
      {isEmpty ? (
        <div className="session-changes-clean" role="status">
          <CircleCheck size={14} />
          No changes
        </div>
      ) : null}
      {headEntries.length > 0 ? (
        <TugChangesList
          entries={headEntries}
          ownSessionId={changesController.tugSessionId}
          expandedKeys={expandedKeys}
          onToggleFile={onToggleFile}
          unattributedLabel="unattributed — no session claims these"
        />
      ) : null}
    </div>,
    headerActions,
  );
}
