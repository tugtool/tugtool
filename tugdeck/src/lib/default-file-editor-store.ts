/**
 * DefaultFileEditorStore — subscribable store for the *deck-wide*
 * File-editor defaults the Settings card's "File Editor" tab edits.
 *
 * A single deck-wide value ({@link FileEditorDefaults}): the view
 * settings plus `openTarget` a brand-new File card adopts on first open
 * when it has nothing persisted of its own. No CSS/DOM side effects — it
 * just reads and writes one tugbank json blob at
 * `dev.tugtool.file-editor/settings`. Mirrors `DefaultModelStore` /
 * `EditorSettingsStore`.
 *
 * Writes go through `client.setLocalValue` (optimistic, and — crucially
 * — synchronously fires `onDomainChanged`, so every open card's
 * `useTugbankValue` reader reflects the new default immediately) plus a
 * PUT to persist. Reads come straight from the TugbankClient cache, so
 * the panel's controls are correct from first paint with no async flash.
 *
 * **Laws:** [L02] useSyncExternalStore-compatible subscribe/getSnapshot.
 *
 * @module lib/default-file-editor-store
 */

import { getTugbankClient } from "./tugbank-singleton";
import { putFileEditorDefaults } from "@/settings-api";
import {
  DEFAULT_FILE_EDITOR_DEFAULTS,
  FILE_EDITOR_DEFAULTS_DOMAIN,
  FILE_EDITOR_DEFAULTS_KEY,
  parseFileEditorDefaults,
  type FileEditorDefaults,
} from "./file-editor-settings";

export class DefaultFileEditorStore {
  private _defaults: FileEditorDefaults;
  private _listeners: Set<() => void> = new Set();
  private _unsubscribeTugbank: (() => void) | null = null;

  constructor() {
    this._defaults = this._readFromCache() ?? { ...DEFAULT_FILE_EDITOR_DEFAULTS };

    const client = getTugbankClient();
    if (client) {
      this._unsubscribeTugbank = client.onDomainChanged((domain) => {
        if (domain !== FILE_EDITOR_DEFAULTS_DOMAIN) return;
        const fresh = this._readFromCache() ?? { ...DEFAULT_FILE_EDITOR_DEFAULTS };
        this._defaults = fresh;
        for (const listener of this._listeners) listener();
      });
    }
  }

  private _readFromCache(): FileEditorDefaults | null {
    const client = getTugbankClient();
    if (!client) return null;
    return parseFileEditorDefaults(
      client.get(FILE_EDITOR_DEFAULTS_DOMAIN, FILE_EDITOR_DEFAULTS_KEY),
    );
  }

  /** Current deck-wide defaults. (L02 — useSyncExternalStore) */
  getSnapshot = (): FileEditorDefaults => this._defaults;

  /** Subscribe to changes. Returns unsubscribe. (L02) */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  /**
   * Update the deck-wide defaults. Optimistically reflects locally and
   * across open cards via `setLocalValue`, then persists.
   */
  set(partial: Partial<FileEditorDefaults>): void {
    const next = { ...this._defaults, ...partial };
    this._defaults = next;
    for (const listener of this._listeners) listener();

    const client = getTugbankClient();
    if (client) {
      client.setLocalValue(FILE_EDITOR_DEFAULTS_DOMAIN, FILE_EDITOR_DEFAULTS_KEY, {
        kind: "json",
        value: next,
      });
    }
    putFileEditorDefaults(next);
  }

  /** Dispose subscriptions. */
  dispose(): void {
    if (this._unsubscribeTugbank) {
      this._unsubscribeTugbank();
      this._unsubscribeTugbank = null;
    }
    this._listeners.clear();
  }
}
