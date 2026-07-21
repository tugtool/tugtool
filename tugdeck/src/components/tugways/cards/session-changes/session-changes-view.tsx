/**
 * `SessionChangesView` — the `±` route's read-only changes viewer ([P02]).
 * On the `±` route this rides the TugSheet `shade` presentation over the live
 * transcript and shows the card's changed files: the session's attributed
 * files plus the project's unattributed files, per-file inline diffs, and the
 * non-repo git-init affordance. It answers "what's changed?" — glanceable,
 * dismiss-and-forget. Authoring and landing a commit live in the transcript's
 * `TugCommitDialog`, not here.
 *
 * The file rows are `TugChangesList` ([P01]); the shade keeps only its header
 * chrome (fold-all cue + whole-diff pop-out), the git-init affordance, and a
 * lower-right Done button. Return and Escape both dismiss: Done is the sole
 * `persistentDefaultRing` Return consumer inside the sheet's trapped focus
 * mode (the effort-picker convention), while Escape / Cmd-. route through the
 * `TugSheet` cancelDialog chain.
 *
 * Laws: [L02] the controller + git-init verb store enter React through
 * `useSyncExternalStore`; [L06] no appearance state in React (status tones and
 * hover affordances paint via CSS); [L26] per-file collapse is by unmount
 * under `TugChangesList`'s collapse context.
 *
 * @module components/tugways/cards/session-changes/session-changes-view
 */

import "./session-changes-view.css";

import React, { useCallback, useState, useSyncExternalStore } from "react";
import { CircleCheck, GitCommitHorizontal, X } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
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
  /** Hide the shade — the header X, the Done button, Return, and Escape. */
  onClose?: () => void;
}

export function SessionChangesView({
  projectDir,
  changesController,
  codeSessionStore,
  onClose,
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

  // Seed the sheet's key view onto the Done button so Return dismisses (the
  // effort-picker convention). The shade unmounts this view on close, so this
  // seeds only while the shade is open.
  const doneFocusGroup = React.useId();
  useSeedKeyView(`${doneFocusGroup}:0`);

  // The shade header is the section band chrome ([P02]) — a `BlockStrip` at
  // `altitude="section"`, grip-less: the Changes glyph + title on the left,
  // the fold-all cue + Diff pop-out + close on the right.
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
      actions={
        <>
          {actions}
          {onClose !== undefined ? (
            <TugIconButton
              icon={<X size={12} strokeWidth={2.5} />}
              aria-label="Close"
              size="2xs"
              emphasis="ghost"
              onClick={onClose}
            />
          ) : null}
        </>
      }
    />
  );

  // The view fills the sheet's shade body ([P17]): the header strip pinned
  // above, the scrolling view in the middle, the Done action row below. The
  // shade panel (geometry, scrim, grabber, modality, Escape close) is
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
      <div className="tug-sheet-actions session-changes-actions">
        <TugPushButton
          size="sm"
          emphasis="primary"
          persistentDefaultRing
          focusGroup={doneFocusGroup}
          focusOrder={0}
          onClick={() => onClose?.()}
          data-slot="session-changes-done"
          data-testid="session-changes-done"
        >
          Done
        </TugPushButton>
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
