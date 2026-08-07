/**
 * `computeCommandCapabilities` — the registry's projection into the host's
 * per-item menu gates.
 *
 * The projection's whole job is to ask each command the question its own
 * routing implies: a first-responder command is validated from the first
 * responder, a key-card command from the key card's content responder, and a
 * command carrying its own predicate is validated by that predicate and
 * nothing else. Getting the walk wrong is invisible in a type checker and
 * shows up as a menu item lit by a responder that will never receive the
 * dispatch.
 *
 * Real `ResponderChainManager`, real registrations; the entries are local so
 * a table edit can't quietly rewrite what these assert.
 */

import { describe, expect, test } from "bun:test";

import { ResponderChainManager } from "../../components/tugways/responder-chain";
import { TUG_ACTIONS } from "../../components/tugways/action-vocabulary";
import type {
  CommandEntry,
  CommandMenuFacts,
  CommandValidationSource,
} from "../../components/tugways/command-registry";
import { COMMANDS, EMPTY_MENU_FACTS } from "../../components/tugways/command-registry";
import { computeCommandCapabilities } from "../host-menu-state";

/**
 * The two halves a predicate reads, joined the way the publisher joins them
 * at flush time: the live chain, and the published menu facts.
 */
function source(
  chain: ResponderChainManager,
  facts: Partial<CommandMenuFacts> = {},
): CommandValidationSource {
  return {
    validateAction: (action) => chain.validateAction(action),
    validateActionInKeyCard: (action) => chain.validateActionInKeyCard(action),
    queryActionState: (action) => chain.queryActionState(action),
    queryActionStateInKeyCard: (action) => chain.queryActionStateInKeyCard(action),
    menu: { ...EMPTY_MENU_FACTS, ...facts },
  };
}

describe("computeCommandCapabilities", () => {
  test("a first-responder entry reflects the chain's validateAction", () => {
    const entries: CommandEntry[] = [
      {
        id: TUG_ACTIONS.SAVE,
        title: "Save",
        routing: "first-responder",
        menuItemId: "file.save",
        mirrored: true,
      },
    ];
    const chain = new ResponderChainManager();
    let canSave = false;
    chain.register({
      id: "editor",
      parentId: null,
      actions: { [TUG_ACTIONS.SAVE]: () => {} },
      validateAction: () => canSave,
    });
    chain.makeFirstResponder("editor");

    expect(computeCommandCapabilities(source(chain), entries)["file.save"].enabled).toBe(false);
    canSave = true;
    expect(computeCommandCapabilities(source(chain), entries)["file.save"].enabled).toBe(true);
  });

  test("an unhandled action leaves its item disabled", () => {
    const entries: CommandEntry[] = [
      {
        id: TUG_ACTIONS.SAVE,
        title: "Save",
        routing: "first-responder",
        menuItemId: "file.save",
        mirrored: true,
      },
    ];
    const chain = new ResponderChainManager();
    chain.register({ id: "canvas", parentId: null, actions: {} });
    chain.makeFirstResponder("canvas");

    expect(computeCommandCapabilities(source(chain), entries)["file.save"].enabled).toBe(false);
  });

  test("a key-card entry asks the key-card walk, not the first responder", () => {
    // The first responder would happily answer yes. A key-card-routed
    // command must not borrow that answer: with no key card there is no
    // content responder to ask, so the item is disabled.
    const entries: CommandEntry[] = [
      {
        id: TUG_ACTIONS.INTERRUPT_SESSION,
        title: "Stop",
        routing: "key-card",
        menuItemId: "session.stop",
        mirrored: true,
      },
    ];
    const chain = new ResponderChainManager();
    chain.register({
      id: "focused",
      parentId: null,
      actions: { [TUG_ACTIONS.INTERRUPT_SESSION]: () => {} },
      validateAction: () => true,
    });
    chain.makeFirstResponder("focused");

    expect(chain.validateAction(TUG_ACTIONS.INTERRUPT_SESSION)).toBe(true);
    expect(computeCommandCapabilities(source(chain), entries)["session.stop"].enabled).toBe(false);
  });

  test("an explicit predicate wins over the chain walk", () => {
    const entries: CommandEntry[] = [
      {
        id: "next-theme",
        title: "Next Theme",
        routing: "registry",
        menuItemId: "view.nextTheme",
        mirrored: true,
        validate: () => false,
      },
    ];
    const chain = new ResponderChainManager();
    expect(computeCommandCapabilities(source(chain), entries)["view.nextTheme"].enabled).toBe(false);
  });

  test("a registry-routed entry with no predicate is enabled", () => {
    // There is no responder to ask and no predicate to consult; an entry
    // that publishes a gate at all has to answer something, and "available"
    // is the answer that matches an unconditional command.
    const entries: CommandEntry[] = [
      {
        id: "open-quickly",
        title: "Open Quickly",
        routing: "registry",
        menuItemId: "file.openQuickly",
        mirrored: true,
      },
    ];
    const chain = new ResponderChainManager();
    expect(computeCommandCapabilities(source(chain), entries)["file.openQuickly"].enabled).toBe(true);
  });

  test("state narrows to a boolean; a value string does not ride the wire", () => {
    const currentMode = "plan";
    const entries: CommandEntry[] = [
      {
        id: `${TUG_ACTIONS.SET_PERMISSION_MODE}:plan`,
        title: "Plan",
        routing: "key-card",
        action: TUG_ACTIONS.SET_PERMISSION_MODE,
        payload: "plan",
        menuItemId: "session.permissionMode.plan",
        mirrored: true,
        state: () => currentMode === "plan",
      },
      {
        id: `${TUG_ACTIONS.SET_PERMISSION_MODE}:auto`,
        title: "Auto",
        routing: "key-card",
        action: TUG_ACTIONS.SET_PERMISSION_MODE,
        payload: "auto",
        menuItemId: "session.permissionMode.auto",
        mirrored: true,
        // The wider return type the hook keeps for off-menu readers: a
        // value, not a check state. The mirror drops it rather than
        // coercing it into a checkmark.
        state: () => currentMode,
      },
    ];
    const chain = new ResponderChainManager();
    const gates = computeCommandCapabilities(source(chain), entries);

    expect(gates["session.permissionMode.plan"].state).toBe(true);
    expect(gates["session.permissionMode.auto"].state).toBeUndefined();
  });

  test("a dynamic title rides the gate, and its absence leaves the item's own", () => {
    const entries: CommandEntry[] = [
      {
        id: TUG_ACTIONS.TOGGLE_CHANGES_VIEW,
        title: "Show Changes",
        routing: "key-card",
        menuItemId: "session.toggleChanges",
        mirrored: true,
        dynamicTitle: () => "Hide Changes",
      },
      {
        id: TUG_ACTIONS.TOGGLE_HISTORY_VIEW,
        title: "Show History",
        routing: "key-card",
        menuItemId: "session.toggleHistory",
        mirrored: true,
      },
    ];
    const chain = new ResponderChainManager();
    const gates = computeCommandCapabilities(source(chain), entries);

    expect(gates["session.toggleChanges"].title).toBe("Hide Changes");
    expect(gates["session.toggleHistory"].title).toBeUndefined();
  });

  test("only mirrored, non-parameterized entries with a menu item are published", () => {
    const entries: CommandEntry[] = [
      // Not mirrored: its enablement still belongs to a hand-rolled tier.
      { id: "a", title: "A", routing: "registry", menuItemId: "menu.a" },
      // Mirrored but parameterized: rebuilt at menu-open time, outside the
      // static mirror by construction.
      {
        id: "set-theme",
        title: "Theme",
        routing: "registry",
        menuItemId: "view.theme",
        parameterized: true,
        mirrored: true,
      },
      // Mirrored with no menu item: nothing to key a gate by.
      { id: "c", title: "C", routing: "registry", mirrored: true, internal: true },
      { id: "d", title: "D", routing: "registry", menuItemId: "menu.d", mirrored: true },
    ];
    const chain = new ResponderChainManager();

    expect(Object.keys(computeCommandCapabilities(source(chain), entries))).toEqual(["menu.d"]);
  });

  test("the shipped table's session gates follow the frontmost card's state", () => {
    const chain = new ResponderChainManager();
    const idle = {
      sessionBound: true,
      canInterrupt: false,
      canChangeSettings: true,
      permissionMode: "plan",
      hasAssistantMessage: false,
      hasTurns: false,
      changesVisible: false,
      historyVisible: false,
      commitReady: false,
    };

    // No session card frontmost: the whole Session surface is dark.
    const none = computeCommandCapabilities(source(chain));
    expect(none["session.stop"].enabled).toBe(false);
    expect(none["session.focusPrompt"].enabled).toBe(false);
    expect(none["session.rewind"].enabled).toBe(false);

    // A bound, idle session: the composer and the mode radios are live, Stop
    // is not (nothing to interrupt), and Rewind has nowhere to go.
    const bound = computeCommandCapabilities(
      source(chain, { sessionCardFrontmost: true, session: idle }),
    );
    expect(bound["session.focusPrompt"].enabled).toBe(true);
    expect(bound["session.stop"].enabled).toBe(false);
    expect(bound["session.rewind"].enabled).toBe(false);
    expect(bound["session.permissionMode.plan"].enabled).toBe(true);
    expect(bound["session.permissionMode.plan"].state).toBe(true);
    expect(bound["session.permissionMode.auto"].state).toBe(false);

    // Mid-turn: Stop lights, and the mode radios go dark so a mode change
    // cannot race the running turn.
    const running = computeCommandCapabilities(
      source(chain, {
        sessionCardFrontmost: true,
        session: { ...idle, canInterrupt: true, canChangeSettings: false, hasTurns: true },
      }),
    );
    expect(running["session.stop"].enabled).toBe(true);
    expect(running["session.permissionMode.plan"].enabled).toBe(false);
    expect(running["session.rewind"].enabled).toBe(true);
  });

  test("the Show/Hide verbs follow the Shade's live visibility", () => {
    const chain = new ResponderChainManager();
    const session = {
      sessionBound: true,
      canInterrupt: false,
      canChangeSettings: true,
      permissionMode: "default",
      hasAssistantMessage: false,
      hasTurns: false,
      changesVisible: false,
      historyVisible: true,
      commitReady: false,
    };
    const gates = computeCommandCapabilities(
      source(chain, { sessionCardFrontmost: true, session }),
    );

    expect(gates["session.toggleChanges"].title).toBe("Show Session Changes");
    expect(gates["session.toggleHistory"].title).toBe("Hide Commit History");
  });

  test("the deck gates follow pane shape, including the deselected-deck hatch", () => {
    const chain = new ResponderChainManager();

    // One pane, one card, selected: nowhere to navigate, nothing to close all
    // of, and no stack to rotate.
    const single = computeCommandCapabilities(
      source(chain, {
        paneCount: 1,
        focusedPaneCardCount: 1,
        visibleCardCount: 1,
        focusedPaneActiveCardClosable: true,
        selectionActive: true,
        stackDepth: 1,
      }),
    );
    expect(single["file.closeCard"].enabled).toBe(true);
    expect(single["file.closeAllCardTabs"].enabled).toBe(false);
    expect(single["window.nextCard"].enabled).toBe(false);
    expect(single["window.nextCardInStack"].enabled).toBe(false);
    expect(single["window.revealStack"].enabled).toBe(false);

    // Same deck, deselected by a canvas click: navigation stays live so the
    // user can re-enter a card without the mouse.
    const deselected = computeCommandCapabilities(
      source(chain, {
        paneCount: 1,
        focusedPaneCardCount: 0,
        visibleCardCount: 1,
        selectionActive: false,
        stackDepth: 0,
      }),
    );
    expect(deselected["window.nextCard"].enabled).toBe(true);
    // The stack items take no such hatch: they act on a specific pane's
    // stack, and there is no such pane.
    expect(deselected["window.nextCardInStack"].enabled).toBe(false);
    expect(deselected["window.previousCardInStack"].enabled).toBe(false);
    expect(deselected["window.revealStack"].enabled).toBe(false);
  });

  test("the save family follows the frontmost Text card's gates", () => {
    const chain = new ResponderChainManager();

    const noCard = computeCommandCapabilities(source(chain));
    expect(noCard["file.save"].enabled).toBe(false);
    expect(noCard["file.saveAs"].enabled).toBe(false);
    expect(noCard["file.revertToSaved"].enabled).toBe(false);

    const dirty = computeCommandCapabilities(
      source(chain, {
        fileGates: { save: true, saveAs: true, saveACopy: true, revert: true, reload: true },
      }),
    );
    expect(dirty["file.save"].enabled).toBe(true);
    expect(dirty["file.revertToSaved"].enabled).toBe(true);
  });

  describe("the chord half", () => {
    const gated: CommandEntry = {
      id: TUG_ACTIONS.NEXT_TURN,
      title: "Next Turn",
      routing: "first-responder",
      menuItemId: "session.nextTurn",
      mirrored: true,
      validate: (chain) => chain.menu.session?.hasTurns ?? false,
      disabledChord: "detach",
    };
    const kept: CommandEntry = { ...gated, disabledChord: "keep" };
    const spec = { keyEquivalent: "\u{F701}", command: true, option: true };
    const chords = { "session.nextTurn": spec };

    test("an item the keymap has not claimed keeps the host's literal", () => {
      const gates = computeCommandCapabilities(
        source(new ResponderChainManager()),
        [gated],
        {},
      );
      // Absent, not null: null would clear a key equivalent the host chose.
      expect("chord" in gates["session.nextTurn"]).toBe(false);
    });

    test("a claimed item carries the chord while its command is applicable", () => {
      const facts = {
        sessionCardFrontmost: true,
        session: {
          sessionBound: true,
          canInterrupt: false,
          canChangeSettings: true,
          permissionMode: "default",
          hasAssistantMessage: true,
          hasTurns: true,
          changesVisible: false,
          historyVisible: false,
          commitReady: false,
        },
      };
      const gates = computeCommandCapabilities(
        source(new ResponderChainManager(), facts),
        [gated],
        chords,
      );
      expect(gates["session.nextTurn"].chord).toEqual(spec);
    });

    test("a detaching command releases the chord when it dims", () => {
      // A chord on a dimmed item is eaten at the menu bar with a beep, so
      // detaching is the difference between "inapplicable here" and "dead".
      const gates = computeCommandCapabilities(
        source(new ResponderChainManager()),
        [gated],
        chords,
      );
      expect(gates["session.nextTurn"].enabled).toBe(false);
      expect(gates["session.nextTurn"].chord).toBeNull();
    });

    test("a keeping command holds the chord even when it dims", () => {
      const gates = computeCommandCapabilities(
        source(new ResponderChainManager()),
        [kept],
        chords,
      );
      expect(gates["session.nextTurn"].enabled).toBe(false);
      expect(gates["session.nextTurn"].chord).toEqual(spec);
    });

    test("chordActive releases the chord without dimming the item", () => {
      // Save As… is the shipped case: enabled and chordless are not the same
      // state, so the question the chord asks is its own.
      const entry: CommandEntry = {
        id: TUG_ACTIONS.SAVE_AS,
        title: "Save As…",
        routing: "first-responder",
        menuItemId: "file.saveAs",
        mirrored: true,
        validate: () => true,
        chordActive: (chain) => chain.menu.fileGates !== null,
      };
      const saveAsChord = { keyEquivalent: "s", command: true, shift: true };
      const gates = computeCommandCapabilities(
        source(new ResponderChainManager()),
        [entry],
        { "file.saveAs": saveAsChord },
      );
      expect(gates["file.saveAs"].enabled).toBe(true);
      expect(gates["file.saveAs"].chord).toBeNull();
    });
  });

  test("the shipped table publishes a gate for every item it has moved", () => {
    // Every mirrored entry in the real table must be keyed and answerable —
    // a mirrored entry that produced no gate would leave its item on a tier
    // that the same change deleted.
    const chain = new ResponderChainManager();
    const gates = computeCommandCapabilities(source(chain));
    const mirrored = COMMANDS.filter(
      (entry) =>
        entry.mirrored === true &&
        entry.menuItemId !== undefined &&
        entry.parameterized !== true,
    );

    for (const entry of mirrored) {
      expect(gates[entry.menuItemId as string], `${entry.id} publishes a gate`).toBeDefined();
      expect(gates[entry.menuItemId as string].enabled, `${entry.id} answers`).toBeBoolean();
    }

    // The rest of the block is chord-only: entries whose key equivalent the
    // keymap states while their enablement stays the host's. Each must say
    // nothing about enablement, or it would light an item its own tier gates.
    const chordOnly = Object.entries(gates).filter(
      ([id]) => !mirrored.some((entry) => entry.menuItemId === id),
    );
    for (const [id, gate] of chordOnly) {
      expect(gate.enabled, `${id} carries a chord and no verdict`).toBeUndefined();
      expect("chord" in gate, `${id} carries a chord`).toBe(true);
    }
  });
});
