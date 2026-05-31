/**
 * resume-sheet.tsx — the `/resume` focused sessions overlay + its card-hosted
 * hook ([#step-8]).
 *
 * `/resume` ≠ `/rewind` ([D05]): it picks among the project's *distinct prior
 * sessions* and rebinds THIS card to the chosen conversation (a genuine resume
 * → replay rebuilds the transcript), where `/rewind` ([#step-7-3]) picks among
 * turns within the current session. They share no component — only the
 * card-scoped overlay shell ([D15]).
 *
 * This is NOT the full-card `DevProjectPicker` (project-path entry + recents +
 * sessions, shown when no session is bound). It is a focused overlay that
 * reuses the EXISTING sessions data source + `SESSIONS_CELL_RENDERERS` over the
 * card's already-bound project — sessions only, no path/recents chrome. The
 * cold-boot / empty-card picker is untouched.
 *
 * Picking a non-live session resumes it (`fireRestore` — same path the full
 * picker's Open uses, which a live card's rebind goes through); "New session"
 * spawns a fresh one. Cancel / ESC / backdrop dismiss and leave the live
 * session intact. The wire send is deferred past the sheet's exit animation so
 * the binding flip doesn't unmount the sheet mid-animation (mirrors
 * `DevProjectPicker`'s Open).
 *
 * Compositional — composes `TugSheet`, `TugListView`, `TugPushButton`; the
 * reused session cells keep their own tokens ([L20]).
 *
 * Laws: [L02] store reads via the store API, [L11] cells emit, the form owns
 *       state, [L19] authoring guide, [L20] composed children keep tokens,
 *       [L26] rows reconcile through the module-constant `SESSIONS_CELL_RENDERERS`.
 * Decisions: [D05] sheet-not-shared, [D15] pane sheets are overlays,
 *            [D23] local slash-command dispatch.
 *
 * @module components/tugways/cards/resume-sheet
 */

import "./resume-sheet.css";

import React, { useCallback, useMemo, useSyncExternalStore } from "react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { ShowSheetOptions } from "@/components/tugways/tug-sheet";
import {
  TugListView,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import {
  useDevSessionsDataSource,
  type DevSessionsDataSource,
} from "@/lib/dev-picker-data-source";
import { useSessionLedger } from "@/lib/dev-session-ledger-store";
import { SESSIONS_CELL_RENDERERS, PickerCellProvider } from "./dev-picker-cells";
import { getConnection } from "@/lib/connection-singleton";
import { sendSpawnSession } from "@/lib/session-lifecycle";
import { fireRestore } from "@/lib/dev-session-restore";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";

// Mirrors `dev-card.tsx`'s sheet exit duration: defer the wire send so the
// binding flip (which rebinds + re-renders the card) doesn't unmount the sheet
// mid-exit-animation.
const SHEET_EXIT_ANIMATION_MS = 220;

export interface UseResumeSheetArgs {
  cardId: string;
  /** The card's shared sheet host (`useTugSheet().showSheet`). */
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
}

export interface ResumeSheetController {
  /** Present the sessions overlay. A no-op when the card has no bound project
   *  (the popup gates `/resume` on a bound session). */
  openResumeSheet: () => void;
}

export function useResumeSheet({
  cardId,
  showSheet,
}: UseResumeSheetArgs): ResumeSheetController {
  // The bound session's project dir, read straight from the binding store
  // ([L02]) — `/resume` lists sessions for the SAME project (a live-session
  // rebind, not a project switch). Stable under a live card.
  const projectDir = useSyncExternalStore(
    (cb) => cardSessionBindingStore.subscribe(cb),
    () => cardSessionBindingStore.getBinding(cardId)?.projectDir ?? "",
  );
  // The sessions data source for the bound project, fed by the tugcast-side
  // ledger ([L02]). Lives at the card level (a hook) so its subscription is
  // stable.
  const sessionLedger = useSessionLedger(projectDir);
  const sessionsDataSource = useDevSessionsDataSource(projectDir, sessionLedger);

  const openResumeSheet = useCallback(() => {
    if (projectDir.length === 0) return;
    void showSheet({
      title: "Resume session",
      description: "Pick a session to resume in this card.",
      content: (close) => (
        <ResumeSheetBody
          dataSource={sessionsDataSource}
          cardId={cardId}
          projectDir={projectDir}
          onClose={close}
        />
      ),
    });
  }, [showSheet, sessionsDataSource, cardId, projectDir]);

  return { openResumeSheet };
}

interface ResumeSheetBodyProps {
  dataSource: DevSessionsDataSource;
  cardId: string;
  projectDir: string;
  onClose: (value?: string) => void;
}

function ResumeSheetBody({
  dataSource,
  cardId,
  projectDir,
  onClose,
}: ResumeSheetBodyProps): React.ReactElement {
  // Pick-to-resume: a row click rebinds + resumes (or spawns a new session),
  // then dismisses. Live-elsewhere and loading rows are inert.
  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => {
        const row = dataSource.rowAt(index);
        const connection = getConnection();
        if (!connection) {
          console.warn("ResumeSheet: connection unavailable");
          return;
        }
        if (row.kind === "session-resume") {
          if (row.row.state === "live") return; // can't resume live-elsewhere
          const sessionId = row.row.session_id;
          onClose("resume");
          window.setTimeout(() => {
            fireRestore(cardId, sessionId, projectDir, connection);
          }, SHEET_EXIT_ANIMATION_MS);
        } else if (row.kind === "session-new") {
          const sessionId = crypto.randomUUID();
          onClose("new");
          window.setTimeout(() => {
            sendSpawnSession(connection, cardId, sessionId, projectDir, "new");
          }, SHEET_EXIT_ANIMATION_MS);
        }
        // "loading" — inert.
      },
    }),
    [dataSource, cardId, projectDir, onClose],
  );

  return (
    <div className="resume-sheet">
      {/* The reused session cells read selection / pending-trash from this
          context; a focused pick-to-resume overlay tracks none, so the values
          are inert (no row pre-highlighted, no trash popover pending). */}
      <PickerCellProvider
        value={{
          currentPath: projectDir,
          selection: null,
          pendingTrashSessionId: null,
          pendingTrashRecentPath: null,
        }}
      >
        <div className="resume-sheet-list">
          <TugListView<DevSessionsDataSource>
            dataSource={dataSource}
            delegate={delegate}
            cellRenderers={SESSIONS_CELL_RENDERERS}
            scrollKey="resume-sheet-sessions"
            className="dev-card-picker-sessions-list dev-card-picker-list-view"
          />
        </div>
      </PickerCellProvider>
      <div className="tug-sheet-actions">
        <TugPushButton onClick={() => onClose()} data-testid="resume-cancel">
          Cancel
        </TugPushButton>
      </div>
    </div>
  );
}
