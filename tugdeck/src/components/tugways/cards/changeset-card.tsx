/**
 * Changeset card — the workspace's dirty state grouped by owner.
 *
 * Renders the CHANGESET feed (0x23): a branch/ahead-behind/HEAD header (the
 * retired git card's data), one collapsible section per changeset — session
 * sections show the owner's display name and a live dot, dash sections show
 * base/rounds/worktree state — plus an unattributed section for dirty files
 * no owner claims. File rows carry a git-status glyph, op/origin provenance,
 * and ambiguous/shared badges. Read-only in this milestone: no selection,
 * no commit actions.
 *
 * Data arrives via `useCardData<ChangesetSnapshot>()` (FeedStore →
 * `useSyncExternalStore`, workspace-key filtered by the host). Sections are
 * a controlled `TugAccordion type="multiple"` — the accordion emits
 * `toggleSection` through the responder chain and the form binding captures
 * it into `useState`; sections a snapshot introduces open themselves once.
 * Read-only rows render no tabindex.
 *
 * Laws: [L02] external state via useSyncExternalStore, [L06] appearance via
 *       CSS, [L11] controls emit actions, [L20] composed children keep
 *       their own tokens.
 *
 * @module components/tugways/cards/changeset-card
 */

import "./changeset-card.css";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleCheck, GitBranch } from "lucide-react";

import { registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { useCardData } from "@/components/tugways/hooks/use-card-data";
import type {
  ChangesetEntry,
  ChangesetFile,
  ChangesetSnapshot,
} from "@/lib/changeset-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Section id for the accordion — owner ids are unique per snapshot. */
function sectionId(entry: ChangesetEntry): string {
  return `${entry.kind}:${entry.owner_id}`;
}

const UNATTRIBUTED_SECTION = "unattributed";

/** Tone class for a git-status glyph (first significant letter wins). */
function statusToneClass(gitStatus: string): string {
  if (gitStatus.startsWith("??")) return "changeset-status-untracked";
  const letter = gitStatus.replace(/[.\s]/g, "").charAt(0);
  switch (letter) {
    case "A":
      return "changeset-status-added";
    case "D":
      return "changeset-status-deleted";
    case "R":
      return "changeset-status-renamed";
    default:
      return "changeset-status-modified";
  }
}

/** Render the porcelain XY pair with dots shown as spaces (v1 style). */
function statusGlyph(gitStatus: string): string {
  return gitStatus.replace(/\./g, " ");
}

/**
 * Whether a file still exists on disk to open. A deleted file (op
 * `deleted`, or a `D` in either porcelain status axis) has no target, so
 * its path renders as plain text rather than a link.
 */
function isDeleted(op: string, gitStatus: string): boolean {
  return op === "deleted" || /D/.test(gitStatus);
}

/**
 * A repo-relative file path, rendered as an `open-file` link when the file
 * still exists. Absolute path = the snapshot's `workspace_key` (the repo
 * root) joined with the repo-relative path. Reuses the same dispatch +
 * focus discipline as `ToolFileRef`: a primary click opens the file in a
 * Text card without stealing first-responder from this read-only card; a
 * right-click offers Open in Editor / Show in Finder. Deleted files (and
 * the case where no workspace root is known) render inert.
 */
function FilePathLink({
  path,
  op,
  gitStatus,
  workspaceRoot,
}: {
  path: string;
  op: string;
  gitStatus: string;
  workspaceRoot: string;
}) {
  const absolutePath = workspaceRoot ? `${workspaceRoot}/${path}` : path;

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.shiftKey) return;
      dispatchAction({ action: TUG_ACTIONS.OPEN_FILE, path: absolutePath });
    },
    [absolutePath],
  );

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    // Suppress WebKit's mousedown focus default for the primary open
    // gesture so opening a file never pulls focus onto this read-only card
    // (the target Text card claims focus via its own activation path).
    if (event.button !== 0 || event.metaKey || event.shiftKey) return;
    event.preventDefault();
  }, []);

  if (isDeleted(op, gitStatus) || !workspaceRoot) {
    return (
      <span className="changeset-file-path" title={path}>
        {path}
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
        className="changeset-file-path changeset-file-path--link"
        data-slot="changeset-file-ref"
        title={path}
        data-tug-focus="refuse"
        data-no-activate=""
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      >
        {path}
      </span>
    </TugContextMenu>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function FileRow({ file, workspaceRoot }: { file: ChangesetFile; workspaceRoot: string }) {
  return (
    <div className="changeset-file-row" data-testid="changeset-file">
      <span className={`changeset-file-status ${statusToneClass(file.git_status)}`}>
        {statusGlyph(file.git_status)}
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        workspaceRoot={workspaceRoot}
      />
      {file.ambiguous && (
        <span className="changeset-badge changeset-badge-ambiguous">ambiguous</span>
      )}
      {file.shared && <span className="changeset-badge changeset-badge-shared">shared</span>}
      <span className="changeset-file-provenance">
        {file.origin === "dash" ? file.op : `${file.op} · ${file.origin}`}
      </span>
    </div>
  );
}

function SectionTrigger({ entry }: { entry: ChangesetEntry }) {
  if (entry.kind === "session") {
    return (
      <span className="changeset-section-trigger">
        <span
          className={`changeset-live-dot ${entry.live ? "changeset-live-dot-on" : ""}`}
          aria-hidden="true"
        />
        <span className="changeset-section-name">{entry.display_name}</span>
        <span className="changeset-section-detail">
          {entry.files.length} file{entry.files.length === 1 ? "" : "s"}
        </span>
      </span>
    );
  }
  return (
    <span className="changeset-section-trigger">
      <span className="changeset-dash-mark" aria-hidden="true">
        ⌁
      </span>
      <span className="changeset-section-name">{entry.display_name}</span>
      <span className="changeset-section-detail">
        {entry.base} · {entry.rounds} round{entry.rounds === 1 ? "" : "s"}
        {entry.worktree_dirty ? " · dirty worktree" : ""}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ChangesetCardContent
// ---------------------------------------------------------------------------

export function ChangesetCardContent() {
  const data = useCardData<ChangesetSnapshot>();

  // Controlled accordion ([L11]): the control dispatches toggleSection; the
  // form binding lands it in state. Sections open themselves the first time
  // a snapshot introduces them (tracked by id, so a user's collapse sticks
  // across recomputes).
  const accordionSenderId = useId();
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const { ResponderScope: AccordionScope, responderRef: accordionRef } = useResponderForm({
    toggleSectionMulti: {
      [accordionSenderId]: (v: string[]) => setOpenKeys(v),
    },
  });

  const sectionIds = useMemo(() => {
    if (!data) return [] as string[];
    const ids = data.changesets.map(sectionId);
    if (data.unattributed.length > 0) ids.push(UNATTRIBUTED_SECTION);
    return ids;
  }, [data]);

  const seenSectionsRef = useRef<Set<string>>(new Set());
  const openNewSections = useCallback((ids: string[]) => {
    const fresh = ids.filter((id) => !seenSectionsRef.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seenSectionsRef.current.add(id));
    setOpenKeys((prev) => [...prev, ...fresh]);
  }, []);
  useEffect(() => {
    openNewSections(sectionIds);
  }, [sectionIds, openNewSections]);

  if (!data) {
    return (
      <div data-slot="changeset-card" className="changeset-card changeset-card-waiting">
        Waiting for changeset…
      </div>
    );
  }

  const hasChanges = data.changesets.length > 0 || data.unattributed.length > 0;

  return (
    <div data-slot="changeset-card" className="changeset-card">
      <div className="changeset-header">
        <div className="changeset-branch-row">
          <GitBranch size={16} className="changeset-branch-icon" />
          <span className="changeset-branch-name">{data.branch}</span>
          {data.ahead > 0 && <span className="changeset-ahead-behind">↑{data.ahead}</span>}
          {data.behind > 0 && <span className="changeset-ahead-behind">↓{data.behind}</span>}
        </div>
        {data.head_message && (
          <div className="changeset-head-message" title={data.head_sha}>
            {data.head_message}
          </div>
        )}
      </div>

      {hasChanges ? (
        <AccordionScope>
          <div ref={accordionRef as (el: HTMLDivElement | null) => void}>
            <TugAccordion
              type="multiple"
              variant="separator"
              value={openKeys}
              senderId={accordionSenderId}
              className="changeset-sections"
            >
              {data.changesets.map((entry) => (
                <TugAccordionItem
                  key={sectionId(entry)}
                  value={sectionId(entry)}
                  trigger={<SectionTrigger entry={entry} />}
                  data-testid={`changeset-${entry.kind}`}
                >
                  <div className="changeset-file-list">
                    {entry.files.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        workspaceRoot={data.workspace_key}
                      />
                    ))}
                  </div>
                </TugAccordionItem>
              ))}
              {data.unattributed.length > 0 && (
                <TugAccordionItem
                  value={UNATTRIBUTED_SECTION}
                  trigger={
                    <span className="changeset-section-trigger">
                      <span className="changeset-section-name changeset-section-name-muted">
                        Unattributed
                      </span>
                      <span className="changeset-section-detail">
                        {data.unattributed.length} file
                        {data.unattributed.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  }
                  data-testid="changeset-unattributed"
                >
                  <div className="changeset-file-list">
                    {data.unattributed.map((file) => (
                      <div
                        className="changeset-file-row"
                        data-testid="changeset-file"
                        key={file.path}
                      >
                        <span
                          className={`changeset-file-status ${statusToneClass(file.git_status)}`}
                        >
                          {statusGlyph(file.git_status)}
                        </span>
                        <FilePathLink
                          path={file.path}
                          op=""
                          gitStatus={file.git_status}
                          workspaceRoot={data.workspace_key}
                        />
                      </div>
                    ))}
                  </div>
                </TugAccordionItem>
              )}
            </TugAccordion>
          </div>
        </AccordionScope>
      ) : (
        <div className="changeset-clean" role="status">
          <CircleCheck size={14} />
          Clean working tree
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerChangesetCard
// ---------------------------------------------------------------------------

/**
 * Register the Changeset card in the global card registry. Call from
 * `main.tsx` before any `DeckManager.addCard("changeset")`.
 */
export function registerChangesetCard(): void {
  registerCard({
    componentId: "changeset",
    contentFactory: () => <ChangesetCardContent />,
    defaultMeta: { title: "Changeset", icon: "GitBranch", closable: true },
    defaultFeedIds: [FeedId.CHANGESET],
    sizePolicy: {
      min: { width: 280, height: 200 },
      preferred: { width: 650, height: 350 },
    },
  });
}
