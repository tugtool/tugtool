/**
 * keybinding-map.ts -- Static keybinding map for the four-stage key pipeline.
 *
 * Maps key combinations to TugAction names. Stage 1 of the key
 * pipeline (capture-phase listener) consults this map.
 *
 * Format: { key: KeyboardEvent.code, ctrl?, meta?, shift?, alt?, action, preventDefaultOnMatch? }
 *
 * [D04] Minimal static keybinding map for Phase 3
 * [D06] preventDefaultOnMatch added in Phase 5a for Cmd+A scoping ()
 *,  */

import type { TugAction } from "./action-vocabulary";
import { TUG_ACTIONS } from "./action-vocabulary";

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
  /**
   * Static payload copied onto the dispatched ActionEvent's `value`
   * field when this binding matches. Phase A3 / R4 introduced this
   * for the ⌘1..⌘9 → `jumpToTab` family, where the binding needs to
   * carry the 1-based tab index into the dispatch. Omit for actions
   * whose handlers take no payload.
   *
   * The field is typed `unknown` to match `ActionEvent.value`, which
   * itself is untyped by design (see action-vocabulary.ts for the
   * "middle ground" rationale). Handlers narrow at the dispatch site
   * via `typeof` or structural guards, same as any other action.
   */
  value?: unknown;
  /**
   * Routing for this binding's dispatch.
   *
   *   - `"first-responder"` (default) — existing semantics; the
   *     capture-phase listener calls
   *     `sendToFirstResponderForContinuation`, which walks up from the
   *     current first responder. Use for shortcuts whose target
   *     depends on which specific element the user is inside (clipboard,
   *     undo, tab navigation, etc.).
   *
   *   - `"key-card"` — dispatches to the `kind: "card-content"`
   *     responder inside the *active card* (regardless of which
   *     element inside the card is focused). Use for shortcuts that
   *     belong to "whichever card the user is currently in" — e.g.
   *     ⌘K focus-prompt. Each card type declares its own handlers by
   *     registering a `card-content` responder in its body; the chain
   *     walks UP from there, so unhandled actions fall through to the
   *     card-level responder and above as usual.
   */
  scope?: "first-responder" | "key-card";
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
 * (editor for undo, card for close/tab nav, canvas for show-settings
 * and add-card-to-active-pane, any of the floating surfaces for
 * cancel-dialog). There is no per-component keyboard wiring — adding
 * a new shortcut is one entry here and (if needed) one handler on
 * the responder that owns the semantic.
 *
 * Shortcuts that currently dispatch to stub handlers (⌘, , ⌘F) still
 * route through the chain so the keystroke has a single code path
 * from the moment the handler grows real behavior.
 *
 *  * | Ctrl+`           | cycle-card             | stage 1 (global shortcut)       |
 * | Cmd+A            | select-all             | stage 1 + preventDefaultOnMatch |
 * | Cmd+X            | cut                    | stage 1 + preventDefaultOnMatch |
 * | Cmd+C            | copy                   | stage 1 + preventDefaultOnMatch |
 * | Cmd+V            | paste                  | stage 1 + preventDefaultOnMatch |
 * | Cmd+Z            | undo                   | stage 1 + preventDefaultOnMatch |
 * | Shift+Cmd+Z      | redo                   | stage 1 + preventDefaultOnMatch |
 * | Cmd+W            | close                  | stage 1 (card close)            |
 * | Cmd+T            | add-card-to-active-pane | stage 1 (canvas)                |
 * | Cmd+,            | show-settings          | stage 1 (canvas stub)           |
 * | Cmd+.            | cancel-dialog          | stage 1 (floating surfaces)     |
 * | Cmd+F            | find                   | stage 1 (card stub)             |
 * | Shift+Cmd+[      | previous-tab           | stage 1 (card, wraps)           |
 * | Shift+Cmd+]      | next-tab               | stage 1 (card, wraps)           |
 * | Cmd+1..Cmd+9     | jump-to-tab            | stage 1 + value: 1..9 payload   |
 */
export const KEYBINDINGS: KeyBinding[] = [
  { key: "Backquote", ctrl: true, action: TUG_ACTIONS.CYCLE_CARD },
  { key: "KeyA", meta: true, action: TUG_ACTIONS.SELECT_ALL, preventDefaultOnMatch: true },
  // Clipboard shortcuts route through the responder chain so the first
  // responder (e.g. an editor's registered action) does the work. The
  // browser's native clipboard handling is suppressed via
  // preventDefaultOnMatch so a single code path (the responder) owns
  // the semantics — including atom-aware HTML preservation.
  { key: "KeyX", meta: true, action: TUG_ACTIONS.CUT, preventDefaultOnMatch: true },
  { key: "KeyC", meta: true, action: TUG_ACTIONS.COPY, preventDefaultOnMatch: true },
  { key: "KeyV", meta: true, action: TUG_ACTIONS.PASTE, preventDefaultOnMatch: true },
  // Undo / redo do NOT use preventDefaultOnMatch. Native <input> and
  // <textarea> elements rely on the browser's built-in undo stack,
  // which no JavaScript API can trigger programmatically. These
  // components do not register undo/redo handlers, so the dispatch
  // returns handled=false, preventDefault is skipped, and the
  // browser's native Cmd+Z runs. ContentEditable responders (e.g.
  // tug-prompt-input) register their own handlers; when handled, the
  // dispatch branch calls preventDefault so the engine's execCommand
  // is the single source of truth.
  { key: "KeyZ", meta: true, action: TUG_ACTIONS.UNDO },
  { key: "KeyZ", meta: true, shift: true, action: TUG_ACTIONS.REDO },
  // Card / canvas / dialog shortcuts. These do NOT set
  // preventDefaultOnMatch: either the key has no browser default we
  // care about (⌘W in a WebView is app-level), or the default is
  // already suppressed upstream (⌘T via the Swift menu), or there is
  // no conflicting default at all (⌘, , ⌘., ⌘F inside a WebView run
  // without a browser UI to collide with).
  { key: "KeyW", meta: true, action: TUG_ACTIONS.CLOSE },
  { key: "KeyT", meta: true, action: TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE },
  // Focus the key card's prompt input. `scope: "key-card"` routes the
  // dispatch to the `card-content` responder inside the active card;
  // each card type that has a prompt (tide, future) registers a
  // FOCUS_PROMPT handler there. Non-prompt cards (gallery, git) don't
  // register; the dispatch is a silent no-op and
  // `preventDefaultOnMatch` suppresses the macOS beep regardless.
  {
    key: "KeyK",
    meta: true,
    action: TUG_ACTIONS.FOCUS_PROMPT,
    scope: "key-card",
    preventDefaultOnMatch: true,
  },
  { key: "Comma", meta: true, action: TUG_ACTIONS.SHOW_SETTINGS },
  { key: "Period", meta: true, action: TUG_ACTIONS.CANCEL_DIALOG },
  // Escape routes to the same chain action as ⌘. so floating UI
  // (popovers, alerts, sheets) dismisses via its existing
  // CANCEL_DIALOG handlers, AND — when nothing dialog-like is in the
  // chain — a card-level CANCEL_DIALOG handler (e.g. tide-card.tsx's
  // card-content responder) can interrupt an in-flight turn. The
  // chain's "first responder up" walk gives the natural priority:
  // visible popover dismisses first, drag cancels next (via the
  // separate document-level Escape listener in card-drag-coordinator),
  // in-flight interrupt last. No `preventDefaultOnMatch`: when no
  // responder claims the action the event continues to bubble so
  // bubble-phase consumers (e.g. CodeMirror's autocomplete dismiss)
  // still see it.
  { key: "Escape", action: TUG_ACTIONS.CANCEL_DIALOG },
  { key: "KeyF", meta: true, action: TUG_ACTIONS.FIND },
  // Tab navigation: macOS convention (Safari, Terminal) uses
  // ⇧⌘[ / ⇧⌘] for previous / next tab with wrap-around. Routes to
  // TugPane's existing previous-tab / next-tab handlers, which already
  // wrap via `(idx ± 1 + n) % n`.
  { key: "BracketLeft", meta: true, shift: true, action: TUG_ACTIONS.PREVIOUS_TAB },
  { key: "BracketRight", meta: true, shift: true, action: TUG_ACTIONS.NEXT_TAB },
  // Jump to tab by 1-based index (⌘1..⌘9). Each binding carries its
  // index on `value`; the capture-phase pipeline copies that onto
  // the dispatched ActionEvent. TugPane's `jump-to-tab` handler reads
  // the index, narrows to `number`, and selects the corresponding
  // tab. Out-of-range indices are a silent no-op on the handler side.
  // `preventDefaultOnMatch` is not set: browsers have no default
  // meaning for ⌘1..⌘9 inside a WKWebView that we need to suppress.
  { key: "Digit1", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 1 },
  { key: "Digit2", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 2 },
  { key: "Digit3", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 3 },
  { key: "Digit4", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 4 },
  { key: "Digit5", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 5 },
  { key: "Digit6", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 6 },
  { key: "Digit7", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 7 },
  { key: "Digit8", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 8 },
  { key: "Digit9", meta: true, action: TUG_ACTIONS.JUMP_TO_TAB, value: 9 },
  // tug-prompt-entry route shortcuts. ⇧⌘C / ⇧⌘S / ⇧⌘: switch the
  // route segment without leaving the editor. The handler lives on
  // tug-prompt-entry's responder (default `first-responder` scope —
  // dispatch from the editor walks up to the entry). The `value`
  // payload carries the canonical route character; the entry's
  // SELECT_ROUTE handler narrows to string and calls setRouteState.
  // `preventDefaultOnMatch` suppresses the WebView's native handling
  // (Shift+Cmd+S "Save Page As"; Shift+Cmd+C "Copy with Style") so the
  // shortcut is owned by the responder chain regardless of focus.
  { key: "KeyC", meta: true, shift: true, action: TUG_ACTIONS.SELECT_ROUTE, value: "❯", preventDefaultOnMatch: true },
  { key: "KeyS", meta: true, shift: true, action: TUG_ACTIONS.SELECT_ROUTE, value: "$", preventDefaultOnMatch: true },
  { key: "Semicolon", meta: true, shift: true, action: TUG_ACTIONS.SELECT_ROUTE, value: ":", preventDefaultOnMatch: true },
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
