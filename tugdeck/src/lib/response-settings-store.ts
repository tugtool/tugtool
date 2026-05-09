/**
 * ResponseSettingsStore — subscribable store for the Tide transcript's
 * typography and inter-entry spacing.
 *
 * Mirrors `EditorSettingsStore` in shape but targets a different
 * surface: the assistant-response transcript pane at the top of the
 * Tide card (vs. the prompt editor at the bottom). Two parallel font
 * groups (header / content) plus an `entryMargin` slider value drive
 * a small set of CSS custom properties on the bound transcript root,
 * scoped via descendant rules in `tide-card.css` so the settings only
 * affect the Tide transcript and never bleed into other markdown
 * consumers in the deck.
 *
 * Reads initial state synchronously from the TugbankClient cache (no
 * async load, no placeholder flash). Observes `onDomainChanged` for
 * live updates from external processes.
 *
 * **Laws:** [L02] useSyncExternalStore-compatible subscribe/getSnapshot.
 * [L06] Appearance via CSS custom properties, not React state.
 * [L22] Store changes drive DOM directly, not through React render.
 * [L23] Synchronous initial read — no visible state disturbance.
 *
 * @module lib/response-settings-store
 */

import { getTugbankClient } from "./tugbank-singleton";
import { putResponseSettings } from "@/settings-api";
import type { ResponseSettings } from "@/settings-api";
import { FONT_STACKS } from "./editor-settings-store";

// ── Constants ───────────────────────────────────────────────────────────────

const DOMAIN = "dev.tugtool.tide.response";
const KEY = "settings";

export const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  headerFontId: "plex-sans",
  headerFontSize: 14,
  headerLetterSpacing: 0,
  headerLineHeight: 1.4,
  contentFontId: "plex-sans",
  contentFontSize: 14,
  contentLetterSpacing: 0,
  contentLineHeight: 1.6,
  entryMargin: 16,
};

// ── Store ───────────────────────────────────────────────────────────────────

export class ResponseSettingsStore {
  private _settings: ResponseSettings;
  private _listeners: Set<() => void> = new Set();
  private _targetEl: HTMLElement | null = null;
  private _unsubscribeTugbank: (() => void) | null = null;

  constructor() {
    this._settings = this._readFromCache() ?? { ...DEFAULT_RESPONSE_SETTINGS };

    const client = getTugbankClient();
    if (client) {
      this._unsubscribeTugbank = client.onDomainChanged((domain) => {
        if (domain !== DOMAIN) return;
        const fresh = this._readFromCache();
        if (fresh) this._applySettings(fresh, false);
      });
    }
  }

  /** Read settings from the TugbankClient cache. Returns null if not stored.
   *  Persisted snapshots from earlier versions may be missing newer fields;
   *  fill with defaults so the store always sees a complete shape. */
  private _readFromCache(): ResponseSettings | null {
    const client = getTugbankClient();
    if (!client) return null;
    const entry = client.get(DOMAIN, KEY);
    if (entry && entry.kind === "json" && entry.value !== undefined) {
      return { ...DEFAULT_RESPONSE_SETTINGS, ...(entry.value as Partial<ResponseSettings>) };
    }
    return null;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Bind the transcript root element for CSS custom property updates. */
  bind(el: HTMLElement): void {
    this._targetEl = el;
    this._applyCSSProperties();
  }

  /** Unbind the DOM element (e.g., on unmount). */
  unbind(): void {
    this._targetEl = null;
  }

  /** Get the current settings snapshot. (L02 — useSyncExternalStore) */
  getSnapshot = (): ResponseSettings => {
    return this._settings;
  };

  /** Subscribe to settings changes. Returns unsubscribe. (L02) */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  /** Update one or more settings. Applies immediately and persists. */
  set(partial: Partial<ResponseSettings>): void {
    const next = { ...this._settings, ...partial };
    this._applySettings(next, true);
  }

  /** Dispose subscriptions. */
  dispose(): void {
    if (this._unsubscribeTugbank) {
      this._unsubscribeTugbank();
      this._unsubscribeTugbank = null;
    }
    this._listeners.clear();
    this._targetEl = null;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private _applySettings(next: ResponseSettings, persist: boolean): void {
    if (!FONT_STACKS[next.headerFontId]) next.headerFontId = DEFAULT_RESPONSE_SETTINGS.headerFontId;
    if (!FONT_STACKS[next.contentFontId]) next.contentFontId = DEFAULT_RESPONSE_SETTINGS.contentFontId;

    this._settings = next;

    this._applyCSSProperties();

    for (const listener of this._listeners) listener();

    if (persist) putResponseSettings(next);
  }

  private _applyCSSProperties(): void {
    const el = this._targetEl;
    if (!el) return;
    const s = this._settings;

    const headerStack = FONT_STACKS[s.headerFontId];
    if (headerStack) el.style.setProperty("--tugx-tide-header-font-family", headerStack);
    el.style.setProperty("--tugx-tide-header-font-size", `${s.headerFontSize}px`);
    el.style.setProperty(
      "--tugx-tide-header-letter-spacing",
      s.headerLetterSpacing === 0 ? "normal" : `${s.headerLetterSpacing}px`,
    );
    el.style.setProperty("--tugx-tide-header-line-height", String(s.headerLineHeight));

    const contentStack = FONT_STACKS[s.contentFontId];
    if (contentStack) el.style.setProperty("--tugx-tide-content-font-family", contentStack);
    el.style.setProperty("--tugx-tide-content-font-size", `${s.contentFontSize}px`);
    el.style.setProperty(
      "--tugx-tide-content-letter-spacing",
      s.contentLetterSpacing === 0 ? "normal" : `${s.contentLetterSpacing}px`,
    );
    el.style.setProperty("--tugx-tide-content-line-height", String(s.contentLineHeight));

    el.style.setProperty("--tugx-tide-entry-margin", `${s.entryMargin}px`);
  }
}
