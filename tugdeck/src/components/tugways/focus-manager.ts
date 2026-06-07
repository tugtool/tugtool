/**
 * FocusManager -- tugways focus engine.
 *
 * A plain TypeScript class (outside React state) that owns the three things
 * the responder chain deliberately does not: the **key view** (the single
 * element keystrokes land on), an explicit **focusable registry** with an
 * app-authored Tab order, and a **focus-mode stack** modeled on CFRunLoop
 * run-loop modes (a floating surface pushes a trapped mode; the Tab walk
 * only services focusables registered in the current mode).
 *
 * It is a *sibling* of `ResponderChainManager`, not a replacement: the chain
 * owns action routing (first responder), the FocusManager owns the keyboard
 * target (key view). The two usually agree but are independent axes -- a
 * focus-refusing control click routes an action while leaving the key view
 * put. Both ride the same `ResponderChainProvider` document listeners; the
 * FocusManager seeds its key view from the chain's first responder via
 * `attach(chain)`.
 *
 * This first cut is **inert**: the registry, key view, mode stack, walk, and
 * default-action map all exist and are exercised by pure-logic tests, but no
 * document listener intercepts Tab yet, so Tab behavior is unchanged in the
 * running app. The only visible effect is the `data-key-view` attribute that
 * tracks the first responder.
 *
 * Co-locates `FocusManagerContext` so the provider and `useFocusable` can
 * import it without a circular dependency -- the same pattern
 * `responder-chain.ts` uses for `ResponderChainContext`.
 *
 * State-zone classification ([L24]): the key-view id, focusable records, and
 * mode stack are all **structure** zone (registry + `useLayoutEffect` at the
 * hook). The `data-key-view` attribute is the **appearance** projection of
 * the key view, written directly to the DOM ([L06]) -- never React state.
 */

import { createContext } from "react";
import type { TugAction } from "./action-vocabulary";
import type { ComponentKeyDeclaration, FocusKey } from "./focus-act";
import type { ResponderChainManager } from "./responder-chain";

/**
 * The behavior a key-view component declares to the engine ([P01]): the pure
 * decision fields the act resolver reads ({@link ComponentKeyDeclaration}) plus
 * the callbacks the engine invokes to carry an act out. The engine owns the
 * scope mechanics (ascend = pop); the component supplies the rest, so behavior
 * follows from the declaration rather than a bespoke per-component keymap.
 */
export interface KeyViewBehavior extends ComponentKeyDeclaration {
  /** Space (and Enter-act on an item container): select / toggle the current item. */
  onSelect?: () => void;
  /** Enter on a non-descendable item, or a plain act. */
  onAct?: () => void;
  /** Enter on a descendable item: the component pushes its inner scope + lands the key view inside it. */
  onDescend?: () => void;
  /** Optional cleanup when the engine ascends out of this component's descended scope. */
  onAscend?: () => void;
}

// ---- Focus modes ----

/**
 * The id of the base focus mode -- the bottom of the mode stack, always
 * present, never pushed or popped. Focusables that do not belong to a
 * floating surface register into this mode; the Tab walk services it
 * whenever no trapped mode is current.
 */
export const BASE_FOCUS_MODE = "base";

/**
 * DOM projection of the current (top) focus mode, stamped on the document root.
 * Absent when the base mode is current; set to the active trap's scope id while
 * a floating surface's mode is pushed. The appearance/structure projection of
 * the mode stack ([L24]) — useful for CSS that scopes to "a modal trap is
 * active", for devtools, and for app-tests. Mirrors `data-key-view` /
 * `data-keyboard-access`.
 */
export const FOCUS_MODE_ATTRIBUTE = "data-focus-mode";

/**
 * DOM marker for the **immediate container** of the key view (depth 1 only):
 * the element one level up the key path that *contains* the active component.
 * The engine's visible `:focus-within` — a quiet "contains active" mark, distinct
 * from the focus ring (`data-key-view-kbd`, on the component itself) and the
 * movement cursor (`data-key-cursor`, on the current item). Projected from the
 * scope stack: when a scope is descended into (pushed), the key view captured at
 * push time (`restoreKeyView` — the container we descended *from*) wears it.
 * Only the top scope's container is marked; no ancestor chain renders.
 */
export const KEY_WITHIN_ATTRIBUTE = "data-key-within";

/**
 * DOM marker a focused text surface sets on (or within) itself to advertise
 * "I own Tab right now" -- e.g. a text editor with an open completion popup,
 * which accepts the completion on Tab instead of yielding to the focus walk.
 * The Tab pipeline checks this before advancing the key view (the [Q02]
 * flag resolution): when present on the active element's subtree, Tab is left
 * to the surface's own keymap; otherwise the focus walk advances.
 */
export const TAB_CONSUME_ATTRIBUTE = "data-tug-tab-consume";

/**
 * A focus mode (scope) on the stack. Mirrors a CFRunLoop mode: while it is
 * current, the Tab walk services only the focusables registered into it
 * (when `trapped`), giving a focus trap for free.
 *
 * - `trapped: true` -- only this mode's focusables participate; Tab wraps
 *   within them. This is what a sheet / alert / popover / menu pushes.
 * - `trapped: false` -- this mode's focusables PLUS the base-mode focusables
 *   participate (the CFRunLoop "common modes" shape), for surfaces that
 *   layer accelerators without trapping.
 */
export interface FocusMode {
  scopeId: string;
  trapped: boolean;
}

/**
 * Internal mode-stack entry. Adds `restoreKeyView`: the key view that was
 * current when this mode was pushed, restored when it is popped — the
 * CFRunLoop "pop restores the prior key view" semantic ([#cfrunloop-model]).
 * `restoreKeyViewKeyboard` snapshots whether that key view was keyboard-driven,
 * so the restore re-paints the ring iff it was there before the push (e.g. a
 * popover opened by keyboard from a focus-cycling stop returns to the ringed
 * stop on close; a mouse-opened one restores ringless).
 */
interface FocusModeEntry extends FocusMode {
  restoreKeyView: string | null;
  restoreKeyViewKeyboard: boolean;
}

// ---- Focusables ----

/**
 * Walk policy for a focusable.
 *
 * - `accept` -- included in the standard-mode Tab walk.
 * - `skip` -- pointer-focusable but excluded from the standard walk; included
 *   only in `accessibility` keyboard-access mode.
 */
export type FocusPolicy = "accept" | "skip";

/**
 * Keyboard-access mode. `standard` honors `skip`; `accessibility` ignores it
 * so every interactive affordance is Tab-reachable. The mode is owned by a
 * tugbank-backed store (wired separately); the walk reads it here.
 */
export type KeyboardAccessMode = "standard" | "accessibility";

/**
 * The shape a caller (the `useFocusable` hook, or a test) hands to
 * `registerFocusable`. `policy` and `modes` are optional and normalized to
 * their defaults inside the manager.
 */
export interface FocusableInput {
  /** Stable id for this focusable. Matches the `data-tug-focusable` attribute. */
  id: string;
  /**
   * Named focus group. Tab order is group-level authored ([P02]): the walk
   * sorts by (group ordinal, item order), where group ordinals come from
   * `setGroupOrder`. Groups not in the authored order sort after the named
   * ones, by registration sequence.
   */
  group: string;
  /** Item order within the group. */
  order: number;
  /** Walk policy. Defaults to `accept`. */
  policy?: FocusPolicy;
  /**
   * Transient "I consume Tab right now" predicate (e.g. a text editor with an
   * open completion popup). Consulted by the Tab pipeline before advancing
   * the key view. Stored by reference so the hook can keep it live without
   * re-registering.
   */
  consumesTab?: () => boolean;
  /**
   * The component's key-view behavior ([P01]), held by reference and read live at
   * dispatch time so a component can change what its current item descends to (or
   * which keys it captures) without re-registering. Absent for plain focus stops
   * that need no model dispatch.
   */
  behavior?: () => KeyViewBehavior | null;
  /**
   * The focus modes this focusable participates in. Defaults to
   * `[BASE_FOCUS_MODE]`. Floating surfaces register their contents into the
   * mode they push.
   */
  modes?: string[];
}

/**
 * A normalized focusable record held in the registry. `policy` and `modes`
 * are filled in; `seq` is a monotonic registration counter used as the final
 * sort tiebreak so the walk order is deterministic.
 */
export interface FocusableRecord {
  id: string;
  group: string;
  order: number;
  policy: FocusPolicy;
  consumesTab?: () => boolean;
  behavior?: () => KeyViewBehavior | null;
  modes: string[];
  seq: number;
}

// ---- FocusManager ----

export class FocusManager {
  private focusables: Map<string, FocusableRecord> = new Map();
  private modeStack: FocusModeEntry[] = [];
  private groupOrder: string[] = [];
  private defaultActions: Map<string, TugAction> = new Map();
  private keyViewId: string | null = null;
  // Whether the current key view was reached by *keyboard* (the Tab walk /
  // surface entry) vs by pointer (click promotion). The focus ring shows on a
  // keyboard-reached key view; WebKit's `:focus-visible` heuristic is
  // unreliable for the engine's programmatic `.focus()`, so the engine marks
  // its own keyboard navigation rather than depending on the browser.
  private keyViewKeyboard = false;
  // When true, the focus ring also follows *pointer*-driven key-view changes —
  // not just keyboard navigation. This is the "keyboard + pointer" ring policy:
  // a click that lands on a registered focusable paints the ring, so the ring
  // is consistent whether you Tab to a control or click it. When false (the
  // default), the ring paints on keyboard navigation only. Orthogonal to
  // {@link accessMode}; driven by the focus-ring-modality store.
  private ringFollowsPointer = false;
  private accessMode: KeyboardAccessMode = "standard";
  private seqCounter = 0;
  private version = 0;
  private subscribers: Set<() => void> = new Set();

  // The chain we seed the key view from, plus its unsubscribe handle. Set by
  // `attach`, cleared by `detach`.
  private chain: ResponderChainManager | null = null;
  private chainUnsubscribe: (() => void) | null = null;
  // Set while `focusKeyView` moves DOM focus. The walk has just chosen a
  // specific focusable as the key view (keyboard=true); the `focusin` that
  // `el.focus()` fires synchronously promotes that element's nearest *responder*
  // (often a coarser container — a card root), which would otherwise re-seed the
  // key view back to that responder with keyboard=false, dropping the ring on
  // the first Tab into a freshly-revealed card. Suppress the chain re-seed for
  // the duration of that programmatic focus so the walk's choice stands.
  private suppressChainSeed = false;
  // Set while a *pointer*-driven first-responder promotion runs (see
  // `runPointerPromotion`). A pointer interaction re-seeds the key view to the
  // promoted responder and clears the ring (click-to-focus); any other chain
  // reflection is programmatic and yields to a finer focusable key view rather
  // than coarsening it — the boot-restore protection in `seedKeyViewFromChain`.
  private pointerPromotionActive = false;
  // Focus keys (`group:order`) of keyboard key views whose focusable had not
  // mounted when the focus axis restored ([focus-transfer] `deferred-dom`). The
  // ring re-lights the moment a matching focusable registers — the late-mount
  // retry for the keyboard ring across reload / relaunch.
  private pendingKeyboardRestore = new Set<string>();

  // ---- Chain attachment (key-view seeding) ----

  /**
   * Bind to the responder chain so the key view tracks the first responder.
   * The provider calls this from the same `useLayoutEffect` that installs the
   * chain's document listeners, and `detach` from its cleanup.
   *
   * On every chain change the key view is set to the current first responder.
   * In this inert cut that is the sole driver of the key view; once the Tab
   * pipeline lands, the walk drives it imperatively and this seeding yields.
   * Idempotent: re-attaching tears down the prior subscription first.
   */
  attach(chain: ResponderChainManager): void {
    if (this.chain === chain) return;
    this.detach();
    this.chain = chain;
    this.chainUnsubscribe = chain.subscribe(() => {
      // Yield to the walk while it is imperatively landing focus on a chosen
      // key view: the `focusin` from that programmatic `.focus()` must not
      // re-seed (and downgrade) the key view it just set.
      if (this.suppressChainSeed) return;
      this.seedKeyViewFromChain();
    });
    // Seed immediately so the key view reflects whatever the chain already
    // promoted before this subscription was installed.
    this.seedKeyViewFromChain();
  }

  /**
   * Reflect the chain's first responder onto the key view — the chain-seeding
   * path. The key view is the most *specific* focus target: when the Tab walk or
   * the focus-axis restore ([focus-transfer]) has already set the key view to a
   * registered focusable, a chain reflection that merely re-promotes that
   * focusable's coarser *container* (its card-root responder) must not coarsen
   * the key view back to the container or drop its keyboard ring — it yields.
   * This is what lets a keyboard ring survive the wave of programmatic
   * promotions that fire during cold-boot focus restore (the boot bug). Only a
   * genuine pointer interaction (run through {@link runPointerPromotion}, which
   * re-seeds and clears the ring — click-to-focus) or a reflection that moves to
   * a different subtree changes an established finer key view.
   */
  private seedKeyViewFromChain(): void {
    if (this.chain === null) return;
    const frId = this.chain.getFirstResponder();
    if (!this.pointerPromotionActive && this.keyViewIsFinerThan(frId)) return;
    this.setKeyView(frId);
  }

  /**
   * Whether the current key view is a registered focusable whose element lives
   * inside the element of `responderId` — i.e. the key view is *finer* than the
   * responder the chain just promoted. DOM-free environments and unmatched ids
   * resolve to `false` (no yield), preserving the bare-reflection behavior.
   */
  private keyViewIsFinerThan(responderId: string | null): boolean {
    if (responderId === null || this.keyViewId === null) return false;
    if (!this.focusables.has(this.keyViewId)) return false;
    if (typeof document === "undefined") return false;
    const esc = (s: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : s;
    const kvEl = document.querySelector(`[data-tug-focusable="${esc(this.keyViewId)}"]`);
    const rEl = document.querySelector(`[data-responder-id="${esc(responderId)}"]`);
    if (kvEl === null || rEl === null) return false;
    return rEl.contains(kvEl);
  }

  /**
   * Run `fn` (a first-responder promotion) marked as pointer-driven, so the
   * chain reflection it triggers coarsens the key view and clears the ring — the
   * click-to-focus path. Outside this wrapper, chain reflections are treated as
   * programmatic and yield to a finer focusable key view ({@link
   * seedKeyViewFromChain}). Synchronous: `makeFirstResponder` notifies the chain
   * within `fn`, so the flag need only span the call.
   */
  runPointerPromotion(fn: () => void): void {
    this.pointerPromotionActive = true;
    try {
      fn();
    } finally {
      this.pointerPromotionActive = false;
    }
  }

  /** Unsubscribe from the chain. Safe to call when not attached. */
  detach(): void {
    this.chainUnsubscribe?.();
    this.chainUnsubscribe = null;
    this.chain = null;
  }

  // ---- Focusable registry ----

  /**
   * Register (or replace) a focusable. Normalizes `policy` to `accept` and
   * `modes` to `[BASE_FOCUS_MODE]`, and assigns a registration sequence used
   * as the final walk-order tiebreak.
   */
  registerFocusable(input: FocusableInput): void {
    const record: FocusableRecord = {
      id: input.id,
      group: input.group,
      order: input.order,
      policy: input.policy ?? "accept",
      consumesTab: input.consumesTab,
      behavior: input.behavior,
      modes: input.modes ?? [BASE_FOCUS_MODE],
      seq: this.seqCounter++,
    };
    this.focusables.set(record.id, record);
    this.touch();
    // Late-mount keyboard-ring resume: if this focusable's stable `group:order`
    // is the saved key view whose element wasn't in the DOM when the focus axis
    // restored ([focus-transfer] `armKeyboardRestore`), re-light the ring on it
    // now. `focusKeyView` runs under `suppressChainSeed`, so the `focusin` it
    // fires can't re-seed the key view back to keyboard=false.
    if (record.group !== "" && this.pendingKeyboardRestore.size > 0) {
      const focusKey = `${record.group}:${record.order}`;
      if (this.pendingKeyboardRestore.has(focusKey) && this.isRecordRendered(record)) {
        this.pendingKeyboardRestore.delete(focusKey);
        this.setKeyView(record.id, true);
        this.focusKeyView();
      }
    }
  }

  /**
   * Arm a late-mount keyboard-ring resume for the focusable with this stable
   * `group:order` focus key ([focus-transfer]). Called when the focus axis
   * restored a keyboard key view whose element had not yet mounted; the ring
   * re-lights when that focusable registers.
   */
  armKeyboardRestore(focusKey: string): void {
    // The focusable often *already* registered by the time the focus axis
    // dispatches: an item-group stop mounts on a deep layout effect that fires
    // before the card's host root registers, so `resolveBagFocus` bails to
    // `deferred-dom` (host root not yet found) even though the focusable is in
    // the DOM. Waiting for a future registration would hang forever — it already
    // happened. Complete immediately against the live registry when a rendered
    // focusable carries this `group:order`; only arm for a genuinely-late mount.
    for (const record of this.focusables.values()) {
      if (`${record.group}:${record.order}` === focusKey && this.isRecordRendered(record)) {
        this.pendingKeyboardRestore.delete(focusKey);
        this.setKeyView(record.id, true);
        this.focusKeyView();
        return;
      }
    }
    this.pendingKeyboardRestore.add(focusKey);
  }

  /** Remove a focusable. No-op if it is not registered. */
  unregisterFocusable(id: string): void {
    if (this.focusables.delete(id)) {
      this.touch();
    }
  }

  /**
   * Author the group sequence for the Tab walk ([P02]). Groups appear in Tab
   * order in the order given; groups not listed sort after the named ones, by
   * registration sequence. Reordering this list reorders the walk with no DOM
   * move.
   */
  setGroupOrder(groups: string[]): void {
    this.groupOrder = [...groups];
    this.touch();
  }

  // ---- Key view ----

  /**
   * Set the key view to `id` (or `null` to clear). Writes the `data-key-view`
   * DOM attribute on exactly one element, plus `data-key-view-kbd` when the key
   * view was reached by keyboard (so the focus ring paints). No-op (other than
   * DOM clear) when neither the value nor the modality changed.
   *
   * `keyboard` defaults to `false` (pointer / chain reflection); the Tab walk
   * and surface entry pass `true`.
   */
  setKeyView(id: string | null, keyboard = false): void {
    if (this.keyViewId === id && this.keyViewKeyboard === keyboard) return;
    this.keyViewId = id;
    this.keyViewKeyboard = keyboard;
    this.syncKeyViewDomAttribute();
    this.touch();
  }

  /**
   * Re-project the current key view onto the DOM element that now carries its
   * `data-tug-focusable` — for a **roving single-stop focusable** (a tab bar,
   * radio / option / choice group, accordion, or list) whose key-view *id* stays
   * the same while the projected element moves under arrow navigation.
   * `setKeyView` early-returns when `(id, keyboard)` is unchanged, so it cannot
   * chase a moved element; this re-runs the DOM projection directly.
   *
   * `keyboard` sets the modality the ring reads: `true` (arrow-roving) keeps the
   * ring on the newly-roved member; `false` (a pointer move within the group)
   * clears it; omit to preserve the current modality.
   *
   * Appearance-zone DOM mutation only ([L06], [L22]): it writes `data-key-view`
   * / `data-key-view-kbd` and notifies no React subscriber — the key-view id is
   * unchanged and the ring is driven by the DOM attribute, not React state, so
   * there is nothing to `touch()`.
   */
  refreshKeyViewProjection(keyboard?: boolean): void {
    if (this.keyViewId === null) return;
    if (keyboard !== undefined) this.keyViewKeyboard = keyboard;
    this.syncKeyViewDomAttribute();
  }

  /** The current key-view id, or `null` if none. */
  keyView(): string | null {
    return this.keyViewId;
  }

  /**
   * Whether the current key view is keyboard-driven (wears the ring). A floating
   * surface's close-focus restorer uses this at open time to decide ownership:
   * when a keyboard key view is present, the engine's mode-stack restore owns the
   * close-focus (it returns the ring + DOM focus to that key view), so the
   * responder-chain "prior responder" restore must defer — one writer, not two.
   */
  keyViewIsKeyboard(): boolean {
    return this.keyViewKeyboard;
  }

  /**
   * Whether the current key view's focusable declares it is consuming Tab right
   * now (its `consumesTab` predicate returns true). The Tab pipeline also checks
   * the active element's DOM marker ([TAB_CONSUME_ATTRIBUTE]) for surfaces that
   * are not (yet) registered focusables; this covers the registered case.
   */
  keyViewConsumesTab(): boolean {
    if (this.keyViewId === null) return false;
    return this.focusables.get(this.keyViewId)?.consumesTab?.() ?? false;
  }

  /**
   * The behavior declared by the current key view's component ([P01]), or `null`
   * when the key view declares none (a plain focus stop). The act-dispatch reads
   * this to resolve Space/Enter/Escape against the focused component.
   */
  keyViewBehavior(): KeyViewBehavior | null {
    if (this.keyViewId === null) return null;
    return this.focusables.get(this.keyViewId)?.behavior?.() ?? null;
  }

  /**
   * Whether the current key view captures `key` for itself (an editor leaf's
   * typing / caret) — the generalization of `keyViewConsumesTab` to any key
   * ([P04]). When true the act-dispatch leaves the key to the component. Falls
   * back to the `consumesTab` predicate for the Tab key so the two stay in sync.
   */
  keyViewCaptures(key: FocusKey): boolean {
    const captured = this.keyViewBehavior()?.captures?.(key) ?? false;
    if (captured) return true;
    return key.key === "Tab" ? this.keyViewConsumesTab() : false;
  }

  /**
   * Ascend one scope level: pop the current (top) focus mode, restoring the key
   * view captured when it was pushed, and move DOM focus to it. The engine half
   * of Escape ([P02]); a no-op (returns `false`) at the base mode, so a bare
   * Escape with nothing descended falls through to the cancel ladder ([R04]).
   */
  ascend(): boolean {
    const mode = this.currentFocusMode();
    if (mode === BASE_FOCUS_MODE) return false;
    this.popFocusMode(mode);
    // `popFocusMode` restores the prior key view with `keyboard=false`; we
    // ascended by keyboard, so re-stamp the ring onto the restored container.
    this.refreshKeyViewProjection(true);
    this.focusKeyView();
    return true;
  }

  /**
   * Move DOM focus to the current key-view element, so keystrokes land on it
   * after the Tab walk advances. Mirrors the chain's `focusResponder` DOM-walk
   * fallback: focus the element itself when it is intrinsically focusable or
   * carries a non-negative tabindex, else its first tabbable descendant. A
   * guarded no-op with no document or no key view. Returns whether focus moved.
   */
  focusKeyView(): boolean {
    if (this.keyViewId === null || typeof document === "undefined") return false;
    const id = this.keyViewId;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id;
    const el = document.querySelector<HTMLElement>(
      `[data-responder-id="${escaped}"], [data-tug-focusable="${escaped}"]`,
    );
    if (!el) return false;
    const tabIndexAttr = el.getAttribute("tabindex");
    const intrinsicallyFocusable =
      el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLAnchorElement;
    const hasFocusableTabIndex = tabIndexAttr !== null && parseInt(tabIndexAttr, 10) >= 0;
    // Suppress the chain re-seed for the synchronous `focusin` this `.focus()`
    // fires (see `suppressChainSeed`), so the walk's keyboard key view survives.
    this.suppressChainSeed = true;
    try {
      if (intrinsicallyFocusable || hasFocusableTabIndex) {
        el.focus();
        return true;
      }
      const tabbable = el.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (tabbable) {
        tabbable.focus();
        return true;
      }
      return false;
    } finally {
      this.suppressChainSeed = false;
    }
  }

  // ---- Keyboard-access mode ----

  /** Set the keyboard-access mode the Tab walk reads. */
  setKeyboardAccessMode(mode: KeyboardAccessMode): void {
    if (this.accessMode === mode) return;
    this.accessMode = mode;
    this.touch();
  }

  /** The current keyboard-access mode. */
  keyboardAccessMode(): KeyboardAccessMode {
    return this.accessMode;
  }

  // ---- Ring modality ----

  /**
   * Set whether the focus ring follows pointer-driven key-view changes in
   * addition to keyboard navigation. `false` (default) = ring on keyboard
   * navigation only; `true` = ring also paints when a click lands on a
   * registered focusable.
   *
   * Repaints immediately: the key-view id is unchanged, so this re-runs the
   * DOM projection directly (appearance-zone DOM only — no React notify, the
   * ring is driven by the `data-key-view-kbd` attribute, not React state
   * [L06]/[L22]).
   */
  setRingFollowsPointer(value: boolean): void {
    if (this.ringFollowsPointer === value) return;
    this.ringFollowsPointer = value;
    this.refreshKeyViewProjection();
  }

  /** Whether the ring currently follows pointer-driven key-view changes. */
  ringFollowsPointerMode(): boolean {
    return this.ringFollowsPointer;
  }

  // ---- Focus-mode stack ----

  /**
   * Push a focus mode. The pushed mode becomes current; the Tab walk services
   * only its focusables (when `trapped`). Captures the current key view so it
   * can be restored on pop ([#cfrunloop-model]). Pushing a `scopeId` already on
   * the stack moves it to the top (re-capturing the key view at that point).
   */
  pushFocusMode(scopeId: string, opts: { trapped: boolean }): void {
    const existing = this.modeStack.findIndex((m) => m.scopeId === scopeId);
    if (existing !== -1) {
      this.modeStack.splice(existing, 1);
    }
    this.modeStack.push({
      scopeId,
      trapped: opts.trapped,
      restoreKeyView: this.keyViewId,
      restoreKeyViewKeyboard: this.keyViewKeyboard,
    });
    this.syncFocusModeDomAttribute();
    this.syncKeyWithinDomAttribute();
    this.touch();
  }

  /**
   * Pop the named focus mode off the stack and restore the key view that was
   * current when it was pushed. No-op if it is not present. `pushFocusMode`
   * keeps scope ids unique on the stack, so a single index search is
   * sufficient.
   *
   * Restore fires only when popping the **top** mode (the common dismiss case);
   * popping a buried mode leaves the key view alone, since a mode still above
   * it owns the current scope.
   */
  popFocusMode(scopeId: string): void {
    const at = this.modeStack.findIndex((m) => m.scopeId === scopeId);
    if (at === -1) return;
    const wasTop = at === this.modeStack.length - 1;
    const [entry] = this.modeStack.splice(at, 1);
    this.syncFocusModeDomAttribute();
    this.syncKeyWithinDomAttribute();
    if (wasTop) {
      // Restore the prior key view AND its keyboard-ness, so a key view that
      // wore the ring before this mode was pushed (e.g. a focus-cycling stop
      // that opened a popover by keyboard) gets the ring back on pop, while a
      // mouse-opened one restores ringless. A no-op when unchanged; harmless
      // when the captured target has since unmounted (the chain's
      // first-responder seeding will re-resolve the key view on the next chain
      // change).
      this.setKeyView(entry.restoreKeyView, entry.restoreKeyViewKeyboard);
      // The engine is the single owner of close-focus when it is returning to a
      // KEYBOARD key view (a focus-cycle / Tab stop the surface was opened from):
      // move DOM focus onto it. The service-popup binding defers in exactly this
      // case (it checks `keyViewIsKeyboard` at open), so focus is written by one
      // system — no dueling writers, no dependence on effect order. A non-keyboard
      // or null restore (a mouse-opened surface) leaves DOM focus to that
      // responder-chain fallback instead, unchanged.
      if (entry.restoreKeyView !== null && entry.restoreKeyViewKeyboard) {
        this.focusKeyView();
      }
    }
    // Always notify: popping a mode changes `isFocusModePushed` /
    // `currentFocusMode`, which subscribers observe (e.g. a card's `cycling`
    // flag) independently of the key view. The `setKeyView` above is NOT enough
    // — it early-returns when the restored key view is unchanged (restoring a
    // null editor key view to an already-null one), which would leave the mode
    // pop unobserved and a derived `cycling` boolean stale.
    this.touch();
  }

  /**
   * Move the key view to the first focusable in the current mode (authored
   * order) and return its id, or `null` if the mode has no focusables. The
   * engine's "set initial focus when a surface opens" primitive — a floating
   * surface calls this after pushing its mode so keyboard entry lands inside
   * the trap. Does not move DOM focus; pair with `focusKeyView` for that.
   */
  focusFirstInMode(): string | null {
    const order = this.walkOrder();
    if (order.length === 0) return null;
    const id = order[0].id;
    this.setKeyView(id, true);
    return id;
  }

  /** The current (top) focus mode id, or `BASE_FOCUS_MODE` when none pushed. */
  currentFocusMode(): string {
    const top = this.modeStack[this.modeStack.length - 1];
    return top ? top.scopeId : BASE_FOCUS_MODE;
  }

  /**
   * Whether `scopeId` is anywhere on the mode stack — current OR merely covered
   * by a transient mode pushed on top of it (e.g. a popover opened from within a
   * focus-cycling card). Distinct from {@link currentFocusMode}: a consumer that
   * asks "am I still in this mode?" (the cycling card, deciding whether to keep
   * its `data-cycling` treatment / not restore the editor caret) wants this, not
   * top-of-stack — opening a nested surface must not read as an exit.
   */
  isFocusModePushed(scopeId: string): boolean {
    return this.modeStack.some((m) => m.scopeId === scopeId);
  }

  /**
   * Whether the current (top) focus mode is trapped (modal). `false` at the base
   * mode. The act dispatch ascends only **non-trapped** scopes ([P02]); a trapped
   * (modal) scope's Escape is the surface's to handle (cancel), so the engine does
   * not pop it from under a sheet / alert ([R04]).
   */
  currentFocusModeTrapped(): boolean {
    const top = this.modeStack[this.modeStack.length - 1];
    return top ? top.trapped : false;
  }

  // ---- Default-action resolution ----

  /**
   * Declare (or clear) the default action a scope's `Return` resolves to. The
   * scope is a focus-mode id (or `BASE_FOCUS_MODE`). Passing `null` clears it.
   */
  setDefaultAction(scopeId: string, action: TugAction | null): void {
    if (action === null) {
      this.defaultActions.delete(scopeId);
    } else {
      this.defaultActions.set(scopeId, action);
    }
    this.touch();
  }

  /**
   * Resolve the default action of the current focus mode, or `null` if the
   * current mode declares none.
   */
  resolveDefaultAction(): TugAction | null {
    return this.defaultActions.get(this.currentFocusMode()) ?? null;
  }

  // ---- Tab walk ----

  /**
   * Advance the key view to the next focusable in the current mode's authored
   * order, wrapping past the last to the first. Returns the new key-view id,
   * or `null` if the current mode has no participating focusables.
   *
   * If the current key view is not among the walk candidates (e.g. it was
   * seeded from a non-focusable first responder), the walk starts at the
   * beginning.
   */
  focusNext(): string | null {
    return this.advance(1);
  }

  /**
   * Advance the key view to the previous focusable in the current mode's
   * authored order, wrapping past the first to the last. See `focusNext`.
   */
  focusPrevious(): string | null {
    return this.advance(-1);
  }

  /**
   * The ordered list of focusables that participate in the current mode and
   * pass the current keyboard-access policy filter. Exposed for the Tab
   * pipeline and for inspection; the walk uses it directly.
   */
  walkOrder(): FocusableRecord[] {
    const top = this.modeStack[this.modeStack.length - 1];
    const modeId = top ? top.scopeId : BASE_FOCUS_MODE;
    const trapped = top ? top.trapped : false;
    const records: FocusableRecord[] = [];
    for (const record of this.focusables.values()) {
      const inMode =
        record.modes.includes(modeId) ||
        (!trapped && record.modes.includes(BASE_FOCUS_MODE));
      if (!inMode) continue;
      if (this.accessMode === "standard" && record.policy === "skip") continue;
      // A focusable in a hidden subtree is not a reachable Tab target. Card
      // panes keep inactive tab cards mounted as `display: none` (only the
      // active card is laid out), so without this filter the walk would step
      // through every background card's focusables before reaching the
      // frontmost one — Tab-ing N times for the Nth tab. Skip records whose
      // element renders no box. A no-op without a DOM (pure-logic walk tests)
      // and when the element can't be resolved, so neither is excluded.
      if (!this.isRecordRendered(record)) continue;
      // A disabled / pointer-inert control is not a reachable Tab target — the
      // walk skips it so, e.g., the prompt submit drops out of the cycle while
      // the editor is empty (its empty-input gate) and the seed lands on the
      // next live stop instead.
      if (!this.isRecordInteractive(record)) continue;
      records.push(record);
    }
    records.sort((a, b) => this.compareFocusables(a, b));
    return records;
  }

  /**
   * Resolve a focusable record's live DOM element (the responder container or
   * the focusable element carrying its id), or `null` if absent / no document.
   */
  private resolveFocusableElement(record: FocusableRecord): HTMLElement | null {
    if (typeof document === "undefined") return null;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(record.id)
        : record.id;
    return document.querySelector<HTMLElement>(
      `[data-responder-id="${escaped}"], [data-tug-focusable="${escaped}"]`,
    );
  }

  /**
   * Whether a focusable's element is currently rendered (lays out a box). Used
   * by the walk to exclude focusables inside a `display: none` subtree (an
   * inactive tab card). Returns `true` when there is no document or the element
   * can't be resolved, so the in-memory walk (tests / SSR) is never narrowed by
   * a DOM that isn't there.
   */
  private isRecordRendered(record: FocusableRecord): boolean {
    if (typeof document === "undefined") return true;
    const el = this.resolveFocusableElement(record);
    if (el === null) return true;
    return el.getClientRects().length > 0;
  }

  /**
   * Whether a focusable's element is currently *interactive* — the walk must
   * never land the key view on a control that cannot be activated. Excludes
   * native-`disabled` and `aria-disabled` elements and elements made
   * pointer-inert by CSS (`pointer-events: none` — e.g. the prompt submit's
   * empty-input gate, which disables the button visually + for the pointer
   * without a `disabled` attribute). Reads the DOM at walk time, exactly like
   * {@link isRecordRendered}: the "is the control actionable" signal stays
   * appearance/DOM state ([L06]), and this structure consumer observes it
   * directly rather than round-tripping it through React ([L22]/[L24]).
   * Permissive without a DOM (returns `true`) so the pure-logic walk tests are
   * never narrowed.
   */
  private isRecordInteractive(record: FocusableRecord): boolean {
    if (typeof document === "undefined") return true;
    const el = this.resolveFocusableElement(record);
    if (el === null) return true;
    if (el.matches(':disabled, [aria-disabled="true"]')) return false;
    if (
      typeof window !== "undefined" &&
      window.getComputedStyle(el).pointerEvents === "none"
    ) {
      return false;
    }
    return true;
  }

  private advance(step: 1 | -1): string | null {
    const order = this.walkOrder();
    if (order.length === 0) return null;
    const current =
      this.keyViewId === null
        ? -1
        : order.findIndex((r) => r.id === this.keyViewId);
    // When the key view is absent from the walk, a forward step starts at the
    // first element and a backward step at the last.
    const base = current === -1 ? (step === 1 ? -1 : 0) : current;
    const nextIndex = (base + step + order.length) % order.length;
    const nextId = order[nextIndex].id;
    this.setKeyView(nextId, true);
    return nextId;
  }

  private compareFocusables(a: FocusableRecord, b: FocusableRecord): number {
    const ga = this.groupIndex(a.group);
    const gb = this.groupIndex(b.group);
    if (ga !== gb) return ga - gb;
    if (a.order !== b.order) return a.order - b.order;
    return a.seq - b.seq;
  }

  private groupIndex(group: string): number {
    const i = this.groupOrder.indexOf(group);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }

  // ---- Subscription (for future useSyncExternalStore consumers, [L02]) ----

  /** Subscribe to manager changes. Returns an unsubscribe function. */
  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /** Monotonic version for `useSyncExternalStore` snapshots. */
  getVersion(): number {
    return this.version;
  }

  // ---- Private helpers ----

  private touch(): void {
    this.version += 1;
    for (const cb of this.subscribers) {
      cb();
    }
  }

  /**
   * Project the key view onto the DOM: clear `data-key-view` from any element
   * that carries it, then stamp it on the element whose `data-responder-id`
   * or `data-tug-focusable` matches the current key-view id. The attribute
   * value is the id itself, so devtools shows `data-key-view="<id>"` inline.
   *
   * DOM-free environments (unit tests without a document) are detected via
   * `typeof document` and skipped -- the in-memory key view is already set,
   * only the appearance projection is unavailable. Mirrors the chain's
   * `syncFirstResponderDomAttribute`.
   */
  private syncKeyViewDomAttribute(): void {
    if (typeof document === "undefined") return;
    document.querySelectorAll<HTMLElement>("[data-key-view]").forEach((el) => {
      el.removeAttribute("data-key-view");
      el.removeAttribute("data-key-view-kbd");
    });
    if (this.keyViewId === null) return;
    const id = this.keyViewId;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id;
    const el = document.querySelector<HTMLElement>(
      `[data-responder-id="${escaped}"], [data-tug-focusable="${escaped}"]`,
    );
    if (!el) return;
    el.setAttribute("data-key-view", id);
    // The focus ring paints on a keyboard-reached key view (the engine's own
    // signal, since `:focus-visible` is unreliable for programmatic focus) —
    // and, when the ring-follows-pointer policy is on, on any pointer-driven
    // key-view change too, so the ring is consistent across Tab and click.
    if (this.keyViewKeyboard || this.ringFollowsPointer) {
      el.setAttribute("data-key-view-kbd", "");
    }
  }

  /**
   * Project the **immediate container** of the key view onto the DOM (depth 1):
   * clear `data-key-within` from any element that carries it, then — when a scope
   * is descended into — stamp it on the element whose `data-tug-focusable` /
   * `data-responder-id` matches the top scope's `restoreKeyView` (the container we
   * descended *from*). At base (no pushed scope) nothing is marked: a flat
   * component is its own key view and has no "within". Only the top scope's
   * container renders — no ancestor chain ([Q02]). Appearance-zone DOM only
   * ([L06]/[L22]); guarded for DOM-free environments.
   */
  private syncKeyWithinDomAttribute(): void {
    if (typeof document === "undefined") return;
    document
      .querySelectorAll<HTMLElement>(`[${KEY_WITHIN_ATTRIBUTE}]`)
      .forEach((el) => el.removeAttribute(KEY_WITHIN_ATTRIBUTE));
    const top = this.modeStack[this.modeStack.length - 1];
    const withinId = top?.restoreKeyView ?? null;
    if (withinId === null) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(withinId)
        : withinId;
    const el = document.querySelector<HTMLElement>(
      `[data-responder-id="${escaped}"], [data-tug-focusable="${escaped}"]`,
    );
    el?.setAttribute(KEY_WITHIN_ATTRIBUTE, "");
  }

  /**
   * Project the current (top) focus mode onto the document root: set
   * `data-focus-mode="<scopeId>"` while a trap is current, remove it at base.
   * Guarded for DOM-free environments. Mirrors `syncKeyViewDomAttribute`.
   */
  private syncFocusModeDomAttribute(): void {
    if (typeof document === "undefined") return;
    const mode = this.currentFocusMode();
    if (mode === BASE_FOCUS_MODE) {
      document.documentElement.removeAttribute(FOCUS_MODE_ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, mode);
    }
  }
}

// ---- React context ----

/**
 * React context holding the singleton FocusManager for the canvas subtree.
 * Default `null` (outside any provider). Co-located here so
 * `use-focusable.tsx` and `responder-chain-provider.tsx` import it without a
 * circular dependency -- the same arrangement as `ResponderChainContext`.
 */
export const FocusManagerContext = createContext<FocusManager | null>(null);

// ---- Global handle ----
//
// Last-registration-wins module singleton so framework code outside the React
// tree can reach the engine — the same arrangement as
// `registerResponderChainManager`. Used by the single-channel focus dispatcher
// (`applyBagFocus` in `focus-transfer.ts`) to re-light the keyboard ring as
// part of a focus-axis restore. Set by `responder-chain-provider` on mount.

let activeFocusManager: FocusManager | null = null;

/** Register the active FocusManager. Called by the provider on mount. */
export function registerFocusManager(manager: FocusManager | null): void {
  activeFocusManager = manager;
}

/** The active FocusManager, or `null` outside a mounted provider. */
export function getFocusManager(): FocusManager | null {
  return activeFocusManager;
}

/**
 * React context carrying the focus-mode scope id that `useFocusable` callers in
 * the subtree register into. Default `BASE_FOCUS_MODE` (the app shell). A
 * floating surface that pushes a trap provides its scope id here (via
 * `useFocusTrap`), so its focusable contents join the trap's mode and the Tab
 * walk cycles within them — the "a surface's contents register into the mode it
 * pushes" half of [#cfrunloop-model].
 */
export const FocusModeContext = createContext<string>(BASE_FOCUS_MODE);
