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
import type { ResponderChainManager } from "./responder-chain";

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
 */
interface FocusModeEntry extends FocusMode {
  restoreKeyView: string | null;
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
  private accessMode: KeyboardAccessMode = "standard";
  private seqCounter = 0;
  private version = 0;
  private subscribers: Set<() => void> = new Set();

  // The chain we seed the key view from, plus its unsubscribe handle. Set by
  // `attach`, cleared by `detach`.
  private chain: ResponderChainManager | null = null;
  private chainUnsubscribe: (() => void) | null = null;

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
      this.setKeyView(chain.getFirstResponder());
    });
    // Seed immediately so the key view reflects whatever the chain already
    // promoted before this subscription was installed.
    this.setKeyView(chain.getFirstResponder());
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
      modes: input.modes ?? [BASE_FOCUS_MODE],
      seq: this.seqCounter++,
    };
    this.focusables.set(record.id, record);
    this.touch();
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

  /** The current key-view id, or `null` if none. */
  keyView(): string | null {
    return this.keyViewId;
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
    });
    this.syncFocusModeDomAttribute();
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
    if (wasTop) {
      // Restore the prior key view. A no-op when unchanged; harmless when the
      // captured target has since unmounted (the chain's first-responder
      // seeding will re-resolve the key view on the next chain change).
      this.setKeyView(entry.restoreKeyView);
    } else {
      this.touch();
    }
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
      records.push(record);
    }
    records.sort((a, b) => this.compareFocusables(a, b));
    return records;
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
    // signal, since `:focus-visible` is unreliable for programmatic focus).
    if (this.keyViewKeyboard) {
      el.setAttribute("data-key-view-kbd", "");
    }
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

/**
 * React context carrying the focus-mode scope id that `useFocusable` callers in
 * the subtree register into. Default `BASE_FOCUS_MODE` (the app shell). A
 * floating surface that pushes a trap provides its scope id here (via
 * `useFocusTrap`), so its focusable contents join the trap's mode and the Tab
 * walk cycles within them — the "a surface's contents register into the mode it
 * pushes" half of [#cfrunloop-model].
 */
export const FocusModeContext = createContext<string>(BASE_FOCUS_MODE);
