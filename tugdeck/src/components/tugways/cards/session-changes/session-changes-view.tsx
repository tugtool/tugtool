/**
 * `SessionChangesView` — the read-only changes glance ([P02]). Rides the
 * bottom-anchored passive TugSheet `shade` over the live transcript and shows
 * the card's changed files: the session's attributed files plus the project's
 * unattributed files, per-file inline diffs, and the non-repo git-init
 * affordance. It answers "what's changed?" — glanceable, dismiss-and-forget.
 *
 * The sheet is passive ([P17]): the composer below keeps focus (⌃⌘C is the
 * toggle; landing a commit lives in the composer's commit mode + Z5), so
 * the view carries no Done button, no header X, and seeds no key view. The
 * file rows are `TugChangesList` ([P01]); the header keeps only its fold-all
 * cue + whole-diff pop-out, and the git-init affordance sits in the body.
 *
 * Above the file list sits the **session diff document** — this session's
 * attributed changes as one long-scrolling `TugDiffDocument`, collapsed by
 * default. Its descriptor's pathspec is the session entry's own file list, so
 * it is session-confined by construction and stays so live (a claim/disclaim
 * recomposes the snapshot, which re-scopes the document). The repo-wide view
 * is a different surface entirely: the Project Diff card (`/diff`).
 *
 * Laws: [L02] the controller + git-init verb store enter React through
 * `useSyncExternalStore`; [L06] no appearance state in React (status tones and
 * hover affordances paint via CSS); [L26] per-file diff bodies collapse by
 * unmount inside `TugChangesList`'s rows.
 *
 * @module components/tugways/cards/session-changes/session-changes-view
 */

import "./session-changes-view.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { GitCommitHorizontal, LoaderCircle } from "lucide-react";

import { TugNonRepoNotice } from "@/components/tugways/tug-non-repo-notice";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { TugDiffDocument } from "@/components/tugways/tug-diff-document";
import {
  TugChangesList,
  PopOutDiffButton,
  diffablePathsOf,
  fileExpandKey,
  type TugChangesListEntry,
} from "@/components/tugways/tug-changes-list";
import {
  diffDescriptorKey,
  type DiffDescriptor,
  type GitDiffPayload,
  type GitDiffSnapshot,
  type GitDiffStore,
} from "@/lib/git-diff-store";
import { useChangesetClaim, useChangesetDisclaim } from "@/lib/changeset-verb-store";
import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Session diff document — the whole-session diff as one long document
// ---------------------------------------------------------------------------

const DIFF_IDLE_SNAPSHOT: GitDiffSnapshot = {
  phase: "idle",
  requestId: null,
  payload: null,
  error: null,
};

const DIFF_NOOP_SUBSCRIBE = (): (() => void) => () => {};

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
  /**
   * The card's single-shot `git_diff_request` store, workspace-filtered to
   * this card's project ([D21]) — sources the session diff document. `null`
   * (no connection — gallery/fixtures) renders the document affordance inert.
   */
  gitDiffStore: GitDiffStore | null;
}

export function SessionChangesView({
  projectDir,
  changesController,
  codeSessionStore,
  gitDiffStore,
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

  // The claim round trip's state ([L02]). The failure detail is surfaced by
  // the card's `ClaimErrorNoticeController` (a bulletin, not view chrome); the
  // view reads it only to hold the Claim affordances while one is in flight.
  const claim = useChangesetClaim(changesController.entryKey);
  const claimPending = claim.phase === "pending";
  // Claim's inverse, read the same way and for the same reason.
  const disclaim = useChangesetDisclaim(changesController.entryKey);
  const disclaimPending = disclaim.phase === "pending";

  const sessionFiles = snap.entry?.files ?? [];

  // The session diff document: this session's attributed changes as ONE
  // long-scrolling document above the file list — collapsed by default, a
  // review surface rather than commit chrome. Session-confined by
  // construction: the descriptor's pathspec is the entry's own file list, the
  // same snapshot the rows below render, so the document and the list cannot
  // disagree about what belongs to the session.
  const [docExpanded, setDocExpanded] = useState(false);
  const sessionPathsKey = sessionFiles.map((f) => f.path).join("\n");
  const docDescriptor: DiffDescriptor | null = useMemo(
    () =>
      sessionPathsKey.length > 0 && !project.no_repo
        ? {
            kind: "head",
            root: project.project_dir,
            paths: sessionPathsKey.split("\n"),
          }
        : null,
    [sessionPathsKey, project.no_repo, project.project_dir],
  );
  // Fetch on expand, and again when the attributed set moves while expanded
  // (a claim/disclaim recomposes the snapshot → a new descriptor key). The
  // ref guards the effect's over-firing; the store keeps the last payload
  // through a refetch so an open document never blanks ([L23]).
  const docRequestedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!docExpanded || docDescriptor === null || gitDiffStore === null) return;
    const key = diffDescriptorKey(docDescriptor);
    if (docRequestedKeyRef.current === key) return;
    docRequestedKeyRef.current = key;
    gitDiffStore.requestDiff(docDescriptor);
  }, [docExpanded, docDescriptor, gitDiffStore]);
  const docSnapshot = useSyncExternalStore(
    gitDiffStore?.subscribe ?? DIFF_NOOP_SUBSCRIBE,
    gitDiffStore?.getSnapshot ?? (() => DIFF_IDLE_SNAPSHOT),
  );
  // The rendered payload, held to the CURRENT session paths: a payload that
  // resolved just before a disclaim recomposed the entry would otherwise show
  // a file the list below no longer claims. Totals recompute from the kept
  // files so the document header and its rows agree.
  const docPayload: GitDiffPayload | null = useMemo(() => {
    const payload = docSnapshot.payload;
    if (payload === null || sessionPathsKey.length === 0) return null;
    const pathSet = new Set(sessionPathsKey.split("\n"));
    const files = payload.files.filter((file) => pathSet.has(file.path));
    return {
      ...payload,
      files,
      file_count: files.length,
      total_added: files.reduce((n, file) => n + file.added, 0),
      total_removed: files.reduce((n, file) => n + file.removed, 0),
    };
  }, [docSnapshot, sessionPathsKey]);

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
  // dismissed by ⌃⌘C (the composer keeps focus).
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
      <TugNonRepoNotice
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
  const orphanedItem: TugChangesListEntry | null =
    snap.orphaned.length > 0
      ? {
          kind: "orphaned",
          id: `orphaned:${project.project_dir}`,
          project,
          files: snap.orphaned,
        }
      : null;
  const hasSessionFiles = sessionFiles.length > 0;
  const isEmpty =
    !hasSessionFiles && unattributedItem === null && orphanedItem === null;
  // An empty view is only a verified all-clear once the aggregate has actually
  // composed this workspace ([P02]). Before the first emit `project` is the
  // pre-scan placeholder, so an empty-and-uncomposed view says "scanning"
  // rather than a false "No changes" green.
  const isCleanAllClear = isEmpty && snap.composed;
  const isAwaitingScan = isEmpty && !snap.composed;

  // The head entries (session + unattributed) the banner controls act on.
  // Every diffable file across them yields one expand key; the whole-view Diff
  // pop-out is a `head` diff over their union of paths.
  const headEntries: TugChangesListEntry[] = [
    ...(sessionItem !== null && hasSessionFiles ? [sessionItem] : []),
    ...(unattributedItem !== null ? [unattributedItem] : []),
    ...(orphanedItem !== null ? [orphanedItem] : []),
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
      {isCleanAllClear ? (
        <div className="session-changes-clean" role="status">
          None
        </div>
      ) : null}
      {isAwaitingScan ? (
        <div
          className="session-changes-scanning"
          role="status"
          data-testid="session-changes-scanning"
        >
          <LoaderCircle size={14} className="session-changes-scanning-spin" />
          Waiting for project scan…
        </div>
      ) : null}
      {snap.ledgerDegraded ? (
        <div
          className="session-changes-scanning"
          role="alert"
          data-testid="session-changes-ledger-degraded"
        >
          Attribution ledger damaged — claims are unavailable, not empty.
          Restart Tug to rebuild it.
        </div>
      ) : null}
      {docDescriptor !== null && gitDiffStore !== null ? (
        <div
          className="session-changes-doc"
          data-slot="session-changes-doc"
          data-expanded={docExpanded ? "true" : undefined}
        >
          {/* The toggle row reads like the list's section labels; the whole
              row is the fold's click target, the cue owns its own gesture. */}
          <div
            className="session-changes-doc-toggle"
            onClick={() => setDocExpanded((prev) => !prev)}
          >
            <span className="session-changes-doc-label">session diff</span>
            <span onClick={(event) => event.stopPropagation()}>
              <BlockFoldCue
                collapsed={!docExpanded}
                onToggle={(nextCollapsed) => setDocExpanded(!nextCollapsed)}
                collapsedLabel="Show the session diff"
                expandedLabel="Hide the session diff"
                ariaLabelExpand="Show this session's changes as one diff"
                ariaLabelCollapse="Hide the session diff"
                size="2xs"
                subtype="icon"
                stabilizeScroll={false}
                data-slot="session-changes-doc-fold"
              />
            </span>
          </div>
          {docExpanded ? (
            docPayload !== null && docPayload.files.length > 0 ? (
              <TugDiffDocument
                payload={docPayload}
                label="This session's changes (git diff HEAD)"
                className="session-changes-doc-document"
              />
            ) : (
              <p className="session-changes-doc-notice" role="status">
                {docSnapshot.phase === "error"
                  ? (docSnapshot.error ?? "Couldn't load the diff.")
                  : "Loading diff…"}
              </p>
            )
          ) : null}
        </div>
      ) : null}
      {headEntries.length > 0 ? (
        <TugChangesList
          entries={headEntries}
          ownSessionId={changesController.tugSessionId}
          expandedKeys={expandedKeys}
          onToggleFile={onToggleFile}
          unattributedLabel={
            snap.ledgerDegraded
              ? "unattributed — ledger damaged, claims unavailable"
              : "unattributed — no session claims these"
          }
          onClaimUnattributed={(path) => changesController.claim([path])}
          onClaimAllUnattributed={(paths) => changesController.claim(paths)}
          orphanedLabel="orphaned — claim to bring into this session"
          onClaimOrphaned={(path) => changesController.claim([path])}
          onClaimAllOrphaned={(paths) => changesController.claim(paths)}
          claimPending={claimPending}
          sessionLabel="this session's changes"
          onDisclaimFile={(path) => changesController.disclaim([path])}
          onDisclaimAllFiles={(paths) => changesController.disclaim(paths)}
          disclaimPending={disclaimPending}
          hunkElection={changesController.hunkElection()}
          onElectHunks={(path, ids) => changesController.electHunks(path, ids)}
        />
      ) : null}
    </div>,
    headerActions,
  );
}
