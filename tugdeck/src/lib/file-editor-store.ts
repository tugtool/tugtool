/**
 * FileEditorStore — the save engine behind one File card, in either of
 * two modes fixed at construction from the deck-wide `save-mode` default.
 *
 * **Manual** (the shipping default) is the classic document model: edits
 * stay in the buffer as dirty state, an idle debounce writes only a
 * crash-safety set-aside record — never the real file — and the real file
 * changes only on an explicit save verb (Save / Save As… / Save a Copy… /
 * Revert / Reload). A dirty buffer gates card close.
 *
 * **Automatic** is the live-autosave model: the buffer is continuously
 * written through to disk (a short idle debounce coalesces keystrokes;
 * hard flush points override the timer), so there is no dirty state and
 * closing the card is always safe.
 *
 * Both modes make every real-file write conditional on the last-known disk
 * hash; a mismatch surfaces as a `conflict` — a modal sheet in manual
 * mode, a non-modal banner in automatic — so external edits and the user's
 * own are never silently lost.
 *
 * External changes: the store subscribes to the FILESYSTEM feed (0x10) and
 * filters the per-workspace event batches for its own canonical path. When
 * the buffer has no unflushed edits, an external change auto-reverts the
 * buffer in place (NSDocument-style); while edits are in flight, the
 * hash-conditional write adjudicates instead.
 *
 * The editor (CM6) remains the runtime owner of the text — the store never
 * mirrors keystrokes. It reaches the buffer through an attached
 * `FileEditorBridge` (get text at flush time, replace text on revert),
 * keeping document content out of React state entirely.
 *
 * **Laws:** [L02] React renders phase/banner state via
 * `useSyncExternalStore` on this store. [L22] DOM-driving consumers (the
 * "saving…" indicator) observe the store directly.
 *
 * @module lib/file-editor-store
 */

import { FeedId } from "../protocol";
import { getConnection } from "./connection-singleton";
import { tugDevLogStore } from "./tug-dev-log-store/tug-dev-log-store";
import type { FileReadErrorKind, FileWriteOutcome } from "./file-io";
import { readFileFromDisk, writeFileToDisk } from "./file-io";
import {
  AsideWriter,
  asidePathFor,
  asidePathForUntitled,
  readAside,
  type AsideRecord,
} from "./file-aside";

/**
 * Which save contract this store enforces. `automatic` is the
 * saveless live-autosave model (every debounce writes the real file);
 * `manual` is the classic document model — edits stay in the buffer and
 * the debounce writes only a set-aside record, until an explicit save.
 */
export type SaveMode = "manual" | "automatic";

/** Idle debounce between the last edit and the write-through. */
export const AUTOSAVE_DEBOUNCE_MS = 1000;

/** Consecutive write failures before the card surfaces a banner. */
export const WRITE_FAILURE_BANNER_THRESHOLD = 3;

/** Cursor + scroll positions — the only state the card bag persists. */
export interface FilePositions {
  anchor: { line: number; ch: number };
  scrollTop: number;
}

/**
 * The editor's side of the contract. Attached by the mounted editor;
 * detached on unmount. The store never touches CM6 directly.
 */
export interface FileEditorBridge {
  /** Current buffer text (read at flush time). */
  getText(): string;
  /**
   * Replace the buffer in place (external-change revert), preserving
   * cursor/scroll as far as the new text allows. Must not re-trigger
   * `noteEdit`.
   */
  replaceText(next: string): void;
  /** Current cursor/scroll for bag persistence. */
  getPositions(): FilePositions;
  /** Reapply persisted positions after a restore. */
  applyPositions(positions: FilePositions): void;
}

/** Lifecycle phase of the card's file binding. */
export type FileEditorPhase = "empty" | "loading" | "ready" | "error";

/** Autosave sub-state while `phase === "ready"`. */
export type FileSaveState = "clean" | "editing" | "writing";

/**
 * Outcome of a manual-mode `save()`. `needs-path` means the buffer is
 * untitled and the card must run the save panel then `saveAs`; the rest
 * mirror the write outcomes the card surfaces as sheets.
 */
export type FileSaveResult =
  | "ok"
  | "needs-path"
  | "conflict"
  | "missing"
  | "error"
  | "noop";

/** Unresolved divergence between the buffer and the disk. */
export interface FileConflict {
  reason: "hash" | "missing";
  /** Present for `hash` conflicts: the disk content's current sha256. */
  diskSha256?: string;
}

/**
 * Draft path for an untitled buffer — the analog of macOS's
 * `~/Library/Autosave Information`. The fs endpoints expand the tilde.
 */
export function draftPathFor(draftId: string): string {
  return `~/Library/Application Support/Tug/Drafts/draft-${draftId}.txt`;
}

/** An unsaved-aside restore that needs a user decision. */
export interface PendingAsideConflict {
  /** Buffer text held in the aside from a prior session. */
  asideContent: string;
  /** The line ending that aside recorded. */
  asideLineEnding: LineEnding;
}

/** Immutable snapshot rendered by the File card. */
export interface FileEditorSnapshot {
  phase: FileEditorPhase;
  /** Which save contract is in force; fixed at construction. */
  saveMode: SaveMode;
  /** Canonicalized absolute path, once bound. */
  path: string | null;
  /** True while a manual buffer has no file identity yet. */
  untitled: boolean;
  /**
   * A prior-session aside whose baseline diverged from the current disk
   * file — the card presents the open-conflict sheet.
   */
  pendingAsideConflict: PendingAsideConflict | null;
  /** Non-null while the buffer is an untitled draft. */
  draftId: string | null;
  /** Basename for the card title. */
  fileName: string | null;
  /**
   * Text to seed the editor document with. Set on open; NOT updated on
   * keystrokes (CM6 owns the live buffer). Reverts go through the bridge.
   */
  seedContent: string | null;
  readOnly: boolean;
  saveState: FileSaveState;
  conflict: FileConflict | null;
  /** Read failure that prevented binding the file. */
  error: { kind: FileReadErrorKind; size?: number } | null;
  /** Consecutive write-transport failures (banner at threshold). */
  writeFailures: number;
  /** Dominant newline style of the bound file (status-bar display). */
  lineEnding: LineEnding;
  /** Wall-clock ms of the last successful write, or null before any. */
  lastSavedAt: number | null;
}

/** Dominant newline style of a file. */
export type LineEnding = "LF" | "CRLF" | "CR";

/** Detect the dominant newline style of `content`. */
function detectLineEnding(content: string): LineEnding {
  if (content.indexOf("\r\n") !== -1) return "CRLF";
  if (content.indexOf("\r") !== -1) return "CR";
  return "LF";
}

/**
 * Serialize the editor's text to the file's chosen newline style. The
 * editor (CM6) always hands back `\n`-only text — it normalizes line
 * breaks internally regardless of what the file used — so the on-disk
 * newline representation is owned HERE, at the write boundary: normalize
 * to `\n` defensively, then expand to the target sequence. This is what
 * makes the status-bar line-ending choice (and a CRLF/CR file's original
 * style) actually persist to disk rather than being flattened to LF.
 */
function serializeEol(text: string, ending: LineEnding): string {
  const lf = normalizeLf(text);
  if (ending === "LF") return lf;
  return lf.replace(/\n/g, ending === "CRLF" ? "\r\n" : "\r");
}

/** Normalize any newline style to `\n` (the aside's stored representation). */
function normalizeLf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

const EMPTY_SNAPSHOT: FileEditorSnapshot = {
  phase: "empty",
  saveMode: "automatic",
  path: null,
  untitled: false,
  pendingAsideConflict: null,
  draftId: null,
  fileName: null,
  seedContent: null,
  readOnly: false,
  saveState: "clean",
  conflict: null,
  error: null,
  writeFailures: 0,
  lineEnding: "LF",
  lastSavedAt: null,
};

/** Basename of an absolute path (trailing slashes ignored). */
function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * One FILESYSTEM event. `path` is present for Created / Modified /
 * Removed; `from`/`to` for a `Renamed` event (the Linux/Windows path —
 * macOS FSEvents delivers renames as Removed+Created pairs instead).
 */
interface FilesystemEvent {
  kind: string;
  path?: string;
  from?: string;
  to?: string;
}

/** Shape of one FILESYSTEM frame after the workspace_key splice. */
interface FilesystemFrame {
  workspace_key: string;
  events: FilesystemEvent[];
}

/** Parse a FILESYSTEM frame payload; null when malformed. */
function parseFilesystemFrame(payload: Uint8Array): FilesystemFrame | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.workspace_key !== "string") return null;
    if (!Array.isArray(obj.events)) return null;
    const events: FilesystemEvent[] = [];
    for (const raw of obj.events) {
      if (raw === null || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      if (typeof e.kind !== "string") continue;
      if (
        typeof e.path !== "string" &&
        typeof e.from !== "string" &&
        typeof e.to !== "string"
      ) {
        continue;
      }
      events.push({
        kind: e.kind,
        path: typeof e.path === "string" ? e.path : undefined,
        from: typeof e.from === "string" ? e.from : undefined,
        to: typeof e.to === "string" ? e.to : undefined,
      });
    }
    return { workspace_key: obj.workspace_key, events };
  } catch {
    return null;
  }
}

/**
 * One File card's autosave engine. Construct per card; `dispose()` on card
 * destruction.
 */
export class FileEditorStore {
  private _snapshot: FileEditorSnapshot = EMPTY_SNAPSHOT;
  private _listeners = new Set<() => void>();
  private _bridge: FileEditorBridge | null = null;
  /**
   * The save contract, fixed at construction. Held off the snapshot so a
   * state-resetting `_update({ ...EMPTY_SNAPSHOT })` (open, rebind) can
   * re-apply it — a rebind must never silently revert a manual card to
   * automatic.
   */
  private readonly _saveMode: SaveMode;
  /** Writer for the current document's set-aside record (manual mode). */
  private _asideWriter: AsideWriter | null = null;
  /** An aside flush in flight; a mid-flight edit re-flushes on settle. */
  private _asideFlushInFlight: Promise<void> | null = null;
  private _asideEditedDuringWrite = false;
  /** sha256 the next write is conditioned on. */
  private _baselineSha256: string | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _flushInFlight: Promise<void> | null = null;
  /**
   * A manual-mode real-file `save()` in flight. A second ⌘S waits on it
   * rather than reissuing a write against the baseline the first save is
   * about to change (which would 409 → a spurious conflict for the user's
   * own bytes).
   */
  private _saveInFlight: Promise<void> | null = null;
  /**
   * Whether the buffer's last known content was empty — sampled at
   * open, flush, and revert time (the bridge is gone by dispose time,
   * so dispose-time draft GC reads this instead).
   */
  private _lastKnownEmpty = true;
  /** A revert fetched while a flush was in flight waits its turn. */
  private _recheckQueued = false;
  /**
   * An edit (or line-ending change) arrived while a write was in flight.
   * That write captured the buffer at its start, so it persisted stale
   * content; on settle we must re-flush the current buffer instead of
   * reporting "clean" — otherwise the edit is silently lost while the
   * UI shows saved.
   */
  private _editedDuringWrite = false;
  private _disposed = false;
  /** Unregisters the FILESYSTEM feed callback; called by `dispose()`. */
  private _unsubscribeFilesystem: (() => void) | null = null;

  constructor(opts?: { saveMode?: SaveMode }) {
    this._saveMode = opts?.saveMode ?? "automatic";
    this._snapshot = { ...EMPTY_SNAPSHOT, saveMode: this._saveMode };
    const conn = getConnection();
    if (conn) {
      this._unsubscribeFilesystem = conn.onFrame(
        FeedId.FILESYSTEM,
        (payload: Uint8Array) => {
          if (this._disposed) return;
          this._onFilesystemFrame(payload);
        },
      );
    }
  }

  // ── useSyncExternalStore surface ─────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): FileEditorSnapshot => this._snapshot;

  private _update(patch: Partial<FileEditorSnapshot>): void {
    this._snapshot = { ...this._snapshot, ...patch };
    for (const listener of this._listeners) listener();
  }

  // ── Editor bridge ────────────────────────────────────────────────────────

  attachEditor(bridge: FileEditorBridge): void {
    this._bridge = bridge;
  }

  detachEditor(): void {
    this._bridge = null;
  }

  /** Cursor/scroll for bag persistence; null before the editor mounts. */
  snapshotPositions(): FilePositions | null {
    return this._bridge ? this._bridge.getPositions() : null;
  }

  applyPositions(positions: FilePositions): void {
    this._bridge?.applyPositions(positions);
  }

  // ── Open ─────────────────────────────────────────────────────────────────

  /** Bind the card to `path`: read it and enter `ready` (or `error`). */
  async openPath(path: string): Promise<void> {
    this._clearDebounce();
    this._resetAsideState();
    this._update({
      ...EMPTY_SNAPSHOT,
      saveMode: this._saveMode,
      phase: "loading",
      path,
      fileName: baseName(path),
    });
    const outcome = await readFileFromDisk(path);
    // A newer openPath (or openUntitled) may have superseded this one while
    // the read was in flight — every other async settle in this store makes
    // the same check; without it a slow open would clobber a fast one's
    // binding with the wrong baseline.
    if (this._disposed || this._snapshot.path !== path) return;
    if (!outcome.ok) {
      this._update({
        phase: "error",
        error: { kind: outcome.error, size: outcome.size },
      });
      return;
    }
    this._baselineSha256 = outcome.file.sha256;
    this._lastKnownEmpty = outcome.file.content === "";
    this._update({
      phase: "ready",
      path: outcome.file.path,
      fileName: baseName(outcome.file.path),
      seedContent: outcome.file.content,
      readOnly: outcome.file.readOnly,
      saveState: "clean",
      conflict: null,
      error: null,
      writeFailures: 0,
      lineEnding: detectLineEnding(outcome.file.content),
      lastSavedAt: null,
    });
    if (this._saveMode === "manual") {
      await this._restoreAsideForPath(outcome.file.path, outcome.file.sha256);
    }
  }

  /**
   * Bind the card to a NEW untitled manual buffer: no file exists
   * anywhere until the first Save; crash-safety rides an aside keyed by
   * the draft id. An existing aside for this draft restores it dirty.
   */
  async openUntitled(draftId: string): Promise<void> {
    this._clearDebounce();
    this._resetAsideState();
    this._baselineSha256 = null;
    this._lastKnownEmpty = true;
    const asidePath = asidePathForUntitled(draftId);
    const writer = new AsideWriter(asidePath);
    this._asideWriter = writer;
    this._update({
      ...EMPTY_SNAPSHOT,
      saveMode: this._saveMode,
      phase: "ready",
      path: null,
      draftId,
      untitled: true,
      fileName: "Untitled",
      seedContent: "",
      saveState: "clean",
    });
    const result = await readAside(asidePath, { draftId });
    if (this._disposed || this._snapshot.draftId !== draftId) return;
    if (result.kind === "unreadable") return;
    if (result.kind === "invalid") {
      void writer.delete();
      return;
    }
    writer.seed(result.sha256);
    // The user typed while the aside read was in flight — their keystrokes
    // own the buffer now; leave the (seeded) aside in place rather than
    // clobbering them with a stale restore.
    if (this._snapshot.saveState !== "clean") return;
    const record = result.record;
    this._bridge?.replaceText(record.content);
    this._update({
      seedContent: record.content,
      lineEnding: record.lineEnding,
      saveState: "editing",
    });
  }

  /**
   * Bind the card to a NEW untitled draft: an empty file under the Tug
   * drafts directory that autosaves like any other file (autosave-
   * elsewhere until the user names it via Move To).
   */
  async openDraft(draftId: string): Promise<void> {
    const path = draftPathFor(draftId);
    const existing = await readFileFromDisk(path);
    if (this._disposed) return;
    if (!existing.ok && existing.error === "not_found") {
      const created = await writeFileToDisk({
        path,
        content: "",
        baselineSha256: null,
      });
      if (this._disposed) return;
      if (!created.ok) {
        this._update({ phase: "error", error: { kind: "internal" } });
        return;
      }
    }
    await this.openPath(path);
    if (this._disposed) return;
    this._update({ draftId, fileName: "Untitled" });
  }

  /**
   * Re-anchor the buffer to `newPath` (Move To… / the missing-file
   * banner's Save As…): write the current buffer there (create-new),
   * delete the old draft when this was one, and bind to the new path.
   * Returns the write outcome so callers gate on success — a swallowed
   * failure here would let a close guard destroy the card and strand the
   * edits in an orphaned aside.
   */
  async saveAs(newPath: string): Promise<FileSaveResult> {
    const snap = this._snapshot;
    if (this._bridge === null || snap.phase !== "ready") return "noop";
    this._clearDebounce();
    const content = serializeEol(this._bridge.getText(), snap.lineEnding);
    const oldPath = snap.path;
    const oldBaseline = this._baselineSha256;
    const wasDraft = snap.draftId !== null;

    // NSSavePanel already ran a replace confirmation, so an existing
    // target is overwritten deliberately: create-new first, and on the
    // exists-conflict retry conditioned on the disk hash it reported.
    let outcome = await writeFileToDisk({
      path: newPath,
      content,
      baselineSha256: null,
    });
    if (!outcome.ok && outcome.error === "conflict") {
      outcome = await writeFileToDisk({
        path: newPath,
        content,
        baselineSha256: outcome.diskSha256,
      });
    }
    if (this._disposed) return "noop";
    if (!outcome.ok) {
      tugDevLogStore.warn("file-editor-store", "saveAs failed", {
        error: outcome.error,
        newPath,
      });
      return outcome.error === "conflict"
        ? "conflict"
        : outcome.error === "missing"
          ? "missing"
          : "error";
    }
    if (this._saveMode === "manual") {
      // The old document's set-aside record is superseded by the real
      // file we just wrote — discard it. `openPath(newPath)` re-keys the
      // writer and reseeds the sha chain for the new identity.
      await this._deleteAside();
    } else if (wasDraft && oldPath !== null) {
      // Draft GC — hash-conditional removal of the old draft file.
      void writeFileToDisk({
        path: oldPath,
        content: "",
        baselineSha256: oldBaseline,
        delete: true,
      });
    }
    await this.openPath(newPath);
    return "ok";
  }

  /** Explicit save (⌘S / File ▸ Save): flush pending edits now. */
  async saveNow(): Promise<void> {
    await this.flush();
  }

  /**
   * Manual-mode explicit save: write the current buffer to the
   * REAL file (conditional on the last-known disk hash), and on success
   * discard the aside and go clean. An untitled buffer has no path yet —
   * `"needs-path"` tells the card to run the save panel then `saveAs`.
   * A `conflict`/`missing` outcome sets the snapshot conflict the card
   * renders as the conflict/missing sheet.
   */
  async save(): Promise<FileSaveResult> {
    // Single-flight: if a save is already writing, wait for it before
    // evaluating this one. A concurrent second ⌘S must not reissue a write
    // against the baseline the in-flight save is about to change — that
    // 409s into a spurious "changed by another application" conflict for
    // the user's own bytes. After it settles we re-check dirty state below,
    // so a real edit made during the first save still gets saved here.
    while (this._saveInFlight !== null) await this._saveInFlight;

    const snap = this._snapshot;
    if (snap.phase !== "ready" || snap.readOnly || this._bridge === null) {
      return "noop";
    }
    if (snap.path === null) return "needs-path";
    if (snap.saveState === "clean" && snap.conflict === null) return "ok";

    let done!: () => void;
    this._saveInFlight = new Promise<void>((resolve) => {
      done = resolve;
    });
    try {
      return await this._performSave(snap.path);
    } finally {
      this._saveInFlight = null;
      done();
    }
  }

  /** The real-file write behind {@link save}, run under the single-flight latch. */
  private async _performSave(path: string): Promise<FileSaveResult> {
    const bridge = this._bridge;
    if (bridge === null) return "noop";
    this._clearDebounce();
    const content = serializeEol(bridge.getText(), this._snapshot.lineEnding);
    this._lastKnownEmpty = content === "";
    this._update({ saveState: "writing" });
    const outcome = await writeFileToDisk({
      path,
      content,
      baselineSha256: this._baselineSha256,
    });
    if (this._disposed) return "noop";
    if (outcome.ok) {
      this._baselineSha256 = outcome.sha256;
      const editedDuringWrite = this._editedDuringWrite;
      this._editedDuringWrite = false;
      if (editedDuringWrite) {
        // The buffer changed mid-save, so the real file holds stale bytes.
        // Stay dirty and re-capture the aside; the user's next save writes
        // the current buffer — never report clean over an unsaved edit.
        this._update({
          saveState: "editing",
          conflict: null,
          writeFailures: 0,
          lastSavedAt: Date.now(),
        });
        void this._flushAside();
        return "ok";
      }
      // Drain any in-flight aside write before deleting it — a create-new
      // the server orders after a bare delete would resurrect a stale aside
      // for a document we're now reporting clean.
      await this._deleteAside();
      if (this._disposed) return "noop";
      if (this._editedDuringWrite) {
        // An edit landed while we drained/deleted the aside — stay dirty
        // and re-capture it rather than reporting clean over it.
        this._editedDuringWrite = false;
        this._update({
          saveState: "editing",
          conflict: null,
          writeFailures: 0,
          lastSavedAt: Date.now(),
        });
        void this._flushAside();
        return "ok";
      }
      this._update({
        saveState: "clean",
        conflict: null,
        writeFailures: 0,
        lastSavedAt: Date.now(),
      });
      return "ok";
    }
    if (outcome.error === "conflict") {
      this._update({
        saveState: "editing",
        conflict: { reason: "hash", diskSha256: outcome.diskSha256 },
      });
      return "conflict";
    }
    if (outcome.error === "missing") {
      this._update({ saveState: "editing", conflict: { reason: "missing" } });
      return "missing";
    }
    this._update({
      saveState: "editing",
      writeFailures: this._snapshot.writeFailures + 1,
    });
    tugDevLogStore.warn("file-editor-store", "manual save failed", {
      error: outcome.error,
    });
    return "error";
  }

  /**
   * Write a copy of the current buffer to `targetPath` without rebinding
   * or changing dirty state (Save a Copy…). Create-new, with the same
   * NSSavePanel-confirmed overwrite retry as `saveAs`.
   */
  async saveACopy(targetPath: string): Promise<"ok" | "error" | "noop"> {
    const snap = this._snapshot;
    if (snap.phase !== "ready" || this._bridge === null) return "noop";
    const content = serializeEol(this._bridge.getText(), snap.lineEnding);
    let outcome = await writeFileToDisk({
      path: targetPath,
      content,
      baselineSha256: null,
    });
    if (!outcome.ok && outcome.error === "conflict") {
      outcome = await writeFileToDisk({
        path: targetPath,
        content,
        baselineSha256: outcome.diskSha256,
      });
    }
    if (this._disposed) return "noop";
    if (!outcome.ok) {
      tugDevLogStore.warn("file-editor-store", "saveACopy failed", {
        error: outcome.error,
        targetPath,
      });
      return "error";
    }
    return "ok";
  }

  /**
   * Discard buffer edits and reload the on-disk version (Revert to Saved /
   * Reload from Disk — the card owns the confirm sheet; the store method
   * is unconditional). Deletes the aside and goes clean.
   */
  async revertToSaved(): Promise<void> {
    this._clearDebounce();
    await this._deleteAside();
    await this._recheckDisk({ force: true });
  }

  /** Alias of {@link revertToSaved}: reload the disk version, discarding edits. */
  reloadFromDisk(): Promise<void> {
    return this.revertToSaved();
  }

  /**
   * Discard the set-aside record WITHOUT reloading the buffer — the
   * close-sheet "Don't Save": the card is about to be destroyed, so the
   * aside must not survive to restore the abandoned edits. Marking clean
   * stops the unmount keepalive flush from re-creating it.
   */
  async discardAside(): Promise<void> {
    this._clearDebounce();
    await this._deleteAside();
    if (!this._disposed) this._update({ saveState: "clean" });
  }

  // ── Autosave ─────────────────────────────────────────────────────────────

  /**
   * Note one buffer edit. Arms (or re-arms) the idle debounce. No-op for
   * read-only files and while a conflict is unresolved — the user must
   * choose before any further bytes move.
   */
  noteEdit(): void {
    const snap = this._snapshot;
    if (snap.phase !== "ready" || snap.readOnly || snap.conflict) return;
    if (snap.saveState === "writing") {
      // The in-flight write already snapshotted the (now stale) buffer;
      // mark for a re-flush on settle rather than losing this edit.
      this._editedDuringWrite = true;
    } else {
      this._update({ saveState: "editing" });
    }
    this._armDebounce(AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Flush pending edits to disk now (Cmd-S, card deactivation, lifecycle
   * teardown). Resolves when the write settles. `keepalive` marks the
   * final-flush fetch so it survives page teardown.
   */
  flush(opts?: { keepalive?: boolean }): Promise<void> {
    this._clearDebounce();
    // In manual mode `flush()` is the ASIDE path, never the real file
    //: lifecycle callers (pagehide, unmount, close-handoff) must
    // persist the crash-recovery record without an unrequested real-file
    // write. The real file is only written by the explicit save verbs.
    if (this._saveMode === "manual") {
      return this._flushAside(opts);
    }
    const snap = this._snapshot;
    if (
      snap.phase !== "ready" ||
      snap.readOnly ||
      snap.conflict !== null ||
      snap.saveState === "clean" ||
      this._bridge === null
    ) {
      return this._flushInFlight ?? Promise.resolve();
    }
    if (this._flushInFlight) return this._flushInFlight;

    const path = snap.path;
    if (path === null) return Promise.resolve();
    const rawText = this._bridge.getText();
    this._lastKnownEmpty = rawText === "";
    // The file's newline style is owned here — the editor always hands
    // back `\n`-only text (see `serializeEol`).
    const content = serializeEol(rawText, snap.lineEnding);
    this._update({ saveState: "writing" });
    const flight = writeFileToDisk(
      { path, content, baselineSha256: this._baselineSha256 },
      opts,
    ).then((outcome) => {
      this._flushInFlight = null;
      if (this._disposed) return;
      this._onWriteSettled(outcome);
    });
    this._flushInFlight = flight;
    return flight;
  }

  private _onWriteSettled(outcome: FileWriteOutcome): void {
    const editedDuringWrite = this._editedDuringWrite;
    this._editedDuringWrite = false;
    if (outcome.ok) {
      this._baselineSha256 = outcome.sha256;
      if (editedDuringWrite) {
        // The buffer changed while this write was in flight, so it wrote
        // stale content. Re-flush the current buffer instead of going
        // clean — never report "saved" over an unpersisted edit.
        this._update({
          saveState: "editing",
          writeFailures: 0,
          lastSavedAt: Date.now(),
        });
        void this.flush();
        return;
      }
      this._update({
        saveState: "clean",
        writeFailures: 0,
        lastSavedAt: Date.now(),
      });
      if (this._recheckQueued) {
        this._recheckQueued = false;
        void this._recheckDisk();
      }
      return;
    }
    if (outcome.error === "conflict") {
      this._update({
        saveState: "editing",
        conflict: { reason: "hash", diskSha256: outcome.diskSha256 },
      });
      return;
    }
    if (outcome.error === "missing") {
      this._update({ saveState: "editing", conflict: { reason: "missing" } });
      return;
    }
    // Transport/server failure: back off and retry from the debounce.
    const failures = this._snapshot.writeFailures + 1;
    this._update({ saveState: "editing", writeFailures: failures });
    tugDevLogStore.warn("file-editor-store", "write failed; will retry", {
      error: outcome.error,
      attempt: failures,
    });
    const backoff = Math.min(
      AUTOSAVE_DEBOUNCE_MS * 2 ** Math.min(failures, 3),
      8000,
    );
    this._armDebounce(backoff);
  }

  private _armDebounce(delayMs: number): void {
    this._clearDebounce();
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      void this.flush();
    }, delayMs);
  }

  private _clearDebounce(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  // ── Set-aside autosave (manual mode) ─────────────────────────────────────

  /** Drop the current document's aside writer and in-flight bookkeeping. */
  private _resetAsideState(): void {
    this._asideWriter = null;
    this._asideFlushInFlight = null;
    this._asideEditedDuringWrite = false;
  }

  /**
   * Delete the current document's aside, first draining any in-flight aside
   * write and suppressing a queued re-flush. A bare delete that races a
   * first (create-new) aside write can server-order BEFORE it, so the write
   * lands after and resurrects a stale aside for a document we've since
   * saved — the next open would then offer to restore already-saved edits
   *.
   */
  private async _deleteAside(): Promise<void> {
    this._asideEditedDuringWrite = false;
    if (this._asideFlushInFlight !== null) {
      await this._asideFlushInFlight;
      if (this._disposed) return;
    }
    await this._asideWriter?.delete();
  }

  /**
   * Write the unsaved buffer to the set-aside record (never the real
   * file). Only fires while the buffer is dirty; a mid-flight edit marks
   * the aside for a re-flush on settle so the record never lags behind
   * the buffer — the writer's own sha chain absorbs write races.
   */
  private _flushAside(opts?: { keepalive?: boolean }): Promise<void> {
    const snap = this._snapshot;
    const writer = this._asideWriter;
    if (
      snap.phase !== "ready" ||
      snap.readOnly ||
      snap.saveState !== "editing" ||
      this._bridge === null ||
      writer === null
    ) {
      return this._asideFlushInFlight ?? Promise.resolve();
    }
    if (this._asideFlushInFlight !== null) {
      this._asideEditedDuringWrite = true;
      return this._asideFlushInFlight;
    }
    const rawText = this._bridge.getText();
    this._lastKnownEmpty = rawText === "";
    const record: AsideRecord = {
      version: 1,
      path: snap.path,
      draftId: snap.draftId,
      // The aside stores `\n`-normalized text; the line ending is a
      // separate field applied at real-save time (`serializeEol`).
      content: normalizeLf(rawText),
      lineEnding: snap.lineEnding,
      baselineSha256: this._baselineSha256,
      editedAt: Date.now(),
    };
    const flight = writer.write(record, opts).then((outcome) => {
      this._asideFlushInFlight = null;
      if (this._disposed) return;
      const edited = this._asideEditedDuringWrite;
      this._asideEditedDuringWrite = false;
      if (!outcome.ok) {
        tugDevLogStore.warn("file-editor-store", "aside flush failed", {
          error: outcome.error,
        });
        return;
      }
      if (edited) void this._flushAside();
    });
    this._asideFlushInFlight = flight;
    return flight;
  }

  /**
   * After a manual open, consult the document's aside:
   * a matching baseline restores the edits silently (dirty); a diverged
   * baseline surfaces `pendingAsideConflict` for the open-conflict sheet;
   * an invalid aside is deleted; an unread aside is left untouched.
   */
  private async _restoreAsideForPath(
    path: string,
    diskSha256: string,
  ): Promise<void> {
    const asidePath = asidePathFor(path);
    const writer = new AsideWriter(asidePath);
    this._asideWriter = writer;
    const result = await readAside(asidePath, { path });
    if (this._disposed || this._snapshot.path !== path) return;
    if (result.kind === "unreadable") return;
    if (result.kind === "invalid") {
      void writer.delete();
      return;
    }
    writer.seed(result.sha256);
    // The user typed while the aside read was in flight — their keystrokes
    // own the buffer now; don't clobber them with a restore or a conflict
    // sheet. The seeded writer keeps the next flush chained correctly.
    if (this._snapshot.saveState !== "clean") return;
    const record = result.record;
    if (record.baselineSha256 === diskSha256) {
      // Same base bytes → the aside is a clean superset of what's on disk;
      // restore it dirty, NSDocument-style, with no prompt.
      this._bridge?.replaceText(record.content);
      this._update({
        seedContent: record.content,
        lineEnding: record.lineEnding,
        saveState: "editing",
      });
      return;
    }
    // Diverged base → the disk file moved on since these edits were set
    // aside; the user decides. Buffer shows disk.
    this._update({
      pendingAsideConflict: {
        asideContent: record.content,
        asideLineEnding: record.lineEnding,
      },
    });
  }

  /**
   * Resolve the open-conflict sheet. `keep` seeds the
   * buffer from the aside (dirty), conditioning the next save on the
   * current disk bytes; `disk` discards the aside and keeps disk content.
   */
  resolveAsideConflict(choice: "keep" | "disk"): void {
    const pending = this._snapshot.pendingAsideConflict;
    if (pending === null) return;
    if (choice === "disk") {
      void this._asideWriter?.delete();
      this._update({ pendingAsideConflict: null });
      return;
    }
    this._bridge?.replaceText(pending.asideContent);
    this._update({
      seedContent: pending.asideContent,
      lineEnding: pending.asideLineEnding,
      saveState: "editing",
      pendingAsideConflict: null,
    });
  }

  // ── Conflict resolution ──────────────────────────────────────────────────

  /**
   * Resolve an open conflict. `reload` replaces the buffer with disk
   * content; `overwrite` re-issues the write conditioned on the hash the
   * conflict reported (hash conflicts only).
   */
  async resolveConflict(choice: "reload" | "overwrite"): Promise<void> {
    const conflict = this._snapshot.conflict;
    if (conflict === null) return;
    if (choice === "reload") {
      // Discard buffer edits for the disk version (both modes); in manual
      // mode the aside is superseded and deleted.
      if (this._saveMode === "manual") await this._deleteAside();
      this._update({ conflict: null });
      await this._recheckDisk({ force: true });
      return;
    }
    if (conflict.reason !== "hash" || conflict.diskSha256 === undefined) {
      return;
    }
    this._baselineSha256 = conflict.diskSha256;
    if (this._saveMode === "manual") {
      // Save Anyway: route to the REAL-file save path, NOT
      // `flush()` — which now writes the aside and would silently drop the
      // user's decision. `save()` deletes the aside on the ok settle.
      this._update({ conflict: null });
      await this.save();
      return;
    }
    this._update({ conflict: null, saveState: "editing" });
    await this.flush();
  }

  /**
   * Re-read disk and revert the buffer in place if it diverged from
   * the baseline.
   */
  refreshFromDisk(): Promise<void> {
    return this._recheckDisk();
  }

  /**
   * Change the file's newline style (the status-bar line-ending popup).
   * The buffer text is unchanged — the newline representation is applied
   * at the write boundary (`serializeEol`) — so this records the choice
   * and forces a re-serialize write of the current content, unless the
   * file is read-only or mid-conflict.
   */
  setLineEnding(ending: LineEnding): void {
    const snap = this._snapshot;
    if (snap.lineEnding === ending) return;
    this._update({ lineEnding: ending });
    if (snap.phase !== "ready" || snap.readOnly || snap.conflict !== null) {
      return;
    }
    if (this._snapshot.saveState === "writing") {
      // A real-file write is mid-flight (automatic flush or manual save) and
      // serialized the OLD ending; re-flush on settle so the new ending
      // actually reaches disk (setLineEnding is a one-shot action with no
      // follow-up edit to trigger recovery). Keyed on `writing`, not
      // `_flushInFlight`, because a manual save() sets the former, not the
      // latter — checking the wrong flag dropped the change silently.
      this._editedDuringWrite = true;
      return;
    }
    // Force a write even from a clean state — flush no-ops when clean.
    if (this._snapshot.saveState === "clean") {
      this._update({ saveState: "editing" });
    }
    void this.flush();
  }

  // ── External changes ─────────────────────────────────────────────────────

  private _onFilesystemFrame(payload: Uint8Array): void {
    const snap = this._snapshot;
    if (snap.phase !== "ready" || snap.path === null) return;
    const frame = parseFilesystemFrame(payload);
    if (frame === null) return;
    const root = frame.workspace_key.replace(/\/+$/, "");
    const full = (p: string): string => `${root}/${p}`;

    // Rename-follow. (a) An explicit `Renamed { from, to }` whose
    // `from` is our path (the Linux/Windows path) → adopt `to` directly.
    const renamed = frame.events.find(
      (e) => e.kind === "Renamed" && e.from !== undefined && full(e.from) === snap.path,
    );
    if (renamed?.to !== undefined) {
      void this._adoptRename(full(renamed.to));
      return;
    }
    // (b) macOS delivers renames as Removed{ours} + Created{new} in one
    // batch. When our file was removed, try to adopt a hash-matching
    // creation before falling back to the missing-file flow.
    if (frame.events.some((e) => e.kind === "Removed" && e.path !== undefined && full(e.path) === snap.path)) {
      void this._tryAdoptRemovedRename(frame, root);
      return;
    }

    const hit = frame.events.some(
      (event) => event.path !== undefined && full(event.path) === snap.path,
    );
    if (!hit) return;
    if (snap.saveState === "writing") {
      // Likely our own write echoing back; re-check once it settles so a
      // genuinely foreign change still gets adjudicated.
      this._recheckQueued = true;
      return;
    }
    if (snap.conflict !== null) return;
    if (snap.saveState === "editing") {
      if (this._saveMode === "manual") {
        // Dirty manual buffer: the unsaved edits live only in the buffer,
        // so a disk change is a genuine external divergence. Read disk and
        // raise the conflict immediately — never merge, never
        // silently revert.
        void this._raiseConflictIfDiverged();
        return;
      }
      // Automatic: unflushed edits; the conditional write adjudicates —
      // never revert out from under the user.
      return;
    }
    void this._recheckDisk();
  }

  /**
   * Manual-mode watcher/focus path: re-read disk and, if it diverged from
   * the baseline the dirty buffer is based on, raise the hash conflict the
   * card renders as the modal conflict sheet.
   */
  private async _raiseConflictIfDiverged(): Promise<void> {
    const path = this._snapshot.path;
    if (path === null) return;
    const outcome = await readFileFromDisk(path);
    if (this._disposed || this._snapshot.path !== path) return;
    if (this._snapshot.saveState !== "editing" || this._snapshot.conflict !== null) {
      return;
    }
    if (!outcome.ok) {
      if (outcome.error === "not_found") {
        this._update({ conflict: { reason: "missing" } });
      }
      return;
    }
    if (outcome.file.sha256 !== this._baselineSha256) {
      this._update({
        conflict: { reason: "hash", diskSha256: outcome.file.sha256 },
      });
    }
  }

  /**
   * Try to adopt a rename from a macOS Removed+Created batch:
   * read each `Created` candidate (same-basename first, else the sole
   * creation) and adopt the first whose disk sha equals our baseline —
   * unsaved edits never touch disk, so a moved file still hashes to the
   * last-saved baseline. Zero or ambiguous matches → the missing-file
   * flow (a prompt, never a wrong rebind).
   */
  private async _tryAdoptRemovedRename(
    frame: FilesystemFrame,
    root: string,
  ): Promise<void> {
    const path = this._snapshot.path;
    if (path === null) return;
    const created = frame.events
      .filter((e) => e.kind === "Created" && e.path !== undefined)
      .map((e) => `${root}/${e.path}`);
    const ourBase = baseName(path);
    let candidates = created.filter((c) => baseName(c) === ourBase);
    if (candidates.length === 0 && created.length === 1) candidates = created;
    for (const candidate of candidates) {
      const outcome = await readFileFromDisk(candidate);
      if (this._disposed || this._snapshot.path !== path) return;
      if (outcome.ok && outcome.file.sha256 === this._baselineSha256) {
        await this._adoptRename(outcome.file.path);
        return;
      }
    }
    // No hash-matching candidate in this batch — the file is gone (a
    // rename the watcher couldn't pair, or a real delete). We follow moves
    // only for in-workspace files, via the watcher's paired events above;
    // out-of-workspace moves fall here, and the missing sheet's Don't Save
    // lets the user close without a jail.
    if (this._snapshot.conflict === null) {
      this._update({ conflict: { reason: "missing" } });
    }
  }

  /**
   * Follow a rename to `newPath` (both modes): rebind path / fileName and
   * re-key the aside (write the current buffer to the new key, delete the
   * old), leaving dirty state and baseline untouched — this is
   * `presentedItemDidMove(to:)` behavior, no prompt.
   */
  private async _adoptRename(newPath: string): Promise<void> {
    const oldPath = this._snapshot.path;
    if (oldPath === null || newPath === oldPath) return;
    const wasDirty = this._snapshot.saveState === "editing";
    const oldWriter = this._asideWriter;
    if (this._saveMode === "manual") {
      this._asideWriter = new AsideWriter(asidePathFor(newPath));
    }
    this._update({ path: newPath, fileName: baseName(newPath) });
    if (this._saveMode === "manual") {
      void oldWriter?.delete();
      if (wasDirty) void this._flushAside();
    }
  }

  /**
   * Focus-time backstop for files outside the watcher's workspace roots.
   * Clean → silent reload; manual + dirty → raise the conflict on
   * divergence. A no-op while a write is in flight or a sheet is pending.
   */
  async recheckOnActivation(): Promise<void> {
    const snap = this._snapshot;
    if (snap.phase !== "ready" || snap.path === null) return;
    if (
      snap.saveState === "writing" ||
      snap.conflict !== null ||
      snap.pendingAsideConflict !== null ||
      this._flushInFlight !== null ||
      this._asideFlushInFlight !== null
    ) {
      return;
    }
    if (snap.saveState === "editing") {
      if (this._saveMode === "manual") await this._raiseConflictIfDiverged();
      return;
    }
    await this._recheckDisk();
  }

  /**
   * Re-read the file and revert the buffer in place when disk diverged
   * from the baseline. `force` reverts even when hashes match (conflict
   * "reload", which must also clear a stale buffer).
   */
  private async _recheckDisk(opts?: { force?: boolean }): Promise<void> {
    const path = this._snapshot.path;
    if (path === null) return;
    const outcome = await readFileFromDisk(path);
    if (this._disposed || this._snapshot.path !== path) return;
    if (!outcome.ok) {
      if (outcome.error === "not_found") {
        this._update({ conflict: { reason: "missing" } });
      }
      return;
    }
    const diverged = outcome.file.sha256 !== this._baselineSha256;
    if (!diverged && opts?.force !== true) return;
    // A non-force recheck is an external-change auto-revert that applies
    // only to a clean buffer. If the user typed during the read RTT their
    // edits now own the buffer — don't clobber them; the next flush or
    // conflict check adjudicates. `force` (revert/reload) reverts anyway.
    if (opts?.force !== true && this._snapshot.saveState !== "clean") return;
    this._baselineSha256 = outcome.file.sha256;
    if (this._bridge) {
      this._bridge.replaceText(outcome.file.content);
    }
    this._update({
      seedContent: outcome.file.content,
      readOnly: outcome.file.readOnly,
      saveState: "clean",
      conflict: null,
      writeFailures: 0,
      lineEnding: detectLineEnding(outcome.file.content),
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  dispose(): void {
    this._clearDebounce();
    // Draft GC: an untitled draft that is still empty leaves nothing
    // worth keeping — remove its file (hash-conditional, keepalive so
    // the request survives teardown). A non-empty draft stays; the bag
    // carries its draftId and a restore reopens it.
    const snap = this._snapshot;
    if (snap.draftId !== null && snap.path !== null && this._lastKnownEmpty) {
      void writeFileToDisk(
        {
          path: snap.path,
          content: "",
          baselineSha256: this._baselineSha256,
          delete: true,
        },
        { keepalive: true },
      );
    }
    this._disposed = true;
    // Unregister the FILESYSTEM feed callback — the closure pins this
    // store for the life of the connection otherwise, so every closed
    // File card would leak a dead instance (and add O(cards) work to
    // every filesystem frame).
    this._unsubscribeFilesystem?.();
    this._unsubscribeFilesystem = null;
    this._listeners.clear();
    this._bridge = null;
  }
}
