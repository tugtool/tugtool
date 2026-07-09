/**
 * FileCard — the File card body: open a text file from disk, edit it in
 * a `TugFileEditor`, with live autosave-in-place.
 *
 * Saveless model: the card's `FileEditorStore` continuously writes the
 * buffer through to disk (debounced), so the card has no dirty state
 * and no close protection — closing is always safe. What persists in
 * the card bag is positions only (`{ path, anchor, scrollTop }`);
 * content always comes from disk on restore.
 *
 * Body states, rendered from the store snapshot:
 *
 *   - `empty`   — a `TugFileChooser` open surface (type a path, or the
 *     native Browse picker); Enter / Open binds the card to the path.
 *   - `loading` — quiet placeholder while the first read is in flight.
 *   - `ready`   — the editor. Mounted ONCE per file binding and kept
 *     mounted across every autosave sub-state (clean / editing /
 *     writing / conflict) — the conflict banner renders ALONGSIDE the
 *     editor, never in its place, so scroll, selection, and the undo
 *     stack survive the moment the user must choose ([L26]: one
 *     component, stable key/type/renderer across the transition).
 *   - `error`   — read failure detail with a Try Again affordance.
 *
 * Conflict banner: `TugPaneBanner` (card-scoped, error variant). Its
 * footer buttons drive `store.resolveConflict` — "Reload from disk"
 * replaces the buffer; "Keep mine" re-issues the write against the
 * disk hash the conflict reported. A missing-file conflict (deleted
 * under the editor) offers Close only; the buffer is preserved and
 * autosave paused until the user chooses.
 *
 * Read-only files: the store never arms autosave and the editor
 * mounts read-only; the title shows a lock suffix.
 *
 * Laws: [L02] all rendering from the store via `useSyncExternalStore`;
 * [L03] lifecycle registrations in `useLayoutEffect`; [L06] no React
 * state for appearance; [L09]/[L10] the card supplies content only —
 * pane owns geometry/chrome; [L23]/[L26] see body-state notes above.
 *
 * @module components/tugways/cards/file-card
 */

import "./file-card.css";

import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { FileEditorStore, type FilePositions } from "@/lib/file-editor-store";
import { cardTitleStore } from "@/lib/card-title-store";
import {
  registerOpenFileCard,
  unregisterOpenFileCard,
} from "@/lib/file-card-open-registry";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { TugFileEditor, type TugFileEditorDelegate } from "../tug-file-editor";
import { TugFileChooser } from "../tug-file-chooser";
import { TugPaneBanner } from "../tug-pane-banner";
import { TugPushButton } from "../tug-push-button";
import { TugIconButton } from "../tug-icon-button";
import { TugInput } from "../tug-input";
import { TugLabel } from "../tug-label";
import { FileCardTopBar } from "./file-card-top-bar";
import { FileCardStatusBar } from "./file-card-status-bar";
import { useFileEditorSettings } from "@/lib/use-file-editor-settings";
import { EditorStatsStore } from "@/lib/editor-stats-store";
import {
  extensionForLanguageId,
  languageIdForPath,
} from "@/lib/language-registry";
import type { LineEnding } from "@/lib/file-editor-store";
import { isPathPickerAvailable, pickPath } from "@/lib/native-path-picker";
import {
  useCardId,
  useCardStatePreservation,
} from "../use-card-state-preservation";
import { useResponderChain } from "../responder-chain-provider";
import { TUG_ACTIONS } from "../action-vocabulary";

// ---------------------------------------------------------------------------
// Bag payload
// ---------------------------------------------------------------------------

/** Positions-only persistence payload — never file content. */
export interface FileCardBagContent {
  /** Bound file path; null for an untitled draft. */
  path: string | null;
  /** Draft id for an untitled buffer (content autosaves under the
   * drafts directory); null for a path-bound card. */
  draftId: string | null;
  anchor: { line: number; ch: number };
  scrollTop: number;
}

/** Narrow an unknown restored bag payload. */
function coerceBagContent(state: unknown): FileCardBagContent | null {
  if (state === null || typeof state !== "object") return null;
  const obj = state as Record<string, unknown>;
  const path = typeof obj.path === "string" ? obj.path : null;
  const draftId = typeof obj.draftId === "string" ? obj.draftId : null;
  if (path === null && draftId === null) return null;
  const anchor = obj.anchor as Record<string, unknown> | undefined;
  return {
    path,
    draftId,
    anchor: {
      line: typeof anchor?.line === "number" ? anchor.line : 1,
      ch: typeof anchor?.ch === "number" ? anchor.ch : 0,
    },
    scrollTop: typeof obj.scrollTop === "number" ? obj.scrollTop : 0,
  };
}

// ---------------------------------------------------------------------------
// Human-readable error copy
// ---------------------------------------------------------------------------

function describeReadError(kind: string, size?: number): string {
  switch (kind) {
    case "not_found":
      return "The file does not exist.";
    case "denied":
      return "Tug can't open this file (permission refused or a protected file type).";
    case "binary":
      return "This file isn't text — binary content can't be edited here.";
    case "too_large":
      return `This file is too large to edit here${
        size !== undefined ? ` (${Math.round(size / (1024 * 1024))} MB)` : ""
      }.`;
    case "bad_path":
      return "That path isn't a file Tug can open.";
    case "network":
      return "Tug couldn't reach its file service.";
    default:
      return "The file couldn't be opened.";
  }
}

// ---------------------------------------------------------------------------
// FileCardContent
// ---------------------------------------------------------------------------

export function FileCardContent({ cardId }: { cardId: string }) {
  // One autosave engine per mounted card body. Disk is authoritative
  // and positions ride the bag, so recreating the store on a cold
  // remount is cheap — it re-reads the file.
  const [store] = useState(() => new FileEditorStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const editorRef = useRef<TugFileEditorDelegate | null>(null);
  const manager = useResponderChain();
  const senderId = useId();

  // Card-local editor settings, seeded from the deck-wide File-editor
  // defaults on first open, then owned by this card ([D07] pattern).
  const { settings: editorSettings, setSetting } = useFileEditorSettings(cardId);

  // Live editor stats (caret + counts) for the bottom status bar. The
  // editor writes it; the status bar reads it — so keystroke-rate
  // updates repaint only the strip, not the editor.
  const [statsStore] = useState(() => new EditorStatsStore());

  // Card-local syntax override from the status-bar file-type popup;
  // null = follow the file's extension. Reset when the card rebinds to
  // a different file (Move To…), so a new file starts on auto-detect.
  const [languageOverrideId, setLanguageOverrideId] = useState<string | null>(
    null,
  );
  useLayoutEffect(() => {
    setLanguageOverrideId(null);
  }, [snapshot.path]);
  const effectiveLanguageId =
    languageOverrideId ?? languageIdForPath(snapshot.path);
  const effectiveLanguageExt = extensionForLanguageId(effectiveLanguageId);

  // Status-bar line-ending popup: convert the buffer's newlines (arms
  // autosave) and reflect the choice immediately.
  const setLineEnding = useCallback(
    (ending: LineEnding) => {
      editorRef.current?.applyLineEnding(ending);
      store.noteLineEnding(ending);
    },
    [store],
  );

  // Chooser input value (empty state only). Controlled-input local
  // data; the committed value is the store's `path` binding.
  const [chooserValue, setChooserValue] = useState("");

  // Find bar: open/closed is structural (the bar mounts/unmounts);
  // the query is controlled-input local data driving the editor's
  // search machinery through the delegate.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const openFindBar = useCallback(() => {
    setFindOpen(true);
    // Focus after the bar mounts.
    requestAnimationFrame(() => findInputRef.current?.focus());
  }, []);

  const closeFindBar = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindMatches(0);
    editorRef.current?.clearSearch();
    editorRef.current?.focus();
  }, []);

  const updateFindQuery = useCallback((value: string) => {
    setFindQuery(value);
    const editor = editorRef.current;
    if (editor === null) return;
    editor.setSearchQuery({ search: value });
    setFindMatches(value === "" ? 0 : editor.getMatchCount());
  }, []);

  // Positions restored from the bag before the editor exists; applied
  // once the file binds and the editor attaches.
  const pendingPositionsRef = useRef<FilePositions | null>(null);

  const openPath = useCallback(
    (path: string) => {
      const trimmed = path.trim();
      if (trimmed === "") return;
      void store.openPath(trimmed);
    },
    [store],
  );

  // Move To… / Save As… — NSSavePanel chooses the new path; the store
  // re-anchors the buffer there (and GCs the old draft).
  const saveAs = useCallback(() => {
    const snap = store.getSnapshot();
    void pickPath("save", snap.draftId !== null ? undefined : (snap.path ?? undefined)).then(
      (newPath) => {
        if (newPath === null) return;
        void store.saveAs(newPath);
      },
    );
  }, [store]);

  // ---- Card state preservation (positions only, [P07]) ----

  useCardStatePreservation<FileCardBagContent | undefined>({
    onSave: () => {
      // Deactivation is a hard flush point; fire-and-forget with
      // keepalive so the write survives teardown. The bag itself is
      // synchronous — positions only.
      void store.flush({ keepalive: true });
      const snap = store.getSnapshot();
      if (snap.path === null && snap.draftId === null) return undefined;
      const positions = store.snapshotPositions();
      return {
        path: snap.draftId !== null ? null : snap.path,
        draftId: snap.draftId,
        anchor: positions?.anchor ?? { line: 1, ch: 0 },
        scrollTop: positions?.scrollTop ?? 0,
      };
    },
    onRestore: (state) => {
      const content = coerceBagContent(state);
      if (content === null) return;
      pendingPositionsRef.current = {
        anchor: content.anchor,
        scrollTop: content.scrollTop,
      };
      if (content.draftId !== null) {
        void store.openDraft(content.draftId);
      } else if (content.path !== null) {
        void store.openPath(content.path);
      }
    },
    onCardActivated: () => {
      editorRef.current?.focus();
    },
  });

  // ---- open-file reuse registry ----

  useLayoutEffect(() => {
    registerOpenFileCard(cardId, {
      getPath: () => store.getSnapshot().path,
      revealLine: (line) => editorRef.current?.revealLine(line),
      openFile: (path, line) => {
        // Reuse this card for a different file: flush the current
        // buffer first (autosave may have pending edits), then open the
        // new path and land on `line` via the pending-positions channel
        // — the same restore path a fresh open-at-line takes.
        pendingPositionsRef.current = {
          anchor: { line: line ?? 1, ch: 0 },
          scrollTop: 0,
        };
        void store.flush().then(() => store.openPath(path));
      },
    });
    return () => {
      unregisterOpenFileCard(cardId);
    };
  }, [cardId, store]);

  // ---- Store lifecycle + final flush ----

  useLayoutEffect(() => {
    const flushOnHide = () => {
      void store.flush({ keepalive: true });
    };
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", flushOnHide);
    return () => {
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", flushOnHide);
      void store.flush({ keepalive: true });
      store.dispose();
    };
  }, [store]);

  // ---- Title sync (basename → pane chrome via cardTitleStore) ----

  useLayoutEffect(() => {
    if (snapshot.fileName !== null) {
      cardTitleStore.set(
        cardId,
        snapshot.readOnly ? `${snapshot.fileName} (read-only)` : snapshot.fileName,
      );
    } else {
      cardTitleStore.clear(cardId);
    }
    return () => {
      cardTitleStore.clear(cardId);
    };
  }, [cardId, snapshot.fileName, snapshot.readOnly]);

  // ---- Apply restored positions once the file binds ----

  useLayoutEffect(() => {
    if (snapshot.phase !== "ready") return;
    const pending = pendingPositionsRef.current;
    if (pending === null) return;
    pendingPositionsRef.current = null;
    store.applyPositions(pending);
  }, [snapshot.phase, store]);

  // ---- Render ----

  if (snapshot.phase === "empty" || snapshot.phase === "loading") {
    return (
      <div className="file-card file-card--open" data-slot="file-card">
        <div className="file-card-open-surface">
          <TugLabel className="file-card-open-prompt">Open a file</TugLabel>
          <div className="file-card-open-row">
            <TugFileChooser
              value={chooserValue}
              onChange={setChooserValue}
              base="/"
              kind="file"
              placeholder="/path/to/file or ~/path/to/file"
              aria-label="File path"
              autoFocus
              onSubmit={() => openPath(chooserValue)}
              disabled={snapshot.phase === "loading"}
            />
            <TugPushButton
              onClick={() => openPath(chooserValue)}
              disabled={snapshot.phase === "loading" || chooserValue.trim() === ""}
            >
              Open
            </TugPushButton>
          </div>
          <div className="file-card-open-alt">
            <TugPushButton
              data-testid="file-card-new-draft"
              onClick={() => {
                void store.openDraft(cardId);
              }}
              disabled={snapshot.phase === "loading"}
            >
              New Untitled File
            </TugPushButton>
          </div>
        </div>
      </div>
    );
  }

  if (snapshot.phase === "error") {
    return (
      <div className="file-card file-card--error" data-slot="file-card">
        <div className="file-card-error-surface">
          <TugLabel className="file-card-error-message">
            {describeReadError(
              snapshot.error?.kind ?? "internal",
              snapshot.error?.size,
            )}
          </TugLabel>
          <TugLabel className="file-card-error-path">
            {snapshot.path ?? ""}
          </TugLabel>
          <TugPushButton
            onClick={() => {
              if (snapshot.path !== null) openPath(snapshot.path);
            }}
          >
            Try Again
          </TugPushButton>
        </div>
      </div>
    );
  }

  // `ready` — the editor plus (possibly) the conflict banner, mounted
  // side by side. The editor's mount identity is stable across every
  // autosave sub-state [L26].
  const conflict = snapshot.conflict;
  return (
    <div className="file-card file-card--editor" data-slot="file-card">
      <FileCardTopBar
        path={snapshot.path}
        isDraft={snapshot.draftId !== null}
        canMoveTo={snapshot.draftId !== null && isPathPickerAvailable()}
        onMoveTo={saveAs}
        settings={editorSettings}
        onChangeSetting={setSetting}
      />
      {findOpen ? (
        <div className="file-card-find-bar" data-slot="file-card-find-bar">
          <TugInput
            ref={findInputRef}
            size="sm"
            value={findQuery}
            placeholder="Find in file"
            aria-label="Find in file"
            data-testid="file-card-find-input"
            onChange={(e) => updateFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) editorRef.current?.findPrevious();
                else editorRef.current?.findNext();
              } else if (e.key === "Escape") {
                closeFindBar();
              }
            }}
          />
          <TugLabel size="sm" className="file-card-find-count">
            {findQuery === "" ? "" : `${findMatches} matches`}
          </TugLabel>
          <TugIconButton
            icon={<ChevronUp />}
            aria-label="Previous match"
            onClick={() => editorRef.current?.findPrevious()}
          />
          <TugIconButton
            icon={<ChevronDown />}
            aria-label="Next match"
            onClick={() => editorRef.current?.findNext()}
          />
          <TugIconButton
            icon={<X />}
            aria-label="Close find"
            onClick={closeFindBar}
          />
        </div>
      ) : null}
      <TugFileEditor
        ref={editorRef}
        store={store}
        readOnly={snapshot.readOnly}
        settings={editorSettings}
        languageExt={effectiveLanguageExt}
        className="file-card-editor"
        onFindRequested={openFindBar}
        onStats={statsStore.set}
      />
      <FileCardStatusBar
        statsStore={statsStore}
        saveState={snapshot.saveState}
        lastSavedAt={snapshot.lastSavedAt}
        lineEnding={snapshot.lineEnding}
        onSetLineEnding={setLineEnding}
        languageId={effectiveLanguageId}
        onSetLanguage={setLanguageOverrideId}
      />
      <TugPaneBanner
        visible={conflict !== null}
        variant="error"
        tone="caution"
        label={conflict?.reason === "missing" ? "File deleted" : "File changed"}
        message={
          conflict?.reason === "missing"
            ? "This file was deleted on disk. Your buffer is preserved until you close the card."
            : "This file changed on disk while you were editing."
        }
        footer={
          conflict?.reason === "missing" ? (
            <>
              {isPathPickerAvailable() ? (
                <TugPushButton
                  data-testid="file-card-missing-save-as"
                  onClick={saveAs}
                >
                  Save As…
                </TugPushButton>
              ) : null}
              <TugPushButton
                data-testid="file-card-missing-close"
                onClick={() => {
                  // Close the card via the chain: the walk from the card
                  // reaches the host pane's CLOSE handler ([L11] — the
                  // pane owns the card list this action mutates).
                  manager?.sendToTarget(cardId, {
                    action: TUG_ACTIONS.CLOSE,
                    sender: senderId,
                    phase: "discrete",
                  });
                }}
              >
                Close
              </TugPushButton>
            </>
          ) : (
            <>
              <TugPushButton
                data-testid="file-card-conflict-reload"
                onClick={() => {
                  void store.resolveConflict("reload");
                }}
              >
                Reload from Disk
              </TugPushButton>
              <TugPushButton
                data-testid="file-card-conflict-overwrite"
                role="destructive"
                onClick={() => {
                  void store.resolveConflict("overwrite");
                }}
              >
                Keep Mine
              </TugPushButton>
            </>
          )
        }
      />
    </div>
  );
}

/** CardHost-facing wrapper that resolves its own cardId from context. */
export function FileCardBody() {
  const cardId = useCardId();
  return <FileCardContent cardId={cardId ?? ""} />;
}
