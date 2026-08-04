/**
 * stack-chord-store.ts — which command ⌘R runs on a slot's stack.
 *
 * A slot holds a stack of panes and two different gestures want the same
 * chord. **Cycle** brings the buried-longest pane forward and nothing else
 * appears on screen: no-look switching, where a depth-N slot returns home
 * after N presses. **Reveal** opens the title-bar picker and lets the user
 * read the stack before choosing. Neither is obviously right — cycling wins
 * once you know what is in the slot, revealing wins while you are still
 * learning it — so the chord is a preference rather than a verdict, and both
 * commands stay in the Window menu whichever way it is set. Only the key
 * equivalent moves.
 *
 * The value rides the menu-state payload to the host, because AppKit resolves
 * a menu key equivalent before the `WKWebView` sees the keydown: the chord
 * cannot be reassigned anywhere except on the `NSMenuItem`s themselves.
 *
 * Persistence rides tugbank defaults (`dev.tugtool.app` / `stackChord`), the
 * same feed as the theme and the keyboard-access mode; there is no
 * `localStorage`. Boot seeds the store from the DEFAULTS snapshot; a live
 * remote write arrives through the DEFAULTS push and is applied with
 * `persist: false` to avoid an echo loop.
 *
 * Laws: [L02] subscribable store consumed through `useSyncExternalStore`;
 * [L24] structure-zone state — read by non-rendering code (the menu-state
 * publisher) as well as by the Settings control.
 *
 * @module stack-chord-store
 */

import { useSyncExternalStore } from "react";
import { putStackChord } from "./settings-api";

/**
 * Which Window-menu item owns ⌘R.
 *
 * - `cycle` → `Window ▸ Cycle Stack`
 * - `reveal` → `Window ▸ Reveal Stack`
 */
export type StackChord = "cycle" | "reveal";

/** The default until the DEFAULTS feed resolves — the no-look gesture. */
export const DEFAULT_STACK_CHORD: StackChord = "cycle";

/**
 * Coerce an arbitrary persisted/remote value to a valid setting. Anything
 * other than the literal `"reveal"` reads as `cycle`, so a malformed default
 * can never leave ⌘R attached to neither item.
 */
export function normalizeStackChord(raw: string | null | undefined): StackChord {
  return raw === "reveal" ? "reveal" : "cycle";
}

class StackChordStore {
  private chord: StackChord = DEFAULT_STACK_CHORD;
  private readonly subscribers = new Set<() => void>();

  /**
   * Seed from the boot-time DEFAULTS snapshot. Does not persist (the value
   * came from tugbank) and does not notify — nothing has subscribed yet.
   */
  initialize(chord: StackChord): void {
    this.chord = chord;
  }

  /** The current setting. */
  getChord(): StackChord {
    return this.chord;
  }

  /** `useSyncExternalStore` snapshot. */
  getSnapshot = (): StackChord => this.chord;

  /**
   * Set the chord, notify, and — unless `persist` is `false` — write it back
   * to tugbank. Pass `persist: false` for values that originated from tugbank
   * (a remote DEFAULTS push) to avoid an echo loop.
   */
  setChord(chord: StackChord, opts?: { persist?: boolean }): void {
    if (chord === this.chord) return;
    this.chord = chord;
    if (opts?.persist !== false) putStackChord(chord);
    for (const cb of this.subscribers) cb();
  }

  subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  };
}

/** App-wide singleton. */
export const stackChordStore = new StackChordStore();

/** React hook returning the current setting, re-rendering on change. */
export function useStackChord(): StackChord {
  return useSyncExternalStore(
    stackChordStore.subscribe,
    stackChordStore.getSnapshot,
    () => DEFAULT_STACK_CHORD,
  );
}
