/**
 * ResponseSettingsStore — subscribable store for the Dev transcript's
 * presentation knobs.
 *
 * Two settings:
 *
 *   - `entryMargin` (px): inter-entry vertical gap, written through to
 *     `--tugx-list-view-row-gap` via the cascade variable
 *     `--tugx-dev-entry-margin`.
 *   - `magnification` (factor, 1 = 100%): the Settings sheet's
 *     Magnification slider, now implemented as CSS `zoom` applied to the
 *     transcript root via `--transcript-zoom`. Layout zoom scopes the
 *     scale to this card's transcript subtree (which wholly contains
 *     the list scrollport, so the list's measurements stay in one
 *     uniformly-scaled space), leaving the surrounding chrome at 1×.
 *     Distinct from — and composes with — the Swift host's
 *     `WKWebView.pageZoom` (View > Zoom In / Out), which scales the
 *     whole window.
 *
 * The store applies both as CSS custom properties on the bound
 * transcript root, so the transcript pane reads exactly the user's
 * choice and no other markdown surface in the deck is affected.
 *
 * Reads initial state synchronously from the TugbankClient cache
 * (no async load, no placeholder flash). Observes `onDomainChanged`
 * for live updates from external processes.
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

// ── Constants ───────────────────────────────────────────────────────────────

const DOMAIN = "dev.tugtool.dev.response";
const KEY = "settings";

export const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  entryMargin: 24,
  magnification: 1,
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
   *  Persisted snapshots from earlier versions may be missing newer fields
   *  or carry retired fields (e.g. `magnification`, which moved to the
   *  Swift host's WKWebView.pageZoom). We pick out the keys we still
   *  consume and ignore the rest, so the next write doesn't perpetuate
   *  the stale shape. */
  private _readFromCache(): ResponseSettings | null {
    const client = getTugbankClient();
    if (!client) return null;
    const entry = client.get(DOMAIN, KEY);
    if (entry && entry.kind === "json" && entry.value !== undefined) {
      const raw = entry.value as Partial<ResponseSettings>;
      return {
        ...DEFAULT_RESPONSE_SETTINGS,
        ...(typeof raw.entryMargin === "number" ? { entryMargin: raw.entryMargin } : {}),
        ...(typeof raw.magnification === "number" ? { magnification: raw.magnification } : {}),
      };
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
    this._settings = next;

    this._applyCSSProperties();

    for (const listener of this._listeners) listener();

    if (persist) putResponseSettings(next);
  }

  private _applyCSSProperties(): void {
    const el = this._targetEl;
    if (!el) return;
    const s = this._settings;
    el.style.setProperty("--tugx-dev-entry-margin", `${s.entryMargin}px`);
    el.style.setProperty("--transcript-zoom", `${s.magnification}`);
  }
}
