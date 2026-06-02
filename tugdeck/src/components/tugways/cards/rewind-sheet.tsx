/**
 * rewind-sheet.tsx — the `/rewind` turn picker + restore-scope sheet
 * ([#step-7-3]).
 *
 * `/rewind` is a turns-within-this-session picker (NOT the `/resume` sessions
 * chooser — [D05]). {@link useRewindSheet} owns the sheet once at the card
 * level (mirroring {@link useModelPicker}): the dev card wires `openRewindSheet`
 * to its `rewind` `RUN_SLASH_COMMAND` handler and presents it through the
 * shared `cardPickerSheet` host as a **wide** card-scoped overlay ([D15]).
 *
 * One step, no view switch: a `TugListView` turn picker (rendered with the same
 * session-option visual as the `/resume` sessions list) above an inline
 * `TugChoiceGroup` that picks the restore scope — *Conversation* or *Code +
 * conversation* (the code segment enables only when the selected turn has a
 * restorable checkpoint, reported by its lazy diff-stat). Cancel / Rewind sit
 * at the bottom, Rewind as the default (Enter), to the right of Cancel.
 *
 * The per-turn diff-stat is fetched lazily on row selection (not per cell on
 * open — the N+1 trap) and cached in the store snapshot's `rewindPreviews`,
 * read via `useSyncExternalStore` ([L02]). Rewinding sends `session_rewind`
 * ([#step-7-1]/[#step-7-2]); conversation/both fork by default. The sheet
 * dismisses on a successful `rewind_result` ack and surfaces the error
 * otherwise (the local L26-safe truncation runs in the store on the ack).
 *
 * Compositional — composes `TugSheet`, `TugListView`, `TugChoiceGroup`,
 * `TugPushButton`; composed children keep their own tokens ([L20]). The
 * `TugChoiceGroup` is a control: it emits `selectValue` through the responder
 * chain, captured by a `useResponderForm` binding here ([L11]).
 *
 * Laws: [L02] store reads via the store API, [L06] appearance via CSS,
 *       [L11] controls emit / the form captures, [L19] authoring guide,
 *       [L20] composed children keep tokens, [L26] picker rows reconcile
 *       through a module-constant `cellRenderers` (never inline lambdas).
 * Decisions: [D05] sheet-not-shared, [D15] pane sheets are overlays.
 *
 * @module components/tugways/cards/rewind-sheet
 */

import "./rewind-sheet.css";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugListRow } from "@/components/tugways/tug-list-row";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import {
  TugChoiceGroup,
  type TugChoiceItem,
} from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  CodeSessionSnapshot,
  RewindTurnPreview,
} from "@/lib/code-session-store/types";
import {
  projectRewindTurns,
  RewindTurnDataSource,
  type RewindRow,
} from "./rewind-turn-source";

type RewindScope = "conversation" | "both";

// ---------------------------------------------------------------------------
// useRewindSheet — the card-hosted /rewind sheet
// ---------------------------------------------------------------------------

export interface UseRewindSheetArgs {
  /** Store supplying the transcript projection + the rewind round-trips. */
  codeSessionStore: CodeSessionStore;
  /** The card's shared sheet host (`useTugSheet().showSheet`). */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

export interface RewindSheetController {
  /** Present the sheet over the current transcript. A no-op when there is
   *  nothing to rewind to (the popup gates this, but guard defensively). */
  openRewindSheet: () => void;
}

export function useRewindSheet({
  codeSessionStore,
  showSheet,
}: UseRewindSheetArgs): RewindSheetController {
  const openRewindSheet = useCallback(() => {
    const rows = projectRewindTurns(codeSessionStore.getSnapshot().transcript);
    if (rows.length === 0) return; // nothing to rewind to
    void showSheet({
      title: "Rewind",
      // Guidance renders as a centered proposal label below the divider (in
      // the body), not as a below-the-line description.
      displayWidth: "md",
      content: (close) => (
        <RewindSheetBody
          rows={rows}
          codeSessionStore={codeSessionStore}
          onClose={close}
        />
      ),
    });
  }, [showSheet, codeSessionStore]);

  return { openRewindSheet };
}

// ---------------------------------------------------------------------------
// Cell — one turn row, rendered with the session-picker visual
// ---------------------------------------------------------------------------

/**
 * Read-only context the picker cells consume: the live preview cache and the
 * sheet-selected row. `onSelect` lives on the delegate (in body scope); the
 * context only carries render inputs, keeping cells presentational ([L11]).
 */
interface RewindCellContextValue {
  previews: ReadonlyMap<string, RewindTurnPreview>;
  selectedPromptUuid: string | null;
}
const RewindCellContext = React.createContext<RewindCellContextValue>({
  previews: new Map(),
  selectedPromptUuid: null,
});

/** Format a turn's diff-stat for the row subtitle. */
function diffStatLabel(preview: RewindTurnPreview | undefined): string {
  if (preview === undefined) return "";
  if (preview.loading) return "…";
  if (!preview.canRewind) return "No code changes";
  const ins = preview.insertions ?? 0;
  const del = preview.deletions ?? 0;
  if (ins === 0 && del === 0) return "No code changes";
  return `+${ins} −${del}`;
}

const RewindTurnCell: TugListViewCellRenderer<RewindTurnDataSource> =
  function RewindTurnCell({
    index,
    dataSource,
  }: TugListViewCellProps<RewindTurnDataSource>): React.ReactElement {
    const { previews, selectedPromptUuid } = React.useContext(RewindCellContext);
    const row = dataSource.rowAt(index);
    const preview = previews.get(row.promptUuid);
    const selected = row.promptUuid === selectedPromptUuid;
    // A turn whose conversation rewind would cross a /compact boundary can't be
    // rewound to (both sheet scopes truncate the conversation), so its row is
    // disabled and says why. `undefined` (still loading) ⇒ enabled.
    const blocked = preview?.conversationRewindable === false;
    const title = row.preview.trim().length > 0 ? row.preview : "(empty prompt)";
    const stat = diffStatLabel(preview);
    const subtitle = row.isCurrent
      ? stat.length > 0
        ? `Current · ${stat}`
        : "Current"
      : stat;
    // A reserved non-breaking space keeps stat-less rows the same height
    // as rows that carry a subtitle, so the turn list reads as an even stack.
    const subtitleText = blocked
      ? "Can't rewind past a /compact"
      : subtitle.length > 0
        ? subtitle
        : " ";
    return (
      <TugListRow
        title={title}
        subtitle={subtitleText}
        selected={selected}
        disabled={blocked}
        data-testid="rewind-turn-row"
        data-prompt-uuid={row.promptUuid}
      />
    );
  };

/** Module-constant renderer map ([L26]): one stable reference shared by every
 *  `rewind-turn` row so picker rows reconcile as the same element across
 *  re-renders — never inline lambdas. */
const REWIND_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<RewindTurnDataSource>
> = {
  "rewind-turn": RewindTurnCell,
};

// ---------------------------------------------------------------------------
// Sheet body — single step: turn list + restore-scope choice group + actions
// ---------------------------------------------------------------------------

interface RewindSheetBodyProps {
  rows: RewindRow[];
  codeSessionStore: CodeSessionStore;
  onClose: (value?: string) => void;
}

function RewindSheetBody({
  rows,
  codeSessionStore,
  onClose,
}: RewindSheetBodyProps): React.ReactElement {
  // Live store reads ([L02]): preview cache, applied-ack, and idle phase.
  const snapshot = useSyncExternalStore<CodeSessionSnapshot>(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  const previews = snapshot.rewindPreviews;
  const isIdle = snapshot.phase === "idle";

  // Pre-select the most recent turn (the last, "current" row) on open — it's
  // always rewindable (it's the tip, so nothing compacts after it), so the
  // sheet opens ready to Rewind. The user can pick an earlier turn.
  const [selected, setSelected] = useState<RewindRow | null>(
    rows.length > 0 ? rows[rows.length - 1] : null,
  );
  const [scope, setScope] = useState<RewindScope>("conversation");
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // The scope choice group is a control: it emits `selectValue` through the
  // chain; this form binding captures it into local state ([L11]).
  const scopeGroupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [scopeGroupId]: (v: string) =>
        setScope(v === "both" ? "both" : "conversation"),
    },
  });

  // Only show turns the user can actually rewind to: omit any whose
  // conversation rewind would cross a `/compact` boundary (tugcode reports
  // `conversationRewindable:false`). A turn whose preview is still loading
  // (`undefined`) is shown until its result lands — so an uncompacted session
  // shows every turn immediately with no flicker; a compacted one drops the
  // pre-compaction turns as their previews resolve.
  const visibleRows = useMemo(
    () =>
      rows.filter(
        (r) => previews.get(r.promptUuid)?.conversationRewindable !== false,
      ),
    [rows, previews],
  );
  // Rebuild the data source only when the visible SET changes (as previews
  // resolve), not on every snapshot tick — keyed on the row-id signature.
  const visibleKey = visibleRows.map((r) => r.promptUuid).join(",");
  const dataSource = useMemo(
    () => new RewindTurnDataSource(visibleRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on visibleKey
    [visibleKey],
  );

  // If the selected turn gets omitted (its preview resolved to not-rewindable
  // after it was picked), drop the selection so the scope group + Rewind
  // disable.
  useEffect(() => {
    if (
      selected !== null &&
      !visibleRows.some((r) => r.promptUuid === selected.promptUuid)
    ) {
      setSelected(null);
    }
  }, [visibleRows, selected]);

  // Lazily fetch a row's diff-stat on selection (cached in the store).
  const ensurePreview = useCallback(
    (promptUuid: string) => {
      if (!previews.has(promptUuid)) {
        codeSessionStore.requestRewindPreview(promptUuid);
      }
    },
    [previews, codeSessionStore],
  );

  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => {
        const row = visibleRows[index];
        if (row === undefined) return;
        setSelected(row);
        ensurePreview(row.promptUuid);
      },
    }),
    [visibleRows, ensurePreview],
  );

  // Fetch every row's diff-stat once, when the sheet opens, so each turn shows
  // its `+N −M` / "No code changes" upfront rather than popping in on click.
  // Cached in the store, so re-opening the sheet re-fetches nothing. (For a
  // user-opened sheet over a bounded turn list these dry-run round-trips are
  // cheap; keyed on `rows` so it runs once per open, not per snapshot tick.)
  useEffect(() => {
    const snap = codeSessionStore.getSnapshot().rewindPreviews;
    for (const row of rows) {
      if (!snap.has(row.promptUuid)) {
        codeSessionStore.requestRewindPreview(row.promptUuid);
      }
    }
  }, [rows, codeSessionStore]);

  // Code restore is offered only when the selected turn has a restorable
  // checkpoint with actual changes (its lazy diff-stat says so).
  const selectedPreview =
    selected !== null ? previews.get(selected.promptUuid) : undefined;
  const codeRestorable =
    selectedPreview !== undefined &&
    !selectedPreview.loading &&
    selectedPreview.canRewind &&
    (selectedPreview.insertions ?? 0) + (selectedPreview.deletions ?? 0) > 0;
  // If "both" is picked but the current selection can't restore code, the
  // effective (and displayed) scope falls back to conversation.
  const effectiveScope: RewindScope =
    scope === "both" && codeRestorable ? "both" : "conversation";

  const scopeItems: TugChoiceItem[] = [
    { value: "conversation", label: "Conversation" },
    { value: "both", label: "Code + conversation", disabled: !codeRestorable },
  ];

  // React to OUR applied rewind's ack: dismiss on success, surface the error
  // (and re-enable) on failure ([L02]).
  const ack = snapshot.lastRewindResult;
  useEffect(() => {
    if (
      !applying ||
      ack === null ||
      selected === null ||
      ack.promptUuid !== selected.promptUuid
    ) {
      return;
    }
    if (ack.canRewind) {
      onClose(selected.promptUuid);
    } else {
      setApplying(false);
      setErrorMsg(ack.error ?? "Rewind failed.");
    }
  }, [applying, ack, selected, onClose]);

  // Block Rewind if the selected turn's conversation rewind would error (e.g.
  // a preview that resolved to not-rewindable after selection).
  const canApply =
    selected !== null &&
    isIdle &&
    !applying &&
    selectedPreview?.conversationRewindable !== false;
  const apply = useCallback(() => {
    if (selected === null || !isIdle) return;
    setErrorMsg(null);
    setApplying(true);
    // Fork is the default for conversation/both ([#step-7-2]).
    codeSessionStore.sessionRewind(selected.promptUuid, effectiveScope, true);
  }, [selected, isIdle, effectiveScope, codeSessionStore]);

  return (
    <ResponderScope>
      <div
        className="rewind-sheet"
        ref={responderRef as (el: HTMLDivElement | null) => void}
        onKeyDown={(e) => {
          // Enter rewinds (the default) when a turn is picked; Escape is
          // TugSheet's cancel.
          if (e.key === "Enter" && canApply) {
            e.preventDefault();
            apply();
          }
        }}
      >
        <div className="rewind-intro">
          <TugLabel emphasis="proposal" align="center">
            Pick a turn to rewind to. Earlier turns are kept.
          </TugLabel>
        </div>

        <RewindCellContext.Provider
          value={{ previews, selectedPromptUuid: selected?.promptUuid ?? null }}
        >
          {/* Reuse the session picker's section + bordered host so the two
              pickers read the same ([L20] cascade-scoped). */}
          <div className="dev-card-picker-section">
            <span className="dev-card-picker-label">Turns</span>
            <div className="dev-card-picker-sessions-host">
              {visibleRows.length > 0 ? (
                <TugListView<RewindTurnDataSource>
                  dataSource={dataSource}
                  delegate={delegate}
                  cellRenderers={REWIND_CELL_RENDERERS}
                  scrollKey="rewind-turns"
                  rowLayout="flush"
                  className="dev-card-picker-sessions-list dev-card-picker-list-view"
                />
              ) : (
                <div className="rewind-empty" role="status">
                  No turns to rewind to since the last /compact.
                </div>
              )}
            </div>
          </div>
        </RewindCellContext.Provider>

        <div className="rewind-scope-row">
          <TugLabel emphasis="proposal">Restore</TugLabel>
          <TugChoiceGroup
            items={scopeItems}
            value={effectiveScope}
            senderId={scopeGroupId}
            size="sm"
            disabled={selected === null}
            aria-label="Restore scope"
            data-testid="rewind-scope"
          />
        </div>

        {!isIdle ? (
          <p className="rewind-busy" role="status">
            Claude is busy — wait for the current turn to finish.
          </p>
        ) : null}
        {errorMsg !== null ? (
          <p className="rewind-error" role="alert">
            {errorMsg}
          </p>
        ) : null}

        <div className="tug-sheet-actions">
          <TugPushButton onClick={() => onClose()} data-testid="rewind-cancel">
            Cancel
          </TugPushButton>
          <TugPushButton
            emphasis="filled"
            disabled={!canApply}
            onClick={apply}
            data-testid="rewind-apply"
          >
            Rewind
          </TugPushButton>
        </div>
      </div>
    </ResponderScope>
  );
}
