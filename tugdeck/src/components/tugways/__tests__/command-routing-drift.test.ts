/**
 * The migration's drift guard.
 *
 * Converting the re-dispatch loops in `action-dispatch.ts` into table rows
 * is mechanical but voluminous, and a mis-transcribed `routing` turns a
 * working command into a silent no-op that no type checker catches. The
 * table below records, per command, the mechanism the pre-funnel call site
 * used — read off `action-dispatch.ts` before the loops were deleted — and
 * asserts the entry still routes that way.
 *
 * The second half is the coverage question from the other side: every wire
 * `AppDelegate.swift` can send has to land somewhere. The fixture is the
 * deduplicated `sendControl(` list from the Swift source; each wire is
 * declared a command, a bridge (a wire whose parameter selects a per-value
 * command), or a data frame, and the test holds the registry to it.
 */

import { describe, expect, test } from "bun:test";

import {
  COMMANDS,
  COMMANDS_BY_ID,
  commandWire,
  type CommandRouting,
} from "../command-registry";
import { TUG_ACTIONS } from "../action-vocabulary";
import { KEYBINDINGS } from "../keybinding-map";

/**
 * command id → the mechanism the pre-migration code used.
 *
 * `first-responder` was `sendToFirstResponder` or, for the menu-command
 * adapter group, `sendToFirstResponderForContinuation` with the
 * continuation invoked immediately. `key-card` was `sendToKeyCard`.
 * `registry` means the body lived in `action-dispatch.ts` itself.
 */
const PRE_MIGRATION_MECHANISM: Readonly<Record<string, CommandRouting>> = {
  // The save-verb loop.
  [TUG_ACTIONS.SAVE]: "first-responder",
  [TUG_ACTIONS.SAVE_AS]: "first-responder",
  [TUG_ACTIONS.SAVE_A_COPY]: "first-responder",
  [TUG_ACTIONS.REVERT_TO_SAVED]: "first-responder",
  [TUG_ACTIONS.RELOAD_FROM_DISK]: "first-responder",
  // The zoom loop.
  [TUG_ACTIONS.ZOOM_IN]: "first-responder",
  [TUG_ACTIONS.ZOOM_OUT]: "first-responder",
  [TUG_ACTIONS.ZOOM_ACTUAL]: "first-responder",
  // The menu-command adapter loop (continuation-aware).
  [TUG_ACTIONS.FIND]: "first-responder",
  [TUG_ACTIONS.FIND_NEXT]: "first-responder",
  [TUG_ACTIONS.FIND_PREVIOUS]: "first-responder",
  [TUG_ACTIONS.UNDO]: "first-responder",
  [TUG_ACTIONS.REDO]: "first-responder",
  [TUG_ACTIONS.NEXT_TAB]: "first-responder",
  [TUG_ACTIONS.PREVIOUS_TAB]: "first-responder",
  [TUG_ACTIONS.CYCLE_CARD]: "first-responder",
  [TUG_ACTIONS.PASTE_AS_QUOTE]: "first-responder",
  [TUG_ACTIONS.PASTE_AS_PLAIN_TEXT]: "first-responder",
  [TUG_ACTIONS.COPY_AS_PLAIN_TEXT]: "first-responder",
  // The key-card loop.
  [TUG_ACTIONS.FOCUS_PROMPT]: "key-card",
  [TUG_ACTIONS.CYCLE_PERMISSION_MODE]: "key-card",
  [TUG_ACTIONS.INTERRUPT_SESSION]: "key-card",
  [TUG_ACTIONS.TOGGLE_CHANGES_VIEW]: "key-card",
  [TUG_ACTIONS.TOGGLE_HISTORY_VIEW]: "key-card",
  // Standalone first-responder adapters.
  [TUG_ACTIONS.CLOSE]: "first-responder",
  [TUG_ACTIONS.CLOSE_ALL]: "first-responder",
  [TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE]: "first-responder",
  [TUG_ACTIONS.SHOW_COMPONENT_GALLERY]: "first-responder",
  [TUG_ACTIONS.FOCUS_LENS]: "first-responder",
  [TUG_ACTIONS.REVEAL_STACK]: "first-responder",
  [TUG_ACTIONS.CYCLE_STACK]: "first-responder",
  // Wires with real bodies in action-dispatch.ts.
  "new-text-card": "registry",
  [TUG_ACTIONS.OPEN_FILE]: "registry",
  [TUG_ACTIONS.OPEN_DIFF]: "registry",
  "open-quickly": "registry",
  "clear-recent-documents": "registry",
  "next-theme": "registry",
  "set-theme": "registry",
  "show-card": "registry",
  "arrange-cards": "registry",
  "focus-pane": "registry",
  setup: "registry",
  logout: "registry",
  reload: "registry",
  "toggle-lens": "registry",
  // The coverage pass found this one is senderless: the wire has a registry
  // body, but Maker ▸ Source Tree… runs its panel in the host and never
  // sends it, so the entry claims no menu item.
  "source-tree": "registry",
  "set-imposition": "registry",
  "set-imposition-lens": "registry",
  "assign-slot": "registry",
  "focus-session-card": "registry",
};

describe("routing matches the pre-migration mechanism", () => {
  for (const [id, mechanism] of Object.entries(PRE_MIGRATION_MECHANISM)) {
    test(`${id} still routes ${mechanism}`, () => {
      expect(COMMANDS_BY_ID.get(id)?.routing).toBe(mechanism);
    });
  }

  test("the per-value families inherit the mechanism their wire used", () => {
    // Twenty slash bridges and four permission modes were one key-card
    // re-dispatch each before they were rows.
    const perValue = COMMANDS.filter((e) => e.id.includes(":"));
    const slash = perValue.filter((e) => commandWire(e) === TUG_ACTIONS.RUN_SLASH_COMMAND);
    const modes = perValue.filter((e) => commandWire(e) === TUG_ACTIONS.SET_PERMISSION_MODE);

    expect(slash.length).toBe(20);
    expect(modes.length).toBe(4);
    for (const entry of [...slash, ...modes]) {
      expect(entry.routing).toBe("key-card");
      expect(entry.menuItemId).toBeDefined();
    }
  });

  test("the nine slot commands carry their own digit and dispatch one action", () => {
    const slots = COMMANDS.filter((e) => commandWire(e) === TUG_ACTIONS.MOVE_TO_SLOT);
    expect(slots.length).toBe(9);
    for (const entry of slots) {
      expect(entry.routing).toBe("first-responder");
      expect(entry.action).toBe(TUG_ACTIONS.MOVE_TO_SLOT);
    }
    expect(slots.map((e) => e.payload)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

/**
 * Every `sendControl(` wire in `AppDelegate.swift`, deduplicated.
 *
 * - `command` — the wire is itself a registry id.
 * - `{ bridgeFor }` — the wire's parameter selects a per-value command; the
 *   entries are `<bridgeFor>:<value>`, which for `run-card-command` is a
 *   different name than the wire's own (it bridges to `run-slash-command`).
 * - `data` — a tugcast/host data frame, deliberately outside the table
 *   ([P03]).
 */
type WireKind = "command" | "data" | { readonly bridgeFor: string };

const SWIFT_WIRES: Readonly<Record<string, WireKind>> = {
  "app-lifecycle": "data",
  "voiceover-changed": "data",
  "open-file": "command",
  "show-card": "command",
  "show-settings": "command",
  setup: "command",
  logout: "command",
  "set-theme": "command",
  reload: "command",
  "toggle-lens": "command",
  "focus-lens": "command",
  "arrange-cards": "command",
  "zoom-actual": "command",
  "zoom-in": "command",
  "zoom-out": "command",
  "focus-pane": "command",
  "show-component-gallery": "command",
  "open-quickly": "command",
  "clear-recent-documents": "command",
  save: "command",
  "save-as": "command",
  "save-a-copy": "command",
  "revert-to-saved": "command",
  "reload-from-disk": "command",
  "new-text-card": "command",
  "next-theme": "command",
  "add-card-to-active-pane": "command",
  close: "command",
  "close-all": "command",
  "focus-prompt": "command",
  "interrupt-session": "command",
  "cycle-permission-mode": "command",
  "toggle-history-view": "command",
  "toggle-changes-view": "command",
  undo: "command",
  redo: "command",
  "copy-as-plain-text": "command",
  "paste-as-quote": "command",
  "paste-as-plain-text": "command",
  find: "command",
  "find-next": "command",
  "find-previous": "command",
  "previous-tab": "command",
  "next-tab": "command",
  "cycle-card": "command",
  "reveal-stack": "command",
  "cycle-stack": "command",
  // The parameter picks the command.
  "run-card-command": { bridgeFor: TUG_ACTIONS.RUN_SLASH_COMMAND },
  "set-permission-mode": { bridgeFor: TUG_ACTIONS.SET_PERMISSION_MODE },
};

describe("every Swift wire lands somewhere", () => {
  const wiresWithEntries = new Set(COMMANDS.map(commandWire));

  for (const [wire, kind] of Object.entries(SWIFT_WIRES)) {
    const label = typeof kind === "string" ? kind : `bridge to ${kind.bridgeFor}`;
    test(`${wire} resolves as a ${label}`, () => {
      if (kind === "command") {
        expect(COMMANDS_BY_ID.has(wire)).toBe(true);
      } else if (kind === "data") {
        expect(COMMANDS_BY_ID.has(wire)).toBe(false);
      } else {
        // Not a command itself; its per-value entries carry the family.
        expect(COMMANDS_BY_ID.has(wire)).toBe(false);
        expect(wiresWithEntries.has(kind.bridgeFor)).toBe(true);
      }
    });
  }
});

/**
 * The table now carries every shipped chord as a default binding, while
 * `KEYBINDINGS` is still the map the key pipeline reads. Two copies of one
 * fact is exactly the drift this plan exists to end, so until the pipeline
 * reads the table the two are held identical here.
 */
describe("default bindings mirror the live keybinding map", () => {
  function chordKey(b: {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    alt?: boolean;
  }): string {
    return `${b.key}|${b.ctrl ? 1 : 0}${b.meta ? 1 : 0}${b.shift ? 1 : 0}${b.alt ? 1 : 0}`;
  }

  const tableChords = new Map<string, { id: string; preventDefault: boolean }>();
  for (const entry of COMMANDS) {
    for (const binding of entry.bindings ?? []) {
      tableChords.set(chordKey(binding.chord), {
        id: entry.id,
        preventDefault: binding.preventDefault === true,
      });
    }
  }

  for (const binding of KEYBINDINGS) {
    const key = chordKey(binding);
    const label =
      binding.value === undefined
        ? binding.action
        : `${binding.action}:${String(binding.value)}`;
    test(`${key} is a default binding of ${label}`, () => {
      const found = tableChords.get(key);
      expect(found).toBeDefined();
      expect(found?.id).toBe(label);
      expect(found?.preventDefault).toBe(binding.preventDefaultOnMatch === true);
    });
  }
});
