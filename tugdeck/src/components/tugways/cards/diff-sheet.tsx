/**
 * diff-sheet.tsx — the `/diff` uncommitted-changes sheet ([#step-10b]).
 *
 * `/diff` shows `git diff HEAD` for the card's project dir as a single
 * card-scoped overlay ([D15]). Unlike Claude Code's terminal pager (a flat
 * file list you arrow through, Enter to open one file full-screen), the
 * Tug-native shape is one **`TugAccordion type="multiple"`** with an item per
 * changed file: the collapsed trigger shows the path + `+N −M`, and the body
 * renders that file's hunks via the shared {@link DiffBlock} (`suppressHeader`
 * — the trigger owns identity). All files can be open at once, so there's no
 * select-then-view round trip.
 *
 * Sourcing is single-shot, not a feed ([D21]): {@link useDiffSheet} fires a
 * `git_diff_request` for the project dir on open (and on the in-sheet refresh)
 * via {@link GitDiffStore}, and the body renders the matching response read
 * through `useSyncExternalStore` ([L02]). The header mirrors Claude Code's
 * "Uncommitted changes (git diff HEAD)" / "N files changed +X −Y".
 *
 * Compositional — composes `TugSheet` (via the card's shared `showSheet`),
 * `TugAccordion`, `DiffBlock`, `TugPushButton`, `TugLabel`; composed children
 * keep their own tokens ([L20]).
 *
 * Laws: [L02] store reads via `useSyncExternalStore`, [L06] appearance via
 *       CSS, [L20] composed children keep tokens.
 * Decisions: [D15] pane sheets are overlays, [D21] `/diff` dedicated command.
 *
 * @module components/tugways/cards/diff-sheet
 */

import "./diff-sheet.css";

import React, { useCallback, useMemo, useSyncExternalStore } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import {
  type GitDiffFile,
  type GitDiffStore,
  diffStatusLabel,
  diffStatusLetter,
  diffSummaryLine,
  fileStatLabel,
} from "@/lib/git-diff-store";

// ---------------------------------------------------------------------------
// useDiffSheet — the card-hosted /diff sheet
// ---------------------------------------------------------------------------

export interface UseDiffSheetArgs {
  /** Store that fires `git_diff_request` and resolves the single-shot reply. */
  gitDiffStore: GitDiffStore;
  /** The card's shared sheet host (`useTugSheet().showSheet`). */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

export interface DiffSheetController {
  /** Present the `/diff` sheet, firing a fresh request for this project. */
  openDiffSheet: () => void;
}

export function useDiffSheet({
  gitDiffStore,
  showSheet,
}: UseDiffSheetArgs): DiffSheetController {
  const openDiffSheet = useCallback(() => {
    // Fire the request as the sheet opens so the diff is in flight before the
    // body mounts; the body reads the result reactively.
    gitDiffStore.requestDiff();
    void showSheet({
      title: "Diff",
      displayWidth: "document",
      content: (close) => (
        <DiffSheetBody gitDiffStore={gitDiffStore} onClose={close} />
      ),
    });
  }, [gitDiffStore, showSheet]);

  return { openDiffSheet };
}

// ---------------------------------------------------------------------------
// File row — one accordion item: trigger (status + path + stat) over hunks
// ---------------------------------------------------------------------------

/** Accordion item key — the (unique) destination path of each changed file. */
function fileKey(file: GitDiffFile): string {
  return file.path;
}

/** The collapsed trigger: status letter, path (rename shows old → new), stat. */
function FileTrigger({ file }: { file: GitDiffFile }): React.ReactElement {
  const pathLabel =
    file.status === "renamed" && file.old_path !== undefined
      ? `${file.old_path} → ${file.path}`
      : file.path;
  return (
    <span className="diff-sheet-file-trigger">
      <span
        className="diff-sheet-file-status"
        data-status={file.status}
        aria-label={diffStatusLabel(file.status)}
        title={diffStatusLabel(file.status)}
      >
        {diffStatusLetter(file.status)}
      </span>
      <span className="diff-sheet-file-path" title={pathLabel}>
        {pathLabel}
      </span>
      <span className="diff-sheet-file-stat" aria-label={fileStatLabel(file)}>
        {file.binary ? (
          <span className="diff-sheet-stat-binary">binary</span>
        ) : (
          <>
            <span className="diff-sheet-stat-add">+{file.added}</span>
            <span className="diff-sheet-stat-remove">−{file.removed}</span>
          </>
        )}
      </span>
    </span>
  );
}

/** The expanded body: hunks via DiffBlock, or a note for binary files. */
function FileBody({ file }: { file: GitDiffFile }): React.ReactElement {
  if (file.binary) {
    return (
      <p className="diff-sheet-binary-note" role="note">
        Binary file — no textual diff.
      </p>
    );
  }
  return (
    <DiffBlock
      data={{ source: "unified", text: file.unified, filePath: file.path }}
      suppressHeader
      className="diff-sheet-file-diff"
    />
  );
}

// ---------------------------------------------------------------------------
// Sheet body — header summary + refresh + the per-file accordion
// ---------------------------------------------------------------------------

interface DiffSheetBodyProps {
  gitDiffStore: GitDiffStore;
  onClose: (value?: string) => void;
}

function DiffSheetBody({
  gitDiffStore,
  onClose,
}: DiffSheetBodyProps): React.ReactElement {
  const snapshot = useSyncExternalStore(
    gitDiffStore.subscribe,
    gitDiffStore.getSnapshot,
  );
  const refresh = useCallback(() => gitDiffStore.requestDiff(), [gitDiffStore]);

  const payload = snapshot.payload;
  const files = payload?.files ?? [];
  const hasFiles = files.length > 0;

  // A single-file diff opens expanded; multi-file opens as a scannable
  // collapsed list. Uncontrolled — the user toggles from there.
  const defaultOpen = useMemo(
    () => (files.length === 1 ? [fileKey(files[0])] : []),
    [files],
  );

  // Body content by phase. The empty / no-repo states render a *single*
  // centered proposal label (no repeated "no changes" — the header
  // context line is shown only when there are files to summarize).
  let body: React.ReactElement;
  if (snapshot.phase === "error") {
    body = (
      <p className="diff-sheet-notice" role="alert">
        {snapshot.error ?? "Couldn't load the diff."}
      </p>
    );
  } else if (snapshot.phase === "loading" || payload === null) {
    body = (
      <p className="diff-sheet-notice" role="status">
        Loading changes…
      </p>
    );
  } else if (payload.no_repo) {
    body = (
      <div className="diff-sheet-notice" role="status">
        <TugLabel emphasis="proposal" align="center">
          Not a git repository.
        </TugLabel>
      </div>
    );
  } else if (!hasFiles) {
    body = (
      <div className="diff-sheet-notice" role="status">
        <TugLabel emphasis="proposal" align="center">
          No uncommitted changes.
        </TugLabel>
      </div>
    );
  } else {
    body = (
      <TugAccordion
        type="multiple"
        variant="separator"
        defaultValue={defaultOpen}
        className="diff-sheet-files"
      >
        {files.map((file) => (
          <TugAccordionItem
            key={fileKey(file)}
            value={fileKey(file)}
            trigger={<FileTrigger file={file} />}
            data-testid="diff-file"
          >
            <FileBody file={file} />
          </TugAccordionItem>
        ))}
      </TugAccordion>
    );
  }

  return (
    <div className="diff-sheet">
      <div className="diff-sheet-header">
        {hasFiles && payload !== null ? (
          <div className="diff-sheet-header-text">
            <TugLabel emphasis="proposal">
              Uncommitted changes (git diff HEAD)
            </TugLabel>
            <span
              className="diff-sheet-summary"
              aria-label={diffSummaryLine(
                payload.file_count,
                payload.total_added,
                payload.total_removed,
              )}
            >
              {payload.file_count}{" "}
              {payload.file_count === 1 ? "file" : "files"} changed{" "}
              <span className="diff-sheet-stat-add">+{payload.total_added}</span>{" "}
              <span className="diff-sheet-stat-remove">
                −{payload.total_removed}
              </span>
            </span>
          </div>
        ) : (
          <span className="diff-sheet-header-spacer" />
        )}
        <TugPushButton
          size="sm"
          onClick={refresh}
          disabled={snapshot.phase === "loading"}
          data-testid="diff-refresh"
        >
          Refresh
        </TugPushButton>
      </div>

      <div className="diff-sheet-body">{body}</div>

      <div className="tug-sheet-actions">
        <TugPushButton emphasis="filled" onClick={() => onClose()} data-testid="diff-done">
          Done
        </TugPushButton>
      </div>
    </div>
  );
}
