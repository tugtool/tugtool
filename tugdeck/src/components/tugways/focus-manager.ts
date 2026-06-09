/**
 * FocusManager -- tugways focus engine, per-card (the key-window model).
 *
 * Focus state is owned **per card**, not pooled deck-global. Each card is a
 * self-contained focus universe: its own focus-mode stack (cycle / card-modal
 * trap / descend), its own key view (the element keystrokes land on), its own
 * key-within, its own default-ring stack, and its own app-authored focusable
 * registry. That universe lives in a {@link FocusContext}.
 *
 * `FocusManager` is the deck **coordinator** (the AppKit *app object* to the
 * context's *key window*): it owns only deck-global settings (ring modality,
 * keyboard-access mode), the responder-chain attachment, the subscriber set +
 * version, and the **key-card** pointer plus the `cardId → FocusContext` map. Its
 * public API delegates every walk / seed / projection / engine call to the **key
 * card's** context (the active context). Switching the key card is an O(1) context
 * swap; an inactive card's context is untouched, so a mid-flow cycle, a pending
 * card-modal dialog, or a descended scope is preserved **by construction** — no
 * tagging a shared stack, no suspend/restore reconciliation.
 *
 * Data-flow direction (the inversion that keeps key-card single-sourced): the key
 * card is **activation-driven**, not focus-derived. The activation-focus channel
 * (`applyBagFocus` in `focus-transfer.ts`) calls {@link FocusManager.setKeyCard}
 * (or {@link FocusManager.adoptKeyCard}); that sets `keyCardId`, projects THAT
 * context's marks, and only then does the responder chain's `getKeyCard()` DOM
 * fallback find the just-projected key view. Projection is downstream of the key
 * card, never an independent source — so the two can never diverge.
 *
 * Default context ([L26] + the no-card invariant): when no key card is set (a
 * `new FocusManager()` in the pure-logic tests, the gallery, a standalone
 * preview), the coordinator services a single **default context**. Registering
 * with no `cardId` routes there and the walk/seed/projection all operate on it,
 * so the per-card refactor is purely additive — the focus-walk suite passes
 * unchanged against the default context, and every hook stays a clean no-op with
 * no manager.
 *
 * Co-locates `FocusManagerContext` so the provider and `useFocusable` can import
 * it without a circular dependency -- the same pattern `responder-chain.ts` uses
 * for `ResponderChainContext`.
 *
 * State-zone classification ([L24]): the per-card key-view id, focusable records,
 * and mode stack are all **structure** zone (registry + `useLayoutEffect` at the
 * hook). The `data-key-view` attribute is the **appearance** projection of the
 * key view, written directly to the DOM ([L06]) -- never React state.
 */

import { createContext } from "react";
import type { TugAction } from "./action-vocabulary";
import type { ComponentKeyDeclaration, FocusKey } from "./focus-act";
import type { ResponderChainManager } from "./responder-chain";
import { resolveSpatial, type SpatialDirection, type SpatialOrder } from "./spatial-order";

/**
 * The behavior a key-view component declares to the engine ([P01]): the pure
 * decision fields the act resolver reads ({@link ComponentKeyDeclaration}) plus
 * the callbacks the engine invokes to carry an act out. The engine owns the
 * scope mechanics (ascend = pop); the component supplies the rest, so behavior
 * follows from the declaration rather than a bespoke per-component keymap.
 */
export interface KeyViewBehavior extends ComponentKeyDeclaration {
  /** Space: select / toggle the current item. Enter never commits a group member ([P24]). */
  onSelect?: () => void;
  /** A plain act on a leaf (Enter / Space on a non-item component). */
  onAct?: () => void;
  /** Enter on a descendable item: the component pushes its inner scope + lands the key view inside it. */
  onDescend?: () => void;
  /** Optional cleanup when the engine ascends out of this component's descended scope. */
  onAscend?: () => void;
}

/**
 * The live delegation contract a selection-group key view exposes to the spatial
 * navigator ([P22] / [Q12]). The group is ONE ring node; when the ring rests on it,
 * an arrow that stays inside the group drives its `useFocusCursor` 1D cursor instead
 * of moving the ring, and only an arrow off the group's edge crosses a declared seam
 * to the next key view. The handle is appearance-only ([L06]): it moves the cursor
 * and fires any live commit; it never registers a focusable.
 */
export interface SpatialCursorHandle {
  /** Number of cursor positions (live; reflects enabled items). */
  length: () => number;
  /** Current cursor index (live), or `-1` when empty. */
  cursorIndex: () => number;
  /** Move the 1D cursor by ±1 (clamped) and fire the group's live commit, if any. */
  moveCursor: (delta: 1 | -1) => void;
  /**
   * If `ArrowRight` should descend the current item (tree disclosure — an open
   * accordion section / a list row with navigable content), descend and return
   * `true`; else `false`. Consulted before spatial movement so Right keeps its
   * disclosure meaning wherever descent is available ([P02]).
   */
  tryDescendRight: () => boolean;
}

// ---- Focus modes ----

/**
 * The id of the base focus mode -- the bottom of a context's mode stack, always
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
 * `data-keyboard-access`. Projected only by the **key card's** context.
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
 * A focus mode (scope) on a context's stack. Mirrors a CFRunLoop mode: while it
 * is current, the Tab walk services only the focusables registered into it
 * ({@link FocusContext.walkModeSet}) — a focus trap for free, for EVERY pushed
 * mode.
 *
 * `trapped` does NOT widen the Tab walk; it selects the Escape semantics:
 * - `trapped: true` -- modal. Escape DISMISSES the surface (sheet / alert /
 *   popover / menu, and a card's focus-cycle).
 * - `trapped: false` -- a descend scope (an accordion section, a list row).
 *   Escape ASCENDS one level instead of dismissing. Tab is still contained to
 *   this scope's focusables (a locked loop) — see {@link FocusContext.walkModeSet}.
 */
export interface FocusMode {
  scopeId: string;
  trapped: boolean;
}

/**
 * Whether a keyboard value-commit at a cycle stop keeps the cycle (`retain`) or
 * pops it back to the resting key view (`relinquish`) — [P15] of the
 * focus-language plan. The disposition is carried by the focus *mode* (set by
 * whichever primitive pushed it), so the act dispatch stays policy-agnostic.
 */
export type CycleDisposition = "retain" | "relinquish";

/** The act-dispatch commit kinds that a mode's `commitDisposition` reacts to. */
export type FocusCommitKind = "select" | "act" | "descend";

/** The commit a mode's `commitDisposition` is consulted with. */
export interface FocusCommit {
  kind: FocusCommitKind;
  /** The key view (stop) that committed, for per-stop override decisions. */
  keyViewId: string | null;
}

/**
 * Internal mode-stack entry. Adds `restoreKeyView`: the key view that was
 * current when this mode was pushed, restored when it is popped — the
 * CFRunLoop "pop restores the prior key view" semantic ([#cfrunloop-model]).
 * `restoreKeyViewKeyboard` snapshots whether that key view was keyboard-driven,
 * so the restore re-paints the ring iff it was there before the push (e.g. a
 * popover opened by keyboard from a focus-cycling stop returns to the ringed
 * stop on close; a mouse-opened one restores ringless).
 * `commitDisposition` ([P15]): consulted when a stop commits a value by
 * keyboard while this mode is current; `relinquish` pops the mode.
 */
interface FocusModeEntry extends FocusMode {
  restoreKeyView: string | null;
  restoreKeyViewKeyboard: boolean;
  commitDisposition?: (commit: FocusCommit) => CycleDisposition;
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
 * tugbank-backed store (wired separately) and is **deck-global** (the coordinator
 * holds it; every context's walk reads it).
 */
export type KeyboardAccessMode = "standard" | "accessibility";

/**
 * The shape a caller (the `useFocusable` hook, or a test) hands to
 * `registerFocusable`. `policy` and `modes` are optional and normalized to
 * their defaults inside the context.
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
 * A normalized focusable record held in a context's registry. `policy` and
 * `modes` are filled in; `seq` is a monotonic registration counter used as the
 * final sort tiebreak so the walk order is deterministic.
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

// ---- FocusContext ----

/**
 * One card's self-contained focus universe ([P21]). Owns the focusable registry,
 * the focus-mode stack, the key view (id + keyboard-ness), the key-within, the
 * default-ring stack, and the group order + default-action map. All of the walk,
 * seed, mode, and DOM-projection logic operates on *this* context.
 *
 * It reads deck-global settings (keyboard-access mode, ring modality) and the
 * "am I the key card?" gate from its coordinator ({@link FocusManager}), and
 * notifies the coordinator's single global subscriber set on change. **Only the
 * key card's context projects to the DOM**: every projection method is a no-op
 * when this context is not active, so a background card mutating its own stack
 * (a dialog mounting at `display:none`) never clobbers the active card's marks.
 * The coordinator calls {@link projectAll} when this context becomes the key
 * card, reconciling the DOM via the same "clear all globally, then stamp" pass
 * that is the safety net against a stale mark from a just-deactivated context.
 */
export class FocusContext {
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
  // Stack of buttons that have opted into the persistent default ring (the
  // "Return's home" filled+ring shown while the keyboard rests on a non-button
  // control). The engine owns the `data-default-ring` DOM attribute so the
  // one-filled-ring-per-scope invariant ([P14]) is structural: the TOP node
  // wears the ring iff the current key view is NOT itself a button. Per-card.
  private defaultRingStack: HTMLElement[] = [];
  private seqCounter = 0;
  // Declared spatial arrow orders ([P23] / [Q12]), keyed by the focus mode
  // (`scopeId`) they govern — a card's base order, a dialog trap's own order. The
  // navigator looks up the order for the current mode; pure ring/seam/override data
  // (structure zone, [L22]). Group nodes are discovered live from `cursorHandles`,
  // not declared here.
  private spatialOrders: Map<string, SpatialOrder> = new Map();
  // Live cursor handles for selection-group key views (the [Q12] delegation
  // contract). Present only while a group is mounted; the navigator consults the
  // ringed node's handle to delegate an in-group arrow to the cursor.
  private cursorHandles: Map<string, SpatialCursorHandle> = new Map();
  // Focus keys (`group:order`) of keyboard key views whose focusable had not
  // mounted when the focus axis restored ([focus-transfer] `deferred-dom`). The
  // ring re-lights the moment a matching focusable registers — the late-mount
  // retry for the keyboard ring across reload / relaunch.
  private pendingKeyboardRestore = new Set<string>();

  constructor(
    private readonly coord: FocusManager,
    /** The card this context belongs to, or `null` for the default context. */
    readonly cardId: string | null,
  ) {}

  // ---- Coordinator-facing gates / settings ----

  /** Whether this context is the key card's context (the only one that projects). */
  private isActive(): boolean {
    return this.coord.isActiveContext(this);
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
    this.notify();
    // Late-mount keyboard-ring resume: if this focusable's stable `group:order`
    // is the saved key view whose element wasn't in the DOM when the focus axis
    // restored ([focus-transfer] `armKeyboardRestore`), re-light the ring on it
    // now. `focusKeyView` runs under the coordinator's `suppressChainSeed`, so
    // the `focusin` it fires can't re-seed the key view back to keyboard=false.
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
      this.notify();
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
    this.notify();
  }

  // ---- Key view ----

  /**
   * Set the key view to `id` (or `null` to clear). Writes the `data-key-view`
   * DOM attribute on exactly one element, plus `data-key-view-kbd` when the key
   * view was reached by keyboard (so the focus ring paints) — but only while this
   * context is the key card's (projection is gated on active). No-op (other than
   * the DOM sync) when neither the value nor the modality changed.
   *
   * `keyboard` defaults to `false` (pointer / chain reflection); the Tab walk
   * and surface entry pass `true`.
   */
  setKeyView(id: string | null, keyboard = false): void {
    if (this.keyViewId === id && this.keyViewKeyboard === keyboard) return;
    this.keyViewId = id;
    this.keyViewKeyboard = keyboard;
    this.syncKeyViewDomAttribute();
    this.notify();
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
   * now (its `consumesTab` predicate returns true).
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
   * carries a non-negative tabindex, else its first tabbable descendant.
   *
   * Gated on active: only the key card's context moves DOM focus, so a background
   * card popping a mode (its dialog unmounting) never steals focus from the card
   * the user is in. A guarded no-op with no document or no key view. Returns
   * whether focus moved.
   */
  focusKeyView(): boolean {
    if (!this.isActive()) return false;
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
    // fires (see `FocusManager.suppressChainSeed`), so the walk's keyboard key
    // view survives.
    this.coord.beginSuppressChainSeed();
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
      this.coord.endSuppressChainSeed();
    }
  }

  // ---- Focus-mode stack ----

  /**
   * Push a focus mode. The pushed mode becomes current; the Tab walk services
   * only its focusables. Captures the current key view so it can be restored on
   * pop ([#cfrunloop-model]). Pushing a `scopeId` already on the stack moves it
   * to the top (re-capturing the key view at that point).
   */
  pushFocusMode(
    scopeId: string,
    opts: {
      trapped: boolean;
      commitDisposition?: (commit: FocusCommit) => CycleDisposition;
    },
  ): void {
    const existing = this.modeStack.findIndex((m) => m.scopeId === scopeId);
    if (existing !== -1) {
      this.modeStack.splice(existing, 1);
    }
    this.modeStack.push({
      scopeId,
      trapped: opts.trapped,
      restoreKeyView: this.keyViewId,
      restoreKeyViewKeyboard: this.keyViewKeyboard,
      commitDisposition: opts.commitDisposition,
    });
    this.syncFocusModeDomAttribute();
    this.syncKeyWithinDomAttribute();
    this.notify();
  }

  /**
   * Apply the current (top) mode's commit disposition after a keyboard
   * value-commit at the key view ([P15]). If the top mode declares
   * `commitDisposition` and it returns `relinquish` for this commit, pop that
   * mode. Returns whether the mode was relinquished.
   */
  applyCommitDisposition(kind: FocusCommitKind): boolean {
    const top = this.modeStack[this.modeStack.length - 1];
    if (!top || top.commitDisposition === undefined) return false;
    const disposition = top.commitDisposition({ kind, keyViewId: this.keyViewId });
    if (disposition !== "relinquish") return false;
    this.popFocusMode(top.scopeId);
    return true;
  }

  /**
   * Pop the named focus mode off the stack and restore the key view that was
   * current when it was pushed. No-op if it is not present.
   *
   * Restore fires only when popping the **top** mode (the common dismiss case);
   * popping a buried mode leaves the key view alone, since a mode still above
   * it owns the current scope.
   *
   * `restoreFocus` (default `true`) controls whether DOM focus is *moved* onto
   * the restored key view. The key-view STATE (id + ring) is always restored;
   * `restoreFocus: false` skips only the `el.focus()`.
   */
  popFocusMode(scopeId: string, opts?: { restoreFocus?: boolean }): void {
    const restoreFocus = opts?.restoreFocus ?? true;
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
      // mouse-opened one restores ringless.
      this.setKeyView(entry.restoreKeyView, entry.restoreKeyViewKeyboard);
      // The engine is the single owner of close-focus when it is returning to a
      // KEYBOARD key view (a focus-cycle / Tab stop the surface was opened from):
      // move DOM focus onto it. A non-keyboard or null restore leaves DOM focus
      // to the responder-chain fallback. Suppressed entirely when `restoreFocus`
      // is false (the caller owns the next focus). `focusKeyView` is itself gated
      // on active, so a background pop never moves focus.
      if (
        restoreFocus &&
        entry.restoreKeyView !== null &&
        entry.restoreKeyViewKeyboard
      ) {
        this.focusKeyView();
      }
    }
    // Always notify: popping a mode changes `isFocusModePushed` /
    // `currentFocusMode`, which subscribers observe (e.g. a card's `cycling`
    // flag) independently of the key view.
    this.notify();
  }

  /**
   * Move the key view to the first focusable in the current mode (authored
   * order) and return its id, or `null` if the mode has no focusables. The
   * engine's "set initial focus when a surface opens" primitive. Does not move
   * DOM focus; pair with `focusKeyView` for that.
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
   * Whether `scopeId` is anywhere on this context's mode stack — current OR
   * merely covered by a transient mode pushed on top of it (e.g. a popover
   * opened from within a focus-cycling card). A consumer that asks "am I still in
   * this mode?" (the cycling card) wants this, not top-of-stack.
   */
  isFocusModePushed(scopeId: string): boolean {
    return this.modeStack.some((m) => m.scopeId === scopeId);
  }

  /**
   * Whether the current (top) focus mode is trapped (modal). `false` at the base
   * mode. The act dispatch ascends only **non-trapped** scopes ([P02]).
   */
  currentFocusModeTrapped(): boolean {
    const top = this.modeStack[this.modeStack.length - 1];
    return top ? top.trapped : false;
  }

  /**
   * Whether a pushed (non-base) scope owns this card's key destination: there is
   * a current trap / cycle / descend AND a key view to land on. The [P20] gate —
   * the coordinator consults it on (re)activation so a pending card-modal dialog
   * (or a mid-flow cycle) is re-established as the card's focus destination
   * instead of the resting editor.
   */
  hasPushedKeyDestination(): boolean {
    return this.currentFocusMode() !== BASE_FOCUS_MODE && this.keyViewId !== null;
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
    this.notify();
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
    const accepted = this.walkModeSet();
    const accessMode = this.coord.keyboardAccessMode();
    const records: FocusableRecord[] = [];
    for (const record of this.focusables.values()) {
      const inMode = record.modes.some((m) => accepted.has(m));
      if (!inMode) continue;
      if (accessMode === "standard" && record.policy === "skip") continue;
      // A focusable in a hidden subtree is not a reachable Tab target. With
      // per-card contexts the walk already sees only THIS card's focusables, so
      // this filter is the *within-card* hidden-subtree guard (a collapsed
      // accordion section, a conditionally-hidden control) — not the retired
      // cross-card display:none exclusion. A no-op without a DOM (pure-logic walk
      // tests) and when the element can't be resolved.
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
   * The set of mode ids the Tab walk services for the current mode stack
   * ([#cfrunloop-model]).
   *
   * Every PUSHED mode CONTAINS the walk to its own focusables, whatever its
   * `trapped` flag:
   *  - a modal trap (sheet / inline dialog) — Tab cycles the surface, Escape
   *    dismisses;
   *  - a card's focus-cycle — Tab cycles the card's stops;
   *  - a **descend** scope (an accordion section, a list row) — Tab is a LOCKED
   *    loop inside the descended content, and Escape ASCENDS one level.
   *
   * `trapped` governs only the Escape semantics (ascend vs dismiss), NOT the
   * breadth of the Tab walk — a non-trapped descend is still Tab-contained. A
   * descend must never widen the walk to the enclosing scope (it would break the
   * locked loop). (Per-card contexts already isolate each card's base mode, so
   * `BASE_FOCUS_MODE` no longer spans other cards.) Only the bare base mode
   * (nothing pushed) services the base focusables.
   */
  private walkModeSet(): Set<string> {
    const top = this.modeStack[this.modeStack.length - 1];
    return new Set<string>([top ? top.scopeId : BASE_FOCUS_MODE]);
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
   * by the walk to exclude focusables inside a hidden (`display: none`) subtree
   * **inside the active card** (a collapsed accordion section). Returns `true`
   * when there is no document or the element can't be resolved, so the in-memory
   * walk (tests / SSR) is never narrowed by a DOM that isn't there.
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
   * pointer-inert by CSS (`pointer-events: none`). Reads the DOM at walk time;
   * permissive without a DOM (returns `true`) so the pure-logic walk tests are
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

  // ---- Spatial arrow navigation ([P22] / [P23]) ----

  /**
   * Declare the spatial arrow order for a focus mode (the bounded scope a card or
   * dialog draws). Registration ([Q12]); read by {@link moveKeyViewSpatial} for the
   * current mode. No DOM projection, so no notify.
   */
  registerSpatialOrder(scopeId: string, order: SpatialOrder): void {
    this.spatialOrders.set(scopeId, order);
  }

  /** Drop a declared spatial order (on unmount of the layout that declared it). */
  unregisterSpatialOrder(scopeId: string): void {
    this.spatialOrders.delete(scopeId);
  }

  /** Register a group key view's live cursor handle (the delegation contract). */
  registerCursorHandle(id: string, handle: SpatialCursorHandle): void {
    this.cursorHandles.set(id, handle);
  }

  /** Drop a group's cursor handle (on unmount / when it stops being a group). */
  unregisterCursorHandle(id: string): void {
    this.cursorHandles.delete(id);
  }

  /**
   * Move the focus ring spatially in `direction` ([P22] / [P23]): delegate an
   * in-group arrow to the ringed group's cursor, cross a declared seam / ring at a
   * boundary, or descend on Right where disclosure is available. Returns `true` when
   * the navigator owns the arrow (moved the ring, drove a group cursor, descended,
   * or held a group at an undeclared edge), so the caller consumes it; `false` when
   * no declared order and no group claim this arrow — it is not the spatial plane's.
   *
   * Never beeps: a closed ring always yields a next node and a declared seam always
   * has a target; a group at an undeclared edge holds (clamps) rather than failing.
   * A non-group node with a declared order but no target for this arrow is a *dead
   * arrow* ([R06]) — warned at dev time, never a beep.
   */
  moveKeyViewSpatial(direction: SpatialDirection): boolean {
    const id = this.keyViewId;
    if (id === null) return false;
    const handle = this.cursorHandles.get(id);
    // Tree-disclosure descend on Right keeps its meaning wherever descent is
    // available ([P02]) — consulted before spatial movement.
    if (direction === "right" && (handle?.tryDescendRight() ?? false)) return true;
    const order = this.spatialOrders.get(this.currentFocusMode());
    if (order === undefined && handle === undefined) return false;
    // The declared order references nodes by their stable `group:order` focus key
    // ([Q12]) — the same key the dialog seeds with — so an author never needs an
    // auto-generated focusable id. Map the ringed id to its key (fall back to the
    // raw id for an unkeyed node, e.g. the engine tests).
    const node = this.focusKeyOf(id) ?? id;
    // Inject the ringed group's LIVE cursor length so the resolver can detect its
    // edge; only the current node's group-ness matters to a single resolution.
    const effective: SpatialOrder = {
      rings: order?.rings ?? [],
      seams: order?.seams,
      overrides: order?.overrides,
      groups: handle !== undefined ? [{ node, length: handle.length() }] : order?.groups,
    };
    const cursorIndex = handle !== undefined ? handle.cursorIndex() : null;
    const resolution = resolveSpatial(effective, node, direction, cursorIndex);
    if (resolution.kind === "cursor") {
      handle?.moveCursor(resolution.delta);
      return true;
    }
    if (resolution.kind === "ring") {
      const targetId = this.idForFocusKey(resolution.target);
      const targetRecord = targetId !== null ? this.focusables.get(targetId) : undefined;
      if (
        targetId !== null &&
        targetRecord !== undefined &&
        this.isRecordRendered(targetRecord) &&
        this.isRecordInteractive(targetRecord)
      ) {
        this.setKeyView(targetId, true);
        this.focusKeyView();
        return true;
      }
      // The declared target is absent or non-interactive (a disabled stop — e.g. a
      // toolbar chip on the Shell route). Don't strand the ring on a dead node: fall
      // through to the liveliness walk below, which skips disabled stops and lands on
      // the next interactive key view. So an author can declare a fixed grid over a
      // dynamic layout without recomputing membership per state.
    }
    // resolution.kind === "none" — no spatial target (a group edge, or an arrow the
    // declared rings / seams don't cover) — or a ring target that was non-interactive.
    if (order !== undefined && this.nodeInOrder(order, node)) {
      // Liveliness ([P23] — "never beeps falls back to the design-time ordering"):
      // within a declared spatial scope, fall back to the linear groupOrder walk —
      // down / right advance, up / left retreat, both wrapping. Every arrow moves the
      // ring SOMEWHERE; the interface never beeps and never silently swallows the
      // key. (The authored rings / seams give the *spatial* feel; this is the net
      // under them so a layout can never trap the ring in a dead-end corner.)
      //
      // Gated on the ringed node actually being *part of* the declared order: a key
      // view the author left OUT of the order (a Tab-reached list that owns its own
      // arrows) is not on the spatial plane, so the navigator yields the arrow to that
      // surface's own handler rather than dragging it into the linear net.
      const moved =
        direction === "down" || direction === "right"
          ? this.focusNext()
          : this.focusPrevious();
      if (moved !== null) {
        this.focusKeyView();
        return true;
      }
    }
    if (handle !== undefined) {
      // A group at an edge in a scope with NO declared order: hold the cursor (clamp)
      // and consume the arrow so the page does not scroll — Tab leaves the group.
      return true;
    }
    return false;
  }

  /**
   * Whether a node key is referenced anywhere in a declared order — as a ring
   * member, a seam / override endpoint, or a delegated group. A node the author did
   * not place in the order is off the spatial plane: the navigator yields its arrows
   * (it does not apply the liveliness fallback) so a Tab-reached surface keeps its
   * own keyboard.
   */
  private nodeInOrder(order: SpatialOrder, node: string): boolean {
    if (order.rings.some((ring) => ring.nodes.includes(node))) return true;
    if (order.seams?.some((seam) => seam.from === node || seam.to === node)) return true;
    if (order.overrides?.some((o) => o.from === node || o.to === node)) return true;
    if (order.groups?.some((group) => group.node === node)) return true;
    return false;
  }

  /** A focusable's stable spatial node key (`group:order`), or `null` if ungrouped. */
  private focusKeyOf(id: string): string | null {
    const record = this.focusables.get(id);
    if (record === undefined || record.group === "") return null;
    return `${record.group}:${record.order}`;
  }

  /**
   * The id of the rendered focusable with this `group:order` key, or `null`. Prefers
   * a rendered record so the navigator lands the ring on a live target.
   */
  private idForFocusKey(focusKey: string): string | null {
    let fallback: string | null = null;
    for (const record of this.focusables.values()) {
      if (record.group === "" || `${record.group}:${record.order}` !== focusKey) continue;
      if (this.isRecordRendered(record)) return record.id;
      fallback ??= record.id;
    }
    return fallback;
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

  // ---- Default ring ----

  /**
   * Register a button as this card's persistent-default-ring node ([P14]). The
   * engine owns the `data-default-ring` attribute from here, projecting it in
   * lockstep with the key view. Innermost-wins: a nested surface's node takes
   * over while mounted and the prior node is restored on
   * {@link unregisterDefaultRing}.
   */
  registerDefaultRing(node: HTMLElement): void {
    if (this.defaultRingStack.includes(node)) return;
    this.defaultRingStack.push(node);
    this.syncDefaultRingDomAttribute();
  }

  /** Remove a persistent-default-ring node (on unmount / opt-out). */
  unregisterDefaultRing(node: HTMLElement): void {
    const i = this.defaultRingStack.indexOf(node);
    if (i < 0) return;
    this.defaultRingStack.splice(i, 1);
    node.removeAttribute("data-default-ring");
    this.syncDefaultRingDomAttribute();
  }

  // ---- DOM projection (key-card only) ----

  /**
   * Project all three engine marks for this context — called by the coordinator
   * when this context becomes the key card. The per-mark sync methods are gated
   * on active (so a background context never projects); at the moment the
   * coordinator calls this, this context IS active. Each runs its "clear all
   * globally, then stamp" pass, which doubles as the safety net that wipes a
   * stale mark left by the just-deactivated context.
   */
  projectAll(): void {
    this.syncKeyViewDomAttribute();
    this.syncKeyWithinDomAttribute();
    this.syncFocusModeDomAttribute();
  }

  /**
   * Project the key view onto the DOM: clear `data-key-view` from any element
   * that carries it, then stamp it on the element whose `data-responder-id`
   * or `data-tug-focusable` matches the current key-view id. Gated on active —
   * only the key card's context writes the projection.
   */
  private syncKeyViewDomAttribute(): void {
    if (typeof document === "undefined" || !this.isActive()) return;
    document.querySelectorAll<HTMLElement>("[data-key-view]").forEach((el) => {
      el.removeAttribute("data-key-view");
      el.removeAttribute("data-key-view-kbd");
    });
    const el = this.keyViewElement();
    if (el !== null && this.keyViewId !== null) {
      el.setAttribute("data-key-view", this.keyViewId);
      // The focus ring paints on a keyboard-reached key view (the engine's own
      // signal, since `:focus-visible` is unreliable for programmatic focus) —
      // and, when the ring-follows-pointer policy is on, on any pointer-driven
      // key-view change too.
      if (this.keyViewKeyboard || this.coord.ringFollowsPointerMode()) {
        el.setAttribute("data-key-view-kbd", "");
      }
    }
    // The default ring tracks the same signal, so it is recomputed in lockstep
    // with the key view ([P14] one filled+ring per scope).
    this.syncDefaultRingDomAttribute();
  }

  /** Resolve the DOM element carrying the current key view, or `null`. */
  private keyViewElement(): HTMLElement | null {
    if (typeof document === "undefined" || this.keyViewId === null) return null;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(this.keyViewId)
        : this.keyViewId;
    return document.querySelector<HTMLElement>(
      `[data-responder-id="${escaped}"], [data-tug-focusable="${escaped}"]`,
    );
  }

  /**
   * Whether the current key view is itself a button — the one control that
   * claims the scope's Return for its own activation.
   */
  private keyViewIsButton(): boolean {
    const el = this.keyViewElement();
    if (el === null) return false;
    return el instanceof HTMLButtonElement || el.closest(".tug-button") !== null;
  }

  /**
   * Project the persistent default ring: clear `data-default-ring` from every
   * registered node, then stamp it on the TOP node iff the current key view is
   * not itself a button ([P14]). Gated on active.
   */
  private syncDefaultRingDomAttribute(): void {
    if (typeof document === "undefined" || !this.isActive()) return;
    for (const node of this.defaultRingStack) node.removeAttribute("data-default-ring");
    const top = this.defaultRingStack[this.defaultRingStack.length - 1];
    if (top === undefined) return;
    if (!this.keyViewIsButton()) top.setAttribute("data-default-ring", "");
  }

  /**
   * Project the **immediate container** of the key view onto the DOM (depth 1):
   * clear `data-key-within` from any element that carries it, then — when a scope
   * is descended into — stamp it on the element whose `data-tug-focusable` /
   * `data-responder-id` matches the top scope's `restoreKeyView`. Gated on
   * active. At base (no pushed scope) nothing is marked.
   */
  private syncKeyWithinDomAttribute(): void {
    if (typeof document === "undefined" || !this.isActive()) return;
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
   * Gated on active — the document root carries exactly the key card's mode.
   */
  private syncFocusModeDomAttribute(): void {
    if (typeof document === "undefined" || !this.isActive()) return;
    const mode = this.currentFocusMode();
    if (mode === BASE_FOCUS_MODE) {
      document.documentElement.removeAttribute(FOCUS_MODE_ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(FOCUS_MODE_ATTRIBUTE, mode);
    }
  }

  // ---- Internal ----

  private notify(): void {
    this.coord.notifyChange();
  }
}

// ---- FocusManager (deck coordinator) ----

export class FocusManager {
  // The per-card focus universes, keyed by cardId, plus the default context for
  // the no-card path (tests / gallery / standalone previews).
  private contexts: Map<string, FocusContext> = new Map();
  private readonly defaultContext: FocusContext;
  // The key card — activation-driven authority ([P21]). `null` = no card active,
  // so the default context is serviced. Set by `setKeyCard` / `adoptKeyCard`
  // from the activation-focus channel; projection is downstream of it.
  private keyCardId: string | null = null;

  // ---- Deck-global settings ----
  // When true, the focus ring also follows *pointer*-driven key-view changes.
  private ringFollowsPointer = false;
  private accessMode: KeyboardAccessMode = "standard";

  // ---- Subscription (single global notify-all) ----
  private version = 0;
  private subscribers: Set<() => void> = new Set();

  // ---- Chain attachment ----
  private chain: ResponderChainManager | null = null;
  private chainUnsubscribe: (() => void) | null = null;
  // Set while a context's `focusKeyView` moves DOM focus. The walk has just
  // chosen a key view (keyboard=true); the `focusin` that `el.focus()` fires
  // synchronously promotes that element's nearest *responder* (often a coarser
  // container), which would otherwise re-seed the key view back with
  // keyboard=false, dropping the ring. Suppress the chain re-seed for the
  // duration of that programmatic focus so the walk's choice stands.
  private suppressChainSeed = false;
  // Set while a *pointer*-driven first-responder promotion runs (see
  // `runPointerPromotion`). A pointer interaction re-seeds the key view to the
  // promoted responder and clears the ring (click-to-focus); any other chain
  // reflection is programmatic and yields to a finer focusable key view.
  private pointerPromotionActive = false;

  constructor() {
    this.defaultContext = new FocusContext(this, null);
  }

  // ---- Context resolution / key card ----

  /**
   * Resolve the {@link FocusContext} for a card. A concrete `cardId` routes to
   * that card's context (created lazily) — even when it is a *background* card,
   * which is how a dialog mounting in a non-key card lands its trap in the right
   * universe. `null` (a card-less surface, or the gallery) routes to the **active
   * context**: chrome around the key card belongs to the key card, and with no
   * key card the active context is the default context. The hooks pass the
   * `CardIdContext` value here.
   */
  contextFor(cardId: string | null): FocusContext {
    if (cardId === null) return this.activeContext();
    let ctx = this.contexts.get(cardId);
    if (ctx === undefined) {
      ctx = new FocusContext(this, cardId);
      this.contexts.set(cardId, ctx);
    }
    return ctx;
  }

  /**
   * The context the coordinator services — the key card's, or the default
   * context when no key card is set. Every param-free public method below
   * delegates here (the document-listener path + the pure-logic tests).
   */
  activeContext(): FocusContext {
    if (this.keyCardId === null) return this.defaultContext;
    return this.contexts.get(this.keyCardId) ?? this.defaultContext;
  }

  /** Whether `ctx` is the active (key card's) context — the projection gate. */
  isActiveContext(ctx: FocusContext): boolean {
    return this.activeContext() === ctx;
  }

  /** The current key card id, or `null`. Activation-driven authority. */
  keyCard(): string | null {
    return this.keyCardId;
  }

  /**
   * Set the key card and project its context to the DOM ([P21] activation). The
   * new active context's `projectAll` runs its "clear all globally, then stamp"
   * pass, reconciling away the just-deactivated context's marks. Idempotent for
   * an unchanged key card (re-projects so a re-activation of the same card — a
   * window blur→focus — re-stamps its marks). Pass `null` to clear the key card
   * (back to the default context).
   */
  setKeyCard(cardId: string | null): void {
    const changed = this.keyCardId !== cardId;
    this.keyCardId = cardId;
    this.activeContext().projectAll();
    if (changed) this.touch();
  }

  /**
   * Adopt `cardId` as the key card and, if its context already owns a pushed key
   * destination (a pending card-modal dialog's trap, a mid-flow cycle, a
   * descended scope), land DOM focus on it and report `true` ([P20]). The
   * activation-focus channel (`applyBagFocus`) calls this first: when it returns
   * `true` the dialog (not the resting editor) is the card's destination and the
   * caller skips its framework/engine focus claim; when `false` the card is at
   * rest and the caller proceeds to focus the editor as before.
   *
   * `keyCardId` is set in TWO places, by design — they are complementary, never
   * conflicting (both write the same activating card id):
   *  1. the provider's deck-store subscription (`syncKeyCard`) is the *structural
   *     authority* — it sets `keyCardId` for every way a card becomes active,
   *     including the initial seed / same-bit case where no `cardDidActivate`
   *     fires;
   *  2. this `adoptKeyCard` (the focus claim) sets it again — idempotent when the
   *     subscription already did, but it also performs the [P20] focus restore and
   *     covers cold-boot ordering where the focus claim can precede the store
   *     notify. Don't "simplify" the `setKeyCard` out of here.
   */
  adoptKeyCard(cardId: string): boolean {
    this.setKeyCard(cardId);
    const ctx = this.activeContext();
    if (!ctx.hasPushedKeyDestination()) return false;
    ctx.focusKeyView();
    return true;
  }

  // ---- Chain attachment (key-view seeding) ----

  /**
   * Bind to the responder chain so the active context's key view tracks the
   * first responder. The provider calls this from the same `useLayoutEffect`
   * that installs the chain's document listeners, and `detach` from its cleanup.
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

  /** Unsubscribe from the chain. Safe to call when not attached. */
  detach(): void {
    this.chainUnsubscribe?.();
    this.chainUnsubscribe = null;
    this.chain = null;
  }

  /**
   * Reflect the chain's first responder onto the active context's key view. The
   * key view is the most *specific* focus target: a chain reflection that merely
   * re-promotes a registered focusable's coarser *container* must not coarsen the
   * key view or drop its keyboard ring — it yields. Only a genuine pointer
   * interaction (run through {@link runPointerPromotion}) or a reflection that
   * moves to a different subtree changes an established finer key view.
   */
  private seedKeyViewFromChain(): void {
    if (this.chain === null) return;
    const frId = this.chain.getFirstResponder();
    if (!this.pointerPromotionActive && this.keyViewIsFinerThan(frId)) return;
    this.activeContext().setKeyView(frId);
  }

  /**
   * Whether the active context's current key view is a registered focusable whose
   * element lives inside the element of `responderId` — i.e. the key view is
   * *finer* than the responder the chain just promoted. DOM-free environments and
   * unmatched ids resolve to `false` (no yield).
   */
  private keyViewIsFinerThan(responderId: string | null): boolean {
    const keyViewId = this.activeContext().keyView();
    if (responderId === null || keyViewId === null) return false;
    if (typeof document === "undefined") return false;
    const esc = (s: string) =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(s) : s;
    const kvEl = document.querySelector(`[data-tug-focusable="${esc(keyViewId)}"]`);
    const rEl = document.querySelector(`[data-responder-id="${esc(responderId)}"]`);
    if (kvEl === null || rEl === null) return false;
    return rEl.contains(kvEl);
  }

  /**
   * Run `fn` (a first-responder promotion) marked as pointer-driven, so the
   * chain reflection it triggers coarsens the key view and clears the ring — the
   * click-to-focus path. Synchronous.
   */
  runPointerPromotion(fn: () => void): void {
    this.pointerPromotionActive = true;
    try {
      fn();
    } finally {
      this.pointerPromotionActive = false;
    }
  }

  /** Begin/end suppression of the chain re-seed around a programmatic `.focus()`. */
  beginSuppressChainSeed(): void {
    this.suppressChainSeed = true;
  }
  endSuppressChainSeed(): void {
    this.suppressChainSeed = false;
  }

  // ---- Keyboard-access mode (deck-global) ----

  /** Set the keyboard-access mode every context's walk reads. */
  setKeyboardAccessMode(mode: KeyboardAccessMode): void {
    if (this.accessMode === mode) return;
    this.accessMode = mode;
    this.touch();
  }

  /** The current keyboard-access mode. */
  keyboardAccessMode(): KeyboardAccessMode {
    return this.accessMode;
  }

  // ---- Ring modality (deck-global) ----

  /**
   * Set whether the focus ring follows pointer-driven key-view changes in
   * addition to keyboard navigation. Repaints immediately by re-projecting the
   * active context (appearance-zone DOM only — no React notify).
   */
  setRingFollowsPointer(value: boolean): void {
    if (this.ringFollowsPointer === value) return;
    this.ringFollowsPointer = value;
    this.activeContext().refreshKeyViewProjection();
  }

  /** Whether the ring currently follows pointer-driven key-view changes. */
  ringFollowsPointerMode(): boolean {
    return this.ringFollowsPointer;
  }

  // ---- Subscription (for useSyncExternalStore consumers, [L02]) ----

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

  /** Internal: a context mutated — bump the global version and notify all. */
  notifyChange(): void {
    this.touch();
  }

  private touch(): void {
    this.version += 1;
    for (const cb of this.subscribers) {
      cb();
    }
  }

  // ---- Active-context delegations ----
  //
  // The document-listener path and the pure-logic tests call these param-free
  // methods on the coordinator; each services the **key card's** context (the
  // default context when no key card is set). Card-scoped hooks that must target
  // a specific (possibly background) card resolve {@link contextFor} instead.

  registerFocusable(input: FocusableInput): void {
    this.activeContext().registerFocusable(input);
  }
  unregisterFocusable(id: string): void {
    this.activeContext().unregisterFocusable(id);
  }
  armKeyboardRestore(focusKey: string): void {
    this.activeContext().armKeyboardRestore(focusKey);
  }
  setGroupOrder(groups: string[]): void {
    this.activeContext().setGroupOrder(groups);
  }
  setKeyView(id: string | null, keyboard = false): void {
    this.activeContext().setKeyView(id, keyboard);
  }
  refreshKeyViewProjection(keyboard?: boolean): void {
    this.activeContext().refreshKeyViewProjection(keyboard);
  }
  keyView(): string | null {
    return this.activeContext().keyView();
  }
  keyViewIsKeyboard(): boolean {
    return this.activeContext().keyViewIsKeyboard();
  }
  keyViewConsumesTab(): boolean {
    return this.activeContext().keyViewConsumesTab();
  }
  keyViewBehavior(): KeyViewBehavior | null {
    return this.activeContext().keyViewBehavior();
  }
  keyViewCaptures(key: FocusKey): boolean {
    return this.activeContext().keyViewCaptures(key);
  }
  ascend(): boolean {
    return this.activeContext().ascend();
  }
  focusKeyView(): boolean {
    return this.activeContext().focusKeyView();
  }
  pushFocusMode(
    scopeId: string,
    opts: {
      trapped: boolean;
      commitDisposition?: (commit: FocusCommit) => CycleDisposition;
    },
  ): void {
    this.activeContext().pushFocusMode(scopeId, opts);
  }
  popFocusMode(scopeId: string, opts?: { restoreFocus?: boolean }): void {
    this.activeContext().popFocusMode(scopeId, opts);
  }
  applyCommitDisposition(kind: FocusCommitKind): boolean {
    return this.activeContext().applyCommitDisposition(kind);
  }
  focusFirstInMode(): string | null {
    return this.activeContext().focusFirstInMode();
  }
  currentFocusMode(): string {
    return this.activeContext().currentFocusMode();
  }
  isFocusModePushed(scopeId: string): boolean {
    return this.activeContext().isFocusModePushed(scopeId);
  }
  currentFocusModeTrapped(): boolean {
    return this.activeContext().currentFocusModeTrapped();
  }
  setDefaultAction(scopeId: string, action: TugAction | null): void {
    this.activeContext().setDefaultAction(scopeId, action);
  }
  resolveDefaultAction(): TugAction | null {
    return this.activeContext().resolveDefaultAction();
  }
  focusNext(): string | null {
    return this.activeContext().focusNext();
  }
  focusPrevious(): string | null {
    return this.activeContext().focusPrevious();
  }
  moveKeyViewSpatial(direction: SpatialDirection): boolean {
    return this.activeContext().moveKeyViewSpatial(direction);
  }
  walkOrder(): FocusableRecord[] {
    return this.activeContext().walkOrder();
  }
  registerDefaultRing(node: HTMLElement): void {
    this.activeContext().registerDefaultRing(node);
  }
  unregisterDefaultRing(node: HTMLElement): void {
    this.activeContext().unregisterDefaultRing(node);
  }
}

// ---- React context ----

/**
 * React context holding the singleton FocusManager (deck coordinator) for the
 * canvas subtree. Default `null` (outside any provider). Co-located here so
 * `use-focusable.tsx` and `responder-chain-provider.tsx` import it without a
 * circular dependency -- the same arrangement as `ResponderChainContext`.
 */
export const FocusManagerContext = createContext<FocusManager | null>(null);

// ---- Global handle ----
//
// Last-registration-wins module singleton so framework code outside the React
// tree can reach the engine — the same arrangement as
// `registerResponderChainManager`. Used by the single-channel focus dispatcher
// (`applyBagFocus` in `focus-transfer.ts`) to set the key card on activation and
// re-light the keyboard ring as part of a focus-axis restore. Set by
// `responder-chain-provider` on mount.

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
