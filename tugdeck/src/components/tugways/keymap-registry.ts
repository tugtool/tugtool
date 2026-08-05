/**
 * keymap-registry.ts — funnel #2: the one place a chord becomes a command.
 *
 * The command registry says what a command's default bindings are; this
 * module answers the questions a keyboard raises about them. Two of those
 * questions are cheap and one is the reason the module exists:
 *
 * - `matchChord` — the global layer's O(1) lookup, what the key pipeline runs
 *   on every keydown.
 * - `menuChords` — which chord each menu item should carry, for the push.
 * - `resolveChord` — **who actually gets this chord**, as an ordered stack
 *   with a winner and a shadower per loser.
 *
 * ## Why shadowing is the point
 *
 * A chord in Tug can be claimed at four layers, and they are not peers. In
 * the shipped app AppKit resolves an `NSMenuItem` key equivalent *before the
 * web view sees a keydown at all*, so a menu-eligible chord preempts every
 * scoped binding regardless of focus ([P15]). Below that, the JS pipeline
 * resolves focus mode first, then the responder walk innermost-first, then
 * global ([P08]).
 *
 * The codebase already knows this and reasons about it by hand: `pdf-view.tsx`
 * declines ⌘1–⌘3 because the deck wants them, and declines the zoom chords
 * outright because "they belong to the host's View menu and never reach the
 * web view at all." That comment is a hand-maintained shadowing analysis.
 * `resolveChord` is what answers it instead.
 *
 * ## What this module cannot see, and takes as input
 *
 * Two of the four layers are runtime facts owned elsewhere: scoped bindings
 * live in the components that declare them (read through the responder
 * chain), and a menu item's live enablement lives in the menu-state mirror.
 * A registry that imported either would be a cycle, and one that cached
 * either would be stale. So they arrive through a {@link KeymapEnvironment}
 * the registry is handed — which is also what lets every resolution case be
 * unit-tested against a constructed multi-layer world.
 */

import type { Chord, CommandBinding, CommandEntry, BindingScope } from "./command-registry";
import { COMMANDS } from "./command-registry";
import { chordKey, codeToKeyEquivalent, eventChordKey, type ChordSpec } from "./chord-format";

/* ---------------------------------------------------------------------------
 * What resolveChord answers (Spec S02)
 * ------------------------------------------------------------------------- */

/** Which layer a claim on a chord lives at. */
export type ResolutionLayer =
  /**
   * An `NSMenuItem` carries this chord. AppKit resolves it before the web
   * view sees a keydown, so this layer sits above all three JS layers.
   */
  | {
      readonly kind: "native";
      readonly menuItemId: string;
      /**
       * The item validates enabled. `false` means the chord is eaten at the
       * menu bar with a beep and reaches nothing at all — it does **not**
       * fall through.
       */
      readonly enabled: boolean;
      /**
       * The enclosing menu is visible, or carries
       * `allowsKeyEquivalentWhenHidden`. `false` means the chord falls
       * through to the JS layers — the Maker menu's state when maker mode
       * is off.
       */
      readonly claims: boolean;
    }
  | { readonly kind: "js"; readonly scope: BindingScope };

export interface ChordResolution {
  readonly commandId: string;
  readonly layer: ResolutionLayer;
  /** This claim is the one that fires. */
  readonly active: boolean;
  /** The claim that took the chord instead. Absent on the winner. */
  readonly shadowedBy?: {
    readonly commandId: string;
    readonly layer: ResolutionLayer;
  };
}

/* ---------------------------------------------------------------------------
 * The environment: the two layers the registry cannot see for itself
 * ------------------------------------------------------------------------- */

/** A binding the responder chain currently has registered under a scope. */
export interface ScopedBinding {
  readonly commandId: string;
  readonly chord: Chord;
  readonly scope: BindingScope;
  /**
   * Resolution distance: 0 is the innermost claimant. A focus mode is
   * innermost of all, then the responder walk from the first responder up.
   * The pipeline resolves smallest-first, so this is the sort key.
   */
  readonly depth: number;
}

/** A menu item's live claim on a chord. */
export interface NativeChordClaim {
  readonly menuItemId: string;
  readonly commandId: string;
  readonly chord: Chord;
  readonly enabled: boolean;
  readonly claims: boolean;
}

/**
 * The runtime world a resolution is answered against. Both halves are read
 * fresh on every call — a cached answer here is a keymap pane confidently
 * showing what was true when the card opened.
 */
export interface KeymapEnvironment {
  scopedBindings(): readonly ScopedBinding[];
  nativeChords(): readonly NativeChordClaim[];
}

/** The world before anything has registered: JS global bindings only. */
export const EMPTY_KEYMAP_ENVIRONMENT: KeymapEnvironment = {
  scopedBindings: () => [],
  nativeChords: () => [],
};

/* ---------------------------------------------------------------------------
 * The registry
 * ------------------------------------------------------------------------- */

/** A command's binding, with the command it belongs to. */
export interface KeymapBinding {
  readonly commandId: string;
  readonly binding: CommandBinding;
}

/** A binding plus whether it is the one that actually fires right now. */
export interface ResolvedBinding {
  readonly binding: CommandBinding;
  readonly active: boolean;
  readonly shadowedBy?: { readonly commandId: string; readonly layer: ResolutionLayer };
}

export class KeymapRegistry {
  private entries: readonly CommandEntry[];
  /** Merged default + override binding lists, keyed by command id. */
  private bindings: Map<string, readonly CommandBinding[]>;
  /** Global-layer chord → binding. First writer wins, matching the old scan. */
  private globalIndex: Map<string, KeymapBinding>;
  private environment: KeymapEnvironment = EMPTY_KEYMAP_ENVIRONMENT;
  private readonly subscribers = new Set<() => void>();
  private version = 0;

  constructor(entries: readonly CommandEntry[] = COMMANDS) {
    this.entries = entries;
    this.bindings = new Map();
    this.globalIndex = new Map();
    this.rebuild();
  }

  /** Point the registry at the live scoped-binding and menu-chord sources. */
  setEnvironment(environment: KeymapEnvironment): void {
    this.environment = environment;
  }

  /**
   * Replace a command's bindings — the seam a user override writes through.
   * An empty list is "explicitly unbound", which is a different fact from
   * having no override at all ([P14]); `null` restores the table's default.
   */
  setBindings(commandId: string, bindings: readonly CommandBinding[] | null): void {
    if (bindings === null) {
      const entry = this.entries.find((e) => e.id === commandId);
      if (entry?.bindings === undefined) this.bindings.delete(commandId);
      else this.bindings.set(commandId, entry.bindings);
    } else {
      this.bindings.set(commandId, bindings);
    }
    this.reindex();
    this.notify();
  }

  // ---- Subscription ([L02]) ----

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Bumps on every binding change, so React readers can `useSyncExternalStore`. */
  getSnapshot(): number {
    return this.version;
  }

  // ---- Reads ----

  /**
   * The global-layer command for an event, or `null`.
   *
   * Only the global layer: the mode and responder layers are resolved by the
   * chain, ahead of this call, because they need the live focus walk. That
   * split is what stage 1 already does, and formalizing it here changes no
   * order.
   */
  matchChord(event: KeyboardEvent): KeymapBinding | null {
    return this.globalIndex.get(eventChordKey(event)) ?? null;
  }

  /** Every binding on a command, defaults merged with any override. */
  bindingsOf(commandId: string): readonly CommandBinding[] {
    return this.bindings.get(commandId) ?? [];
  }

  /**
   * A command's bindings, each marked with whether it is the one that fires.
   *
   * A command can hold a chord and still never see it — that is the whole
   * point of asking. The keymap row that says "⌘1" without saying "the
   * Window menu takes this first" is the lie [P11] retires.
   */
  bindingsFor(commandId: string): ResolvedBinding[] {
    return this.bindingsOf(commandId).map((binding) => {
      const stack = this.resolveChord(binding.chord);
      const winner = stack.find((r) => r.active);
      // The question is "does pressing this fire this command", not "does
      // this particular row win" — a promoted command's chord fires through
      // its menu item, and reporting that as shadowed would be backwards.
      if (winner !== undefined && winner.commandId === commandId) {
        return { binding, active: true };
      }
      // No winner and a native claim in the stack means the chord is eaten
      // at the menu bar. If the eater is this command's own item, the chord
      // is not shadowed — it is disabled, which is a different sentence.
      const blocker =
        winner ??
        stack.find(
          (r) => r.layer.kind === "native" && r.layer.claims && !r.layer.enabled,
        );
      return {
        binding,
        active: false,
        ...(blocker !== undefined && blocker.commandId !== commandId
          ? { shadowedBy: { commandId: blocker.commandId, layer: blocker.layer } }
          : {}),
      };
    });
  }

  /**
   * The full claim stack for a chord, outermost layer first ([P15]).
   *
   * Order: the native menu, then focus mode, then the responder walk
   * innermost-first, then global. The first claim that can take the chord
   * is `active`; every claim after it names that winner as its `shadowedBy`.
   *
   * Three native states, and all three are different answers:
   *
   * - `claims: false` — the item's menu is hidden without
   *   `allowsKeyEquivalentWhenHidden`, so it neither fires nor blocks. It is
   *   listed (the pane should say the chord changes meaning in maker mode)
   *   but wins nothing and shadows nothing.
   * - `claims: true, enabled: false` — the chord is eaten at the menu bar
   *   with a beep. Nothing below is reachable, and nothing is active: the
   *   chord is dead in the app. Attributing it to the first JS binding
   *   would be a lie in the one surface whose job is to be believed.
   * - `claims: true, enabled: true` — it fires, and shadows everything.
   */
  resolveChord(chord: Chord): ChordResolution[] {
    const key = chordKey(chord);
    const stack: Array<{ commandId: string; layer: ResolutionLayer }> = [];

    for (const claim of this.environment.nativeChords()) {
      if (chordKey(claim.chord) !== key) continue;
      stack.push({
        commandId: claim.commandId,
        layer: {
          kind: "native",
          menuItemId: claim.menuItemId,
          enabled: claim.enabled,
          claims: claim.claims,
        },
      });
    }

    const scoped = this.environment
      .scopedBindings()
      .filter((b) => chordKey(b.chord) === key)
      .slice()
      .sort((a, b) => a.depth - b.depth);
    for (const b of scoped) {
      stack.push({ commandId: b.commandId, layer: { kind: "js", scope: b.scope } });
    }

    for (const [id, list] of this.bindings) {
      for (const binding of list) {
        if (binding.scope.kind !== "global") continue;
        if (chordKey(binding.chord) !== key) continue;
        stack.push({ commandId: id, layer: { kind: "js", scope: binding.scope } });
      }
    }

    // One pass: the first claim that can take the chord wins, and a native
    // item that eats it without firing blocks everything below without
    // winning either.
    let winner: { commandId: string; layer: ResolutionLayer } | null = null;
    let eater: { commandId: string; layer: ResolutionLayer } | null = null;
    const resolved: ChordResolution[] = [];
    for (const claim of stack) {
      const blocker = winner ?? eater;
      if (blocker !== null) {
        resolved.push({
          commandId: claim.commandId,
          layer: claim.layer,
          active: false,
          shadowedBy: { commandId: blocker.commandId, layer: blocker.layer },
        });
        continue;
      }
      if (claim.layer.kind === "native" && !claim.layer.claims) {
        // Present, but its menu is hidden: it takes nothing and blocks
        // nothing, so the JS layers below resolve as [P08] states.
        resolved.push({ commandId: claim.commandId, layer: claim.layer, active: false });
        continue;
      }
      if (claim.layer.kind === "native" && !claim.layer.enabled) {
        eater = claim;
        resolved.push({ commandId: claim.commandId, layer: claim.layer, active: false });
        continue;
      }
      winner = claim;
      resolved.push({ commandId: claim.commandId, layer: claim.layer, active: true });
    }
    return resolved;
  }

  /**
   * Which chord each menu item should carry — what the mirror publishes.
   *
   * An item appears here only when its command declares a `menuEligible`
   * binding, because absence on the wire means "leave the constructed key
   * equivalent alone" (Spec S03). A command that *had* menu-eligible
   * bindings and now has none publishes `null`, which detaches: that is how
   * a rebound-away command releases its chord.
   *
   * Enablement is not consulted here. A `disabledChord: "detach"` command
   * releases its chord while it validates disabled, and only the publisher
   * knows what validated — so it applies that rule over this answer.
   */
  menuChords(): Record<string, ChordSpec | null> {
    const out: Record<string, ChordSpec | null> = {};
    for (const entry of this.entries) {
      if (entry.menuItemId === undefined) continue;
      const declaresEligible = (entry.bindings ?? []).some((b) => b.menuEligible === true);
      const live = this.bindingsOf(entry.id).find((b) => b.menuEligible === true);
      if (live !== undefined) {
        // An `NSMenuItem` carries exactly one key equivalent, so the first
        // eligible binding is the menu's and the rest live in the JS funnel.
        out[entry.menuItemId] = codeToKeyEquivalent(live.chord);
      } else if (declaresEligible) {
        out[entry.menuItemId] = null;
      }
    }
    return out;
  }

  // ---- Lints ----

  /**
   * The collision lint ([P15]): a `menuEligible` binding that shares a chord
   * with a scoped binding.
   *
   * This is the one collision the shadowing model cannot soften. A scoped
   * binding loses to a menu item unconditionally and from anywhere — not
   * "when the menu is open", not "when focus is outside the card" — so the
   * scoped binding is not shadowed, it is dead. Promoting a command to the
   * menu bar is therefore a decision about every surface that wanted that
   * chord, and this is what makes that decision visible instead of silent.
   */
  lintChordCollisions(scoped: readonly ScopedBinding[] = this.environment.scopedBindings()): string[] {
    const eligible = new Map<string, string>();
    for (const [id, list] of this.bindings) {
      for (const binding of list) {
        if (binding.menuEligible !== true) continue;
        eligible.set(chordKey(binding.chord), id);
      }
    }
    const problems: string[] = [];
    for (const b of scoped) {
      const owner = eligible.get(chordKey(b.chord));
      if (owner === undefined || owner === b.commandId) continue;
      problems.push(
        `${b.commandId}'s scoped binding on ${chordKey(b.chord)} is dead: the menu item for ${owner} takes that chord before the web view sees it`,
      );
    }
    return problems;
  }

  // ---- Internals ----

  private rebuild(): void {
    this.bindings = new Map();
    for (const entry of this.entries) {
      if (entry.bindings !== undefined && entry.bindings.length > 0) {
        this.bindings.set(entry.id, entry.bindings);
      }
    }
    this.reindex();
  }

  private reindex(): void {
    const index = new Map<string, KeymapBinding>();
    for (const [commandId, list] of this.bindings) {
      for (const binding of list) {
        if (binding.scope.kind !== "global") continue;
        const key = chordKey(binding.chord);
        if (!index.has(key)) index.set(key, { commandId, binding });
      }
    }
    this.globalIndex = index;
  }

  private notify(): void {
    this.version += 1;
    for (const subscriber of this.subscribers) subscriber();
  }
}

/** The app's registry. Tests construct their own over a fixture table. */
export const keymapRegistry = new KeymapRegistry();
