/**
 * DefaultTextCardStore — subscribable store for the *deck-wide*
 * Text Card defaults the Settings card's "Text Card" tab edits.
 *
 * A single deck-wide value ({@link TextCardDefaults}): the view
 * settings plus `openTarget` a brand-new Text card adopts on first open
 * when it has nothing persisted of its own. No CSS/DOM side effects — it
 * just reads and writes one tugbank json blob at
 * `dev.tugtool.text-card/settings`. Mirrors `DefaultModelStore` /
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
 * @module lib/default-text-card-store
 */

import { getTugbankClient } from "./tugbank-singleton";
import { putTextCardDefaults } from "@/settings-api";
import {
  DEFAULT_TEXT_CARD_DEFAULTS,
  TEXT_CARD_DEFAULTS_DOMAIN,
  TEXT_CARD_DEFAULTS_KEY,
  parseTextCardDefaults,
  type TextCardDefaults,
} from "./text-card-settings";

export class DefaultTextCardStore {
  private _defaults: TextCardDefaults;
  private _listeners: Set<() => void> = new Set();
  private _unsubscribeTugbank: (() => void) | null = null;

  constructor() {
    this._defaults = this._readFromCache() ?? { ...DEFAULT_TEXT_CARD_DEFAULTS };

    const client = getTugbankClient();
    if (client) {
      this._unsubscribeTugbank = client.onDomainChanged((domain) => {
        if (domain !== TEXT_CARD_DEFAULTS_DOMAIN) return;
        const fresh = this._readFromCache() ?? { ...DEFAULT_TEXT_CARD_DEFAULTS };
        this._defaults = fresh;
        for (const listener of this._listeners) listener();
      });
    }
  }

  private _readFromCache(): TextCardDefaults | null {
    const client = getTugbankClient();
    if (!client) return null;
    return parseTextCardDefaults(
      client.get(TEXT_CARD_DEFAULTS_DOMAIN, TEXT_CARD_DEFAULTS_KEY),
    );
  }

  /** Current deck-wide defaults. (L02 — useSyncExternalStore) */
  getSnapshot = (): TextCardDefaults => this._defaults;

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
  set(partial: Partial<TextCardDefaults>): void {
    const next = { ...this._defaults, ...partial };
    this._defaults = next;
    for (const listener of this._listeners) listener();

    const client = getTugbankClient();
    if (client) {
      client.setLocalValue(TEXT_CARD_DEFAULTS_DOMAIN, TEXT_CARD_DEFAULTS_KEY, {
        kind: "json",
        value: next,
      });
    }
    putTextCardDefaults(next);
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
