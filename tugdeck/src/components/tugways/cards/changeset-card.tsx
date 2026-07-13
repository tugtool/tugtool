/**
 * Changeset card — the account-global view of every open project's dirty
 * state, grouped project → owner → files.
 *
 * Renders the aggregate CHANGESET_ALL feed (0x24): one collapsible section
 * per open project (display name + branch/ahead-behind + HEAD subject), each
 * containing that project's owner groups (session sections with a live dot,
 * dash sections with base/rounds/worktree state) and an unattributed group,
 * or — for a non-git directory — a "Not a git repository" state with an
 * "Initialize git" affordance. File rows carry a git-status glyph, op/origin
 * provenance, and ambiguous/shared badges. Read-only rows render no tabindex.
 *
 * Data arrives via `useChangesetAll()` — an app-level singleton store
 * (`FeedStore` over CHANGESET_ALL, no workspace filter), NOT `useCardData`:
 * the aggregate frame is account-global and `FeedStore` holds one value per
 * feed id, so aggregation is server-side. Clickable links use each project's
 * own `project_dir` as the absolute-path base.
 *
 * Project sections are a controlled `TugAccordion type="multiple"`; owner and
 * unattributed groups render statically inside an expanded project (one level
 * of collapse — the project). Sections a snapshot introduces open themselves
 * once, so a user's collapse sticks across recomputes.
 *
 * Laws: [L02] external state via useSyncExternalStore, [L06] appearance via
 *       CSS, [L11] controls emit actions, [L20] composed children keep
 *       their own tokens.
 *
 * @module components/tugways/cards/changeset-card
 */

import "./changeset-card.css";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleCheck, GitBranch, FolderGit2 } from "lucide-react";

import { registerCard } from "@/card-registry";
import { dispatchAction } from "@/action-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugContextMenu } from "@/components/tugways/tug-context-menu";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { useChangesetAll } from "@/lib/changeset-all-store";
import { useChangesetGitInit } from "@/lib/changeset-verb-store";
import type {
  ChangesetEntry,
  ChangesetFile,
  ProjectChangeset,
} from "@/lib/changeset-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Section id for a project — its dir is unique across open projects. */
function projectSectionId(project: ProjectChangeset): string {
  return `project:${project.project_dir}`;
}

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
  return gitStatus.replace(/\./g, " ");
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
 * still exists. Absolute path = the project's `project_dir` (the checkout
 * root) joined with the repo-relative path. Reuses the same dispatch + focus
 * discipline as `ToolFileRef`: a primary click opens the file in a Text card
 * without stealing first-responder from this read-only card; a right-click
 * offers Open in Editor / Show in Finder. Deleted files (and the case where
 * no project root is known) render inert.
 */
function FilePathLink({
  path,
  op,
  gitStatus,
  projectRoot,
}: {
  path: string;
  op: string;
  gitStatus: string;
  projectRoot: string;
}) {
  const absolutePath = projectRoot ? `${projectRoot}/${path}` : path;

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

  if (isDeleted(op, gitStatus) || !projectRoot) {
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
// Rows and groups
// ---------------------------------------------------------------------------

function FileRow({ file, projectRoot }: { file: ChangesetFile; projectRoot: string }) {
  return (
    <div className="changeset-file-row" data-testid="changeset-file">
      <span className={`changeset-file-status ${statusToneClass(file.git_status)}`}>
        {statusGlyph(file.git_status)}
      </span>
      <FilePathLink
        path={file.path}
        op={file.op}
        gitStatus={file.git_status}
        projectRoot={projectRoot}
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

/** A static owner-group header + its file list, shown inside an expanded project. */
function OwnerGroup({ entry, projectRoot }: { entry: ChangesetEntry; projectRoot: string }) {
  return (
    <div className="changeset-owner-group" data-testid={`changeset-${entry.kind}`}>
      {entry.kind === "session" ? (
        <div className="changeset-owner-header">
          <span
            className={`changeset-live-dot ${entry.live ? "changeset-live-dot-on" : ""}`}
            aria-hidden="true"
          />
          <span className="changeset-section-name">{entry.display_name}</span>
          <span className="changeset-section-detail">
            {entry.files.length} file{entry.files.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : (
        <div className="changeset-owner-header">
          <span className="changeset-dash-mark" aria-hidden="true">
            ⌁
          </span>
          <span className="changeset-section-name">{entry.display_name}</span>
          <span className="changeset-section-detail">
            {entry.base} · {entry.rounds} round{entry.rounds === 1 ? "" : "s"}
            {entry.worktree_dirty ? " · dirty worktree" : ""}
          </span>
        </div>
      )}
      <div className="changeset-file-list">
        {entry.files.map((file) => (
          <FileRow key={file.path} file={file} projectRoot={projectRoot} />
        ))}
      </div>
    </div>
  );
}

/** The collapsed trigger for one project. */
function ProjectTrigger({ project }: { project: ProjectChangeset }) {
  return (
    <span className="changeset-project-trigger">
      <FolderGit2 size={14} className="changeset-project-icon" aria-hidden="true" />
      <span className="changeset-project-name">{project.display_name}</span>
      {project.no_repo ? (
        <span className="changeset-project-detail changeset-project-detail-muted">
          not a git repository
        </span>
      ) : (
        <span className="changeset-project-detail">
          <GitBranch size={12} className="changeset-branch-icon" aria-hidden="true" />
          {project.branch}
          {project.ahead > 0 && <span className="changeset-ahead-behind">↑{project.ahead}</span>}
          {project.behind > 0 && <span className="changeset-ahead-behind">↓{project.behind}</span>}
        </span>
      )}
    </span>
  );
}

/** The body of one project section — repo changes, clean state, or non-repo Init. */
function ProjectBody({ project }: { project: ProjectChangeset }) {
  const { phase, error, init } = useChangesetGitInit(project.project_dir);

  if (project.no_repo) {
    return (
      <div className="changeset-non-repo" role="group" data-testid="changeset-non-repo">
        <div className="changeset-non-repo-message">
          This directory is not a git repository.
        </div>
        <TugPushButton
          emphasis="outlined"
          role="accent"
          onClick={init}
          disabled={phase === "pending"}
          data-testid="changeset-git-init"
        >
          Initialize git
        </TugPushButton>
        {error !== null && (
          <div className="changeset-non-repo-error" role="alert">
            {error}
          </div>
        )}
      </div>
    );
  }

  const hasChanges = project.changesets.length > 0 || project.unattributed.length > 0;
  if (!hasChanges) {
    return (
      <div className="changeset-clean" role="status">
        <CircleCheck size={14} />
        Clean working tree
      </div>
    );
  }

  return (
    <div className="changeset-project-body">
      {project.head_message && (
        <div className="changeset-head-message" title={project.head_sha}>
          {project.head_message}
        </div>
      )}
      {project.changesets.map((entry) => (
        <OwnerGroup
          key={`${entry.kind}:${entry.owner_id}`}
          entry={entry}
          projectRoot={project.project_dir}
        />
      ))}
      {project.unattributed.length > 0 && (
        <div className="changeset-owner-group" data-testid="changeset-unattributed">
          <div className="changeset-owner-header">
            <span className="changeset-section-name changeset-section-name-muted">
              Unattributed
            </span>
            <span className="changeset-section-detail">
              {project.unattributed.length} file
              {project.unattributed.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="changeset-file-list">
            {project.unattributed.map((file) => (
              <div className="changeset-file-row" data-testid="changeset-file" key={file.path}>
                <span className={`changeset-file-status ${statusToneClass(file.git_status)}`}>
                  {statusGlyph(file.git_status)}
                </span>
                <FilePathLink
                  path={file.path}
                  op=""
                  gitStatus={file.git_status}
                  projectRoot={project.project_dir}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Total changed files across a project's owners + unattributed bucket. */
function countChanges(project: ProjectChangeset): number {
  const owned = project.changesets.reduce((n, entry) => n + entry.files.length, 0);
  return owned + project.unattributed.length;
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

/**
 * One thin table-of-contents row per tracked project — always visible above
 * the accordions so opening one project never loses the others. Clicking a row
 * reveals that project's accordion (expands it and scrolls it into view). The
 * caret reflects the accordion's open state so the TOC doubles as an overview
 * of what's expanded. Read-only-card focus discipline: refuses first-responder
 * so a click toggles without stealing the key view (mirrors `FilePathLink`).
 */
function TocEntry({
  project,
  open,
  onReveal,
}: {
  project: ProjectChangeset;
  open: boolean;
  onReveal: () => void;
}) {
  const changes = countChanges(project);
  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button === 0) event.preventDefault();
  }, []);
  const detail = project.no_repo
    ? "no git"
    : changes > 0
      ? `${changes} change${changes === 1 ? "" : "s"}`
      : "clean";
  return (
    <div
      className={`changeset-toc-entry${open ? " changeset-toc-entry-open" : ""}`}
      role="button"
      data-testid="changeset-toc-entry"
      data-tug-focus="refuse"
      data-no-activate=""
      title={project.project_dir}
      onMouseDown={handleMouseDown}
      onClick={onReveal}
    >
      <span
        className={`changeset-toc-caret${open ? " changeset-toc-caret-open" : ""}`}
        aria-hidden="true"
      >
        ▸
      </span>
      <span className="changeset-toc-name">{project.display_name}</span>
      <span className="changeset-toc-detail">{detail}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChangesetCardContent
// ---------------------------------------------------------------------------

export function ChangesetCardContent() {
  const data = useChangesetAll();
  const projects = data.projects;
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Controlled accordion ([L11]): the control dispatches toggleSection; the
  // form binding lands it in state. Projects open themselves the first time
  // a snapshot introduces them (tracked by id, so a user's collapse sticks
  // across recomputes).
  const accordionSenderId = useId();
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const { ResponderScope: AccordionScope, responderRef: accordionRef } = useResponderForm({
    toggleSectionMulti: {
      [accordionSenderId]: (v: string[]) => setOpenKeys(v),
    },
  });

  const sectionIds = useMemo(() => projects.map(projectSectionId), [projects]);

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

  // TOC reveal: after the expand commits, scroll the revealed project's
  // accordion into view. Scrolls the accordion body (not the whole card), so
  // the fixed TOC + toolbar stay put. Appearance-only DOM op ([L06]).
  const pendingRevealRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingRevealRef.current === null) return;
    const idx = pendingRevealRef.current;
    pendingRevealRef.current = null;
    const el = cardRef.current?.querySelector(`[data-project-index="${idx}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openKeys]);

  const expandAll = useCallback(() => {
    sectionIds.forEach((id) => seenSectionsRef.current.add(id));
    setOpenKeys(sectionIds);
  }, [sectionIds]);
  const collapseAll = useCallback(() => setOpenKeys([]), []);

  const revealProject = useCallback((project: ProjectChangeset, index: number) => {
    const id = projectSectionId(project);
    seenSectionsRef.current.add(id);
    pendingRevealRef.current = index;
    // Adding when absent, or a fresh array when already open, so the reveal
    // effect (keyed on `openKeys` identity) always fires and re-scrolls.
    setOpenKeys((prev) => (prev.includes(id) ? [...prev] : [...prev, id]));
  }, []);

  if (projects.length === 0) {
    return (
      <div data-slot="changeset-card" className="changeset-card changeset-card-empty">
        No open projects
      </div>
    );
  }

  const openSet = new Set(openKeys);

  return (
    <div ref={cardRef} data-slot="changeset-card" className="changeset-card">
      <div className="changeset-head">
        <div className="changeset-toolbar">
          <span className="changeset-toolbar-title">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
          <span className="changeset-toolbar-spacer" />
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="2xs"
            onClick={expandAll}
            data-testid="changeset-expand-all"
          >
            Expand all
          </TugPushButton>
          <TugPushButton
            emphasis="ghost"
            role="action"
            size="2xs"
            onClick={collapseAll}
            data-testid="changeset-collapse-all"
          >
            Collapse all
          </TugPushButton>
        </div>
        <div className="changeset-toc" role="list">
          {projects.map((project, i) => (
            <TocEntry
              key={projectSectionId(project)}
              project={project}
              open={openSet.has(projectSectionId(project))}
              onReveal={() => revealProject(project, i)}
            />
          ))}
        </div>
      </div>
      <AccordionScope>
        <div
          ref={accordionRef as (el: HTMLDivElement | null) => void}
          className="changeset-scroll"
        >
          <TugAccordion
            type="multiple"
            variant="separator"
            value={openKeys}
            senderId={accordionSenderId}
            className="changeset-sections"
          >
            {projects.map((project, i) => (
              <TugAccordionItem
                key={projectSectionId(project)}
                value={projectSectionId(project)}
                trigger={<ProjectTrigger project={project} />}
                data-testid="changeset-project"
                data-project-index={i}
              >
                <ProjectBody project={project} />
              </TugAccordionItem>
            ))}
          </TugAccordion>
        </div>
      </AccordionScope>
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
    // No per-card feed: the card reads the account-global aggregate via the
    // app-level `useChangesetAll` singleton, not `useCardData`. Declaring
    // CHANGESET_ALL here would route it through the host's per-card,
    // workspace-key-filtered FeedStore — which drops the aggregate frame (it
    // carries no top-level workspace_key), so the host's `feedsReady` gate
    // would hang on "Loading..." forever. An empty list makes the card ready
    // immediately; the singleton store handles delivery.
    cardFeedIds: [],
    sizePolicy: {
      min: { width: 280, height: 200 },
      preferred: { width: 650, height: 350 },
    },
  });
}
