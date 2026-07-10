/**
 * FileCard — the File card body: open a text file from disk, edit it in
 * a `TugFileEditor`, and save it in one of two modes.
 *
 * Save modes (from the deck-wide `save-mode` default, resolved by the
 * store): **manual** — the classic document model, with dirty state, a
 * crash-safety set-aside record, explicit Save / Save As… / Save a Copy… /
 * Revert / Reload, and a close guard that prompts when the buffer is dirty;
 * **automatic** — live autosave-in-place with no dirty state, where closing
 * is always safe. The card bag persists positions only
 * (`{ path, anchor, scrollTop }`); content comes from disk (or the aside)
 * on restore.
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
 * Conflict UX: automatic mode renders a card-scoped `TugPaneBanner`
 * (error variant) whose footer buttons drive `store.resolveConflict` —
 * "Reload from disk" replaces the buffer, "Keep mine" re-issues the write
 * against the disk hash the conflict reported. Manual mode raises the modal
 * save sheets (see `file-card-save-sheets`) for external-change,
 * missing-file, revert, reload, and open-time aside conflicts. Either way
 * the buffer is preserved until the user chooses.
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
import { registerCardCloseGuard } from "@/lib/card-close-guard";
import {
  publishFileMenuState,
  clearFileMenuState,
} from "@/lib/host-menu-state";
import { readSaveMode } from "@/lib/open-file-in-card";
import { reserveUntitledNumber } from "@/lib/untitled-naming";
import { noteRecentDocument } from "@/lib/recent-documents";
import { openPathInOS } from "@/lib/os-open";
import { useTugSheet } from "@/components/tugways/tug-sheet";
import { useFileSaveSheets } from "./file-card-save-sheets";
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
import { useFocusManager } from "../use-focusable";
import { useCardDelegate, useCardLifecycle } from "@/lib/card-lifecycle";
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
  /** True when the buffer is a manual-mode untitled buffer —
   * restore re-enters `openUntitled` and finds the aside. */
  untitled: boolean;
  /** Session number behind the untitled name ("Untitled-2", …); null
   * for a titled card or a legacy bag. */
  untitledNumber: number | null;
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
    untitled: obj.untitled === true,
    untitledNumber:
      typeof obj.untitledNumber === "number" ? obj.untitledNumber : null,
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
  const [store] = useState(() => new FileEditorStore({ saveMode: readSaveMode() }));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const isManual = snapshot.saveMode === "manual";
  const isDirty = snapshot.saveState !== "clean";
  const editorRef = useRef<TugFileEditorDelegate | null>(null);
  const manager = useResponderChain();
  const cardLifecycle = useCardLifecycle();
  const focusManager = useFocusManager();
  const senderId = useId();

  // Pane-modal sheet host for the manual save/close/conflict sheets.
  // `renderSheet()` is mounted once in the card body.
  const { showSheet, renderSheet } = useTugSheet();
  const sheets = useFileSaveSheets(showSheet);

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

  // Status-bar line-ending popup: the store owns the on-disk newline
  // representation (applied at the write boundary) and re-serializes.
  const setLineEnding = useCallback(
    (ending: LineEnding) => store.setLineEnding(ending),
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
  // re-anchors the buffer there (and GCs the old draft). Resolves whether
  // a path was chosen and written (the close guard awaits it).
  const runSaveAsPanel = useCallback(async (): Promise<boolean> => {
    const snap = store.getSnapshot();
    const initial = snap.draftId !== null ? undefined : (snap.path ?? undefined);
    // Untitled buffer: seed the panel with its session name ("Untitled-2").
    const suggested =
      snap.untitled && snap.fileName !== null ? snap.fileName : undefined;
    const newPath = await pickPath("save", initial, suggested);
    if (newPath === null) return false;
    // Report the real write outcome — not merely "a path was picked" — so
    // the close guard only proceeds to destroy the card when the buffer
    // actually reached disk. A swallowed failure here is silent data loss.
    const ok = (await store.saveAs(newPath)) === "ok";
    // A successful Save As creates (and binds) a document — a recent.
    if (ok) noteRecentDocument(newPath);
    return ok;
  }, [store]);
  const saveAs = useCallback(() => {
    void runSaveAsPanel();
  }, [runSaveAsPanel]);

  // Reveal the bound file in the Finder (path click) — opens Finder with
  // the file itself selected inside its folder, not merely the folder.
  const revealInFinder = useCallback(() => {
    const path = store.getSnapshot().path;
    if (path === null) return;
    openPathInOS(path, "reveal");
  }, [store]);

  // Save a Copy… — write the buffer elsewhere without rebinding or
  // clearing the dirty bit.
  const runSaveACopy = useCallback(async () => {
    const newPath = await pickPath("save", store.getSnapshot().path ?? undefined);
    if (newPath === null) return;
    await store.saveACopy(newPath);
  }, [store]);

  // Save (⌘S / File ▸ Save) — manual explicit save; an untitled buffer
  // routes through the save panel.
  const doSave = useCallback(async (): Promise<boolean> => {
    const result = await store.save();
    if (result === "needs-path") return runSaveAsPanel();
    // conflict / missing → the presentation effect raises the sheet.
    return result === "ok";
  }, [store, runSaveAsPanel]);

  // Revert to Saved — confirm, then discard edits back to disk.
  const doRevert = useCallback(async () => {
    const ok = await sheets.presentRevertSheet(
      store.getSnapshot().fileName ?? "Untitled",
    );
    if (ok) await store.revertToSaved();
  }, [store, sheets]);

  // Reload from Disk — confirm only while dirty; a clean buffer reloads
  // without a sheet.
  const doReload = useCallback(async () => {
    const snap = store.getSnapshot();
    if (snap.saveState === "clean") {
      await store.reloadFromDisk();
      return;
    }
    const ok = await sheets.presentReloadSheet(snap.fileName ?? "Untitled");
    if (ok) await store.reloadFromDisk();
  }, [store, sheets]);

  // Single dispatcher wired to the editor's save-verb chain actions.
  const onSaveCommand = useCallback(
    (
      command:
        | "save"
        | "save-as"
        | "save-a-copy"
        | "revert-to-saved"
        | "reload-from-disk",
    ) => {
      switch (command) {
        case "save":
          void doSave();
          break;
        case "save-as":
          void runSaveAsPanel();
          break;
        case "save-a-copy":
          void runSaveACopy();
          break;
        case "revert-to-saved":
          void doRevert();
          break;
        case "reload-from-disk":
          void doReload();
          break;
      }
    },
    [doSave, runSaveAsPanel, runSaveACopy, doRevert, doReload],
  );

  // ---- Focus destination reclaim ([P20], focus-language.md) ----
  //
  // A title-bar interaction (a reposition drag, or even a zero-move click)
  // promotes the pane as first responder and fires `cardDidMove`. Without
  // restoring the card's focus destination, the editor is no longer the
  // first responder, and every first-responder-routed accelerator —
  // notably ⌘S `save` — walks up from the wrong node and misses the
  // editor's handler. Re-assert the destination through the sanctioned
  // gate: an open card-modal sheet keeps its key view (`adoptKeyCard`),
  // otherwise focus the editor (which re-promotes it via `focusin`). This
  // is the same reclaim the Dev card runs; it is what keeps
  // `sendToFirstResponder` reliable across moves.
  const reclaimFocusDestination = useCallback((): void => {
    if (cardLifecycle?.getFirstResponderCardId() !== cardId) return;
    if (focusManager?.adoptKeyCard(cardId) === true) return;
    // `focusResponder`, not a bare `editor.focus()`: it promotes the editor
    // to first responder BEFORE focusing, so it repairs the case where the
    // editor still holds DOM focus but the chain first responder was pulled
    // onto the pane by a title-bar drag (a bare focus() would no-op).
    const editorResponderId = editorRef.current?.responderId();
    if (editorResponderId !== undefined && manager) {
      manager.focusResponder(editorResponderId);
    } else {
      editorRef.current?.focus();
    }
  }, [cardLifecycle, focusManager, cardId, manager]);

  useCardDelegate(cardId, {
    cardDidMove: () => reclaimFocusDestination(),
    cardDidResize: () => reclaimFocusDestination(),
  });

  // ---- Card state preservation (positions only) ----

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
        untitled: snap.untitled,
        untitledNumber: snap.untitledNumber,
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
      if (content.untitled && content.draftId !== null) {
        // Raise the session floor so a fresh untitled card never reuses
        // this restored number, then rebind under the same name.
        if (content.untitledNumber !== null) {
          reserveUntitledNumber(content.untitledNumber);
        }
        void store.openUntitled(
          content.draftId,
          content.untitledNumber ?? undefined,
        );
      } else if (content.draftId !== null) {
        void store.openDraft(content.draftId);
      } else if (content.path !== null) {
        void store.openPath(content.path);
      }
    },
    onCardActivated: () => {
      // Resolve the destination through the same gate as the move reclaim,
      // so an open sheet keeps its key view rather than being clobbered by
      // a raw editor focus (focus-language.md L68).
      reclaimFocusDestination();
      // Focus-time recheck: files outside the watcher's workspace roots
      // get no FILESYSTEM events, so activation is when an external change
      // is caught.
      void store.recheckOnActivation();
    },
  });

  // ---- open-file reuse registry ----

  useLayoutEffect(() => {
    registerOpenFileCard(cardId, {
      getPath: () => store.getSnapshot().path,
      isDirty: () => store.getSnapshot().saveState !== "clean",
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

  // ---- Close guard (manual mode) ----
  //
  // A dirty manual buffer must not die silently. Register in a layout
  // effect ([L03]: a close gesture may fire before a passive effect
  // commits, mirroring the open-file registration above); the release
  // returned by `registerCardCloseGuard` runs on cleanup ([L27]).
  useLayoutEffect(() => {
    if (!isManual) return;
    return registerCardCloseGuard(cardId, {
      // The pane activates this card before running the sheet when the
      // buffer is dirty, so the user decides looking at the content.
      needsDecision: () => store.getSnapshot().saveState !== "clean",
      run: async () => {
        const snap = store.getSnapshot();
        if (snap.saveState === "clean") return "close";
        const choice = await sheets.presentCloseSheet(snap.fileName ?? "Untitled");
        if (choice === "cancel") return "cancel";
        if (choice === "dont-save") {
          await store.discardAside();
          return "close";
        }
        const result = await store.save();
        if (result === "needs-path") {
          return (await runSaveAsPanel()) ? "close" : "cancel";
        }
        return result === "ok" ? "close" : "cancel";
      },
    });
  }, [isManual, cardId, store, sheets, runSaveAsPanel]);

  // ---- Conflict / missing sheet presentation (manual mode) ----
  //
  // A store `conflict` in manual mode is a modal sheet, not
  // the automatic-mode banner. Single-flight via a ref so a snapshot
  // change while the sheet is up never stacks a second one; Cancel leaves
  // the conflict set (the status-bar badge) without re-prompting.
  const conflictSheetUpRef = useRef(false);
  useLayoutEffect(() => {
    if (!isManual) return;
    const conflict = snapshot.conflict;
    if (conflict === null || conflictSheetUpRef.current) return;
    conflictSheetUpRef.current = true;
    const fileName = snapshot.fileName ?? "Untitled";
    void (async () => {
      if (conflict.reason === "missing") {
        const choice = await sheets.presentMissingSheet(fileName);
        if (choice === "save") {
          // Recreate the deleted file. If another process recreated the
          // path meanwhile, this returns a hash conflict — present it here
          // rather than clobber the reappeared file silently.
          if ((await store.resolveMissing()) === "conflict") {
            const c = await sheets.presentConflictSheet(fileName);
            if (c === "save-anyway") await store.resolveConflict("overwrite");
            else if (c === "reload") await store.resolveConflict("reload");
            else if (c === "save-as") await runSaveAsPanel();
          }
        } else if (choice === "save-as") {
          await runSaveAsPanel();
        } else if (choice === "dont-save") {
          // Free the user from the "jail": drop the aside (which also marks
          // the buffer clean, so the close guard won't re-prompt) and close.
          await store.discardAside();
          manager?.sendToTarget(cardId, {
            action: TUG_ACTIONS.CLOSE,
            sender: senderId,
            phase: "discrete",
          });
        }
      } else {
        const choice = await sheets.presentConflictSheet(fileName);
        if (choice === "save-anyway") await store.resolveConflict("overwrite");
        else if (choice === "reload") await store.resolveConflict("reload");
        else if (choice === "save-as") await runSaveAsPanel();
      }
      conflictSheetUpRef.current = false;
    })();
  }, [
    isManual,
    snapshot.conflict,
    snapshot.fileName,
    store,
    sheets,
    runSaveAsPanel,
    manager,
    cardId,
    senderId,
  ]);

  // ---- Open-time aside conflict sheet ----
  const asideConflictUpRef = useRef(false);
  useLayoutEffect(() => {
    const pending = snapshot.pendingAsideConflict;
    if (pending === null || asideConflictUpRef.current) return;
    asideConflictUpRef.current = true;
    const fileName = snapshot.fileName ?? "Untitled";
    void sheets.presentOpenConflictSheet(fileName).then((choice) => {
      store.resolveAsideConflict(choice);
      asideConflictUpRef.current = false;
    });
  }, [snapshot.pendingAsideConflict, snapshot.fileName, store, sheets]);

  // ---- Store lifecycle + final flush ----

  useLayoutEffect(() => {
    const flushOnHide = () => {
      void store.flush({ keepalive: true });
    };
    // `visibilitychange` fires on BOTH hide and show; flush on hide, but
    // recheck disk ONLY when becoming visible — an unguarded
    // recheck would issue a disk read on every hide too.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void store.recheckOnActivation();
      } else {
        flushOnHide();
      }
    };
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void store.flush({ keepalive: true });
      store.dispose();
    };
  }, [store]);

  // ---- Title sync (basename → pane chrome via cardTitleStore) ----

  useLayoutEffect(() => {
    if (snapshot.fileName !== null) {
      const base = snapshot.readOnly
        ? `${snapshot.fileName} (read-only)`
        : snapshot.fileName;
      // Manual mode marks unsaved changes with a small dot AFTER the name,
      // so the filename doesn't hop as the dirty bit sets and clears.
      cardTitleStore.set(cardId, isManual && isDirty ? `${base} •` : base);
    } else {
      cardTitleStore.clear(cardId);
    }
    return () => {
      cardTitleStore.clear(cardId);
    };
  }, [cardId, snapshot.fileName, snapshot.readOnly, isManual, isDirty]);

  // ---- Menu-state file block (drives the native File menu) ----
  //
  // Publish the block whenever the card is bound (ready); clear it
  // otherwise and on unmount ([L27]). The publisher only rides it onto
  // the payload while this card is the focused pane's active card.
  useLayoutEffect(() => {
    if (snapshot.phase !== "ready") {
      clearFileMenuState(cardId);
      return () => clearFileMenuState(cardId);
    }
    publishFileMenuState(cardId, {
      cardId,
      mode: snapshot.saveMode,
      dirty: isManual && snapshot.saveState !== "clean",
      untitled: snapshot.untitled,
      readOnly: snapshot.readOnly,
      hasPath: snapshot.path !== null,
      conflict: snapshot.conflict !== null,
    });
    return () => clearFileMenuState(cardId);
  }, [
    cardId,
    isManual,
    snapshot.phase,
    snapshot.saveMode,
    snapshot.saveState,
    snapshot.untitled,
    snapshot.readOnly,
    snapshot.path,
    snapshot.conflict,
  ]);

  // ---- Focus the editor when a fresh untitled buffer opens ----
  //
  // New Text File (⌥⌘N) should drop the caret straight into the editor so
  // the user can type immediately. Route through `reclaimFocusDestination`
  // so the focus resolves the key-card gate (never steal focus from an open
  // sheet) and repairs the chain, not just DOM focus — a bare `focus()` is
  // the resting-editor footgun. In a layout effect the editor is already
  // mounted and its responder registered, so no frame wait is needed. Fires
  // once per open.
  const untitledFocusedRef = useRef(false);
  useLayoutEffect(() => {
    if (snapshot.phase !== "ready") {
      untitledFocusedRef.current = false;
      return;
    }
    if (snapshot.untitled && !untitledFocusedRef.current) {
      untitledFocusedRef.current = true;
      reclaimFocusDestination();
    }
  }, [snapshot.phase, snapshot.untitled, reclaimFocusDestination]);

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
                // Manual: an untitled buffer with no file identity until
                // the first Save. Automatic: a real draft file.
                if (isManual) void store.openUntitled(cardId);
                else void store.openDraft(cardId);
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
        saveMode={snapshot.saveMode}
        canMoveTo={snapshot.draftId !== null && isPathPickerAvailable()}
        onMoveTo={saveAs}
        onSave={() => void doSave()}
        canSave={
          !snapshot.readOnly &&
          (isDirty || snapshot.untitled || snapshot.conflict !== null)
        }
        onRevealInFinder={revealInFinder}
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
        onSaveCommand={onSaveCommand}
        onStats={statsStore.set}
      />
      <FileCardStatusBar
        statsStore={statsStore}
        saveMode={snapshot.saveMode}
        saveState={snapshot.saveState}
        conflict={snapshot.conflict}
        lastSavedAt={snapshot.lastSavedAt}
        lineEnding={snapshot.lineEnding}
        onSetLineEnding={setLineEnding}
        languageId={effectiveLanguageId}
        onSetLanguage={setLanguageOverrideId}
      />
      {renderSheet()}
      <TugPaneBanner
        visible={conflict !== null && snapshot.saveMode === "automatic"}
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
                role="danger"
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
