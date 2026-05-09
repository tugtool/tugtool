/**
 * ResponseSettingsStore — subscribable store for the Tide transcript's
 * presentation knobs.
 *
 * Two settings only:
 *
 *   - `magnification` (0.5 – 1.5, default 1.0): scales the entire
 *     transcript view — text, headings, icons, controls — by treating
 *     it as a font-size multiplier on `.tide-card-transcript` and
 *     letting `em`-relative descendants scale by cascade. Pixel-baked
 *     icons and identifiers get explicit `em` overrides in
 *     `tide-card.css` so they track the multiplier too.
 *   - `entryMargin` (px): inter-entry vertical gap, written through to
 *     `--tugx-list-view-row-gap` via the cascade variable
 *     `--tugx-tide-entry-margin`.
 *
 * The store applies both as CSS custom properties on the bound
 * transcript root, so the transcript pane reads exactly the user's
 * choices and no other markdown surface in the deck is affected.
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

const DOMAIN = "dev.tugtool.tide.response";
const KEY = "settings";

/** Lower bound on the magnification slider. Below 0.5x the icon
 *  gutter starts colliding with body text on small panes. */
export const MIN_MAGNIFICATION = 0.5;
/** Upper bound. Past 1.5x a single line of body text begins to
 *  overflow at default pane widths. */
export const MAX_MAGNIFICATION = 1.5;

export const DEFAULT_RESPONSE_SETTINGS: ResponseSettings = {
  magnification: 1.0,
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
    // Clamp out-of-range values from a stale persisted shape so the
    // slider never lands on an invalid position on a fresh load.
    next.magnification = Math.max(
      MIN_MAGNIFICATION,
      Math.min(MAX_MAGNIFICATION, next.magnification),
    );

    this._settings = next;

    this._applyCSSProperties();

    for (const listener of this._listeners) listener();

    if (persist) putResponseSettings(next);
  }

  private _applyCSSProperties(): void {
    const el = this._targetEl;
    if (!el) return;
    const s = this._settings;
    el.style.setProperty("--tugx-tide-magnification", String(s.magnification));
    el.style.setProperty("--tugx-tide-entry-margin", `${s.entryMargin}px`);
  }
}
