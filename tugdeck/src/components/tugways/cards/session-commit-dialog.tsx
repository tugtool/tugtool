/**
 * `TugCommitDialog` — the transcript-resident commit authoring + landing
 * surface ([P03]–[P06], [P09], [P11]).
 *
 * A user-driven inline dialog mounted in a dedicated slot at the tail of the
 * transcript scroller ([Q02]): `/commit` (or Session ▸ Commit…) opens it via a
 * per-card {@link CommitDialogController}. It composes the proven inline-dialog
 * stack — `TugInlineDialog` + `useFocusTrap` + `useInlineDialogScope` +
 * `useSpatialOrder` — like the Permission/Question dialogs, the one structural
 * difference (user-driven vs. turn-driven) absorbed by the controller.
 *
 * Header actions (trailing cluster): Cancel / Auto-Message / Commit. The body
 * is a `TugMessageEditor` bound to the persisted changeset draft (the
 * draft-sync discipline ported from the retired `DraftComposer`), over a
 * read-only `TugChangesList` of the session's files. Cmd-Return commits
 * (multi-line Return newlines, [P04]); Commit wears `persistentDefaultRing`;
 * Escape / Cmd-. cancels. Auto-Message is a disabled placeholder here — wired
 * with its streamed Bot + wave affordance in the follow-on step.
 *
 * Laws: [L02] the controller + verb/draft stores enter React through
 * `useSyncExternalStore`; [L06] appearance via CSS/DOM; [L11] the editing
 * responders come from the composed `TugMessageEditor`; [L24] `hasText` is a
 * local mirror; [L03] focus registrations are `useLayoutEffect`-based inside
 * the composed hooks.
 *
 * @module components/tugways/cards/session-commit-dialog
 */

import "./session-commit-dialog.css";

import React from "react";
import { Bot, GitCommitHorizontal } from "lucide-react";

import { TugInlineDialog } from "@/components/tugways/tug-inline-dialog";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import {
  TugMessageEditor,
  type TugMessageEditorHandle,
} from "@/components/tugways/tug-message-editor";
import {
  TugChangesList,
  fileExpandKey,
  type TugChangesListEntry,
} from "@/components/tugways/tug-changes-list";
import { useFocusTrap } from "@/components/tugways/use-focus-trap";
import { useSpatialOrder } from "@/components/tugways/use-spatial-order";
import type { SpatialOrder } from "@/components/tugways/spatial-order";
import { useInlineDialogScope } from "@/components/tugways/use-inline-dialog-scope";
import {
  getChangesetDraftStore,
  useChangesetDraft,
} from "@/lib/changeset-draft-store";
import { useChangesetCommit } from "@/lib/changeset-verb-store";
import {
  evaluateCommitLandGate,
  type CommitDialogController,
} from "@/lib/commit-dialog-controller";
import type { ChangesRouteController } from "@/lib/changes-route-controller";
import type { CodeSessionStore } from "@/lib/code-session-store";

/** Hint on the Commit button while a Claude turn runs ([P11]). */
const TURN_GATE_HINT = "Unavailable while a turn is running";

/** The overlay-phase → Auto-Message affordance pose ([P06]). Pure; exported
 *  for the test suite. While the scribe drafts, the wave shows, the editor is
 *  read-only, and the Auto-Message button is disabled; every other phase is
 *  live. */
export type CommitDraftPhase = "idle" | "drafting" | "ready" | "error";

export interface CommitAutoMessagePose {
  editorDisabled: boolean;
  waveVisible: boolean;
  autoMessageDisabled: boolean;
}

export function commitDialogAutoMessagePose(
  phase: CommitDraftPhase,
): CommitAutoMessagePose {
  const drafting = phase === "drafting";
  return {
    editorDisabled: drafting,
    waveVisible: drafting,
    autoMessageDisabled: drafting,
  };
}

/** Debounce for persisting editor edits into the draft ([P05]). */
const DRAFT_EDIT_DEBOUNCE_MS = 300;

/** Tab / spatial order inside the dialog's trapped mode. */
const CANCEL_ORDER = 0;
const AUTO_MESSAGE_ORDER = 1;
const COMMIT_ORDER = 2;

export interface TugCommitDialogProps {
  controller: CommitDialogController;
  changesController: ChangesRouteController;
  codeSessionStore: CodeSessionStore;
}

export function TugCommitDialog({
  controller,
  changesController,
  codeSessionStore,
}: TugCommitDialogProps): React.ReactElement | null {
  const snap = React.useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const isOpen = snap.open;

  const changes = React.useSyncExternalStore(
    changesController.subscribe,
    changesController.getSnapshot,
  );
  const commit = useChangesetCommit(changesController.entryKey);
  const turnInProgress = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().canInterrupt === true,
  );

  const projectDir = changesController.projectDir;
  const ownerId = changesController.tugSessionId;
  const overlay = useChangesetDraft(projectDir, "session", ownerId);

  const editorRef = React.useRef<TugMessageEditorHandle | null>(null);
  const persisted = changes.entry?.draft?.message ?? "";

  // The editor owns the document ([L02]); these refs mirror what's in it —
  // `docRef` the current text (user edits + programmatic seeds), `lastSeededRef`
  // the last programmatic seed. A server echo only lands when there are no
  // unsynced user edits (`doc === lastSeeded`), so it can never eat local
  // typing ([#draft-sync-discipline]).
  const docRef = React.useRef(persisted);
  const lastSeededRef = React.useRef(persisted);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasText, setHasText] = React.useState(() => persisted.trim().length > 0);

  // Streamed generation fills the editor live (programmatic restore) — the
  // Auto-Message stream in the follow-on step rides this same seam.
  React.useEffect(() => {
    if (overlay.phase !== "drafting") return;
    if (overlay.text === docRef.current) return;
    editorRef.current?.restoreState(overlay.text);
    docRef.current = overlay.text;
    lastSeededRef.current = overlay.text;
    setHasText(overlay.text.trim().length > 0);
  }, [overlay.phase, overlay.text]);

  // Persisted-message sync: a seeded `/commit <message>` draft or a finished
  // regeneration lands — only while the field holds no unsynced user edits.
  React.useEffect(() => {
    if (overlay.phase === "drafting") return;
    if (persisted === docRef.current) return;
    if (docRef.current !== lastSeededRef.current) return;
    editorRef.current?.restoreState(persisted);
    docRef.current = persisted;
    lastSeededRef.current = persisted;
    setHasText(persisted.trim().length > 0);
  }, [persisted, overlay.phase]);

  const persistEdit = React.useCallback((): void => {
    debounceRef.current = null;
    getChangesetDraftStore()?.setDraft(projectDir, "session", ownerId, {
      message: docRef.current,
      edited: true,
    });
  }, [projectDir, ownerId]);

  const handleChange = React.useCallback(
    (text: string): void => {
      docRef.current = text;
      setHasText(text.trim().length > 0);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(persistEdit, DRAFT_EDIT_DEBOUNCE_MS);
    },
    [persistEdit],
  );

  // Flush a pending debounce on unmount — never drop the user's words.
  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        persistEdit();
      }
    },
    [persistEdit],
  );

  // The land gate ([P04]/[P09]/[P11]) — drives the Commit disable + hint and is
  // re-checked in the controller's land path.
  const fileCount = changes.committedPaths.size;
  const gate = evaluateCommitLandGate({
    turnInProgress,
    commitPhase: commit.phase,
    message: hasText ? "x" : "",
    fileCount,
  });
  const commitDisabled = !gate.ok;
  const commitHint =
    gate.ok || gate.reason !== "turn" ? undefined : TURN_GATE_HINT;

  const land = React.useCallback((): void => {
    controller.land(docRef.current);
  }, [controller]);

  const handleCancel = React.useCallback((): void => {
    controller.hide();
  }, [controller]);

  // Auto-Message ([P06]) — the scribe draft on demand. The pose gates the
  // editor + button off the overlay phase; an `edited` draft interposes a
  // confirm before the machine overwrite (the `DraftComposer` pattern).
  const pose = commitDialogAutoMessagePose(overlay.phase);
  const edited = changes.entry?.draft?.edited === true;
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const regenerate = React.useCallback((): void => {
    changesController.requestDraft(true);
  }, [changesController]);
  const handleAutoMessage = React.useCallback((): void => {
    if (edited) setConfirmOpen(true);
    else regenerate();
  }, [edited, regenerate]);

  // Re-claim the caret when a draft finishes streaming (drafting → ready), so
  // the user can edit the generated message immediately.
  const prevPhaseRef = React.useRef(overlay.phase);
  React.useEffect(() => {
    if (prevPhaseRef.current === "drafting" && overlay.phase === "ready") {
      editorRef.current?.focus();
    }
    prevPhaseRef.current = overlay.phase;
  }, [overlay.phase]);

  // Per-file collapse state (dialog-owned, [L24]/[L26]).
  const [expandedKeys, setExpandedKeys] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onToggleFile = React.useCallback(
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

  // Focus / modality — the card-modal inline-dialog stack ([P03]).
  const focusGroup = React.useId();
  const { FocusModeScope, scopeId } = useFocusTrap({
    active: isOpen,
    onEscapeDismiss: handleCancel,
  });
  const cancelKey = `${focusGroup}:${CANCEL_ORDER}`;
  const autoKey = `${focusGroup}:${AUTO_MESSAGE_ORDER}`;
  const commitKey = `${focusGroup}:${COMMIT_ORDER}`;
  const spatialOrder = React.useMemo<SpatialOrder>(
    () => ({
      rings: [
        { axis: "horizontal", nodes: [cancelKey, autoKey, commitKey], closed: true },
      ],
      seams: [],
    }),
    [cancelKey, autoKey, commitKey],
  );
  useSpatialOrder(scopeId, isOpen ? spatialOrder : null);
  const { attachRoot } = useInlineDialogScope({
    active: isOpen,
    defaultFocusKey: commitKey,
    onCancel: handleCancel,
  });
  // Compose the scope's root ref with our own hold on the element so the
  // confirm popover can anchor to the Auto-Message button inside it.
  const rootElRef = React.useRef<HTMLDivElement | null>(null);
  const setRoot = React.useCallback(
    (el: HTMLDivElement | null): void => {
      rootElRef.current = el;
      attachRoot(el);
    },
    [attachRoot],
  );

  // Claim the caret on the editor when the dialog opens (microtask-deferred so
  // it runs after the trap's focus write and the reveal scroll settle). The
  // reference_cm6_editor_in_descend_scope pattern.
  const wasOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      queueMicrotask(() => editorRef.current?.focus());
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // The surface owns Escape ([P04]): the focused multi-line editor advertises
  // `data-tug-tab-consume` (it owns Tab to indent), which makes the engine's
  // Escape ladder yield Escape to the editor to close an open completion. This
  // editor has no completion, so a capture-phase Escape on the dialog root
  // cancels the dialog before the editor swallows the key. A modified Escape
  // (or one already inside a portalled popover) is left alone.
  React.useEffect(() => {
    if (!isOpen) return;
    const el = rootElRef.current;
    if (el === null) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (
        e.key === "Escape" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      }
    };
    el.addEventListener("keydown", onKeyDown, true);
    return () => el.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, handleCancel]);

  if (!isOpen) return null;

  // The head entries the list renders — the session entry plus the project's
  // unattributed files (awareness), same as the read-only shade.
  const listEntries: TugChangesListEntry[] = [];
  if (changes.entry !== null && changes.entry.files.length > 0) {
    listEntries.push({
      kind: "session",
      id: changesController.entryKey,
      project: changes.project,
      entry: changes.entry,
    });
  }
  if (changes.unattributed.length > 0) {
    listEntries.push({
      kind: "unattributed",
      id: `unattributed:${changes.project.project_dir}`,
      project: changes.project,
      files: changes.unattributed,
    });
  }
  return (
    <FocusModeScope>
      <div
        ref={setRoot}
        className="session-commit-dialog"
        data-slot="session-commit-dialog"
      >
        <TugInlineDialog
          icon={<GitCommitHorizontal />}
          iconRole="default"
          title="Commit"
          actions={
            <>
              <TugPushButton
                emphasis="ghost"
                role="action"
                size="xs"
                focusGroup={focusGroup}
                focusOrder={CANCEL_ORDER}
                onClick={handleCancel}
                data-testid="session-commit-dialog-cancel"
              >
                Cancel
              </TugPushButton>
              <TugPushButton
                emphasis="outlined"
                role="action"
                size="xs"
                focusGroup={focusGroup}
                focusOrder={AUTO_MESSAGE_ORDER}
                disabled={pose.autoMessageDisabled}
                title="Generate a commit message"
                onClick={handleAutoMessage}
                data-testid="session-commit-dialog-auto-message"
              >
                Auto-Message
              </TugPushButton>
              <TugPushButton
                emphasis="primary"
                role="action"
                size="xs"
                focusGroup={focusGroup}
                focusOrder={COMMIT_ORDER}
                persistentDefaultRing
                disabled={commitDisabled}
                title={commitHint}
                widthStabilize={{ alternateLabel: "Committing…" }}
                onClick={land}
                data-testid="session-commit-dialog-commit"
              >
                {commit.phase === "pending" ? "Committing…" : "Commit"}
              </TugPushButton>
            </>
          }
        >
          <div className="session-commit-dialog-body">
            {pose.waveVisible ? (
              <div
                className="session-commit-dialog-drafting"
                data-slot="session-commit-dialog-drafting"
              >
                <span className="session-commit-dialog-drafting-avatar" aria-hidden>
                  <Bot size={14} strokeWidth={2} />
                </span>
                <TugProgressIndicator
                  variant="wave"
                  state="running"
                  role="inherit"
                  size={12}
                  aria-label="Drafting…"
                  aria-live="polite"
                />
                <span className="session-commit-dialog-drafting-label">Drafting…</span>
              </div>
            ) : null}
            <TugMessageEditor
              ref={editorRef}
              value={persisted}
              onChange={handleChange}
              onSubmit={land}
              placeholder="Write a commit message, or use Auto-Message."
              lineWrap
              disabled={pose.editorDisabled}
              aria-label="Commit message"
              data-testid="session-commit-dialog-editor"
              className="session-commit-dialog-editor"
            />
            {overlay.phase === "error" && overlay.detail !== null ? (
              <div className="session-commit-dialog-error" role="status">
                {overlay.detail ?? "Draft generation failed."}
              </div>
            ) : null}
            {commit.phase === "error" && commit.error !== null ? (
              <div className="session-commit-dialog-error" role="alert">
                {commit.error}
              </div>
            ) : null}
            {listEntries.length > 0 ? (
              <TugChangesList
                entries={listEntries}
                ownSessionId={changesController.tugSessionId}
                expandedKeys={expandedKeys}
                onToggleFile={onToggleFile}
                unattributedLabel="unattributed — no session claims these"
                className="session-commit-dialog-changes"
              />
            ) : (
              <div className="session-commit-dialog-empty" role="status">
                No changes to commit.
              </div>
            )}
          </div>
        </TugInlineDialog>
        <TugConfirmPopover
          open={confirmOpen}
          anchorEl={
            rootElRef.current?.querySelector<HTMLElement>(
              '[data-testid="session-commit-dialog-auto-message"]',
            ) ?? rootElRef.current
          }
          message="Replace your edited message with a regenerated draft?"
          confirmLabel="Regenerate"
          confirmRole="action"
          onConfirm={() => {
            setConfirmOpen(false);
            regenerate();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    </FocusModeScope>
  );
}
