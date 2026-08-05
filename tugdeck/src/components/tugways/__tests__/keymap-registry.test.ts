/**
 * keymap-registry — who actually gets a chord.
 *
 * Every case here is a world built out of the four layers by hand, because
 * the answer depends entirely on which layers are present and what state
 * they are in. The load-bearing cases are the native ones: an enabled menu
 * item takes a chord from a scoped binding that has focus, a disabled one
 * takes it from everybody and gives it to nobody, and a hidden menu takes
 * nothing at all.
 */

import { describe, expect, test } from "bun:test";

import {
  applyStackChordPreference,
  commandShortcut,
  commandShortcuts,
  EMPTY_KEYMAP_ENVIRONMENT,
  KeymapRegistry,
  type KeymapEnvironment,
  type NativeChordClaim,
  type ScopedBinding,
} from "../keymap-registry";
import {
  COMMANDS,
  GLOBAL_SCOPE,
  STACK_CHORD,
  type Chord,
  type CommandEntry,
} from "../command-registry";
import { TUG_ACTIONS } from "../action-vocabulary";
import { ResponderChainManager } from "../responder-chain";
import { formatChord } from "../chord-format";

const DIGIT_1: Chord = { key: "Digit1", meta: true, label: "1" };

/** A table with one global binding on ⌘1, standing in for move-to-slot:1. */
const FIXTURE: readonly CommandEntry[] = [
  {
    id: "deck.slot1",
    title: "Move Card to Slot 1",
    routing: "first-responder",
    action: TUG_ACTIONS.MOVE_TO_SLOT,
    payload: 1,
    bindings: [{ chord: DIGIT_1, scope: GLOBAL_SCOPE, source: "default" }],
  },
];

function envWith(
  scoped: readonly ScopedBinding[] = [],
  native: readonly NativeChordClaim[] = [],
): KeymapEnvironment {
  return { scopedBindings: () => scoped, nativeChords: () => native };
}

function registryWith(
  scoped: readonly ScopedBinding[] = [],
  native: readonly NativeChordClaim[] = [],
): KeymapRegistry {
  const registry = new KeymapRegistry(FIXTURE);
  registry.setEnvironment(envWith(scoped, native));
  return registry;
}

const PDF_PAGE_BINDING: ScopedBinding = {
  commandId: "pdf.firstPage",
  chord: DIGIT_1,
  scope: { kind: "responder", responderId: "pdf-view" },
  depth: 1,
};

const MODE_BINDING: ScopedBinding = {
  commandId: "sheet.firstField",
  chord: DIGIT_1,
  scope: { kind: "mode", modeId: "commit-sheet" },
  depth: 0,
};

function nativeClaim(over: Partial<NativeChordClaim> = {}): NativeChordClaim {
  return {
    menuItemId: "window.slot1",
    commandId: "deck.slot1",
    chord: DIGIT_1,
    enabled: true,
    claims: true,
    ...over,
  };
}

describe("the JS layers, innermost first", () => {
  test("an unbound chord answers an empty stack", () => {
    const registry = registryWith();
    expect(registry.resolveChord({ key: "KeyQ", ctrl: true, alt: true })).toEqual([]);
  });

  test("global alone wins", () => {
    const stack = registryWith().resolveChord(DIGIT_1);
    expect(stack.map((r) => r.commandId)).toEqual(["deck.slot1"]);
    expect(stack[0].active).toBe(true);
    expect(stack[0].shadowedBy).toBeUndefined();
  });

  test("a responder binding shadows global, and the loser names the winner", () => {
    const stack = registryWith([PDF_PAGE_BINDING]).resolveChord(DIGIT_1);
    expect(stack.map((r) => r.commandId)).toEqual(["pdf.firstPage", "deck.slot1"]);
    expect(stack[0].active).toBe(true);
    expect(stack[1].active).toBe(false);
    expect(stack[1].shadowedBy?.commandId).toBe("pdf.firstPage");
  });

  test("a mode binding shadows a responder binding shadows global", () => {
    const stack = registryWith([PDF_PAGE_BINDING, MODE_BINDING]).resolveChord(DIGIT_1);
    expect(stack.map((r) => r.commandId)).toEqual([
      "sheet.firstField",
      "pdf.firstPage",
      "deck.slot1",
    ]);
    expect(stack.filter((r) => r.active)).toHaveLength(1);
    expect(stack[0].active).toBe(true);
    for (const loser of stack.slice(1)) {
      expect(loser.shadowedBy?.commandId).toBe("sheet.firstField");
    }
  });
});

describe("the native layer sits above all three ([P15])", () => {
  test("an enabled menu item takes the chord from a scoped binding that has focus", () => {
    // This is the ⌘1-⌘9 / PDF-card case `pdf-view.tsx` reasons about by
    // hand: AppKit resolves the key equivalent before the web view sees a
    // keydown, so focus does not enter into it.
    const stack = registryWith([PDF_PAGE_BINDING], [nativeClaim()]).resolveChord(DIGIT_1);
    expect(stack[0].layer.kind).toBe("native");
    expect(stack[0].active).toBe(true);
    expect(stack.slice(1).every((r) => !r.active)).toBe(true);
    expect(stack[1].shadowedBy?.layer.kind).toBe("native");
    expect(stack[1].shadowedBy?.commandId).toBe("deck.slot1");
  });

  test("a disabled menu item eats the chord: nothing below it is reachable", () => {
    // Not a fallthrough. The chord is dead in the app, which is a third
    // state the pane has to name rather than attributing the chord to the
    // first JS binding.
    const stack = registryWith(
      [PDF_PAGE_BINDING],
      [nativeClaim({ enabled: false })],
    ).resolveChord(DIGIT_1);
    expect(stack.some((r) => r.active)).toBe(false);
    expect(stack[1].shadowedBy?.commandId).toBe("deck.slot1");
    expect(stack[2].shadowedBy?.layer.kind).toBe("native");
  });

  test("a hidden menu's item claims nothing, and the JS layers resolve normally", () => {
    // The Maker menu when maker mode is off: its chords fall through.
    const stack = registryWith(
      [PDF_PAGE_BINDING],
      [nativeClaim({ claims: false })],
    ).resolveChord(DIGIT_1);
    expect(stack[0].layer.kind).toBe("native");
    expect(stack[0].active).toBe(false);
    expect(stack[0].shadowedBy).toBeUndefined();
    expect(stack[1].commandId).toBe("pdf.firstPage");
    expect(stack[1].active).toBe(true);
    expect(stack[2].shadowedBy?.commandId).toBe("pdf.firstPage");
  });
});

describe("bindingsFor", () => {
  test("a live binding reports active with no shadower", () => {
    const [resolved] = registryWith().bindingsFor("deck.slot1");
    expect(resolved.active).toBe(true);
    expect(resolved.shadowedBy).toBeUndefined();
  });

  test("a shadowed binding is inactive and names its winner", () => {
    const [resolved] = registryWith([MODE_BINDING]).bindingsFor("deck.slot1");
    expect(resolved.active).toBe(false);
    expect(resolved.shadowedBy?.commandId).toBe("sheet.firstField");
  });

  test("a command whose own menu item carries the chord is active, not shadowed", () => {
    const [resolved] = registryWith([], [nativeClaim()]).bindingsFor("deck.slot1");
    expect(resolved.active).toBe(true);
  });

  test("a command whose own item validates disabled is dark, not shadowed", () => {
    // "Disabled" and "somebody else took it" are different sentences, and
    // the pane says the wrong one if this collapses them.
    const [resolved] = registryWith([], [nativeClaim({ enabled: false })]).bindingsFor(
      "deck.slot1",
    );
    expect(resolved.active).toBe(false);
    expect(resolved.shadowedBy).toBeUndefined();
  });
});

describe("matchChord reads the global layer", () => {
  const registry = registryWith();
  const event = (over: Partial<KeyboardEvent> = {}) =>
    ({
      code: "Digit1",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
      ...over,
    }) as KeyboardEvent;

  test("resolves a bound chord to its command", () => {
    expect(registry.matchChord(event())?.commandId).toBe("deck.slot1");
  });

  test("modifier state is exact", () => {
    expect(registry.matchChord(event({ shiftKey: true }))).toBeNull();
  });

  test("an override replaces the default, and unbinding clears it", () => {
    const local = registryWith();
    local.setBindings("deck.slot1", [
      { chord: { key: "Digit2", meta: true }, scope: GLOBAL_SCOPE, source: "user" },
    ]);
    expect(local.matchChord(event())).toBeNull();
    expect(local.matchChord(event({ code: "Digit2" }))?.commandId).toBe("deck.slot1");

    // An empty list is "explicitly unbound", not "no override".
    local.setBindings("deck.slot1", []);
    expect(local.matchChord(event({ code: "Digit2" }))).toBeNull();

    local.setBindings("deck.slot1", null);
    expect(local.matchChord(event())?.commandId).toBe("deck.slot1");
  });

  test("a binding change bumps the snapshot so React readers re-render", () => {
    const local = registryWith();
    let notified = 0;
    local.subscribe(() => {
      notified += 1;
    });
    const before = local.getSnapshot();
    local.setBindings("deck.slot1", []);
    expect(local.getSnapshot()).not.toBe(before);
    expect(notified).toBe(1);
  });
});

describe("menuChords", () => {
  const registry = new KeymapRegistry(COMMANDS);
  registry.setEnvironment(EMPTY_KEYMAP_ENVIRONMENT);
  const chords = registry.menuChords();

  test("publishes the promoted rows' converted chords", () => {
    expect(chords["session.previousTurn"]).toEqual({
      keyEquivalent: "\u{F700}",
      command: true,
      option: true,
    });
    expect(chords["session.commandPicker"]).toEqual({
      keyEquivalent: "/",
      command: true,
    });
    expect(chords["maker.devTools"]).toEqual({
      keyEquivalent: "/",
      command: true,
      option: true,
    });
  });

  test("says nothing about items whose chord is a construction-time literal", () => {
    // Absence on the wire means "leave the key equivalent alone". Publishing
    // a chord for every menu-driving command would make the sweep a second
    // author on chords the host already owns.
    expect("session.focusPrompt" in chords).toBe(false);
    expect("file.save" in chords).toBe(false);
  });

  test("a command that had a menu-eligible chord and lost it publishes null", () => {
    // `null` detaches — how a rebound-away or unbound command releases its
    // key equivalent, and the state the ⌘R depth gate needs.
    const local = new KeymapRegistry(COMMANDS);
    local.setBindings(TUG_ACTIONS.OPEN_COMMAND_PICKER, []);
    expect(local.menuChords()["session.commandPicker"]).toBeNull();
  });

  test("a command handed a chord it never declared releases it again", () => {
    // The claim is what makes a release possible, so it has to survive the
    // chord that created it. Reveal Stack is the shipped case: it holds ⌘R
    // only under the preference, and going back has to say so out loud or
    // the host keeps the key equivalent the preference just took away.
    const local = new KeymapRegistry(COMMANDS);
    expect("window.revealStack" in local.menuChords()).toBe(false);

    local.setBindings(TUG_ACTIONS.REVEAL_STACK, [STACK_CHORD]);
    expect(local.menuChords()["window.revealStack"]).toEqual({
      keyEquivalent: "r",
      command: true,
    });

    local.setBindings(TUG_ACTIONS.REVEAL_STACK, []);
    expect(local.menuChords()["window.revealStack"]).toBeNull();
  });
});

describe("scoped bindings the table can see", () => {
  test("⇧⌘M resolves to the commit-mode auto-message command", () => {
    // It used to be a raw capture listener on the composer root: invisible to
    // resolveChord, to the keymap pane, and to the collision lint, so nothing
    // could tell you the chord was taken until you pressed it. Stating it in
    // the table is what makes it answerable.
    const registry = new KeymapRegistry(COMMANDS);
    registry.setEnvironment(EMPTY_KEYMAP_ENVIRONMENT);
    const [binding] = registry.bindingsOf(TUG_ACTIONS.COMMIT_AUTO_MESSAGE);
    expect(binding, "the command declares a chord").toBeDefined();
    expect(formatChord(binding.chord)).toBe("⇧⌘M");
    expect(binding.scope.kind, "and it is scoped, not global").toBe("responder");
  });

  test("a scoped chord stays out of the global layer", () => {
    // Declared, but not live everywhere: ⇧⌘M outside commit mode belongs to
    // nobody, and a global index entry would claim it app-wide.
    const registry = new KeymapRegistry(COMMANDS);
    const event = {
      code: "KeyM",
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent;
    expect(registry.matchChord(event)).toBeNull();
  });
});

describe("commandShortcut", () => {
  test("renders a command's first binding", () => {
    expect(commandShortcut(TUG_ACTIONS.COPY_AS_PLAIN_TEXT)).toBe("⌥⇧⌘C");
  });

  test("a command with no binding renders nothing", () => {
    expect(commandShortcut(TUG_ACTIONS.SAVE_A_COPY)).toBeUndefined();
  });

  test("commandShortcuts names every chord, not just the winner", () => {
    // Cancel is reachable two ways and a help sheet that shows one is telling
    // half the truth to the reader who is there to learn.
    expect(commandShortcuts(TUG_ACTIONS.CANCEL_DIALOG)).toBe("⌘. / ⎋");
  });
});

describe("applyStackChordPreference", () => {
  test("⌘R sits on Cycle Stack by default", () => {
    const local = new KeymapRegistry(COMMANDS);
    applyStackChordPreference("cycle", local);
    const chords = local.menuChords();
    expect(chords["window.cycleStack"]).toEqual({ keyEquivalent: "r", command: true });
    // Absent rather than null: Reveal Stack has never held the chord, and
    // its item was built without one, so there is nothing to release.
    expect("window.revealStack" in chords).toBe(false);
  });

  test("the preference moves the chord, and both sides move with it", () => {
    // One rewrite, three consumers: the item that gains the chord, the item
    // that loses it, and the JS lookup. A preference that moved only the
    // menu bar would leave ⌘R meaning two different things.
    const local = new KeymapRegistry(COMMANDS);
    applyStackChordPreference("reveal", local);
    const chords = local.menuChords();
    expect(chords["window.revealStack"]).toEqual({ keyEquivalent: "r", command: true });
    expect(chords["window.cycleStack"]).toBeNull();

    const event = {
      code: "KeyR",
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent;
    expect(local.matchChord(event)?.commandId).toBe(TUG_ACTIONS.REVEAL_STACK);
  });

  test("flipping back restores the default holder", () => {
    const local = new KeymapRegistry(COMMANDS);
    applyStackChordPreference("reveal", local);
    applyStackChordPreference("cycle", local);
    const chords = local.menuChords();
    expect(chords["window.cycleStack"]).toEqual({ keyEquivalent: "r", command: true });
    expect(chords["window.revealStack"]).toBeNull();
  });
});

describe("the collision lint ([P15])", () => {
  test("a scoped binding under a menu-eligible chord is reported dead", () => {
    const registry = new KeymapRegistry([
      {
        ...FIXTURE[0],
        bindings: [{ chord: DIGIT_1, scope: GLOBAL_SCOPE, source: "default", menuEligible: true }],
      },
    ]);
    const problems = registry.lintChordCollisions([PDF_PAGE_BINDING]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("pdf.firstPage");
    expect(problems[0]).toContain("deck.slot1");
  });

  test("a scoped binding under a chord no menu item claims is fine", () => {
    expect(registryWith().lintChordCollisions([PDF_PAGE_BINDING])).toEqual([]);
  });

  test("the shipped table collides with nothing the app registers today", () => {
    // The two scoped registrations in the app: the PDF card's page keys and
    // the gallery's demo chord. Transcribed rather than mounted, because the
    // question is about the table, not about React.
    const registry = new KeymapRegistry(COMMANDS);
    const shippedScopes: ScopedBinding[] = [
      { commandId: "pdf.pageDown", chord: { key: "PageDown" }, scope: { kind: "responder", responderId: "pdf" }, depth: 1 },
      { commandId: "pdf.pageUp", chord: { key: "PageUp" }, scope: { kind: "responder", responderId: "pdf" }, depth: 1 },
      { commandId: "gallery.demo", chord: { key: "KeyY", meta: true, shift: true }, scope: { kind: "responder", responderId: "gallery" }, depth: 1 },
    ];
    expect(registry.lintChordCollisions(shippedScopes)).toEqual([]);
  });
});

describe("the JS order is the order the pipeline actually resolves", () => {
  /**
   * The three JS layers are described twice — once by `resolveKeybinding`,
   * which decides what fires, and once by `resolveChord`, which says who
   * would win. Two descriptions of one order is exactly the drift this
   * module exists to end, so both are driven against one real chain and
   * their answers compared.
   */
  function chainWithNesting(): ResponderChainManager {
    const chain = new ResponderChainManager();
    chain.register({ id: "root", parentId: null, actions: {} });
    chain.register({ id: "card", parentId: "root", actions: {} });
    chain.register({ id: "leaf", parentId: "card", actions: {} });
    chain.makeFirstResponder("leaf");
    return chain;
  }

  const CHORD = { key: "KeyY", meta: true, shift: true };

  function environmentFor(
    chain: ResponderChainManager,
    modes: readonly string[],
  ): KeymapEnvironment {
    return {
      scopedBindings: () =>
        chain.liveKeybindings(modes).map((live) => ({
          commandId: live.binding.action,
          chord: live.binding,
          scope:
            live.kind === "mode"
              ? { kind: "mode" as const, modeId: live.scopeId }
              : { kind: "responder" as const, responderId: live.scopeId },
          depth: live.depth,
        })),
      nativeChords: () => [],
    };
  }

  function keyEvent(): KeyboardEvent {
    return {
      code: CHORD.key,
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent;
  }

  test("innermost responder wins in both, and the outer one names it", () => {
    const chain = chainWithNesting();
    chain.registerKeybinding("card", () => [{ ...CHORD, action: TUG_ACTIONS.CLOSE }]);
    chain.registerKeybinding("leaf", () => [{ ...CHORD, action: TUG_ACTIONS.SUBMIT }]);

    const registry = new KeymapRegistry(FIXTURE);
    registry.setEnvironment(environmentFor(chain, []));

    expect(chain.resolveKeybinding(keyEvent())?.action).toBe(TUG_ACTIONS.SUBMIT);
    const stack = registry.resolveChord(CHORD);
    expect(stack.find((r) => r.active)?.commandId).toBe(TUG_ACTIONS.SUBMIT);
    expect(stack.find((r) => r.commandId === TUG_ACTIONS.CLOSE)?.shadowedBy?.commandId).toBe(
      TUG_ACTIONS.SUBMIT,
    );
  });

  test("a pushed focus mode outranks the whole responder walk in both", () => {
    const chain = chainWithNesting();
    chain.registerKeybinding("leaf", () => [{ ...CHORD, action: TUG_ACTIONS.SUBMIT }]);
    chain.registerKeybinding(
      "sheet",
      () => [{ ...CHORD, action: TUG_ACTIONS.CANCEL_DIALOG }],
      "mode",
    );

    const registry = new KeymapRegistry(FIXTURE);
    registry.setEnvironment(environmentFor(chain, ["sheet"]));

    expect(chain.resolveKeybinding(keyEvent(), ["sheet"])?.action).toBe(
      TUG_ACTIONS.CANCEL_DIALOG,
    );
    expect(registry.resolveChord(CHORD).find((r) => r.active)?.commandId).toBe(
      TUG_ACTIONS.CANCEL_DIALOG,
    );
  });

  test("with the mode gone, both fall back to the responder walk", () => {
    const chain = chainWithNesting();
    chain.registerKeybinding("leaf", () => [{ ...CHORD, action: TUG_ACTIONS.SUBMIT }]);
    chain.registerKeybinding(
      "sheet",
      () => [{ ...CHORD, action: TUG_ACTIONS.CANCEL_DIALOG }],
      "mode",
    );

    const registry = new KeymapRegistry(FIXTURE);
    registry.setEnvironment(environmentFor(chain, []));

    expect(chain.resolveKeybinding(keyEvent(), [])?.action).toBe(TUG_ACTIONS.SUBMIT);
    expect(registry.resolveChord(CHORD).find((r) => r.active)?.commandId).toBe(
      TUG_ACTIONS.SUBMIT,
    );
  });

  test("a binding on a responder off the walk is invisible to both", () => {
    const chain = chainWithNesting();
    chain.register({ id: "elsewhere", parentId: "root", actions: {} });
    chain.registerKeybinding("elsewhere", () => [{ ...CHORD, action: TUG_ACTIONS.SUBMIT }]);

    const registry = new KeymapRegistry(FIXTURE);
    registry.setEnvironment(environmentFor(chain, []));

    expect(chain.resolveKeybinding(keyEvent(), [])).toBeNull();
    expect(registry.resolveChord(CHORD)).toEqual([]);
  });
});
