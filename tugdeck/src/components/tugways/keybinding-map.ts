/**
 * keybinding-map.ts -- Static keybinding map for the four-stage key pipeline.
 *
 * Maps key combinations to TugAction names. Stage 1 of the key
 * pipeline (capture-phase listener) consults this map.
 *
 * Format: { key: KeyboardEvent.code, ctrl?, meta?, shift?, alt?, action, preventDefaultOnMatch? }
 *
 * [D04] Minimal static keybinding map for Phase 3
 * [D06] preventDefaultOnMatch added in Phase 5a for Cmd+A scoping (Spec S03)
 * Spec S05, Table T02
 */

import type { TugAction } from "./action-vocabulary";

// ---- KeyBinding interface ----

/**
 * A single keybinding entry.
 *
 * `key` uses the KeyboardEvent.code value (layout-independent), e.g.
 * "Backquote", "KeyN". Modifier flags default to false when absent.
 */
export interface KeyBinding {
  /** KeyboardEvent.code (layout-independent key identifier) */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** TugAction name to dispatch when the binding matches */
  action: TugAction;
  /**
   * When true, the pipeline calls preventDefault on the event when this
   * binding matches, before dispatching to the responder chain. This allows
   * browser-default behaviors (e.g. Cmd+A select-all) to be suppressed even
   * when no responder handles the action.
   *
   * [D06] Phase 5a: used for the Cmd+A selectAll binding so the browser's
   * native select-all is always suppressed when the keybinding matches.
   */
  preventDefaultOnMatch?: boolean;
}

// ---- Keybindings ----

/**
 * Static keybinding map.
 *
 * Extensible: later phases add entries here without changing pipeline logic.
 *
 * Phase A3 / R4 added the macOS-standard shortcut set. Every entry
 * dispatches a typed action through the responder chain; the walk
 * lands on whatever responder registered a handler for that action
 * (editor for undo, card for close/tab nav, canvas for showSettings
 * and addTabToActiveCard, any of the floating surfaces for
 * cancelDialog). There is no per-component keyboard wiring — adding
 * a new shortcut is one entry here and (if needed) one handler on
 * the responder that owns the semantic.
 *
 * Shortcuts that currently dispatch to stub handlers (⌘, , ⌘F) still
 * route through the chain so the keystroke has a single code path
 * from the moment the handler grows real behavior.
 *
 * Table T02:
 * | Ctrl+`           | cycleCard          | stage 1 (global shortcut)       |
 * | Cmd+A            | selectAll          | stage 1 + preventDefaultOnMatch |
 * | Cmd+X            | cut                | stage 1 + preventDefaultOnMatch |
 * | Cmd+C            | copy               | stage 1 + preventDefaultOnMatch |
 * | Cmd+V            | paste              | stage 1 + preventDefaultOnMatch |
 * | Cmd+Z            | undo               | stage 1 + preventDefaultOnMatch |
 * | Shift+Cmd+Z      | redo               | stage 1 + preventDefaultOnMatch |
 * | Cmd+W            | close              | stage 1 (card close)            |
 * | Cmd+T            | addTabToActiveCard | stage 1 (canvas)                |
 * | Cmd+,            | showSettings       | stage 1 (canvas stub)           |
 * | Cmd+.            | cancelDialog       | stage 1 (floating surfaces)     |
 * | Cmd+F            | find               | stage 1 (card stub)             |
 * | Shift+Cmd+[      | previousTab        | stage 1 (card, wraps)           |
 * | Shift+Cmd+]      | nextTab            | stage 1 (card, wraps)           |
 */
export const KEYBINDINGS: KeyBinding[] = [
  { key: "Backquote", ctrl: true, action: "cycleCard" },
  { key: "KeyA", meta: true, action: "selectAll", preventDefaultOnMatch: true },
  // Clipboard shortcuts route through the responder chain so the first
  // responder (e.g. an editor's registered action) does the work. The
  // browser's native clipboard handling is suppressed via
  // preventDefaultOnMatch so a single code path (the responder) owns
  // the semantics — including atom-aware HTML preservation.
  { key: "KeyX", meta: true, action: "cut", preventDefaultOnMatch: true },
  { key: "KeyC", meta: true, action: "copy", preventDefaultOnMatch: true },
  { key: "KeyV", meta: true, action: "paste", preventDefaultOnMatch: true },
  // Undo / redo suppress the browser's native history stack so the
  // editor's engine / execCommand continuation is the single source
  // of truth — same rationale as the clipboard shortcuts above.
  { key: "KeyZ", meta: true, action: "undo", preventDefaultOnMatch: true },
  {
    key: "KeyZ",
    meta: true,
    shift: true,
    action: "redo",
    preventDefaultOnMatch: true,
  },
  // Card / canvas / dialog shortcuts. These do NOT set
  // preventDefaultOnMatch: either the key has no browser default we
  // care about (⌘W in a WebView is app-level), or the default is
  // already suppressed upstream (⌘T via the Swift menu), or there is
  // no conflicting default at all (⌘, , ⌘., ⌘F inside a WebView run
  // without a browser UI to collide with).
  { key: "KeyW", meta: true, action: "close" },
  { key: "KeyT", meta: true, action: "addTabToActiveCard" },
  { key: "Comma", meta: true, action: "showSettings" },
  { key: "Period", meta: true, action: "cancelDialog" },
  { key: "KeyF", meta: true, action: "find" },
  // Tab navigation: macOS convention (Safari, Terminal) uses
  // ⇧⌘[ / ⇧⌘] for previous / next tab with wrap-around. Routes to
  // tug-card's existing previousTab / nextTab handlers, which already
  // wrap via `(idx ± 1 + n) % n`.
  { key: "BracketLeft", meta: true, shift: true, action: "previousTab" },
  { key: "BracketRight", meta: true, shift: true, action: "nextTab" },
];

// ---- matchKeybinding ----

/**
 * Match a KeyboardEvent against the keybinding map.
 *
 * Returns the full KeyBinding object if a binding matches, or null if no match.
 * Uses KeyboardEvent.code (layout-independent) for the key field.
 *
 * [D06] Returns the full binding so callers can inspect preventDefaultOnMatch.
 */
export function matchKeybinding(event: KeyboardEvent): KeyBinding | null {
  for (const binding of KEYBINDINGS) {
    if (
      event.code === binding.key &&
      !!event.ctrlKey === (binding.ctrl ?? false) &&
      !!event.metaKey === (binding.meta ?? false) &&
      !!event.shiftKey === (binding.shift ?? false) &&
      !!event.altKey === (binding.alt ?? false)
    ) {
      return binding;
    }
  }
  return null;
}
