/**
 * EditorSettingsStore — subscribable store for editor font/size/spacing settings.
 *
 * Reads initial state synchronously from the TugbankClient cache (no async
 * load, no placeholder flash). Observes `onDomainChanged` for live updates
 * from external processes.
 *
 * On change, the store:
 *   1. Notifies subscribers (for useSyncExternalStore — popup labels).
 *   2. Applies CSS custom properties to the bound DOM element (L06, L22).
 *   3. Updates the atom font and regenerates atom images.
 *   4. Persists to tugbank (fire-and-forget).
 *
 * **Laws:** [L02] useSyncExternalStore-compatible subscribe/getSnapshot.
 * [L06] Appearance via CSS custom properties, not React state.
 * [L22] Store changes drive DOM directly, not through React render.
 * [L23] Synchronous initial read — no visible state disturbance.
 *
 * @module lib/editor-settings-store
 */

import { getTugbankClient } from "./tugbank-singleton";
import { putEditorSettings } from "@/settings-api";
import type { EditorSettings } from "@/settings-api";
import { setAtomFont } from "./tug-atom-img";

// ── Constants ───────────────────────────────────────────────────────────────

const DOMAIN = "dev.tugtool.editor";
const KEY = "settings";

export const DEFAULT_SETTINGS: EditorSettings = {
  fontId: "hack",
  fontSize: 13,
  letterSpacing: 0,
};

/** Font stacks keyed by font ID. */
export const FONT_STACKS: Record<string, string> = {
  "plex-sans": '"IBM Plex Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  "inter": '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
  "hack": '"Hack", "JetBrains Mono", "SFMono-Regular", "Menlo", monospace',
};

/** Default font size per font (mono reads larger than proportional). */
export const FONT_DEFAULT_SIZES: Record<string, number> = {
  "plex-sans": 14,
  "inter": 14,
  "hack": 13,
};

// ── Store ───────────────────────────────────────────────────────────────────

export class EditorSettingsStore {
  private _settings: EditorSettings;
  private _listeners: Set<() => void> = new Set();
  private _targetEl: HTMLElement | null = null;
  private _regenerateAtoms: (() => void) | null = null;
  private _unsubscribeTugbank: (() => void) | null = null;

  constructor() {
    // Synchronous read from TugbankClient cache (populated before any
    // React rendering occurs). Falls back to defaults if not yet stored.
    this._settings = this._readFromCache() ?? { ...DEFAULT_SETTINGS };

    // Observe live changes from external processes.
    const client = getTugbankClient();
    if (client) {
      this._unsubscribeTugbank = client.onDomainChanged((domain) => {
        if (domain !== DOMAIN) return;
        const fresh = this._readFromCache();
        if (fresh) this._applySettings(fresh, false);
      });
    }
  }

  /** Read settings from the TugbankClient cache. Returns null if not stored. */
  private _readFromCache(): EditorSettings | null {
    const client = getTugbankClient();
    if (!client) return null;
    const entry = client.get(DOMAIN, KEY);
    if (entry && entry.kind === "json" && entry.value !== undefined) {
      return entry.value as EditorSettings;
    }
    return null;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Bind a DOM element for CSS custom property updates, and an atom regenerator. */
  bind(el: HTMLElement, regenerateAtoms: () => void): void {
    this._targetEl = el;
    this._regenerateAtoms = regenerateAtoms;
    // Apply current settings to the newly bound element immediately.
    this._applyCSSProperties();
    this._applyAtomFont();
  }

  /** Unbind the DOM element (e.g., on unmount). */
  unbind(): void {
    this._targetEl = null;
    this._regenerateAtoms = null;
  }

  /** Get the current settings snapshot. (L02 — useSyncExternalStore) */
  getSnapshot = (): EditorSettings => {
    return this._settings;
  };

  /** Subscribe to settings changes. Returns unsubscribe. (L02) */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  /** Update a single setting. Applies immediately and persists. */
  set(partial: Partial<EditorSettings>): void {
    // When changing font, auto-set the default size for that font.
    if (partial.fontId && partial.fontSize === undefined) {
      partial.fontSize = FONT_DEFAULT_SIZES[partial.fontId] ?? 13;
    }
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
    this._regenerateAtoms = null;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private _applySettings(next: EditorSettings, persist: boolean): void {
    // Validate fontId.
    if (!FONT_STACKS[next.fontId]) next.fontId = DEFAULT_SETTINGS.fontId;

    this._settings = next;

    // CSS custom properties (L06 — appearance via DOM, not React state).
    this._applyCSSProperties();

    // Atom font (Canvas measurement + SVG rendering).
    this._applyAtomFont();

    // Notify useSyncExternalStore subscribers (popup button labels).
    for (const listener of this._listeners) listener();

    // Persist to tugbank (fire-and-forget).
    if (persist) putEditorSettings(next);
  }

  private _applyCSSProperties(): void {
    const el = this._targetEl;
    if (!el) return;
    const { fontId, fontSize, letterSpacing } = this._settings;
    const stack = FONT_STACKS[fontId];
    if (stack) el.style.setProperty("--tug-font-family-editor", stack);
    el.style.setProperty("--tug-font-size-editor", `${fontSize}px`);
    el.style.setProperty("--tug-letter-spacing-editor", letterSpacing === 0 ? "normal" : `${letterSpacing}px`);
  }

  private _applyAtomFont(): void {
    const { fontId, fontSize } = this._settings;
    const stack = FONT_STACKS[fontId];
    if (stack) setAtomFont(stack, fontSize);
    this._regenerateAtoms?.();
  }
}
