/**
 * command-registry.ts — the canonical table of user-invocable commands.
 *
 * One entry per command the user can invoke: its wire name, its display
 * title, how it dispatches, which native menu item it drives, and which
 * chords are bound to it by default. Every emitter — the Swift menu's
 * control frames, the key pipeline, buttons, the slash bridges — resolves
 * through this table and calls `dispatchCommand` ([P01], Spec S01).
 *
 * The table is pure data. It imports the action vocabulary and nothing
 * else, so the dispatcher, the keymap registry, the menu-state mirror,
 * and the Settings panes can all read it without an import cycle.
 *
 * ## What is NOT in here
 *
 * - **tugcast data frames** (`spawn_session_ok`, `session_updated`, and
 *   the ~20 siblings). They are protocol, not commands: no title, no
 *   validity, no chord. They keep the raw `registerAction` handler path
 *   ([P03]).
 * - **Form-control currency** (`set-value`, `toggle`, `select-value`,
 *   `set-color`, `activate-color-well`, `set-property`). These travel
 *   between a control and its responder; they are not user intents.
 * - **Substrate text-editing bindings** (⌃U / ⌃W / ⌥F / ⌥B, the CM6
 *   keymaps). Movement and deletion only ever target the focused text
 *   input, so they stay substrate-local.
 */

import type { TugAction } from "./action-vocabulary";
import { TUG_ACTIONS } from "./action-vocabulary";

/* ---------------------------------------------------------------------------
 * Chords and bindings (Spec S02)
 * ------------------------------------------------------------------------- */

/**
 * A chord's identity is `KeyboardEvent.code` plus the exact state of the
 * four modifier flags — the rule the key pipeline already matches on.
 * `label` is display data only and never participates in matching, so it
 * can be corrected for a keyboard layout without changing what the chord
 * matches ([P09]).
 */
export interface Chord {
  /** KeyboardEvent.code — layout-independent. */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  /** The observed `event.key` at capture; US-authored for built-in defaults. */
  readonly label?: string;
}

/**
 * Where a binding is live — orthogonal to the command's `routing`, which
 * says how it dispatches ([P08]).
 *
 * - `global` — live wherever the app has focus.
 * - `responder` — live while the named responder is in the chain.
 * - `mode` — live while the named focus mode is pushed.
 */
export type BindingScope =
  | { readonly kind: "global" }
  | { readonly kind: "responder"; readonly responderId: string }
  | { readonly kind: "mode"; readonly modeId: string };

/** The global scope, which most bindings carry. */
export const GLOBAL_SCOPE: BindingScope = { kind: "global" };

export interface CommandBinding {
  readonly chord: Chord;
  readonly scope: BindingScope;
  readonly source: "default" | "user";
  /** Suppress the browser default when this chord matches. */
  readonly preventDefault?: boolean;
  /**
   * Eligible to carry the native menu key equivalent. An `NSMenuItem`
   * carries exactly one, so the Swift sweep applies the first eligible
   * binding and the rest live in the JS funnel only.
   */
  readonly menuEligible?: boolean;
}

/* ---------------------------------------------------------------------------
 * Entry shape (Spec S01)
 * ------------------------------------------------------------------------- */

/** How a command reaches its implementation ([P04]). */
export type CommandRouting =
  /** `sendToFirstResponderForContinuation`, continuation invoked immediately. */
  | "first-responder"
  /** `sendToKeyCard` — starts at the active card's card-content responder. */
  | "key-card"
  /** `sendToTarget(targetId, …)` — the target rides the dispatch payload. */
  | "target"
  /** The handler registered through `registerAction`. */
  | "registry"
  /** Represented for display and policy only; AppKit performs it. */
  | "native";

/**
 * The menu-relevant facts that live outside the responder chain: which card
 * is frontmost and what it is currently able to do, how the deck is shaped,
 * whether Open Quickly has a root.
 *
 * Structurally declared here rather than imported so the table keeps its one
 * dependency. Every field is already a fact the frontend had to publish for
 * the host to validate a menu at all — this is the same data, read by the
 * predicate that owns the item instead of by a hand-rolled case.
 */
export interface CommandMenuFacts {
  /** The focused pane's active card is a session card. */
  readonly sessionCardFrontmost: boolean;
  /** The frontmost session card's live state; null when none is frontmost. */
  readonly session: {
    readonly sessionBound: boolean;
    readonly canInterrupt: boolean;
    readonly canChangeSettings: boolean;
    readonly permissionMode: string;
    readonly hasAssistantMessage: boolean;
    readonly hasTurns: boolean;
    readonly changesVisible: boolean;
    readonly historyVisible: boolean;
    readonly commitReady: boolean;
  } | null;
  /**
   * The frontmost Text card's File-menu gates, already reduced from its
   * block by the one function that owns that matrix; null when no Text card
   * is frontmost.
   */
  readonly fileGates: {
    readonly save: boolean;
    readonly saveAs: boolean;
    readonly saveACopy: boolean;
    readonly revert: boolean;
    readonly reload: boolean;
  } | null;
  /** Open Quickly has a search root. */
  readonly openQuickly: boolean;
  readonly paneCount: number;
  /** Cards in the focused pane; 0 when nothing is focused. */
  readonly focusedPaneCardCount: number;
  /** The focused pane's active card can be closed. */
  readonly focusedPaneActiveCardClosable: boolean;
  /** A card is selected — false on a deck deselected by a canvas click. */
  readonly selectionActive: boolean;
  /** How many panes share the focused pane's slot. */
  readonly stackDepth: number;
}

/** Nothing focused, nothing open — the answer before the first push. */
export const EMPTY_MENU_FACTS: CommandMenuFacts = {
  sessionCardFrontmost: false,
  session: null,
  fileGates: null,
  openQuickly: false,
  paneCount: 0,
  focusedPaneCardCount: 0,
  focusedPaneActiveCardClosable: false,
  selectionActive: false,
  stackDepth: 0,
};

/**
 * What a validity or state predicate is allowed to ask: the chain's answers
 * and the published menu facts. Deliberately a narrow interface rather than
 * the whole chain manager — a predicate reads, it does not dispatch — and a
 * plain value rather than a store read, so every predicate is a pure
 * function of its inputs and unit-testable without mounting anything.
 */
export interface CommandValidationSource {
  validateAction(action: string): boolean;
  validateActionInKeyCard(action: string): boolean;
  queryActionState(action: string): boolean | string | undefined;
  queryActionStateInKeyCard(action: string): boolean | string | undefined;
  readonly menu: CommandMenuFacts;
}

export interface CommandEntry {
  /**
   * Canonical wire name: a `TUG_ACTIONS` value, a control-frame wire, or
   * a parameterized id of the form `<action>:<value>` ([P05]).
   */
  readonly id: string;
  /** Display name — menus, keymap UI, palette. The single source for labels. */
  readonly title: string;
  readonly routing: CommandRouting;
  /**
   * The chain action to dispatch. Defaults to `id` when `id` is itself a
   * `TUG_ACTIONS` value; required when it is not.
   */
  readonly action?: TugAction;
  /** Static `ActionEvent.value` carried by every dispatch of this command. */
  readonly payload?: unknown;
  /** The `NSMenuItem` identifier this command drives ([P02]). */
  readonly menuItemId?: string;
  /**
   * Publish this item's gate — enablement, check state, dynamic title — in
   * the menuState `commands` block, where the host's validator reads it
   * ahead of every hand-rolled case ([P13]).
   *
   * This is the migration switch, and it is per item on purpose. The host
   * still hand-rolls a validation tier for the items that have not moved
   * yet; an item is mirrored in the same change that deletes its tier, so
   * exactly one definition of its enablement is live at any moment. An
   * entry with no answer of its own must not be mirrored: a published
   * default-true gate would silently light an item its tier was gating.
   */
  readonly mirrored?: boolean;
  /** Default bindings — a list from day one ([P08]). */
  readonly bindings?: readonly CommandBinding[];
  /**
   * What becomes of this command's key equivalent while the command
   * validates disabled.
   *
   * A chord on a disabled menu item is eaten at the menu bar with a beep; it
   * does not fall through to the web view. So dimming an item is not the
   * whole decision — the chord has to be decided too, and the two answers
   * are genuinely different commands:
   *
   * - `"keep"` — the command owns the chord outright. Nothing else may have
   *   it, and the beep is honest feedback that the user pressed the right
   *   keys at the wrong moment. This is the default, and it is what every
   *   item built with a construction-time key equivalent already does.
   * - `"detach"` — the command claims the chord only while it is
   *   applicable. The gate publishes a `null` chord in the disabled state,
   *   which releases the key equivalent and lets the chord reach the JS
   *   funnel, where a scoped binding may still want it.
   *
   * `"detach"` is the answer for a command promoted from a scoped JS
   * binding to a menu item: the chord was shadowable before the promotion,
   * and detaching is what keeps it shadowable after.
   */
  readonly disabledChord?: "keep" | "detach";
  /**
   * Whether the command holds its menu key equivalent right now, asked
   * independently of whether the item is enabled.
   *
   * Most commands never need this: a chord follows the item, and
   * {@link disabledChord} says what happens when the item dims. Two do not.
   * Save As… is enabled whenever a Text card is frontmost and its chord must
   * come off when one is not, which is the *same* condition read twice only
   * because the item's own enablement is computed from a block that may be
   * absent. And the two slot-stack commands are equally enabled while the
   * stack has somewhere to go, with only ⌘R moving between them on a user
   * preference — an enablement predicate cannot express that, because
   * neither item is ever the disabled one.
   *
   * Absent means "attached whenever the item is enabled", which is what
   * every other command wants.
   */
  readonly chordActive?: (chain: CommandValidationSource) => boolean;
  /** Validity override; chain-routed entries default to the chain walk ([P06]). */
  readonly validate?: (chain: CommandValidationSource) => boolean;
  /** Checkmark / radio / toggle projection ([P07]). */
  readonly state?: (
    chain: CommandValidationSource,
  ) => boolean | string | undefined;
  /** Dynamic menu title (Show/Hide Changes, Undo <noun>). */
  readonly dynamicTitle?: (
    chain: CommandValidationSource,
  ) => string | undefined;
  /**
   * Payload set discovered at runtime — excluded from the menu-state
   * mirror, from the keymap UI's rebindable rows, and from the
   * door-coverage lint ([P05]).
   */
  readonly parameterized?: boolean;
  /**
   * No door by design: the entry exists so the command is named and
   * visible, but it has neither a `menuItemId` nor `bindings`. Every
   * `internal` entry carries a comment naming what blocks the door.
   */
  readonly internal?: boolean;
}

/* ---------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------- */

/** A default global binding, the shape most of the table's chords take. */
function chord(
  spec: Chord,
  options: { preventDefault?: boolean; menuEligible?: boolean } = {},
): CommandBinding {
  return {
    chord: spec,
    scope: GLOBAL_SCOPE,
    source: "default",
    ...(options.preventDefault === true ? { preventDefault: true } : {}),
    ...(options.menuEligible === true ? { menuEligible: true } : {}),
  };
}

/**
 * The activation scope named by the composer's own bindings.
 *
 * A scoped binding is live where its component registers it, and a card's
 * responder id is minted per card — so a table can only name the *surface*,
 * not the runtime id. `resolveChord` reads the live registration for
 * resolution and this name for display, which is what lets a scoped chord be
 * shown in the keymap pane without the table pretending to know where it is.
 */
export const COMPOSER_RESPONDER_SCOPE = "session-composer";

/**
 * ⌘R — the slot-stack chord, held by exactly one of Cycle Stack and Reveal
 * Stack at a time.
 *
 * Which one is a user preference, so the table can only state a default:
 * Cycle Stack carries it below, and `applyStackChordPreference` moves it to
 * Reveal Stack when the user asks. Naming the binding here is what lets the
 * move be a rewrite of the same value rather than a second spelling of it.
 */
export const STACK_CHORD: CommandBinding = {
  chord: { key: "KeyR", meta: true, label: "r" },
  scope: GLOBAL_SCOPE,
  source: "default",
  preventDefault: true,
  menuEligible: true,
};

/* ---------------------------------------------------------------------------
 * Shared predicates
 *
 * The session card's command surfaces gate in two tiers — the frontmost card
 * must be a session card at all, and below that the specific command needs a
 * bound session, an interruptible turn, or a transcript with turns in it.
 * Naming the tiers keeps thirty-odd entries from each spelling the same
 * condition slightly differently.
 * ------------------------------------------------------------------------- */

/** A session card is frontmost — the card-type tier every Session item needs. */
function sessionCardFrontmost(chain: CommandValidationSource): boolean {
  return chain.menu.sessionCardFrontmost;
}

/** A session card is frontmost and bound to a session. */
function sessionBound(chain: CommandValidationSource): boolean {
  return (
    chain.menu.sessionCardFrontmost &&
    (chain.menu.session?.sessionBound ?? false)
  );
}

/**
 * The Mode / Model / Effort controls may be changed — the session is idle.
 * The whole Permission Mode submenu gates on this the same way the composer's
 * chips do, so a mode change can never race a running turn.
 */
function sessionSettingsChangeable(chain: CommandValidationSource): boolean {
  return (
    sessionBound(chain) && (chain.menu.session?.canChangeSettings ?? false)
  );
}

/**
 * A canvas-background click deselects the deck while leaving its panes
 * standing. The card and pane navigation commands stay live in that state so
 * the user can re-activate a card by keyboard or menu instead of having to
 * find one with the mouse.
 */
function deckDeselectedWithPanes(chain: CommandValidationSource): boolean {
  return !chain.menu.selectionActive && chain.menu.paneCount > 0;
}

/**
 * A session card is frontmost and its transcript has something to move
 * through. The transcript navigation commands are no-ops on an empty
 * transcript, and their menu items say so rather than offering a gesture
 * with nowhere to go.
 */
function transcriptNavigable(chain: CommandValidationSource): boolean {
  return (
    chain.menu.sessionCardFrontmost && (chain.menu.session?.hasTurns ?? false)
  );
}

/** Somewhere to navigate to: a multi-card pane, or a deck to re-enter. */
function cardNavigationAvailable(chain: CommandValidationSource): boolean {
  return chain.menu.focusedPaneCardCount > 1 || deckDeselectedWithPanes(chain);
}

/**
 * One entry per slash-command bridge. Each is an individually addressable
 * command — its own title, its own menu item, its own future validity —
 * dispatching the one `run-slash-command` action with a different name
 * ([P05]). The Swift items carry the same name in `representedObject`.
 */
type SlashBridge = readonly [
  name: string,
  title: string,
  menuItemId: string,
  /** Defaults to `sessionBound` — a bound session is what a slash command runs against. */
  validate?: (chain: CommandValidationSource) => boolean,
];

const SLASH_BRIDGES: readonly SlashBridge[] = [
  // Export writes the transcript the card already holds, so it needs the
  // card and not a live session.
  ["export", "Export Session…", "file.exportTranscript", sessionCardFrontmost],
  [
    "copy",
    "Copy Last Response",
    "edit.copyLastResponse",
    (chain) =>
      chain.menu.sessionCardFrontmost &&
      (chain.menu.session?.hasAssistantMessage ?? false),
  ],
  ["clear", "Clear Session", "session.new"],
  ["resume", "Resume Session…", "session.resume"],
  ["rename", "Rename Session…", "session.rename"],
  // The menu door means LAND, not enter. `/commit` and ⌃⌘C-on-an-empty-composer
  // are the two doors that put you into commit mode; by the time this item is
  // enabled you are already in it with a message written, so it performs rather
  // than opening — hence no ellipsis. Every gate is folded into `commitReady`
  // by `CommitModeController`, which is the only thing that sees all four.
  [
    "commit",
    "Commit Changes",
    "session.commit",
    (chain) => chain.menu.session?.commitReady ?? false,
  ],
  ["model", "AI Model…", "session.model"],
  ["effort", "Reasoning Effort…", "session.effort"],
  ["permissions", "Permission Rules…", "session.permissionRules"],
  // Rewind needs somewhere to rewind to.
  [
    "rewind",
    "Rewind…",
    "session.rewind",
    (chain) => sessionBound(chain) && (chain.menu.session?.hasTurns ?? false),
  ],
  ["compact", "Compact Conversation", "session.compact"],
  ["add-dir", "Add Working Directory…", "session.addDir"],
  ["diff", "Show Project Diff", "session.diff"],
  ["context", "Show Context", "session.context"],
  ["usage", "Show Usage", "session.usage"],
  ["skills", "Skills…", "session.skills"],
  ["agents", "Agents…", "session.agents"],
  ["hooks", "Hooks…", "session.hooks"],
  ["memory", "Memory…", "session.memory"],
  // The shortcuts sheet is card documentation, not session work.
  [
    "help",
    "Keyboard Shortcuts & Commands",
    "help.shortcuts",
    sessionCardFrontmost,
  ],
];

const SLASH_BRIDGE_COMMANDS: readonly CommandEntry[] = SLASH_BRIDGES.map(
  ([name, title, menuItemId, validate]) => ({
    id: `${TUG_ACTIONS.RUN_SLASH_COMMAND}:${name}`,
    title,
    routing: "key-card" as const,
    action: TUG_ACTIONS.RUN_SLASH_COMMAND,
    payload: { name, args: "" },
    menuItemId,
    mirrored: true,
    validate: validate ?? sessionBound,
  }),
);

/** The four modes the native submenu offers; `bypassPermissions` is deliberately not among them. */
const PERMISSION_MODES: ReadonlyArray<[mode: string, title: string]> = [
  ["default", "Default"],
  ["acceptEdits", "Accept Edits"],
  ["plan", "Plan"],
  ["auto", "Auto"],
];

const PERMISSION_MODE_COMMANDS: readonly CommandEntry[] = PERMISSION_MODES.map(
  ([mode, title]) => ({
    id: `${TUG_ACTIONS.SET_PERMISSION_MODE}:${mode}`,
    title,
    routing: "key-card" as const,
    action: TUG_ACTIONS.SET_PERMISSION_MODE,
    payload: mode,
    menuItemId: `session.permissionMode.${mode}`,
    mirrored: true,
    validate: sessionSettingsChangeable,
    // The radio's mark: one resolver answers the current mode and each
    // per-value entry narrows it to its own row ([P05], [P07]).
    state: (chain: CommandValidationSource) =>
      chain.menu.session?.permissionMode === mode,
  }),
);

/**
 * ⌘1…⌘9 are nine distinct user-facing commands, not one command with a
 * number ([P05]) — the keymap UI has to show nine rows, and each one is
 * separately rebindable. The chord is the door; the Window menu is not.
 *
 * Deliberately unpromoted ([Q02]). Nine Window-menu items would move nine
 * digit chords out of the JS funnel and into AppKit's key-equivalent scan
 * at once, where they are claimed unconditionally — inside every text
 * surface, and above any responder that wants its digits. `pdf-view.tsx`
 * already declines ⌘1–⌘3 by hand precisely so the deck keeps them; a menu
 * item would take that choice away from it and from every surface after
 * it. Detaching on a `validate` would need the frontend to know "the
 * focused surface wants its digits", which is not a fact anything
 * publishes today.
 *
 * So the nine stay chord-only registry entries: fully visible to the
 * keymap UI and the shadowing view, and still shadowable by the surfaces
 * that need to shadow them.
 */
const SLOT_COMMANDS: readonly CommandEntry[] = Array.from(
  { length: 9 },
  (_, i) => {
    const n = i + 1;
    return {
      id: `${TUG_ACTIONS.MOVE_TO_SLOT}:${n}`,
      title: `Move Card to Slot ${n}`,
      routing: "first-responder" as const,
      action: TUG_ACTIONS.MOVE_TO_SLOT,
      payload: n,
      bindings: [chord({ key: `Digit${n}`, meta: true, label: String(n) })],
    };
  },
);

export const COMMANDS: readonly CommandEntry[] = [
  // ---- File ----
  {
    id: TUG_ACTIONS.NEW_TEXT_CARD,
    title: "New Text File",
    routing: "first-responder",
    menuItemId: "file.newTextCard",
  },
  {
    id: TUG_ACTIONS.OPEN_FILE,
    title: "Open File…",
    routing: "first-responder",
    menuItemId: "file.openFile",
  },
  {
    // Two gates, and they answer different questions. The predicate is
    // the one that matters: a search with no root cannot run, and the
    // chain cannot know that. The canvas's handler is what makes the
    // command reachable at all.
    id: TUG_ACTIONS.OPEN_QUICKLY,
    title: "Open Quickly…",
    routing: "first-responder",
    menuItemId: "file.openQuickly",
    mirrored: true,
    validate: (chain) => chain.menu.openQuickly,
  },
  {
    // Its door is the changeset card's pop-out affordance — a control, not
    // a menu item or a chord.
    id: TUG_ACTIONS.OPEN_DIFF,
    title: "Open Diff",
    routing: "registry",
    internal: true,
  },
  {
    id: TUG_ACTIONS.CLEAR_RECENT_DOCUMENTS,
    title: "Clear Menu",
    routing: "first-responder",
    menuItemId: "file.openRecent.clear",
  },
  {
    id: TUG_ACTIONS.CLOSE,
    title: "Close",
    routing: "first-responder",
    menuItemId: "file.closeCard",
    bindings: [chord({ key: "KeyW", meta: true, label: "w" })],
    mirrored: true,
    validate: (chain) => chain.menu.focusedPaneActiveCardClosable,
  },
  {
    id: TUG_ACTIONS.CLOSE_ALL,
    title: "Close All Tabs",
    routing: "first-responder",
    menuItemId: "file.closeAllCardTabs",
    bindings: [chord({ key: "KeyW", meta: true, alt: true, label: "w" })],
    mirrored: true,
    validate: (chain) => chain.menu.focusedPaneCardCount > 1,
  },
  // The save family gates on the frontmost Text card's block, reduced by
  // the one function that owns that matrix ([P06]: the gate is asked of the
  // surface that would perform, and the block is that surface's answer).
  // Automatic-mode Save stays enabled whenever the card is writable — a
  // disabled item eats its own ⌘S with a beep rather than letting it
  // through.
  {
    id: TUG_ACTIONS.SAVE,
    title: "Save…",
    routing: "first-responder",
    menuItemId: "file.save",
    bindings: [
      chord({ key: "KeyS", meta: true, label: "s" }, { preventDefault: true }),
    ],
    mirrored: true,
    validate: (chain) => chain.menu.fileGates?.save ?? false,
  },
  {
    id: TUG_ACTIONS.SAVE_AS,
    title: "Save As…",
    routing: "first-responder",
    menuItemId: "file.saveAs",
    // ⇧⌘S is claimed only while a Text card is frontmost. Save As… on any
    // other card would have nothing to write, and a chord left on a dimmed
    // item is eaten at the menu bar with a beep instead of falling through —
    // so the chord comes off with the card rather than merely going dark.
    bindings: [
      chord(
        { key: "KeyS", meta: true, shift: true, label: "s" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    validate: (chain) => chain.menu.fileGates?.saveAs ?? false,
    chordActive: (chain) => chain.menu.fileGates !== null,
  },
  {
    id: TUG_ACTIONS.SAVE_A_COPY,
    title: "Save a Copy…",
    routing: "first-responder",
    menuItemId: "file.saveACopy",
    mirrored: true,
    validate: (chain) => chain.menu.fileGates?.saveACopy ?? false,
  },
  {
    id: TUG_ACTIONS.REVERT_TO_SAVED,
    title: "Revert to Saved",
    routing: "first-responder",
    menuItemId: "file.revertToSaved",
    mirrored: true,
    validate: (chain) => chain.menu.fileGates?.revert ?? false,
  },
  {
    id: TUG_ACTIONS.RELOAD_FROM_DISK,
    title: "Reload from Disk",
    routing: "first-responder",
    menuItemId: "file.reloadFromDisk",
    mirrored: true,
    validate: (chain) => chain.menu.fileGates?.reload ?? false,
  },

  // ---- Edit ----
  //
  // Cut / Copy / Paste / Delete / Select All are `NSApp.sendAction` to the
  // `NSText` selectors: AppKit performs them against whatever the native
  // responder chain holds, and no control frame is sent. They are
  // represented here so they are nameable and visible to the keymap UI
  // rather than being commands the user cannot find ([P04]).
  //
  // AppKit performs them, but the chain decides whether they are available:
  // a native-routed entry has no responder to defer to, so each names the
  // chain query explicitly. This is the same answer `validateAction` gives
  // the Edit block today, asked by the item that needs it.
  {
    id: TUG_ACTIONS.CUT,
    title: "Cut",
    routing: "native",
    menuItemId: "edit.cut",
    bindings: [
      chord({ key: "KeyX", meta: true, label: "x" }, { preventDefault: true }),
    ],
    mirrored: true,
    validate: (chain) => chain.validateAction(TUG_ACTIONS.CUT),
  },
  {
    id: TUG_ACTIONS.COPY,
    title: "Copy",
    routing: "native",
    menuItemId: "edit.copy",
    bindings: [
      chord({ key: "KeyC", meta: true, label: "c" }, { preventDefault: true }),
    ],
    mirrored: true,
    validate: (chain) => chain.validateAction(TUG_ACTIONS.COPY),
  },
  {
    id: TUG_ACTIONS.PASTE,
    title: "Paste",
    routing: "native",
    menuItemId: "edit.paste",
    bindings: [
      chord({ key: "KeyV", meta: true, label: "v" }, { preventDefault: true }),
    ],
    mirrored: true,
    validate: (chain) => chain.validateAction(TUG_ACTIONS.PASTE),
  },
  {
    id: TUG_ACTIONS.DELETE,
    title: "Delete",
    routing: "native",
    menuItemId: "edit.delete",
    mirrored: true,
    validate: (chain) => chain.validateAction(TUG_ACTIONS.DELETE),
  },
  {
    id: TUG_ACTIONS.SELECT_ALL,
    title: "Select All",
    routing: "native",
    menuItemId: "edit.selectAll",
    bindings: [
      chord({ key: "KeyA", meta: true, label: "a" }, { preventDefault: true }),
    ],
    mirrored: true,
    validate: (chain) => chain.validateAction(TUG_ACTIONS.SELECT_ALL),
  },
  // Undo and Redo are deliberately NOT mirrored: when a native text control
  // is focused the host validates them from the web view's own
  // NSUndoManager, which is live AppKit state the registry cannot see. The
  // one item whose truth is not the frontend's keeps its host-side case.
  {
    id: TUG_ACTIONS.UNDO,
    title: "Undo",
    routing: "first-responder",
    menuItemId: "edit.undo",
    bindings: [chord({ key: "KeyZ", meta: true, label: "z" })],
  },
  {
    id: TUG_ACTIONS.REDO,
    title: "Redo",
    routing: "first-responder",
    menuItemId: "edit.redo",
    bindings: [chord({ key: "KeyZ", meta: true, shift: true, label: "z" })],
  },
  {
    id: TUG_ACTIONS.COPY_AS_PLAIN_TEXT,
    title: "Copy as Plain Text",
    routing: "first-responder",
    menuItemId: "edit.copyAsPlainText",
    bindings: [
      chord(
        { key: "KeyC", meta: true, shift: true, alt: true, label: "c" },
        { preventDefault: true },
      ),
    ],
    mirrored: true,
    // Shares Copy's gate: both need a selection, and a surface that offers
    // one offers the other.
    validate: (chain) => chain.validateAction(TUG_ACTIONS.COPY),
  },
  {
    id: TUG_ACTIONS.PASTE_AS_QUOTE,
    title: "Paste as Quote",
    routing: "first-responder",
    menuItemId: "edit.pasteAsQuote",
    bindings: [
      chord(
        { key: "KeyV", meta: true, alt: true, label: "v" },
        { preventDefault: true },
      ),
    ],
    mirrored: true,
    // Both paste variants share Paste's gate: an editable surface is the
    // whole requirement.
    validate: (chain) => chain.validateAction(TUG_ACTIONS.PASTE),
  },
  {
    id: TUG_ACTIONS.PASTE_AS_PLAIN_TEXT,
    title: "Paste as Plain Text",
    routing: "first-responder",
    menuItemId: "edit.pasteAsPlainText",
    bindings: [
      chord(
        { key: "KeyV", meta: true, shift: true, alt: true, label: "v" },
        { preventDefault: true },
      ),
    ],
    mirrored: true,
    validate: (chain) => chain.validateAction(TUG_ACTIONS.PASTE),
  },
  // The Find items carry no predicate: they are first-responder-routed, so
  // the default chain walk asks the focused surface directly — which is
  // exactly the question, and the answer stays false until a find-capable
  // surface is focused.
  {
    id: TUG_ACTIONS.FIND,
    title: "Find…",
    routing: "first-responder",
    menuItemId: "edit.find",
    bindings: [
      chord({ key: "KeyF", meta: true, label: "f" }, { preventDefault: true }),
    ],
    mirrored: true,
  },
  {
    id: TUG_ACTIONS.FIND_NEXT,
    title: "Find Next",
    routing: "first-responder",
    menuItemId: "edit.findNext",
    bindings: [chord({ key: "KeyG", meta: true, label: "g" })],
    mirrored: true,
  },
  {
    id: TUG_ACTIONS.FIND_PREVIOUS,
    title: "Find Previous",
    routing: "first-responder",
    menuItemId: "edit.findPrevious",
    bindings: [chord({ key: "KeyG", meta: true, shift: true, label: "g" })],
    mirrored: true,
  },

  // ---- Session ----
  {
    id: TUG_ACTIONS.FOCUS_PROMPT,
    title: "Focus Prompt",
    routing: "key-card",
    menuItemId: "session.focusPrompt",
    bindings: [
      chord({ key: "KeyK", meta: true, label: "k" }, { preventDefault: true }),
    ],
    mirrored: true,
    // The composer exists on any session card, bound or not.
    validate: sessionCardFrontmost,
  },
  {
    // Routed first-responder so the prompt entry holding the caret is the
    // one that receives the path — including the gallery's, which no
    // card-level predicate would reach. The session card answers it too,
    // from its card-content responder, so the command is live anywhere in
    // the card rather than only while the composer is the seat of focus;
    // the chain walk that finds either is the item's gate. The host runs
    // the open panel before dispatching, so the dispatch carries the path.
    id: TUG_ACTIONS.INSERT_FILE,
    title: "Insert File…",
    routing: "first-responder",
    menuItemId: "session.insertFile",
    // Menu-eligible on purpose: the panel that produces the path is the
    // host's, so ⌃⌘I has to reach the menu item rather than the JS funnel,
    // where the command would dispatch with no file chosen.
    bindings: [
      chord(
        { key: "KeyI", ctrl: true, meta: true, label: "i" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
  },
  {
    id: TUG_ACTIONS.INTERRUPT_SESSION,
    title: "Stop",
    routing: "key-card",
    menuItemId: "session.stop",
    mirrored: true,
    validate: (chain) =>
      chain.menu.sessionCardFrontmost &&
      (chain.menu.session?.canInterrupt ?? false),
  },
  {
    id: TUG_ACTIONS.CYCLE_PERMISSION_MODE,
    title: "Cycle Permission Mode",
    routing: "key-card",
    menuItemId: "session.permissionMode.cycle",
    bindings: [
      chord(
        { key: "KeyP", ctrl: true, alt: true, meta: true, label: "p" },
        { preventDefault: true },
      ),
    ],
    mirrored: true,
    validate: sessionSettingsChangeable,
  },
  ...PERMISSION_MODE_COMMANDS,
  {
    id: TUG_ACTIONS.TOGGLE_CHANGES_VIEW,
    title: "Show Session Changes",
    routing: "key-card",
    menuItemId: "session.toggleChanges",
    bindings: [
      chord(
        { key: "KeyC", ctrl: true, meta: true, label: "c" },
        { preventDefault: true },
      ),
    ],
    mirrored: true,
    validate: sessionBound,
    // One command, two verbs: the item says what the gesture will do, so
    // the title follows the Shade's live visibility.
    dynamicTitle: (chain) =>
      (chain.menu.session?.changesVisible ?? false)
        ? "Hide Session Changes"
        : "Show Session Changes",
  },
  {
    id: TUG_ACTIONS.TOGGLE_HISTORY_VIEW,
    title: "Show Commit History",
    routing: "key-card",
    menuItemId: "session.toggleHistory",
    bindings: [
      chord(
        { key: "KeyH", ctrl: true, meta: true, label: "h" },
        { preventDefault: true },
      ),
    ],
    mirrored: true,
    validate: sessionBound,
    dynamicTitle: (chain) =>
      (chain.menu.session?.historyVisible ?? false)
        ? "Hide Commit History"
        : "Show Commit History",
  },
  ...SLASH_BRIDGE_COMMANDS,

  // ---- View ----
  // The focus ring's two directions, promoted out of the raw Tab listener into
  // the table ([L30]) — they were user-invocable commands with no row and no
  // discoverable door. Both are deliberately chordless HERE: ⇥ / ⇧⇥ stay with
  // the focus walk in `responder-chain-provider`, which owns a precedence
  // ladder (a surface consuming Tab keeps it; an empty walk yields to native
  // Tab) that a menu key equivalent would sit above and destroy. Same bargain
  // `interrupt-session` takes with Escape: the chord routes in JS, the menu
  // item is the discoverable face.
  //
  // View rather than Session on purpose: the ring is deck-wide, and the
  // Session menu's premise is that its items dim without a frontmost session
  // card.
  {
    id: TUG_ACTIONS.PREVIOUS_KEYBOARD_FOCUS,
    title: "Previous Keyboard Focus",
    routing: "registry",
    menuItemId: "view.previousKeyboardFocus",
  },
  {
    id: TUG_ACTIONS.NEXT_KEYBOARD_FOCUS,
    title: "Next Keyboard Focus",
    routing: "registry",
    menuItemId: "view.nextKeyboardFocus",
  },
  {
    // The theme submenu's membership is a filesystem scan, so the payload
    // set is only known at runtime.
    id: "set-theme",
    title: "Theme",
    routing: "registry",
    parameterized: true,
  },
  {
    // ⌃⌘T — the Tug tier, because themes are Tug's own machinery
    // (chord-tiers.md). Menu-eligible, so the chord resolves at the native
    // menu layer where the item already lives; the binding is what makes it
    // visible to the keymap pane and rebindable at all. `menuChords()`
    // claims a menu item for a non-`mirrored` entry too, so no gate work is
    // needed to publish it.
    id: "next-theme",
    title: "Next Theme",
    routing: "registry",
    menuItemId: "view.nextTheme",
    bindings: [
      chord(
        { key: "KeyT", ctrl: true, meta: true, label: "t" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },
  // The three zoom commands state their chords here and take their
  // enablement from the host: the predicate reads `window.currentPageZoom`,
  // which is the host's own property and changes as these very commands run.
  // The gate carries the chord alone, and the host's tier keeps the bounds.
  {
    // Two bindings, one command: ⌘+ is what the menu shows, ⌘= is Safari's
    // no-shift ergonomic alias. An `NSMenuItem` carries one key equivalent,
    // so the menu takes the first and the hidden `view.zoomInAlias` item
    // keeps ⌘= as its constructed literal.
    id: TUG_ACTIONS.ZOOM_IN,
    title: "Zoom In",
    routing: "first-responder",
    menuItemId: "view.zoomIn",
    bindings: [
      chord(
        { key: "Equal", meta: true, shift: true, label: "+" },
        { preventDefault: true, menuEligible: true },
      ),
      chord({ key: "Equal", meta: true, label: "=" }, { preventDefault: true }),
    ],
  },
  {
    id: TUG_ACTIONS.ZOOM_OUT,
    title: "Zoom Out",
    routing: "first-responder",
    menuItemId: "view.zoomOut",
    bindings: [
      chord(
        { key: "Minus", meta: true, label: "-" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },
  {
    id: TUG_ACTIONS.ZOOM_ACTUAL,
    title: "Actual Size",
    routing: "first-responder",
    menuItemId: "view.actualSize",
    bindings: [
      chord(
        { key: "Digit0", meta: true, label: "0" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },

  // ---- Window / deck ----
  {
    // Two menu items — Cascade and Tile — for one wire; per-value rows and
    // their menu placement are a later judgment.
    id: TUG_ACTIONS.ARRANGE_CARDS,
    title: "Arrange Cards",
    routing: "first-responder",
    parameterized: true,
  },
  {
    // The pane list is rebuilt per open, so the payload set is runtime.
    id: TUG_ACTIONS.FOCUS_PANE,
    title: "Focus Pane",
    routing: "first-responder",
    parameterized: true,
  },
  {
    id: TUG_ACTIONS.PREVIOUS_TAB,
    title: "Previous Card",
    routing: "first-responder",
    menuItemId: "window.previousCard",
    bindings: [
      chord({ key: "BracketLeft", meta: true, shift: true, label: "[" }),
    ],
    mirrored: true,
    validate: cardNavigationAvailable,
  },
  {
    id: TUG_ACTIONS.NEXT_TAB,
    title: "Next Card",
    routing: "first-responder",
    menuItemId: "window.nextCard",
    bindings: [
      chord({ key: "BracketRight", meta: true, shift: true, label: "]" }),
    ],
    mirrored: true,
    validate: cardNavigationAvailable,
  },
  {
    id: TUG_ACTIONS.CYCLE_CARD,
    title: "Cycle Panes",
    routing: "first-responder",
    menuItemId: "window.cyclePanes",
    bindings: [chord({ key: "Backquote", ctrl: true, label: "`" })],
    mirrored: true,
    validate: (chain) =>
      chain.menu.paneCount >= 2 || deckDeselectedWithPanes(chain),
  },
  // The two slot-stack items take no deselected-deck escape hatch: they act
  // on a SPECIFIC pane's stack, and with nothing selected there is no such
  // pane. Both gate identically whichever one currently holds ⌘R, so the
  // user's preference moves the chord and nothing else.
  //
  // ⌘R is one chord and one command holds it: Cycle Stack by default, Reveal
  // Stack when the user prefers it, moved by `applyStackChordPreference`. The
  // table states the default rather than giving both the chord, so a plain
  // read of it answers "what does ⌘R do" with one command.
  //
  // Whoever holds it detaches it when the stack has nowhere to go — a chord
  // on a dimmed item is eaten at the menu bar with a beep, and ⌘R dead
  // everywhere is a worse answer than ⌘R inapplicable here.
  {
    id: TUG_ACTIONS.REVEAL_STACK,
    title: "Reveal Stack",
    routing: "first-responder",
    menuItemId: "window.revealStack",
    mirrored: true,
    validate: (chain) => chain.menu.stackDepth > 1,
    disabledChord: "detach",
  },
  {
    id: TUG_ACTIONS.CYCLE_STACK,
    title: "Cycle Stack",
    routing: "first-responder",
    menuItemId: "window.cycleStack",
    bindings: [STACK_CHORD],
    mirrored: true,
    validate: (chain) => chain.menu.stackDepth > 1,
    disabledChord: "detach",
  },
  ...SLOT_COMMANDS,
  {
    // Its door is the pane's close box — a targeted control, invisible to
    // a lint that can only see menu items and chords.
    id: TUG_ACTIONS.CLOSE_PANE,
    title: "Close Pane",
    routing: "target",
    internal: true,
  },

  // ---- Lens ----
  {
    id: TUG_ACTIONS.FOCUS_LENS,
    title: "Focus Lens",
    routing: "first-responder",
    menuItemId: "maker.focusLens",
    bindings: [
      chord({ key: "KeyL", meta: true, label: "l" }, { preventDefault: true }),
    ],
  },
  {
    // ⌃⌘L — a sidebar toggle, so it takes the ⌃⌘⟨letter⟩ grammar the Jots
    // toggle below shares. Menu-eligible: the item's key equivalent is left
    // empty in Swift and supplied by `applyCommandChords`, which is what
    // keeps the chord rebindable.
    id: TUG_ACTIONS.TOGGLE_LENS,
    title: "Show Lens",
    routing: "registry",
    menuItemId: "maker.lens",
    bindings: [
      chord(
        { key: "KeyL", ctrl: true, meta: true, label: "l" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },
  {
    // Its door is the Lens Layouts section's kind picker.
    id: "set-imposition",
    title: "Set Imposition",
    routing: "registry",
    internal: true,
  },
  {
    // Its door is the Lens Layouts section's sidebar positions group — one
    // control per registered sidebar card, so the payload set is runtime.
    id: TUG_ACTIONS.SET_SIDEBAR_SIDE,
    title: "Set Sidebar Side",
    routing: "registry",
    internal: true,
  },
  {
    // Its door is the pane title bar's width popup.
    id: TUG_ACTIONS.SET_CARD_WIDTH,
    title: "Set Card Width",
    routing: "registry",
    internal: true,
  },
  {
    // Its door is the Lens Layouts section's Card Width group.
    id: TUG_ACTIONS.SET_CONTENT_WIDTH,
    title: "Set Content Width",
    routing: "registry",
    internal: true,
  },
  {
    // The slot set follows the active imposition, so the payload set is
    // runtime; its door is the Lens rows' slot pickers.
    id: "assign-slot",
    title: "Assign Slot",
    routing: "registry",
    parameterized: true,
  },
  {
    // Its door is a Lens Sessions monitor row.
    id: "focus-session-card",
    title: "Focus Session Card",
    routing: "registry",
    internal: true,
  },

  // ---- Jots ----
  {
    // ⌘J — plain-⌘ tier, earned by frequency: capture is something you reach
    // for mid-thought, and a jot you have to open a card to write is a jot you
    // don't write. Menu-eligible so the chord fires even when the native title
    // bar holds focus.
    id: TUG_ACTIONS.NEW_JOT,
    title: "New Jot",
    routing: "first-responder",
    menuItemId: "file.newJot",
    bindings: [
      chord(
        { key: "KeyJ", meta: true, label: "j" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },
  {
    // ⌃⌘J — the sidebar-toggle grammar's other half (⌃⌘L shows the Lens).
    id: TUG_ACTIONS.TOGGLE_JOTS,
    title: "Show Jots",
    routing: "registry",
    menuItemId: "maker.jots",
    bindings: [
      chord(
        { key: "KeyJ", ctrl: true, meta: true, label: "j" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },

  // ---- App level ----
  {
    // ⌃⌘K — the keyboard's own card, reached from the keyboard. ⌘, belongs to
    // Settings and ⌘K is taken, so this sits a modifier away from both: the
    // one card whose subject is chords should not be the one card you can only
    // open with the mouse.
    id: TUG_ACTIONS.SHOW_KEYBOARD_SHORTCUTS,
    title: "Keyboard Shortcuts…",
    routing: "first-responder",
    menuItemId: "app.keyboardShortcuts",
    bindings: [
      chord(
        { key: "KeyK", ctrl: true, meta: true, label: "k" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
  },
  {
    // The app menu's About and New Session items both send this wire with
    // different components; per-value rows are a later menu decision.
    id: "show-card",
    title: "Show Card",
    routing: "registry",
    parameterized: true,
  },
  // ---- Performed by AppKit ----
  //
  // Represented so the keymap UI can show them and the locked policy can
  // name them; never routed through JS ([P04]).
  {
    id: "hide-application",
    title: "Hide Tug",
    routing: "native",
    menuItemId: "app.hide",
    bindings: [chord({ key: "KeyH", meta: true, label: "h" })],
  },
  {
    id: "hide-others",
    title: "Hide Others",
    routing: "native",
    menuItemId: "app.hideOthers",
    bindings: [chord({ key: "KeyH", meta: true, alt: true, label: "h" })],
  },
  {
    id: "show-all",
    title: "Show All",
    routing: "native",
    menuItemId: "app.showAll",
  },
  {
    id: "services",
    title: "Services",
    routing: "native",
    menuItemId: "app.services",
  },
  {
    id: "quit-application",
    title: "Quit Tug",
    routing: "native",
    menuItemId: "app.quit",
    bindings: [chord({ key: "KeyQ", meta: true, label: "q" })],
  },
  {
    id: "minimize",
    title: "Minimize",
    routing: "native",
    menuItemId: "window.minimize",
    bindings: [chord({ key: "KeyM", meta: true, label: "m" })],
  },
  {
    id: "zoom-window",
    title: "Zoom",
    routing: "native",
    menuItemId: "window.zoom",
  },
  {
    id: "toggle-full-screen",
    title: "Enter Full Screen",
    routing: "native",
    menuItemId: "window.enterFullScreen",
    bindings: [chord({ key: "KeyF", ctrl: true, meta: true, label: "f" })],
  },
  {
    id: "configure-tug",
    title: "Configure Tug…",
    routing: "registry",
    menuItemId: "app.configureTug",
  },
  {
    id: "logout",
    title: "Log Out…",
    routing: "registry",
    menuItemId: "app.logout",
  },
  {
    id: "reload",
    title: "Reload",
    routing: "registry",
    menuItemId: "maker.reload",
  },
  {
    // No menu item drives this: Maker ▸ Source Tree… runs its NSOpenPanel
    // in the host and never sends the wire. The registered handler reaches
    // the same picker through the `sourceTree` script-message bridge, so
    // the command works — nothing sends it.
    //
    // Stays `registry` with the other app-level singletons. Its whole body
    // is one post to a host script-message handler: no deck state, no
    // responder that owns it, and no validity anything could be asked
    // for. A chain identity would give it a home that has no relationship
    // to what it does.
    id: "source-tree",
    title: "Source Tree…",
    routing: "registry",
    internal: true,
  },
  {
    id: TUG_ACTIONS.SHOW_COMPONENT_GALLERY,
    title: "New Component Gallery Card",
    routing: "first-responder",
    menuItemId: "maker.galleryCard",
  },
  {
    id: TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE,
    title: "New Card in Active Pane",
    routing: "first-responder",
    menuItemId: "maker.newCardInPane",
    bindings: [chord({ key: "KeyT", meta: true, label: "t" })],
    mirrored: true,
    validate: (chain) => chain.menu.paneCount > 0,
  },

  // ---- Named, but not yet doored ----
  //
  // Every entry below is `internal`: it exists so the command has a name
  // the table can see, and its comment says exactly what stands between it
  // and a door. Menu placement for these is a design judgment, not a
  // mechanical one, so it is made where menu real estate is decided — not
  // here, where the job is only to end the anonymity.
  {
    // Its door is the Lens Cards rows' center affordance.
    id: TUG_ACTIONS.CENTER_PANE,
    title: "Center Pane",
    routing: "first-responder",
    internal: true,
  },
  {
    // Its door is the Lens rail's pin affordance.
    id: TUG_ACTIONS.PIN_LENS,
    title: "Pin Lens",
    routing: "first-responder",
    internal: true,
  },
  {
    // The shipped door is the Show Lens item, which toggles; the explicit
    // halves exist so a caller that means one of them can say so.
    id: TUG_ACTIONS.SHOW_LENS_PANE,
    title: "Show Lens Pane",
    routing: "first-responder",
    internal: true,
  },
  {
    id: TUG_ACTIONS.HIDE_LENS_PANE,
    title: "Hide Lens Pane",
    routing: "first-responder",
    internal: true,
  },
  {
    // Its door is a drag, which is a gesture rather than a command door.
    id: TUG_ACTIONS.MOVE_PANE,
    title: "Move Pane",
    routing: "first-responder",
    internal: true,
  },
  {
    // Its doors are the Changes sheet's Cancel and the Escape ladder.
    id: TUG_ACTIONS.EXIT_COMMIT_MODE,
    title: "Exit Commit Mode",
    routing: "key-card",
    internal: true,
  },
  {
    // Its door is the Changes sheet's Commit button.
    id: TUG_ACTIONS.LAND_COMMIT,
    title: "Commit",
    routing: "key-card",
    internal: true,
  },
  {
    // ⌃⌘M, live only while the composer is in commit mode — the keyboard
    // twin of the pencil-sparkles button.
    //
    // The chord is stated here so the keymap pane and every hint can read it;
    // *where* it is live is decided by where the composer registers it, which
    // is the [P08] split between a binding's scope and a command's routing.
    // The declared scope names the surface rather than a runtime responder
    // id, because a card's responder id is minted per card and a table cannot
    // name it — `resolveChord` reads the live registration for resolution and
    // this declaration for display.
    id: TUG_ACTIONS.COMMIT_AUTO_MESSAGE,
    title: "Generate a Commit Message",
    routing: "first-responder",
    bindings: [
      {
        chord: { key: "KeyM", ctrl: true, meta: true, label: "m" },
        scope: { kind: "responder", responderId: COMPOSER_RESPONDER_SCOPE },
        source: "default",
        preventDefault: true,
      },
    ],
  },
  {
    // ⌃⌘A — Claim All, one finger from ⌃⌘C (the shade) and ⌃⌘M (the message);
    // live only while the composer is in commit mode, which is what raising
    // the Changes shade means. Composite on purpose: the shade wires the
    // unattributed and orphaned buckets as two buttons, and the chord claims
    // both at once. The buttons remain the granular path.
    //
    // Registered by the composer (the surface that holds focus while the
    // passive shade is up) and handled by the session card (the component
    // that holds `changesController`); the composer's unclaimed
    // first-responder action falls through to the card below it.
    id: TUG_ACTIONS.CLAIM_ALL_CHANGES,
    title: "Claim All Changes",
    routing: "first-responder",
    bindings: [
      {
        chord: { key: "KeyA", ctrl: true, meta: true, label: "a" },
        scope: { kind: "responder", responderId: COMPOSER_RESPONDER_SCOPE },
        source: "default",
        preventDefault: true,
      },
    ],
  },
  {
    // ⌃⇧⌘A — the ⇧-counterpart of Claim All, sharing its key. Counterpart,
    // not set-inverse: ⌃⌘A acts on what is not yet this session's, ⌃⇧⌘A on
    // this session's own entry.
    id: TUG_ACTIONS.DISCLAIM_ALL_CHANGES,
    title: "Disclaim All Changes",
    routing: "first-responder",
    bindings: [
      {
        chord: { key: "KeyA", ctrl: true, meta: true, shift: true, label: "a" },
        scope: { kind: "responder", responderId: COMPOSER_RESPONDER_SCOPE },
        source: "default",
        preventDefault: true,
      },
    ],
  },
  {
    // Its doors are the PDF viewer's context menu items.
    id: `${TUG_ACTIONS.ZOOM_TO_FIT}:width`,
    title: "Zoom to Fit Width",
    routing: "first-responder",
    action: TUG_ACTIONS.ZOOM_TO_FIT,
    payload: "width",
    internal: true,
  },
  {
    id: `${TUG_ACTIONS.ZOOM_TO_FIT}:page`,
    title: "Zoom to Fit Page",
    routing: "first-responder",
    action: TUG_ACTIONS.ZOOM_TO_FIT,
    payload: "page",
    internal: true,
  },
  {
    id: `${TUG_ACTIONS.SET_PAGE_MODE}:continuous`,
    title: "Continuous Pages",
    routing: "first-responder",
    action: TUG_ACTIONS.SET_PAGE_MODE,
    payload: "continuous",
    internal: true,
  },
  {
    id: `${TUG_ACTIONS.SET_PAGE_MODE}:single`,
    title: "Single Page",
    routing: "first-responder",
    action: TUG_ACTIONS.SET_PAGE_MODE,
    payload: "single",
    internal: true,
  },
  {
    id: `${TUG_ACTIONS.SET_PAGE_MODE}:two`,
    title: "Two Pages",
    routing: "first-responder",
    action: TUG_ACTIONS.SET_PAGE_MODE,
    payload: "two",
    internal: true,
  },
  {
    // Window ▸ Cascade and Window ▸ Tile are the shipped doors for
    // rearranging the canvas; this name has no separate implementation.
    id: TUG_ACTIONS.RESET_LAYOUT,
    title: "Reset Layout",
    routing: "first-responder",
    internal: true,
  },
  {
    // A card-level maximize does not exist; Window ▸ Zoom is the window's
    // own command, and no responder registers this one.
    id: TUG_ACTIONS.MAXIMIZE,
    title: "Maximize Card",
    routing: "first-responder",
    internal: true,
  },
  {
    // No responder registers a handler, so a door would lead nowhere.
    id: TUG_ACTIONS.SELECT_NONE,
    title: "Deselect All",
    routing: "first-responder",
    internal: true,
  },
  {
    // ⇥ / ⇧⇥ belong to the provider's focus walk, which owns them before
    // any binding could; a chord here would never be reached.
    id: TUG_ACTIONS.FOCUS_NEXT,
    title: "Focus Next",
    routing: "first-responder",
    internal: true,
  },
  {
    id: TUG_ACTIONS.FOCUS_PREVIOUS,
    title: "Focus Previous",
    routing: "first-responder",
    internal: true,
  },
  {
    // There is no closed-tab history to reopen from.
    id: TUG_ACTIONS.REOPEN_TAB,
    title: "Reopen Closed Tab",
    routing: "first-responder",
    internal: true,
  },
  {
    // The session card handles it, but nothing dispatches it: no chord is
    // assigned to the ⌃⌘ band and no menu item names it.
    id: TUG_ACTIONS.INSERT_SLASH_COMMAND,
    title: "Insert Slash Command",
    routing: "key-card",
    internal: true,
  },

  // ---- Chord-only ----
  //
  // Working commands with no menu door yet. Their chords are what makes
  // them reachable, and what makes them visible to the keymap UI.
  {
    // One command, two doors: the app menu's item and ⌘,. Both dispatch
    // through the chain to the canvas's find-or-create-then-focus handler.
    id: TUG_ACTIONS.SHOW_SETTINGS,
    title: "Settings…",
    routing: "first-responder",
    menuItemId: "app.settings",
    bindings: [chord({ key: "Comma", meta: true, label: "," })],
  },
  {
    id: TUG_ACTIONS.CANCEL_DIALOG,
    title: "Cancel",
    routing: "first-responder",
    bindings: [
      chord({ key: "Period", meta: true, label: "." }),
      chord({ key: "Escape", label: "Escape" }),
    ],
  },
  {
    id: TUG_ACTIONS.SHOW_DEVTOOLS,
    title: "Show DevTools",
    routing: "first-responder",
    menuItemId: "maker.devTools",
    bindings: [
      chord(
        { key: "Slash", meta: true, alt: true, label: "/" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    // The canvas handles it unconditionally, so the default chain walk
    // answers true and the item never dims — which is why it can keep its
    // chord attached without ever eating one.
    disabledChord: "keep",
  },
  {
    id: TUG_ACTIONS.OPEN_COMMAND_PICKER,
    title: "Open Command Picker",
    routing: "key-card",
    menuItemId: "session.commandPicker",
    bindings: [
      chord(
        { key: "Slash", meta: true, label: "/" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    // No predicate: the key-card walk asks the frontmost card whether it has
    // a command picker, which is the whole question.
    disabledChord: "detach",
  },
  {
    // NOT promoted. ⌃⌘P selects the composer's Prompt route — the route
    // chips are its door, and the Changes route already has a Session-menu
    // item in the Show/Hide Changes toggle. A second item for the other
    // half would name a control's internal state as a menu command, and
    // promoting the chord would take it out of the JS funnel for a gesture
    // whose surface is two clicks away.
    //
    // ⌃⌘ is the Tug tier (chord-tiers.md): route selection is Tug's own
    // machinery, and ⇧ was carrying nothing here — there is no ⌘P base of
    // which Prompt Route is the counterpart.
    id: `${TUG_ACTIONS.SELECT_COMPOSER_ROUTE}:prompt`,
    title: "Prompt Route",
    routing: "key-card",
    action: TUG_ACTIONS.SELECT_COMPOSER_ROUTE,
    payload: "prompt",
    bindings: [
      chord(
        { key: "KeyP", ctrl: true, meta: true, label: "p" },
        { preventDefault: true },
      ),
    ],
  },
  {
    // Chord-only, and deliberately so. Focus-mode cycling is a text-first
    // card's own affordance, reached by ⌥⇥ and by the card's chrome; a menu
    // item for it would put ⌥⇥ into AppKit's key-equivalent scan, above every
    // surface that wants a modified Tab, to advertise a gesture that only makes
    // sense once you are already inside such a card.
    id: TUG_ACTIONS.CYCLE_FOCUS_MODE,
    title: "Cycle Focus Mode",
    routing: "key-card",
    bindings: [chord({ key: "Tab", alt: true, label: "Tab" }, { preventDefault: true })],
  },
  {
    id: TUG_ACTIONS.PREVIOUS_TURN,
    title: "Previous Turn",
    routing: "key-card",
    menuItemId: "session.previousTurn",
    bindings: [
      chord(
        { key: "ArrowUp", alt: true, meta: true, label: "ArrowUp" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    validate: transcriptNavigable,
    disabledChord: "detach",
  },
  {
    id: TUG_ACTIONS.NEXT_TURN,
    title: "Next Turn",
    routing: "key-card",
    menuItemId: "session.nextTurn",
    bindings: [
      chord(
        { key: "ArrowDown", alt: true, meta: true, label: "ArrowDown" },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    validate: transcriptNavigable,
    disabledChord: "detach",
  },
  {
    id: TUG_ACTIONS.FIRST_TURN,
    title: "First Turn",
    routing: "key-card",
    menuItemId: "session.firstTurn",
    bindings: [
      chord(
        {
          key: "ArrowUp",
          alt: true,
          shift: true,
          meta: true,
          label: "ArrowUp",
        },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    validate: transcriptNavigable,
    disabledChord: "detach",
  },
  {
    id: TUG_ACTIONS.LAST_TURN,
    title: "Last Turn",
    routing: "key-card",
    menuItemId: "session.lastTurn",
    bindings: [
      chord(
        {
          key: "ArrowDown",
          alt: true,
          shift: true,
          meta: true,
          label: "ArrowDown",
        },
        { preventDefault: true, menuEligible: true },
      ),
    ],
    mirrored: true,
    validate: transcriptNavigable,
    disabledChord: "detach",
  },
];

/* ---------------------------------------------------------------------------
 * Locking policy (Spec S05)
 * ------------------------------------------------------------------------- */

/**
 * Commands the user may not rebind.
 *
 * This is **policy, not mechanism** ([P12]). Every entry in the table is
 * mechanically rebindable; these are the ones where doing so would break a
 * macOS convention the user relies on to get out of trouble — Quit, Hide,
 * the clipboard verbs. Changing the policy is an edit to this array and
 * nothing else, which is why lockedness is not a field on the entry.
 */
export const NATIVE_LOCKED: readonly string[] = [
  "hide-application",
  "hide-others",
  "show-all",
  "quit-application",
  "services",
  TUG_ACTIONS.CUT,
  TUG_ACTIONS.COPY,
  TUG_ACTIONS.PASTE,
  TUG_ACTIONS.DELETE,
  TUG_ACTIONS.SELECT_ALL,
  "minimize",
  "zoom-window",
  "toggle-full-screen",
];

const NATIVE_LOCKED_SET: ReadonlySet<string> = new Set(NATIVE_LOCKED);

/**
 * Whether a command's bindings are the user's to change. Read by the
 * keymap UI (which renders a locked row without a capture affordance) and
 * by the override store's validator (which rejects the write).
 */
export function isCommandLocked(id: string): boolean {
  return NATIVE_LOCKED_SET.has(id);
}

/* ---------------------------------------------------------------------------
 * Derived lookups
 * ------------------------------------------------------------------------- */

export const COMMANDS_BY_ID: ReadonlyMap<string, CommandEntry> = new Map(
  COMMANDS.map((entry) => [entry.id, entry]),
);

export const COMMANDS_BY_MENU_ITEM_ID: ReadonlyMap<string, CommandEntry> =
  new Map(
    COMMANDS.filter((entry) => entry.menuItemId !== undefined).map((entry) => [
      entry.menuItemId as string,
      entry,
    ]),
  );

/** The entry for a command id, or `undefined` if the id names no command. */
export function commandEntry(id: string): CommandEntry | undefined {
  return COMMANDS_BY_ID.get(id);
}

/** Whether an incoming wire name is a registry command rather than a data frame. */
export function isCommandId(id: string): boolean {
  return COMMANDS_BY_ID.has(id);
}

const TUG_ACTION_VALUES: ReadonlySet<string> = new Set(
  Object.values(TUG_ACTIONS),
);

/**
 * The wire name behind an entry, which for a parameterized id is the part
 * before the colon — `<action>:<value>` is the id form [P05] mints, so the
 * base is recoverable without a second field. This is the key the
 * `registry` routing target looks the entry's handler up by.
 */
export function commandWire(entry: CommandEntry): string {
  const colon = entry.id.indexOf(":");
  return colon === -1 ? entry.id : entry.id.slice(0, colon);
}

/**
 * The chain action an entry dispatches: its explicit `action`, or its `id`
 * when the id is itself a `TUG_ACTIONS` value. `null` for entries with no
 * chain action at all — `registry` bodies and `native` rows.
 */
export function commandAction(entry: CommandEntry): TugAction | null {
  if (entry.action !== undefined) return entry.action;
  if (TUG_ACTION_VALUES.has(entry.id)) return entry.id as TugAction;
  return null;
}

/* ---------------------------------------------------------------------------
 * Validity and state
 * ------------------------------------------------------------------------- */

/**
 * Whether a command is applicable right now ([P06]).
 *
 * An explicit `validate` predicate wins. Otherwise a chain-routed command is
 * validated by the chain — walked from the same node it would dispatch to,
 * so a key-card command answers from the key card rather than from wherever
 * focus happens to sit. A `registry` entry with no predicate has no
 * responder to ask and answers enabled; a `native` entry is AppKit's to
 * validate, never ours.
 *
 * This lives beside the table rather than beside the dispatcher because it
 * is the table's own answer: every surface that shows a command — the menu
 * mirror, buttons, context menus — asks this one function, which is what
 * keeps a button and its menu item from disagreeing.
 */
export function validateCommand(
  entry: CommandEntry,
  chain: CommandValidationSource,
): boolean {
  if (entry.validate !== undefined) return entry.validate(chain);

  const action = commandAction(entry);
  if (action === null) return true;

  switch (entry.routing) {
    case "key-card":
      return chain.validateActionInKeyCard(action);
    case "first-responder":
    case "target":
      return chain.validateAction(action);
    case "registry":
    case "native":
      return true;
  }
}

/**
 * A command's state projection — a checkmark, a radio selection, a toggle
 * ([P07]). `undefined` means the command does not participate in a check
 * column at all.
 */
export function queryCommandState(
  entry: CommandEntry,
  chain: CommandValidationSource,
): boolean | string | undefined {
  if (entry.state !== undefined) return entry.state(chain);

  const action = commandAction(entry);
  if (action === null) return undefined;

  switch (entry.routing) {
    case "key-card":
      return chain.queryActionStateInKeyCard(action);
    case "first-responder":
    case "target":
      return chain.queryActionState(action);
    case "registry":
    case "native":
      return undefined;
  }
}

/** Validity for a command named by id; unknown ids are not applicable. */
export function validateCommandId(
  id: string,
  chain: CommandValidationSource,
): boolean | undefined {
  const entry = COMMANDS_BY_ID.get(id);
  return entry === undefined ? undefined : validateCommand(entry, chain);
}

/* ---------------------------------------------------------------------------
 * Table lint
 * ------------------------------------------------------------------------- */

/**
 * Every invariant the table must hold, as a list of violations rather than
 * a throw, so a test can report all of them at once.
 *
 * The door-coverage rule is the load-bearing one: a command with neither a
 * menu item nor a chord is invocable by nobody, which is the state this
 * whole table exists to make visible. An entry that legitimately has no
 * door says so with `internal: true`.
 */
export function lintCommandTable(
  entries: readonly CommandEntry[] = COMMANDS,
): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenMenuItemIds = new Map<string, string>();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      problems.push(`duplicate command id: ${entry.id}`);
    }
    seenIds.add(entry.id);

    if (entry.menuItemId !== undefined) {
      const owner = seenMenuItemIds.get(entry.menuItemId);
      if (owner !== undefined) {
        problems.push(
          `menu item ${entry.menuItemId} is claimed by both ${owner} and ${entry.id}`,
        );
      }
      seenMenuItemIds.set(entry.menuItemId, entry.id);
    }

    if (entry.routing !== "native" && commandAction(entry) === null) {
      if (entry.routing !== "registry") {
        problems.push(
          `${entry.id}: ${entry.routing} routing needs a chain action (its id is not a TUG_ACTIONS value, so it must name one)`,
        );
      }
    }

    const hasDoor =
      entry.menuItemId !== undefined ||
      (entry.bindings !== undefined && entry.bindings.length > 0);
    if (!hasDoor && !entry.parameterized && !entry.internal) {
      problems.push(
        `${entry.id}: no menu item and no binding — no way to invoke it`,
      );
    }
  }

  return problems;
}

/**
 * Action names that are deliberately not commands.
 *
 * A `TUG_ACTIONS` value is either a user intent — which belongs in the
 * table — or it is currency: something a control says to its responder, or
 * a substrate says to its text field. The distinction is the whole point of
 * the table, so it is written down rather than left to be inferred from
 * absence, and `lintActionCoverage` holds every name to one side or the
 * other.
 */
export const ACTIONS_OUTSIDE_THE_TABLE: ReadonlySet<string> = new Set<string>([
  // Form-control currency: a control reporting its own value to whoever
  // owns it. Not invocable, not bindable, not nameable in a menu.
  TUG_ACTIONS.SET_VALUE,
  TUG_ACTIONS.TOGGLE,
  TUG_ACTIONS.SELECT_VALUE,
  TUG_ACTIONS.INCREMENT_VALUE,
  TUG_ACTIONS.DECREMENT_VALUE,
  TUG_ACTIONS.SET_COLOR,
  TUG_ACTIONS.ACTIVATE_COLOR_WELL,
  TUG_ACTIONS.SET_PROPERTY,
  TUG_ACTIONS.SELECT_TAB,
  TUG_ACTIONS.CLOSE_TAB,
  TUG_ACTIONS.ADD_TAB,
  TUG_ACTIONS.TOGGLE_SECTION,
  TUG_ACTIONS.SUBMIT,
  TUG_ACTIONS.REMOVE_ATTACHMENT,
  TUG_ACTIONS.REQUEST_TRASH_SESSION,
  TUG_ACTIONS.CONFIRM_DIALOG,
  TUG_ACTIONS.DISMISS_POPOVER,
  TUG_ACTIONS.SHOW_SLASH_COMMAND_NOTICE,
  TUG_ACTIONS.SCROLL_DOCUMENT,

  // Substrate text-editing currency. Movement and deletion only ever
  // target the focused text field, so the chain abstraction — and a
  // rebindable command — would add nothing.
  TUG_ACTIONS.DELETE_TO_LINE_START,
  TUG_ACTIONS.DELETE_WORD_BACKWARD,
  TUG_ACTIONS.MOVE_WORD_FORWARD,
  TUG_ACTIONS.MOVE_WORD_BACKWARD,

  // Context-menu verbs over a sampled target. Each one means "the thing
  // the right-click landed on", which a chord or a menu-bar item has no
  // way to name.
  TUG_ACTIONS.COPY_COMMAND,
  TUG_ACTIONS.COPY_COMMAND_AS_PLAIN_TEXT,
  TUG_ACTIONS.COPY_ANNOTATION_VALUE,
  TUG_ACTIONS.INSERT_INTO_COMPOSER,
  TUG_ACTIONS.REVEAL_IN_FINDER,
  TUG_ACTIONS.OPEN_IMAGE_PREVIEW,
  TUG_ACTIONS.DUPLICATE,
]);

/**
 * Every action name is either a command wire or explicitly outside the
 * table. A name in neither set is the state this plan exists to end: a
 * verb nobody can find, in a vocabulary that claims to be canonical.
 */
export function lintActionCoverage(
  entries: readonly CommandEntry[] = COMMANDS,
): string[] {
  const wires = new Set(entries.map(commandWire));
  return Object.values(TUG_ACTIONS)
    .filter(
      (action) => !wires.has(action) && !ACTIONS_OUTSIDE_THE_TABLE.has(action),
    )
    .map(
      (action) =>
        `${action} is neither a command nor declared outside the table`,
    );
}

/**
 * The locked policy names commands, so a renamed or deleted entry must not
 * leave a lock pointing at nothing — a lock nobody enforces reads as
 * "rebindable" to every consumer.
 */
export function lintNativeLocked(
  entries: readonly CommandEntry[] = COMMANDS,
): string[] {
  const ids = new Set(entries.map((entry) => entry.id));
  return NATIVE_LOCKED.filter((id) => !ids.has(id)).map(
    (id) => `NATIVE_LOCKED names ${id}, which is not a command`,
  );
}

if (import.meta.env?.DEV) {
  const problems = [
    ...lintCommandTable(),
    ...lintNativeLocked(),
    ...lintActionCoverage(),
  ];
  if (problems.length > 0) {
    throw new Error(`command-registry: ${problems.join("; ")}`);
  }
}
