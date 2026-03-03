/**
 * keybinding-map.ts -- Static keybinding map for the four-stage key pipeline.
 *
 * Maps key combinations to action names. Stage 1 of the key pipeline
 * (capture-phase listener) consults this map.
 *
 * Format: { key: KeyboardEvent.code, ctrl?, meta?, shift?, alt?, action }
 *
 * [D04] Minimal static keybinding map for Phase 3
 * Spec S05, Table T02
 */

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
  /** Action name to dispatch when the binding matches */
  action: string;
}

// ---- Phase 3 keybindings (Table T02) ----

/**
 * Static keybinding map for Phase 3.
 *
 * Extensible: later phases add entries here without changing pipeline logic.
 *
 * Table T02:
 * | Ctrl+`  | cyclePanel | stage 1 (global shortcut) |
 */
export const KEYBINDINGS: KeyBinding[] = [
  { key: "Backquote", ctrl: true, action: "cyclePanel" },
];

// ---- matchKeybinding ----

/**
 * Match a KeyboardEvent against the keybinding map.
 *
 * Returns the action name if a binding matches, or null if no match.
 * Uses KeyboardEvent.code (layout-independent) for the key field.
 */
export function matchKeybinding(event: KeyboardEvent): string | null {
  for (const binding of KEYBINDINGS) {
    if (
      event.code === binding.key &&
      !!event.ctrlKey === (binding.ctrl ?? false) &&
      !!event.metaKey === (binding.meta ?? false) &&
      !!event.shiftKey === (binding.shift ?? false) &&
      !!event.altKey === (binding.alt ?? false)
    ) {
      return binding.action;
    }
  }
  return null;
}
