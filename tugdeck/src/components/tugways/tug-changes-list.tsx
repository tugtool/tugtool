/**
 * `TugChangesList` — a read-only list of changed files with inline diffs
 * ([P01], Spec S01). One `TugListRow` per file (compact, mono): a status
 * glyph + path (with an open/reveal context menu), the house `+N −M` badge
 * pair, a pop-out-to-a-card diff affordance, and a fold cue, over a diff
 * body that expands and collapses in place. Every row is expandable —
 * untracked files diff via the backend's synthesized new-file diffs.
 *
 * Two diff sources share the row renderer:
 *  - the live list (`TugChangesList`) diffs the working tree (`head`
 *    flavor, eagerly fetched so the ± badges fill in), and
 *  - the `/commit` receipt (`CommitChangesList`) diffs one committed sha
 *    (`commit` flavor, fetched lazily per row on first expand — the counts
 *    are frozen in the receipt record, so nothing loads until you look).
 *
 * The component owns diff fetching — one `GitDiffStore` per entry / per
 * expanded receipt row, dropped on unmount — and nothing else: live
 * per-file collapse is CONTROLLED by the host (`expandedKeys` +
 * `onToggleFile`) so each host keeps its own fold-all / whole-diff chrome.
 *
 * A session-entry row can also elect *which hunks* of a file the landing
 * takes ([P09]): the expanded diff renders a checkbox per hunk, keyed by the
 * server-computed hunk id, and the row wears an `N of M hunks` badge when only
 * part of it will land. The election is persisted by the host (the draft's
 * selection) — this component owns the controls and their responder wiring,
 * `DiffBlock` only paints the slot ([D05]).
 *
 * Laws: [L02] diff stores enter React through `useSyncExternalStore`;
 * [L06] status tones, hover affordances, and the partial-landing mark paint
 * via CSS, never React state; [L11] the hunk checkboxes dispatch `toggle`
 * through a `useResponderForm` scope this module owns; [L26] the diff body
 * collapses by unmount.
 *
 * @module components/tugways/tug-changes-list
 */

import "./tug-changes-list.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CornerDownLeft, CornerUpRight, SquareArrowOutUpRight } from "lucide-react";

import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { DiffSummaryBadges } from "@/components/tugways/blocks/diff-summary-badges";
import { renderFilterHighlight } from "@/components/tugways/filter-highlight";
import {
  getEntryDiffStore,
  releaseEntryDiffStore,
} from "@/lib/changeset-diff-store";
import { reconcileHunkElection } from "@/lib/hunk-election";
import {
  diffDescriptorKey,
  type DiffDescriptor,
  type GitDiffFile,
  type GitDiffSnapshot,
} from "@/lib/git-diff-store";
import type {
  ChangesetFile,
  OrphanedFile,
  ProjectChangeset,
  SessionChangesetEntry,
  UnattributedFile,
} from "@/lib/changeset-types";

// ---------------------------------------------------------------------------
// Entry model — one head entry (the session's attributed files, or the
// project's unattributed files) the list renders. The dash lane lives in the
// Changes shade, not here ([P01]).
// ---------------------------------------------------------------------------

export type TugChangesListEntry =
  | { kind: "session"; id: string; project: ProjectChangeset; entry: SessionChangesetEntry }
  | { kind: "unattributed"; id: string; project: ProjectChangeset; files: UnattributedFile[] }
  | { kind: "orphaned"; id: string; project: ProjectChangeset; files: OrphanedFile[] };

// ---------------------------------------------------------------------------
// Status mark — a colored single letter (more legible than a glyph at this
// size): green N (new), yellow M (modified or moved), red D (deleted).
// ---------------------------------------------------------------------------

/** The status letter + tone for a file. New folds untracked + added; modified
 *  folds renamed/moved and every other change; deleted stands alone. */
function statusMark(gitStatus: string): { letter: "N" | "M" | "D"; toneClass: string } {
  if (gitStatus.startsWith("??")) {
    return { letter: "N", toneClass: "tug-changes-list-status-new" };
  }
  const code = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (code) {
    case "A":
      return { letter: "N", toneClass: "tug-changes-list-status-new" };
    case "D":
      return { letter: "D", toneClass: "tug-changes-list-status-deleted" };
    default:
      // Modified, renamed/moved, copied, type-changed — all read as "changed".
      return { letter: "M", toneClass: "tug-changes-list-status-modified" };
  }
}

/** The status letter, colored by tone. Decorative — the git status also rides
 *  the row's provenance text and title. */
function StatusMark({ gitStatus }: { gitStatus: string }): React.ReactElement {
  const { letter, toneClass } = statusMark(gitStatus);
  return (
    <span
      className={`tug-changes-list-file-status ${toneClass}`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

function isDeleted(op: string, gitStatus: string): boolean {
  return op === "deleted" || /D/.test(gitStatus);
}

// ---------------------------------------------------------------------------
// File path link + pop-out
// ---------------------------------------------------------------------------

function FilePathLink({
  path,
  op,
  gitStatus,
  projectRoot,
  highlightQuery = "",
}: {
  path: string;
  op: string;
  gitStatus: string;
  projectRoot: string;
  highlightQuery?: string;
}) {
  const absolutePath = projectRoot ? `${projectRoot}/${path}` : path;
  // The path is matchable content wherever a filtered list shows it, so the
  // marks go on the rendered string. `path` stays the authority for the
  // `title`, the menu, and the open action.
  const shown = renderFilterHighlight(path, highlightQuery);

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.shiftKey) return;
      // Opening the file is the link's own gesture — never also the row's
      // expand toggle.
      event.stopPropagation();
      dispatchAction({ action: TUG_ACTIONS.OPEN_FILE, path: absolutePath });
    },
    [absolutePath],
  );

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    // Suppress WebKit's mousedown focus default so opening a file never pulls
    // first responder onto this read-only surface (the Text card claims focus
    // via its own activation path).
    if (event.button !== 0 || event.metaKey || event.shiftKey) return;
    event.preventDefault();
  }, []);

  if (isDeleted(op, gitStatus) || !projectRoot) {
    return (
      <span className="tug-changes-list-file-path" title={path}>
        {shown}
      </span>
    );
  }

  return (
    <TugContextMenu<string>
      items={[
        { action: TUG_ACTIONS.OPEN_FILE, value: absolutePath, label: "Open in Editor" },
        { action: TUG_ACTIONS.REVEAL_IN_FINDER, value: absolutePath, label: "Show in Finder" },
      ]}
    >
      <span
        className="tug-changes-list-file-path tug-changes-list-file-path--link"
        data-slot="tug-changes-list-file-ref"
        title={path}
        data-tug-focus="refuse"
        data-no-activate=""
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {shown}
      </span>
    </TugContextMenu>
  );
}

export function PopOutDiffButton({
  descriptor,
  label,
}: {
  descriptor: DiffDescriptor;
  label: string;
}) {
  return (
    <TugPushButton
      subtype="icon"
      icon={<SquareArrowOutUpRight size={12} />}
      size="2xs"
      emphasis="ghost"
      role="action"
      title="Open diff in a card"
      aria-label={label}
      data-testid="tug-changes-list-diff-popout"
      onClick={(event) => {
        event?.stopPropagation();
        dispatchAction({ action: TUG_ACTIONS.OPEN_DIFF, descriptor });
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Diff descriptors + inline diff sourcing
// ---------------------------------------------------------------------------

const DIFF_IDLE_SNAPSHOT: GitDiffSnapshot = {
  phase: "idle",
  requestId: null,
  payload: null,
  error: null,
};

const DIFF_NOOP_SUBSCRIBE = (): (() => void) => () => {};

/** The whole-entry diff descriptor: `git diff HEAD` (untracked included)
 *  scoped to the entry's paths. Null for a non-repo project or an empty
 *  entry. */
export function entryDiffDescriptor(entry: TugChangesListEntry): DiffDescriptor | null {
  if (entry.project.no_repo) return null;
  const files = entry.kind === "session" ? entry.entry.files : entry.files;
  const paths = files.map((file) => file.path);
  if (paths.length === 0) return null;
  return { kind: "head", root: entry.project.project_dir, paths };
}

/** The pop-out descriptor for one file (`git diff HEAD` scoped to it). */
function filePopOutDescriptor(
  project: ProjectChangeset,
  path: string,
): DiffDescriptor | null {
  if (project.no_repo) return null;
  return { kind: "head", root: project.project_dir, paths: [path] };
}

/** An entry's inline diff store + snapshot — one `GitDiffStore` per entry id,
 *  sourcing the descriptor the caller memoizes. */
export function useEntryDiff(
  id: string,
  descriptor: DiffDescriptor | null,
): {
  snapshot: GitDiffSnapshot;
  ensureRequested: () => void;
} {
  const store = getEntryDiffStore(id);
  const requestedKeyRef = useRef<string | null>(null);
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? DIFF_NOOP_SUBSCRIBE,
    store?.getSnapshot ?? (() => DIFF_IDLE_SNAPSHOT),
  );
  const ensureRequested = useCallback(() => {
    if (store === null || descriptor === null) return;
    const key = diffDescriptorKey(descriptor);
    if (requestedKeyRef.current === key) return;
    requestedKeyRef.current = key;
    store.requestDiff(descriptor);
  }, [store, descriptor]);
  return { snapshot, ensureRequested };
}

// ---------------------------------------------------------------------------
// Hunk election ([P09]) — which hunks of a partial file the landing takes
// ---------------------------------------------------------------------------

/**
 * One file's hunk election as the row needs it: the server-supplied ids (the
 * only identity anyone uses — the deck never derives one) and the elected
 * subset. An absent entry in the draft means the whole file lands, so
 * `elected` is every id until the user unchecks one.
 */
export interface HunkElection {
  /** The elected ids for this path, or `null` when the file lands whole. */
  elected: readonly string[] | null;
  /** Persist a new election; `null` restores whole-file landing. */
  onElect: (ids: readonly string[] | null) => void;
}

/**
 * The checked set for a file: the persisted election reconciled against the
 * hunks actually in the file ([P18]). Same rule the row's badge reads, so a
 * count and its boxes cannot disagree.
 */
function electedSet(
  ids: readonly string[],
  election: HunkElection | undefined,
): ReadonlySet<string> {
  if (election === undefined) return new Set(ids);
  return new Set(reconcileHunkElection(ids, election.elected).elected);
}

/**
 * A file's inline diff — with a per-hunk election checkbox in each `@@` band
 * wherever a hunk can actually be elected.
 *
 * One component for every diff, branching internally on whether there is an
 * election ([L26]). The predicate moves at runtime — edit a one-hunk file into
 * two while its row is open and the aggregate recomposes — so a call site that
 * swapped between two component types would unmount the open diff, taking its
 * collapsed bands, view mode, and scroll with it.
 *
 * The responder wiring lives here rather than in `DiffBlock` ([D05], [L11]):
 * `DiffBlock` paints the slot and hands back each hunk's id, this component
 * owns the checkboxes, their `toggle` bindings, and the write. Unchecking the
 * last elected hunk is refused at the control — a file in the landing set with
 * nothing elected is a refusal server-side, so the UI never offers it.
 */
function FileDiffBody({
  file,
  election,
}: {
  file: GitDiffFile;
  election?: HunkElection;
}): React.ReactElement {
  const ids = file.hunks ?? [];
  const elected = electedSet(ids, election);
  const senderId = useCallback(
    (id: string) => `hunk:${file.path}:${id}`,
    [file.path],
  );
  // Built plainly, not memoized: `useResponderForm` reads the bindings through
  // a ref it refreshes every render, so there is nothing for a memo to save —
  // and a memo that actually held would freeze each closure over a stale
  // `elected` and break toggling.
  const toggle: Record<string, (value: boolean) => void> = {};
  if (election !== undefined) {
    for (const id of ids) {
      toggle[senderId(id)] = (next: boolean) => {
        const nextElected = ids.filter((candidate) =>
          candidate === id ? next : elected.has(candidate),
        );
        // Every hunk checked is whole-file landing — clear the entry rather
        // than persisting a selection that means the same thing.
        election.onElect(
          nextElected.length === ids.length ? null : nextElected,
        );
      };
    }
  }
  // Unconditional: hooks may not be conditional, and the form is cheap when
  // there is nothing bound to it.
  const form = useResponderForm({ toggle });

  // Hunk controls only where a hunk can actually be elected: the server sends
  // ids for tracked, textual files and none for a created file (whose diff it
  // synthesizes) or a binary one, and the landing engine refuses an election
  // on either ([P07]). The ids ride every diff regardless — identity is what
  // the wire serves, and an affordance is a separate question.
  const renderHunkAffordance =
    election !== undefined && ids.length > 1
      ? (hunkId: string) => {
          const checked = elected.has(hunkId);
          // The sole remaining hunk cannot be unchecked: an empty election
          // on a landing path is a server-side refusal, not a disposition.
          const isLast = checked && elected.size === 1;
          const box = (
            <TugCheckbox
              checked={checked}
              disabled={isLast}
              size="sm"
              senderId={senderId(hunkId)}
              aria-label={`Land this hunk of ${file.path}`}
              data-testid="tug-changes-list-hunk-elect"
            />
          );
          // A disabled control with no stated reason reads as broken. The
          // tooltip rides a wrapper this caller owns rather than widening
          // `TugCheckbox` — which declares no `title` — for one caller.
          return isLast ? (
            <span title="At least one hunk must land — a file in the landing set with nothing elected is refused">
              {box}
            </span>
          ) : (
            box
          );
        }
      : undefined;

  return (
    <form.ResponderScope>
      {/* Unconditional wrapper: rendering it only when there is an election
          would be the same mount-identity breach one level down. It is
          unstyled, and the diff's sticky pin chain is unaffected — the pin's
          containing block is `.tugx-diff-hunk`. */}
      <div ref={form.responderRef}>
        <DiffBlock
          data={{ source: "unified", text: file.unified, filePath: file.path }}
          embedded
          hunkIds={file.hunks}
          renderHunkAffordance={renderHunkAffordance}
        />
      </div>
    </form.ResponderScope>
  );
}

/** One file's diff as the row's expanded body. */
function fileBlockBody(
  snapshot: GitDiffSnapshot,
  path: string,
  election?: HunkElection,
): React.ReactNode {
  if (snapshot.phase === "error") {
    return (
      <p className="tug-changes-list-file-block-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  }
  // The notice is for having nothing to show, not for a request being in
  // flight: the store keeps the last payload across a refetch, and an open
  // diff must keep rendering it rather than blanking to a notice and back.
  // Swapping to a `<p>` and back is a remount, which loses the collapsed
  // bands, the view mode, and the scroll — the same [L23] loss the one-body
  // unification exists to prevent, arriving one level up.
  if (snapshot.payload === null) {
    return (
      <p className="tug-changes-list-file-block-notice" role="status">
        Loading diff…
      </p>
    );
  }
  const file = snapshot.payload.files.find((f) => f.path === path);
  if (file === undefined) {
    return (
      <p className="tug-changes-list-file-block-notice" role="status">
        No diff for this file.
      </p>
    );
  }
  if (file.binary) {
    return (
      <p className="tug-changes-list-file-block-notice" role="note">
        Binary file — no textual diff.
      </p>
    );
  }
  // One component type for every diff, whatever the hunk count and whatever
  // the entry kind ([L26]) — the branch that used to live here now lives
  // inside `FileDiffBody`. The notice branches above stay `<p>`: those are
  // genuinely different entities, not phases of the same one.
  return <FileDiffBody file={file} election={election} />;
}

// ---------------------------------------------------------------------------
// File rows
// ---------------------------------------------------------------------------

export interface FileBlockData {
  path: string;
  git_status: string;
  op: string;
  origin: string;
  shared: boolean;
  /** Bracket-hint provenance text ([P13]), when a bracket saw this path. */
  hint?: string;
}

export function changesetFileData(file: ChangesetFile): FileBlockData {
  return {
    path: file.path,
    git_status: file.git_status,
    op: file.op,
    origin: file.origin,
    shared: file.shared === true,
  };
}

/**
 * Unattributed row data with its bracket-hint text ([P13]): the card
 * session's own hint reads as a terse `likely` badge — the one-glance
 * disposition cue; foreign hints render as a `seen by N` provenance count.
 */
function unattributedFileData(
  file: UnattributedFile,
  ownSessionId?: string,
): FileBlockData {
  const hintedBy = file.hinted_by ?? [];
  let hint: string | undefined;
  if (ownSessionId !== undefined && hintedBy.includes(ownSessionId)) {
    hint = "likely";
  } else if (hintedBy.length > 0) {
    hint = `seen by ${hintedBy.length}`;
  }
  return {
    path: file.path,
    git_status: file.git_status,
    op: "",
    origin: "",
    shared: false,
    hint,
  };
}

/**
 * Orphaned row data ([D120]): a file stranded on a dead session, shown with a
 * `from <prior owner>` hint so the reclaim reads as adoption. Keeps the dead
 * owner's op/origin provenance.
 */
function orphanedFileData(file: OrphanedFile): FileBlockData {
  return {
    path: file.path,
    git_status: file.git_status,
    op: file.op,
    origin: file.origin,
    shared: false,
    hint: `from ${file.prior_owner_name}`,
  };
}

/**
 * What a row's badge says about the file's election — the reconciled shape,
 * not the raw persisted one, so the badge and the checkboxes read the same
 * rule ([P18]).
 */
export type FileElectionBadge =
  | { kind: "partial"; elected: number; total: number }
  | { kind: "stale" };

function FileIdentity({
  file,
  projectRoot,
  highlightQuery,
  election = null,
}: {
  file: FileBlockData;
  projectRoot: string;
  highlightQuery?: string;
  /** See {@link ChangesFileRow}'s `election`. */
  election?: FileElectionBadge | null;
}) {
  const provenance =
    file.origin === ""
      ? null
      : file.origin === "dash" || file.origin === "claim"
        ? file.op
        : `${file.op} · ${file.origin}`;
  // The divider is a separator between the file name and its metadata cluster,
  // not a property of one metadata kind — so it rides a wrapper that renders
  // only when the cluster has something in it. A badge-only or hint-only row
  // gets the same single divider a provenance row does; a bare row gets none.
  const hasMeta =
    file.shared ||
    provenance !== null ||
    file.hint !== undefined ||
    election !== null;
  return (
    <span className="tug-changes-list-file-identity">
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
        highlightQuery={highlightQuery}
      />
      {hasMeta ? (
        <span className="tug-changes-list-file-meta">
          {election !== null ? (
            election.kind === "partial" ? (
              <span
                className="tug-changes-list-badge tug-changes-list-badge-partial"
                data-testid="tug-changes-list-file-partial"
                title={`Only ${election.elected} of this file's ${election.total} hunks will land`}
              >
                {`${election.elected} of ${election.total} hunks`}
              </span>
            ) : (
              // Every box is checked, but not because the file lands whole —
              // saying nothing here would assert a landing the engine is about
              // to refuse.
              <span
                className="tug-changes-list-badge tug-changes-list-badge-stale"
                data-testid="tug-changes-list-file-stale-election"
                title="The hunks elected for this file are no longer in it — the landing will refuse until they are re-elected"
              >
                stale election
              </span>
            )
          ) : null}
          {file.shared ? (
            <span className="tug-changes-list-badge tug-changes-list-badge-shared">
              shared
            </span>
          ) : null}
          {provenance !== null ? (
            <span className="tug-changes-list-file-provenance">{provenance}</span>
          ) : null}
          {file.hint !== undefined ? (
            <span
              className="tug-changes-list-file-hint"
              data-testid="tug-changes-list-file-hint"
            >
              {file.hint}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * One file's row + expandable diff body, shared by the live list and the
 * `/commit` receipt: a compact mono `TugListRow` (status glyph leading; path
 * + badges content; ± counts, pop-out, and fold cue trailing) over a
 * mount-on-expand diff body ([L26]). The whole row is a click target for the
 * fold; the path link and trailing controls own their gestures and stop
 * propagation. Presentation carries no lifecycle dot — a changed file has no
 * lifecycle.
 */
export function ChangesFileRow({
  file,
  projectRoot,
  counts,
  election = null,
  expanded,
  onToggle,
  popOut,
  body,
  onClaim,
  claimPending = false,
  onDisclaim,
  disclaimPending = false,
  highlightQuery,
}: {
  file: FileBlockData;
  projectRoot: string;
  /** A list filter's live query — marks the path where it matched. Absent for
   *  the live Changes list, which carries no filter. */
  highlightQuery?: string;
  /** The `+N −M` pair when known (live: from the eager entry diff; receipt:
   *  from the frozen record). Absent → no badges (binary, still loading). */
  counts: { added: number; removed: number } | null;
  /** What the row says about the file's hunk election ([P09], [P18]): a
   *  partial landing counts the elected hunks, a wholly-drifted one says so
   *  rather than reading as a whole landing. Absent → nothing to say. */
  election?: FileElectionBadge | null;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  popOut: DiffDescriptor | null;
  /** The expanded body. Rendered only while `expanded`. */
  body: React.ReactNode;
  /** When set, a Claim affordance leads the trailing cluster — the row's
   *  file is unattributed-but-likely and this session can claim it ([D1xx]). */
  onClaim?: () => void;
  /** A claim round trip is in flight — the affordance disables rather than
   *  re-sending, so a slow reply reads as "working", not as a dead button. */
  claimPending?: boolean;
  /** When set, a Disclaim affordance trails the cluster — the row's file is in
   *  this session's changeset and the session can renounce it. */
  onDisclaim?: () => void;
  /** A disclaim round trip is in flight — the affordance disables. */
  disclaimPending?: boolean;
}): React.ReactElement {
  return (
    <div
      className="tug-changes-list-file-block"
      data-testid="tug-changes-list-file-block"
      data-path={file.path}
      data-expanded={expanded ? "true" : undefined}
      data-partial={election?.kind === "partial" ? "true" : undefined}
      data-stale-election={election?.kind === "stale" ? "true" : undefined}
    >
      <div
        className="tug-changes-list-row-hit"
        onClick={() => onToggle(!expanded)}
      >
        <TugListRow
          variant="flush"
          density="compact"
          mono
          leading={<StatusMark gitStatus={file.git_status} />}
          trailing={
            <span
              className="tug-changes-list-row-trailing"
              onClick={(event) => event.stopPropagation()}
            >
              {counts !== null ? (
                <DiffSummaryBadges added={counts.added} removed={counts.removed} />
              ) : null}
              {popOut !== null ? (
                <PopOutDiffButton
                  descriptor={popOut}
                  label={`Open diff for ${file.path} in a card`}
                />
              ) : null}
              <BlockFoldCue
                collapsed={!expanded}
                onToggle={(nextCollapsed) => onToggle(!nextCollapsed)}
                collapsedLabel="Expand diff"
                ariaLabelExpand={`Show diff for ${file.path}`}
                ariaLabelCollapse={`Hide diff for ${file.path}`}
                size="2xs"
                subtype="icon"
                stabilizeScroll={false}
                data-slot="tug-changes-list-fold"
              />
              {onClaim !== undefined ? (
                <TugPushButton
                  className="tug-changes-list-claim"
                  subtype="icon"
                  icon={<CornerDownLeft size={12} />}
                  size="2xs"
                  emphasis="outlined"
                  role="accent"
                  disabled={claimPending}
                  title={
                    claimPending
                      ? "Claiming…"
                      : "Claim this file for this session"
                  }
                  aria-label={`Claim ${file.path} for this session`}
                  data-testid="tug-changes-list-claim"
                  onClick={(event) => {
                    event?.stopPropagation();
                    onClaim();
                  }}
                />
              ) : null}
              {onDisclaim !== undefined ? (
                <TugPushButton
                  className="tug-changes-list-disclaim"
                  subtype="icon"
                  icon={<CornerUpRight size={12} />}
                  size="2xs"
                  emphasis="outlined"
                  role="accent"
                  disabled={disclaimPending}
                  title={
                    disclaimPending
                      ? "Disclaiming…"
                      : "Disclaim this file from this session"
                  }
                  aria-label={`Disclaim ${file.path} from this session`}
                  data-testid="tug-changes-list-disclaim"
                  onClick={(event) => {
                    event?.stopPropagation();
                    onDisclaim();
                  }}
                />
              ) : null}
            </span>
          }
        >
          <FileIdentity
            file={file}
            projectRoot={projectRoot}
            highlightQuery={highlightQuery}
            election={election}
          />
        </TugListRow>
      </div>
      {expanded ? (
        <div className="tug-changes-list-file-diff" data-slot="tug-changes-list-file-diff">
          {body}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry file lists + host helpers
// ---------------------------------------------------------------------------

/** The file paths of an entry (host builds fold-all key sets). Every file is
 *  diffable — untracked files arrive as synthesized new-file diffs. */
export function diffablePathsOf(entry: TugChangesListEntry): string[] {
  const files: readonly { path: string }[] =
    entry.kind === "session" ? entry.entry.files : entry.files;
  return files.map((f) => f.path);
}

/** The controlled expand key for one file of one entry. */
export function fileExpandKey(entryId: string, path: string): string {
  return `${entryId}|${path}`;
}

/**
 * One entry's file list with per-file diff expansion (eager `git diff` on
 * mount for the `+N −M` badges). Collapse state is CONTROLLED from the host
 * (`expandedKeys`) so the fold-all / whole-diff controls live once in the
 * host's chrome and act across every entry; this only fetches + renders.
 */
function EntryFiles({
  entry,
  expandedKeys,
  onToggleFile,
  ownSessionId,
  onClaim,
  claimPending,
  onDisclaim,
  disclaimPending,
  hunkElection,
  onElectHunks,
}: {
  entry: TugChangesListEntry;
  expandedKeys: ReadonlySet<string>;
  onToggleFile: (entryId: string, path: string, collapsed: boolean) => void;
  /** The card session's id — distinguishes own vs foreign bracket hints ([P13]). */
  ownSessionId?: string;
  /** Per-path claim, wired only for the unattributed entry. */
  onClaim?: (path: string) => void;
  /** A claim round trip is in flight. */
  claimPending?: boolean;
  /** Per-path disclaim, wired only for the session entry. */
  onDisclaim?: (path: string) => void;
  /** A disclaim round trip is in flight. */
  disclaimPending?: boolean;
  /** The persisted per-path hunk election ([P09]). */
  hunkElection?: Readonly<Record<string, readonly string[]>>;
  /** Persist a path's election; `null` restores whole-file landing. */
  onElectHunks?: (path: string, ids: readonly string[] | null) => void;
}) {
  const projectRoot = entry.project.project_dir;
  const descriptor = useMemo(() => entryDiffDescriptor(entry), [entry]);
  const { snapshot: diffSnapshot, ensureRequested } = useEntryDiff(entry.id, descriptor);
  useEffect(() => {
    ensureRequested();
  }, [ensureRequested]);
  // Drop this entry's inline-diff store on unmount (targeted, so a sibling
  // card's stores are untouched).
  useEffect(() => () => releaseEntryDiffStore(entry.id), [entry.id]);

  const files =
    entry.kind === "session"
      ? entry.entry.files.map(changesetFileData)
      : entry.kind === "orphaned"
        ? entry.files.map(orphanedFileData)
        : entry.files.map((file) => unattributedFileData(file, ownSessionId));

  return (
    <div className="tug-changes-list-file-list" data-entry-kind={entry.kind}>
      {files.map((file) => {
        const diffFile = diffSnapshot.payload?.files.find((f) => f.path === file.path);
        const counts =
          diffFile !== undefined && !diffFile.binary
            ? { added: diffFile.added, removed: diffFile.removed }
            : null;
        const expanded = expandedKeys.has(fileExpandKey(entry.id, file.path));
        const election: HunkElection | undefined =
          onElectHunks !== undefined
            ? {
                elected: hunkElection?.[file.path] ?? null,
                onElect: (ids) => onElectHunks(file.path, ids),
              }
            : undefined;
        // The row says so when only part of the file lands, and says so
        // differently when the election has drifted out of the file entirely —
        // a landing that reads whole but isn't would be a resting lie either
        // way. The badge computes here rather than in the body because a
        // collapsed row has no body, and it reads the same rule the boxes do
        // ([P18]), so the two cannot disagree about the count.
        const badge = ((): FileElectionBadge | null => {
          const ids = diffFile?.hunks;
          if (ids === undefined || election === undefined) return null;
          const display = reconcileHunkElection(ids, election.elected);
          if (display.stale) return { kind: "stale" };
          if (display.partial === null) return null;
          return { kind: "partial", ...display.partial };
        })();
        return (
          <ChangesFileRow
            key={file.path}
            file={file}
            projectRoot={projectRoot}
            counts={counts}
            election={badge}
            expanded={expanded}
            onToggle={(next) => onToggleFile(entry.id, file.path, !next)}
            popOut={filePopOutDescriptor(entry.project, file.path)}
            body={expanded ? fileBlockBody(diffSnapshot, file.path, election) : null}
            onClaim={onClaim !== undefined ? () => onClaim(file.path) : undefined}
            claimPending={claimPending}
            onDisclaim={
              onDisclaim !== undefined ? () => onDisclaim(file.path) : undefined
            }
            disclaimPending={disclaimPending}
          />
        );
      })}
    </div>
  );
}

export interface TugChangesListProps {
  /** Head entries to render, in order: the session entry, then unattributed. */
  entries: ReadonlyArray<TugChangesListEntry>;
  /** The card session's id — distinguishes own vs foreign bracket hints on
   *  unattributed rows. */
  ownSessionId?: string;
  /** Controlled per-file expansion, keyed `${entryId}|${path}` (fileExpandKey). */
  expandedKeys: ReadonlySet<string>;
  onToggleFile: (entryId: string, path: string, collapsed: boolean) => void;
  /** Optional label rendered above the unattributed entry. */
  unattributedLabel?: string;
  /** When set, unattributed rows show a Claim affordance that promotes the
   *  path into this session's changeset ([D1xx]). */
  onClaimUnattributed?: (path: string) => void;
  /** When set (and the section has 1+ files), a "Claim all" button on the
   *  unattributed header claims every path in one batch. */
  onClaimAllUnattributed?: (paths: string[]) => void;
  /** Optional label rendered above the orphaned entry ([D120]). */
  orphanedLabel?: string;
  /** When set, orphaned rows show a Claim affordance that reclaims the path
   *  into this session, severing the dead originator ([D120]). */
  onClaimOrphaned?: (path: string) => void;
  /** When set (and the section has 1+ files), a "Claim all" button on the
   *  orphaned header reclaims every path in one batch ([D120]). */
  onClaimAllOrphaned?: (paths: string[]) => void;
  /** A claim round trip is in flight — every Claim affordance disables until
   *  the reply lands, so a slow or refused claim never invites a re-click. */
  claimPending?: boolean;
  /** Optional label rendered above the session entry. Present only when the
   *  section needs a header — which is what carries "Disclaim all". */
  sessionLabel?: string;
  /** When set, session-entry rows show a Disclaim affordance that removes the
   *  path from this session's changeset — claim's inverse. */
  onDisclaimFile?: (path: string) => void;
  /** When set (and the section has 1+ files), a "Disclaim all" button on the
   *  session header renounces every path in one request — claim-all's inverse. */
  onDisclaimAllFiles?: (paths: string[]) => void;
  /** A disclaim round trip is in flight — every Disclaim affordance disables
   *  until the reply lands. */
  disclaimPending?: boolean;
  /** The persisted per-path hunk election ([P09]) — a path absent from it
   *  lands whole. Read to check the boxes and mark partial rows. */
  hunkElection?: Readonly<Record<string, readonly string[]>>;
  /** When set, session-entry files with more than one hunk show a per-hunk
   *  election checkbox; `null` ids restore whole-file landing. */
  onElectHunks?: (path: string, ids: readonly string[] | null) => void;
  className?: string;
}

export function TugChangesList({
  entries,
  ownSessionId,
  expandedKeys,
  onToggleFile,
  unattributedLabel,
  onClaimUnattributed,
  onClaimAllUnattributed,
  orphanedLabel,
  onClaimOrphaned,
  onClaimAllOrphaned,
  claimPending,
  sessionLabel,
  onDisclaimFile,
  onDisclaimAllFiles,
  disclaimPending,
  hunkElection,
  onElectHunks,
  className,
}: TugChangesListProps): React.ReactElement {
  return (
    <div
      className={className !== undefined ? `tug-changes-list ${className}` : "tug-changes-list"}
      data-slot="tug-changes-list"
    >
      {entries.map((entry) => {
        const label =
          entry.kind === "unattributed"
            ? unattributedLabel
            : entry.kind === "orphaned"
              ? orphanedLabel
              : sessionLabel;
        const onClaim =
          entry.kind === "unattributed"
            ? onClaimUnattributed
            : entry.kind === "orphaned"
              ? onClaimOrphaned
              : undefined;
        const onClaimAll =
          entry.kind === "unattributed"
            ? onClaimAllUnattributed
            : entry.kind === "orphaned"
              ? onClaimAllOrphaned
              : undefined;
        const claimAllPaths = onClaimAll !== undefined ? diffablePathsOf(entry) : [];
        const onDisclaimAll = entry.kind === "session" ? onDisclaimAllFiles : undefined;
        const disclaimAllPaths =
          onDisclaimAll !== undefined ? diffablePathsOf(entry) : [];
        return (
          <React.Fragment key={entry.id}>
            {label !== undefined ? (
              <div
                className="tug-changes-list-section-label"
                data-slot={`tug-changes-list-${entry.kind}-label`}
              >
                <span className="tug-changes-list-section-label-text">{label}</span>
                {onClaimAll !== undefined && claimAllPaths.length >= 1 ? (
                  <TugPushButton
                    className="tug-changes-list-claim-all"
                    subtype="icon-text"
                    icon={<CornerDownLeft size={12} />}
                    size="2xs"
                    emphasis="outlined"
                    role="accent"
                    disabled={claimPending}
                    title={
                      claimPending ? "Claiming…" : "Claim all files in this session"
                    }
                    aria-label={`Claim all ${entry.kind} files in this session`}
                    data-testid={`tug-changes-list-claim-all-${entry.kind}`}
                    onClick={(event) => {
                      event?.stopPropagation();
                      onClaimAll(claimAllPaths);
                    }}
                  >
                    Claim all
                  </TugPushButton>
                ) : null}
                {onDisclaimAll !== undefined && disclaimAllPaths.length >= 1 ? (
                  <TugPushButton
                    className="tug-changes-list-disclaim-all"
                    subtype="icon-text"
                    icon={<CornerUpRight size={12} />}
                    size="2xs"
                    emphasis="outlined"
                    role="accent"
                    disabled={disclaimPending}
                    title={
                      disclaimPending
                        ? "Disclaiming…"
                        : "Disclaim all files from this session"
                    }
                    aria-label="Disclaim all files from this session"
                    data-testid="tug-changes-list-disclaim-all"
                    onClick={(event) => {
                      event?.stopPropagation();
                      onDisclaimAll(disclaimAllPaths);
                    }}
                  >
                    Disclaim all
                  </TugPushButton>
                ) : null}
              </div>
            ) : null}
            <EntryFiles
              entry={entry}
              expandedKeys={expandedKeys}
              onToggleFile={onToggleFile}
              ownSessionId={entry.kind === "unattributed" ? ownSessionId : undefined}
              onClaim={onClaim}
              claimPending={claimPending}
              onDisclaim={entry.kind === "session" ? onDisclaimFile : undefined}
              disclaimPending={disclaimPending}
              hunkElection={entry.kind === "session" ? hunkElection : undefined}
              onElectHunks={entry.kind === "session" ? onElectHunks : undefined}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit list — the `/commit` receipt's file rows ([P08])
// ---------------------------------------------------------------------------

/** One committed file frozen in a `/commit` receipt: path, git name-status
 *  word (`modified` | `created` | `deleted` | `renamed`), ± counts. */
export interface CommitChangesFile {
  path: string;
  status: string;
  added: number;
  removed: number;
}

/** Map a name-status word to a synthetic porcelain code the glyph / tone
 *  helpers key on. */
function commitStatusToGitCode(status: string): string {
  switch (status) {
    case "created":
      return "A ";
    case "deleted":
      return "D ";
    case "renamed":
      return "R ";
    default:
      return " M";
  }
}

/**
 * One receipt row's lazy commit diff: nothing is fetched until the row first
 * expands, then a per-row `GitDiffStore` runs the `commit` flavor scoped to
 * this path. The store is keyed by sha + path (commit diffs are immutable,
 * so a re-expand reuses the ready snapshot) and dropped on unmount.
 */
function CommitFileRow({
  root,
  sha,
  file,
  highlightQuery,
}: {
  root: string;
  sha: string;
  file: CommitChangesFile;
  highlightQuery?: string;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const storeId = `commit:${sha}:${file.path}`;
  const descriptor = useMemo<DiffDescriptor>(
    () => ({ kind: "commit", root, sha, paths: [file.path] }),
    [root, sha, file.path],
  );
  const { snapshot, ensureRequested } = useEntryDiff(storeId, descriptor);
  useEffect(() => {
    if (expanded) ensureRequested();
  }, [expanded, ensureRequested]);
  useEffect(() => () => releaseEntryDiffStore(storeId), [storeId]);

  const gitStatus = commitStatusToGitCode(file.status);
  return (
    <ChangesFileRow
      file={{
        path: file.path,
        git_status: gitStatus,
        // A committed file renders no op/origin provenance — the receipt
        // header already carries the commit identity.
        op: file.status === "deleted" ? "deleted" : "",
        origin: "",
        shared: false,
      }}
      projectRoot={root}
      counts={{ added: file.added, removed: file.removed }}
      expanded={expanded}
      onToggle={setExpanded}
      popOut={descriptor}
      body={expanded ? fileBlockBody(snapshot, file.path) : null}
      highlightQuery={highlightQuery}
    />
  );
}

/**
 * The committed files of one `/commit` receipt as the same rows as
 * {@link TugChangesList} — sha-backed instead of working-tree-backed
 * ([P08]). Counts render instantly from the frozen record; each row's diff
 * fetches lazily on first expand (a thousand-file commit costs nothing until
 * you look). A vanished sha (rebase, gc) degrades to an in-body notice while
 * the rows stay intact.
 */
export function CommitChangesList({
  root,
  sha,
  files,
  highlightQuery,
}: {
  /** The project dir the commit lives in (resolves the workspace). */
  root: string;
  /** The commit's full sha, parsed from the receipt record. */
  sha: string;
  files: readonly CommitChangesFile[];
  /** A list filter's live query — marks the paths it matched. The History
   *  filter matches on a commit's file roster, so an expanded row under a
   *  filter must show which of its files the query found. */
  highlightQuery?: string;
}): React.ReactElement {
  return (
    <div className="tug-changes-list-file-list" data-slot="tug-commit-changes-list">
      {files.map((file) => (
        <CommitFileRow
          key={file.path}
          root={root}
          sha={sha}
          file={file}
          highlightQuery={highlightQuery}
        />
      ))}
    </div>
  );
}
