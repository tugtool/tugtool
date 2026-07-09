/**
 * FileEditorStore — the live-autosave engine behind one File card.
 *
 * Implements the saveless document model: the buffer the user sees is
 * continuously written through to disk (a short idle debounce coalesces
 * keystrokes; hard flush points override the timer), so there is no dirty
 * state and closing the card is always safe. Every write is conditional on
 * the last-known disk hash; a mismatch surfaces as a `conflict` the card
 * renders as a non-modal banner — external edits are never silently lost,
 * and neither are the user's.
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

/** Immutable snapshot rendered by the File card. */
export interface FileEditorSnapshot {
  phase: FileEditorPhase;
  /** Canonicalized absolute path, once bound. */
  path: string | null;
  /** Non-null while the buffer is an untitled draft ([P10]). */
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
  const lf = text.replace(/\r\n?/g, "\n");
  if (ending === "LF") return lf;
  return lf.replace(/\n/g, ending === "CRLF" ? "\r\n" : "\r");
}

const EMPTY_SNAPSHOT: FileEditorSnapshot = {
  phase: "empty",
  path: null,
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

/** Shape of one FILESYSTEM frame after the workspace_key splice. */
interface FilesystemFrame {
  workspace_key: string;
  events: Array<{ kind: string; path: string }>;
}

/** Parse a FILESYSTEM frame payload; null when malformed. */
function parseFilesystemFrame(payload: Uint8Array): FilesystemFrame | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.workspace_key !== "string") return null;
    if (!Array.isArray(obj.events)) return null;
    return {
      workspace_key: obj.workspace_key,
      events: obj.events.filter(
        (e): e is { kind: string; path: string } =>
          e !== null &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).kind === "string" &&
          typeof (e as Record<string, unknown>).path === "string",
      ),
    };
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
  /** sha256 the next write is conditioned on. */
  private _baselineSha256: string | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _flushInFlight: Promise<void> | null = null;
  /**
   * Whether the buffer's last known content was empty — sampled at
   * open, flush, and revert time (the bridge is gone by dispose time,
   * so dispose-time draft GC reads this instead).
   */
  private _lastKnownEmpty = true;
  /** A revert fetched while a flush was in flight waits its turn. */
  private _recheckQueued = false;
  private _disposed = false;
  /** Unregisters the FILESYSTEM feed callback; called by `dispose()`. */
  private _unsubscribeFilesystem: (() => void) | null = null;

  constructor() {
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
    this._update({
      ...EMPTY_SNAPSHOT,
      phase: "loading",
      path,
      fileName: baseName(path),
    });
    const outcome = await readFileFromDisk(path);
    if (this._disposed) return;
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
   */
  async saveAs(newPath: string): Promise<void> {
    const snap = this._snapshot;
    if (this._bridge === null || snap.phase !== "ready") return;
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
    if (this._disposed) return;
    if (!outcome.ok) {
      tugDevLogStore.warn("file-editor-store", "saveAs failed", {
        error: outcome.error,
        newPath,
      });
      return;
    }
    if (wasDraft && oldPath !== null) {
      // Draft GC — hash-conditional removal of the old draft file.
      void writeFileToDisk({
        path: oldPath,
        content: "",
        baselineSha256: oldBaseline,
        delete: true,
      });
    }
    await this.openPath(newPath);
  }

  /** Explicit save (⌘S / File ▸ Save): flush pending edits now. */
  async saveNow(): Promise<void> {
    await this.flush();
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
    if (snap.saveState !== "writing") {
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
    if (outcome.ok) {
      this._baselineSha256 = outcome.sha256;
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
      this._update({ conflict: null });
      await this._recheckDisk({ force: true });
      return;
    }
    if (conflict.reason !== "hash" || conflict.diskSha256 === undefined) {
      return;
    }
    this._baselineSha256 = conflict.diskSha256;
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
    const hit = frame.events.some(
      (event) => `${root}/${event.path}` === snap.path,
    );
    if (!hit) return;
    if (snap.saveState === "writing") {
      // Likely our own write echoing back; re-check once it settles so a
      // genuinely foreign change still gets adjudicated.
      this._recheckQueued = true;
      return;
    }
    if (snap.saveState === "editing" || snap.conflict !== null) {
      // Unflushed edits: the conditional write adjudicates; never revert
      // out from under the user.
      return;
    }
    void this._recheckDisk();
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
