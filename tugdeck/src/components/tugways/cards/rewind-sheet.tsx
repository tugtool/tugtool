/**
 * rewind-sheet.tsx — the `/rewind` turn picker + restore-confirm sheet
 * ([#step-7-3]).
 *
 * `/rewind` is a turns-within-this-session picker (NOT the `/resume` sessions
 * chooser — [D05]). {@link useRewindSheet} owns the sheet once at the card
 * level (mirroring {@link useModelPicker}): the dev card wires `openRewindSheet`
 * to its `rewind` `RUN_SLASH_COMMAND` handler and presents it through the
 * shared `cardPickerSheet` host (card-scoped overlay, [D15]).
 *
 * Two steps in one body (no component-type swap across steps — internal phase
 * branch): a `TugListView` turn picker, then a confirm form with the **three**
 * conditional actions ([#step-7a]): *Restore code and conversation* (both),
 * *Restore conversation* (conversation), *Never mind*. The code option is
 * shown only when the picked turn has a restorable code checkpoint (its lazy
 * `rewind_preview` diff-stat reports `canRewind` with changed files); the
 * restore actions are disabled while claude is busy (rewind requires an idle
 * session — the idle gate is enforced authoritatively by tugcode, mirrored
 * here for UX).
 *
 * The per-turn diff-stat is fetched lazily on row focus (not per cell on open
 * — the N+1 trap) and cached in the store snapshot's `rewindPreviews`, read
 * back via `useSyncExternalStore` ([L02]). Applying a rewind sends
 * `session_rewind` ([#step-7-1]/[#step-7-2]); conversation/both fork by
 * default (the silent respawn + the local L26-safe truncation land when the
 * `rewind_result` ack arrives). The sheet dismisses on a successful ack and
 * surfaces the error otherwise.
 *
 * Compositional component — composes `TugSheet`, `TugListView`, `TugListRow`,
 * `TugPushButton`; composed children keep their own tokens ([L20]).
 *
 * Laws: [L02] store reads via the store API, [L06] appearance via CSS,
 *       [L19] authoring guide, [L20] composed children keep tokens,
 *       [L26] the picker rows reconcile through a module-constant
 *       `cellRenderers` (never inline lambdas) so they stay mount-stable.
 * Decisions: [D05] sheet-not-shared, [D15] pane sheets are overlays.
 *
 * @module components/tugways/cards/rewind-sheet
 */

import "./rewind-sheet.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import { TugListRow } from "@/components/tugways/tug-list-row";
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
      description: "Pick a turn to rewind to. Earlier turns are kept.",
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
// Cell — one turn row, with its lazily-fetched diff-stat
// ---------------------------------------------------------------------------

/**
 * Read-only context the picker cells consume: the live preview cache and the
 * sheet-selected row. `onPick` lives on the delegate (in body scope); the
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

/** Format a turn's diff-stat for the row trailing accessory. */
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
    const title = row.preview.trim().length > 0 ? row.preview : "(empty prompt)";
    return (
      <TugListRow
        title={title}
        subtitle={row.isCurrent ? "Current" : undefined}
        selected={row.promptUuid === selectedPromptUuid}
        trailing={
          <span className="rewind-diffstat" aria-hidden="true">
            {diffStatLabel(preview)}
          </span>
        }
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
// Sheet body — picker step → confirm step
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

  const [selected, setSelected] = useState<RewindRow | null>(null);
  // Set true the moment we apply a rewind, so the ack-driven dismiss only
  // reacts to OUR rewind (not a stale `lastRewindResult` from a prior one).
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const dataSource = useMemo(() => new RewindTurnDataSource(rows), [rows]);

  // Lazily fetch a row's diff-stat on focus/selection (visible/focused rows
  // only — never one fetch per turn on open). Cached in the store; re-focus
  // doesn't re-fetch.
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
        const row = rows[index];
        setSelected(row);
        ensurePreview(row.promptUuid);
      },
    }),
    [rows, ensurePreview],
  );

  // React to OUR applied rewind's ack: dismiss on success, surface the error
  // (and re-enable the actions for a retry) on failure. Watching the store
  // transition in an effect — not copying it into state — keeps the dismiss
  // a clean side-effect of the ack landing ([L02]).
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

  const apply = useCallback(
    (scope: "conversation" | "both") => {
      if (selected === null || !isIdle) return;
      setErrorMsg(null);
      setApplying(true);
      // Fork is the default for conversation/both ([#step-7-2]).
      codeSessionStore.sessionRewind(selected.promptUuid, scope, true);
    },
    [selected, isIdle, codeSessionStore],
  );

  // --- Picker step ---
  if (selected === null) {
    return (
      <div
        className="rewind-sheet"
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
      >
        <RewindCellContext.Provider
          value={{ previews, selectedPromptUuid: null }}
        >
          <div className="rewind-sheet-list">
            <TugListView<RewindTurnDataSource>
              dataSource={dataSource}
              delegate={delegate}
              cellRenderers={REWIND_CELL_RENDERERS}
              rowLayout="flush"
              inline
              className="rewind-list"
            />
          </div>
        </RewindCellContext.Provider>
        <div className="tug-sheet-actions">
          <TugPushButton onClick={() => onClose()}>Cancel</TugPushButton>
        </div>
      </div>
    );
  }

  // --- Confirm step ---
  const preview = previews.get(selected.promptUuid);
  const codeRestorable =
    preview !== undefined &&
    !preview.loading &&
    preview.canRewind &&
    (preview.insertions ?? 0) + (preview.deletions ?? 0) > 0;

  return (
    <div
      className="rewind-sheet rewind-confirm"
      onKeyDown={(e) => {
        // Enter confirms the primary action (conversation restore is always
        // valid); Escape is TugSheet's cancel.
        if (e.key === "Enter") {
          e.preventDefault();
          apply("conversation");
        }
      }}
    >
      <p className="rewind-confirm-summary">
        Rewind to: <strong>{selected.preview.trim() || "(empty prompt)"}</strong>
      </p>
      <p className="rewind-confirm-note">
        This turn and everything after it will be removed. Earlier turns stay.
      </p>
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
      <div className="rewind-confirm-actions">
        {codeRestorable ? (
          <TugPushButton
            emphasis="filled"
            disabled={!isIdle || applying}
            onClick={() => apply("both")}
            data-testid="rewind-confirm-both"
          >
            Restore code and conversation
          </TugPushButton>
        ) : null}
        <TugPushButton
          emphasis={codeRestorable ? "outlined" : "filled"}
          disabled={!isIdle || applying}
          onClick={() => apply("conversation")}
          data-testid="rewind-confirm-conversation"
        >
          Restore conversation
        </TugPushButton>
        <TugPushButton onClick={() => onClose()} data-testid="rewind-confirm-cancel">
          Never mind
        </TugPushButton>
      </div>
    </div>
  );
}
