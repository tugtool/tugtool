/**
 * tug-diff-document.tsx — the shared document-level diff surface ([P18]).
 *
 * One diff **document**: a summary header (`N files changed +X −Y`), a
 * host-level inline ↔ side-by-side toggle, Expand All / Collapse All, and one
 * `TugAccordion type="multiple"` item per changed file whose body renders that
 * file's hunks via the shared {@link DiffBlock} (`suppressHeader` — the
 * accordion trigger owns file identity). `DiffBlock` is the per-file engine and
 * is NOT rebuilt here; this component is the layer above it.
 *
 * Three hosts compose this one document: the session card's `/diff` sheet
 * (`cards/diff-sheet.tsx`), the changeset card's inline whole-entry expansion,
 * and a Text card in diff mode. Each host owns its own sourcing (a
 * {@link GitDiffStore} request, refresh, loading/error notices) and hands this
 * component the parsed {@link GitDiffPayload}; the document renders the files.
 *
 * The view-mode toggle drives every `DiffBlock`'s `viewMode` prop in lockstep;
 * when a host passes a `cardId`, the choice persists through the existing
 * `diff-view-pref.ts` tugbank channel ([L02]), else it is ephemeral local
 * state ([L24]). `headerActions` lets a host inject its own controls (the
 * sheet's Refresh) into the header cluster; `fileTrailing` lets a host add a
 * per-file affordance (the changeset card's pop-out) into each accordion
 * trigger.
 *
 * Laws: [L02] persisted view-mode via `useSyncExternalStore` (the
 *       `useDiffViewMode` hook); [L06] appearance via CSS; [L11] the view
 *       toggle is a control that emits `selectValue` through the responder
 *       chain; [L20] composed children (DiffBlock, TugAccordion, TugChoiceGroup)
 *       keep their own tokens.
 *
 * @module components/tugways/tug-diff-document
 */

import "./tug-diff-document.css";

import React, { useCallback, useId, useMemo, useState } from "react";
import { AlignLeft, Columns2 } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import {
  TugChoiceGroup,
  type TugChoiceItem,
} from "@/components/tugways/tug-choice-group";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { DiffBlock } from "@/components/tugways/body-kinds/diff-block";
import {
  useDiffViewMode,
  writeDiffViewMode,
  type DiffViewMode,
} from "@/lib/diff/diff-view-pref";
import {
  type GitDiffFile,
  type GitDiffPayload,
  diffStatusLabel,
  diffStatusLetter,
  fileStatLabel,
} from "@/lib/git-diff-store";

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export interface TugDiffDocumentProps {
  /** The parsed diff to render (files + totals). */
  payload: GitDiffPayload;
  /**
   * Header label line above the summary (e.g. "Uncommitted changes (git diff
   * HEAD)"). Omitted → just the summary line.
   */
  label?: string;
  /**
   * Extra host controls placed at the end of the header action cluster (the
   * sheet's / Text card's Refresh button). The document owns the view toggle
   * and Expand/Collapse All; the host owns Refresh.
   */
  headerActions?: React.ReactNode;
  /**
   * Per-file trailing affordance rendered inside each accordion trigger (the
   * changeset card's "open as card" pop-out). Omitted → no per-file control.
   */
  fileTrailing?: (file: GitDiffFile) => React.ReactNode;
  /**
   * Key for the persisted inline ↔ side-by-side preference (the tugbank
   * `diff-view-pref.ts` channel). Omitted → the toggle is ephemeral local
   * state, not persisted.
   */
  cardId?: string;
  /** Forwarded class name on the document root. */
  className?: string;
}

// ---------------------------------------------------------------------------
// File row — one accordion item: trigger (status + path + stat) over hunks
// ---------------------------------------------------------------------------

/** Accordion item key — the (unique) destination path of each changed file. */
function fileKey(file: GitDiffFile): string {
  return file.path;
}

/** The collapsed trigger: status letter, path (rename shows old → new), stat. */
function FileTrigger({
  file,
  trailing,
}: {
  file: GitDiffFile;
  trailing?: React.ReactNode;
}): React.ReactElement {
  const pathLabel =
    file.status === "renamed" && file.old_path !== undefined
      ? `${file.old_path} → ${file.path}`
      : file.path;
  return (
    <span className="tug-diff-document-file-trigger">
      <span
        className="tug-diff-document-file-status"
        data-status={file.status}
        aria-label={diffStatusLabel(file.status)}
        title={diffStatusLabel(file.status)}
      >
        {diffStatusLetter(file.status)}
      </span>
      <span className="tug-diff-document-file-path" title={pathLabel}>
        {pathLabel}
      </span>
      <span className="tug-diff-document-file-stat" aria-label={fileStatLabel(file)}>
        {file.binary ? (
          <span className="tug-diff-document-stat-binary">binary</span>
        ) : (
          <>
            <span className="tug-diff-document-stat-add">+{file.added}</span>
            <span className="tug-diff-document-stat-remove">−{file.removed}</span>
          </>
        )}
      </span>
      {trailing !== undefined && trailing !== null ? (
        <span className="tug-diff-document-file-trailing">{trailing}</span>
      ) : null}
    </span>
  );
}

/** The expanded body: hunks via DiffBlock, or a note for binary files. */
function FileBody({
  file,
  viewMode,
}: {
  file: GitDiffFile;
  viewMode: DiffViewMode;
}): React.ReactElement {
  if (file.binary) {
    return (
      <p className="tug-diff-document-binary-note" role="note">
        Binary file — no textual diff.
      </p>
    );
  }
  return (
    <DiffBlock
      data={{ source: "unified", text: file.unified, filePath: file.path }}
      suppressHeader
      viewMode={viewMode}
      className="tug-diff-document-file-diff"
    />
  );
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/** The two view-mode segments — module-level so the sliding indicator inside
 *  TugChoiceGroup doesn't re-attach on every render. */
const VIEW_TOGGLE_ITEMS: TugChoiceItem[] = [
  {
    value: "side-by-side",
    label: "Side by side",
    icon: <Columns2 aria-hidden="true" />,
    iconPosition: "left",
    "aria-label": "Side by side",
  },
  {
    value: "inline",
    label: "Inline",
    icon: <AlignLeft aria-hidden="true" />,
    iconPosition: "left",
    "aria-label": "Inline",
  },
];

export function TugDiffDocument({
  payload,
  label,
  headerActions,
  fileTrailing,
  cardId,
  className,
}: TugDiffDocumentProps): React.ReactElement {
  const files = payload.files;

  // View mode: persisted through tugbank when a cardId is given ([L02]),
  // else ephemeral local state ([L24]). Local state wins optimistically so
  // the toggle repaints without waiting for the tugbank round trip.
  const persistedViewMode = useDiffViewMode(cardId);
  const [localViewMode, setLocalViewMode] = useState<DiffViewMode | null>(null);
  const viewMode: DiffViewMode = localViewMode ?? persistedViewMode ?? "inline";
  const applyViewMode = useCallback(
    (next: DiffViewMode) => {
      setLocalViewMode(next);
      if (cardId !== undefined) writeDiffViewMode(cardId, next);
    },
    [cardId],
  );

  // Controlled accordion so Expand All / Collapse All can drive every file at
  // once. The accordion and the view toggle are both controls ([L11]); one
  // responder form captures the accordion's `toggleSectionMulti` and the
  // toggle's `selectValue`. Files open collapsed (a scannable list).
  const accordionSenderId = useId();
  const viewToggleSenderId = useId();
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const { ResponderScope, responderRef } = useResponderForm({
    toggleSectionMulti: {
      [accordionSenderId]: (v: string[]) => setOpenKeys(v),
    },
    selectValue: {
      [viewToggleSenderId]: (next: string) =>
        applyViewMode(next === "side-by-side" ? "side-by-side" : "inline"),
    },
  });
  const allKeys = useMemo(() => files.map(fileKey), [files]);
  const expandAll = useCallback(() => setOpenKeys(allKeys), [allKeys]);
  const collapseAll = useCallback(() => setOpenKeys([]), []);

  return (
    <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        data-slot="tug-diff-document"
        className={`tug-diff-document${className ? ` ${className}` : ""}`}
      >
        {/* ONE non-wrapping quiet line ([P29], block-grammar): the sections
            read `label │ summary │ view toggle │ Expand/Collapse │ host
            actions`, pipe-delimited by the shared block-header divider
            convention (a left rule with symmetric gap on each section after
            the first). The summary is the flexible spacer that pushes the
            controls to the trailing edge; label + summary ellipsize (label
            first) when narrow while the controls never wrap. */}
        <div className="tug-diff-document-header">
          {label !== undefined ? (
            <span className="tug-diff-document-header-label" title={label}>
              <TugLabel emphasis="proposal">{label}</TugLabel>
            </span>
          ) : null}
          <span
            className="tug-diff-document-summary"
            aria-label={`${payload.file_count} ${
              payload.file_count === 1 ? "file" : "files"
            } changed, ${payload.total_added} added, ${payload.total_removed} removed`}
          >
            {payload.file_count} {payload.file_count === 1 ? "file" : "files"}{" "}
            changed{" "}
            <span className="tug-diff-document-stat-add">
              +{payload.total_added}
            </span>{" "}
            <span className="tug-diff-document-stat-remove">
              −{payload.total_removed}
            </span>
          </span>
          <span className="tug-diff-document-header-section">
            <TugChoiceGroup
              items={VIEW_TOGGLE_ITEMS}
              value={viewMode}
              senderId={viewToggleSenderId}
              size="2xs"
              emphasis="ghost"
              aria-label="Diff view mode"
              data-testid="diff-view-mode"
            />
          </span>
          <span className="tug-diff-document-header-section">
            <TugPushButton
              size="sm"
              emphasis="ghost"
              onClick={expandAll}
              data-testid="diff-expand-all"
            >
              Expand All
            </TugPushButton>
            <TugPushButton
              size="sm"
              emphasis="ghost"
              onClick={collapseAll}
              data-testid="diff-collapse-all"
            >
              Collapse All
            </TugPushButton>
          </span>
          {headerActions != null && headerActions !== false ? (
            <span className="tug-diff-document-header-section">
              {headerActions}
            </span>
          ) : null}
        </div>
        <TugAccordion
          type="multiple"
          variant="separator"
          value={openKeys}
          senderId={accordionSenderId}
          className="tug-diff-document-files"
        >
          {files.map((file) => (
            <TugAccordionItem
              key={fileKey(file)}
              value={fileKey(file)}
              trigger={
                <FileTrigger
                  file={file}
                  trailing={fileTrailing?.(file)}
                />
              }
              data-testid="diff-file"
            >
              <FileBody file={file} viewMode={viewMode} />
            </TugAccordionItem>
          ))}
        </TugAccordion>
      </div>
    </ResponderScope>
  );
}
