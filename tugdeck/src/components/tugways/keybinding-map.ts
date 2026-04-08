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
 * Table T02:
 * | Ctrl+`       | cycleCard | stage 1 (global shortcut)       |
 * | Cmd+A (Meta) | selectAll | stage 1 + preventDefaultOnMatch |
 * | Cmd+X (Meta) | cut       | stage 1 + preventDefaultOnMatch |
 * | Cmd+C (Meta) | copy      | stage 1 + preventDefaultOnMatch |
 * | Cmd+V (Meta) | paste     | stage 1 + preventDefaultOnMatch |
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
