/**
 * file-editor-settings.ts — pure helpers for the File card editor's
 * settings: the deck-wide defaults a new File card adopts on first
 * open, and the per-card values that override them thereafter.
 *
 * No React, no DOM, no I/O — every export is a pure function or a
 * constant, so the parse/resolve logic is unit-testable without a
 * store or a rendered component. Tugbank persistence lives in the
 * store / hook that consume these (`default-file-editor-store.ts`,
 * `use-file-editor-settings.ts`). Mirrors `model.ts`.
 *
 * Two tugbank surfaces, mirroring the model default/per-card split:
 *
 *   - Deck-wide defaults at `dev.tugtool.file-editor/settings`
 *     ({@link FileEditorDefaults}) — edited in the Settings card's
 *     "File Editor" tab. Carries the CM6 view settings PLUS
 *     `openTarget`, which is a deck-wide behavior (how a newly opened
 *     file is routed), never a per-card value.
 *   - Per-card values at `dev.file-editor/<cardId>`
 *     ({@link FileEditorSettings}) — the card-local view settings the
 *     gear popup writes. Seeded from the defaults on first open, then
 *     card-local: changing the defaults never disturbs an open card.
 *
 * Every field maps to a CodeMirror 6 extension; there is no setting
 * here CM6 cannot back live.
 *
 * @module lib/file-editor-settings
 */

import type { TaggedValue } from "@/lib/tugbank-client";

/**
 * Where a newly opened file is routed when no card already holds it:
 *   - `"new"`     — a fresh File card (its own pane).
 *   - `"reuse"`   — rebind the frontmost File card to the new file.
 *   - `"newTab"`  — a new File tab in the frontmost File card's pane.
 */
export type FileEditorOpenTarget = "reuse" | "new" | "newTab";

/** The per-card, CM6-backed view settings for one File card editor. */
export interface FileEditorSettings {
  /** Line-number gutter. */
  lineNumbers: boolean;
  /** Soft-wrap long lines to the viewport width. */
  lineWrap: boolean;
  /** Auto-expand tabs: the Tab key inserts `tabSize` spaces. */
  softTabs: boolean;
  /** Spaces per tab (indent unit width; also the tab render width). */
  tabSize: number;
  /** Code-folding gutter. */
  foldGutter: boolean;
  /** Highlight the line (and gutter cell) containing the cursor. */
  highlightActiveLine: boolean;
  /** Render space characters as visible dots. */
  showSpaces: boolean;
  /** Render tab characters as visible arrows. */
  showTabs: boolean;
}

/** The deck-wide defaults blob: the view settings plus `openTarget`. */
export interface FileEditorDefaults extends FileEditorSettings {
  openTarget: FileEditorOpenTarget;
}

/** tugbank domain for per-card File-editor settings (keyed by cardId). */
export const FILE_EDITOR_DOMAIN = "dev.file-editor";

/**
 * tugbank domain/key for the deck-wide File-editor defaults — the
 * values a brand-new File card (one with nothing persisted under
 * {@link FILE_EDITOR_DOMAIN}) adopts on first open. Set from the
 * Settings card's "File Editor" tab; distinct from the per-card domain
 * so changing the defaults never disturbs an open card.
 */
export const FILE_EDITOR_DEFAULTS_DOMAIN = "dev.tugtool.file-editor";
export const FILE_EDITOR_DEFAULTS_KEY = "settings";

/** The view settings a File card uses when nothing else is configured. */
export const DEFAULT_FILE_EDITOR_SETTINGS: FileEditorSettings = {
  lineNumbers: true,
  lineWrap: false,
  softTabs: true,
  tabSize: 4,
  foldGutter: false,
  highlightActiveLine: true,
  showSpaces: false,
  showTabs: false,
};

/** New files open in a new card unless the deck default opts into reuse. */
export const DEFAULT_FILE_EDITOR_OPEN_TARGET: FileEditorOpenTarget = "new";

export const DEFAULT_FILE_EDITOR_DEFAULTS: FileEditorDefaults = {
  ...DEFAULT_FILE_EDITOR_SETTINGS,
  openTarget: DEFAULT_FILE_EDITOR_OPEN_TARGET,
};

/** Clamp an arbitrary number to a sane spaces-per-tab range. */
export function clampTabSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FILE_EDITOR_SETTINGS.tabSize;
  return Math.max(1, Math.min(16, Math.round(value)));
}

/** Read a boolean field off an untrusted stored blob, else the fallback. */
function readBool(
  obj: Record<string, unknown>,
  key: keyof FileEditorSettings,
  fallback: boolean,
): boolean {
  const v = obj[key];
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Parse the per-card settings out of a tugbank tagged value. Missing or
 * malformed fields fall back to {@link DEFAULT_FILE_EDITOR_SETTINGS};
 * a wholly absent / non-json entry yields `null` (no per-card value).
 */
export function parseFileEditorSettings(
  entry: TaggedValue | undefined,
): FileEditorSettings | null {
  if (entry?.kind !== "json" || entry.value === undefined || entry.value === null) {
    return null;
  }
  const obj = entry.value as Record<string, unknown>;
  const d = DEFAULT_FILE_EDITOR_SETTINGS;
  return {
    lineNumbers: readBool(obj, "lineNumbers", d.lineNumbers),
    lineWrap: readBool(obj, "lineWrap", d.lineWrap),
    softTabs: readBool(obj, "softTabs", d.softTabs),
    tabSize: typeof obj.tabSize === "number" ? clampTabSize(obj.tabSize) : d.tabSize,
    foldGutter: readBool(obj, "foldGutter", d.foldGutter),
    highlightActiveLine: readBool(obj, "highlightActiveLine", d.highlightActiveLine),
    showSpaces: readBool(obj, "showSpaces", d.showSpaces),
    showTabs: readBool(obj, "showTabs", d.showTabs),
  };
}

/**
 * Parse the deck-wide defaults out of a tugbank tagged value — the
 * per-card fields plus `openTarget`. `null` when absent / non-json.
 */
export function parseFileEditorDefaults(
  entry: TaggedValue | undefined,
): FileEditorDefaults | null {
  const settings = parseFileEditorSettings(entry);
  if (settings === null) return null;
  const obj = (entry as TaggedValue).value as Record<string, unknown>;
  const openTarget =
    obj.openTarget === "reuse" ||
    obj.openTarget === "new" ||
    obj.openTarget === "newTab"
      ? (obj.openTarget as FileEditorOpenTarget)
      : DEFAULT_FILE_EDITOR_OPEN_TARGET;
  return { ...settings, openTarget };
}

/**
 * The view settings a freshly-mounted File card should use: its own
 * per-card values when present, otherwise the deck-wide defaults,
 * otherwise the hardcoded defaults. The per-card value always wins, so
 * a card that has been tuned keeps its settings regardless of the
 * deck default. Mirrors `resolveSeedModel`.
 */
export function resolveFileEditorSettings(
  persisted: FileEditorSettings | null,
  defaults: FileEditorDefaults | null,
): FileEditorSettings {
  if (persisted !== null) return persisted;
  if (defaults !== null) {
    const { openTarget: _openTarget, ...settings } = defaults;
    return settings;
  }
  return { ...DEFAULT_FILE_EDITOR_SETTINGS };
}
