/**
 * focus-transfer.ts — the single seam through which the framework
 * transfers keyboard focus and caret state between cards on an
 * activation-driven trigger.
 *
 * ## Why this exists
 *
 * Before this module, every activation path (intra-pane tab click, pane
 * activation, tab-close handoff, cross-pane drag / detach, cold-boot
 * restore) maintained its own "save outgoing, flip bit, restore
 * incoming" dance. Each one diverged on ordering, on which axis it
 * touched, and on whether it gated via the focus-theft rules. The
 * reactive `[A3]` effect subsumed three of those paths into a single
 * `useLayoutEffect`, which closed the divergence but introduced a
 * rapid-cadence race: when a store mutation and the prior effect's
 * commit landed in the same React tick, React's batching delivered the
 * activation body one frame late — the user saw focus dwell on the
 * outgoing card while the incoming card's commit flashed without its
 * caret, then the incoming card caught up.
 *
 * The fix is to decouple focus transfer from React's render cycle.
 * Every activation trigger is either:
 *
 *   - synchronous user gesture (tab click, pane activation, close
 *     handoff) — drives focus transfer in the same call stack as the
 *     store mutation, never round-tripping through React,
 *
 *   - drag-driven gesture — snapshots focus at drag start, lets the
 *     re-parent commit, then re-applies focus on pointerup in the same
 *     gesture's event handler,
 *
 *   - app-lifecycle / deferred trigger (resign, resume, cold boot) —
 *     resolves targets against the post-commit DOM.
 *
 * This module is the one place in the codebase that walks the decision
 * tree from "which card is the caller activating?" to "what, if
 * anything, do I call `.focus()` on?". Callers hand in the card ids
 * and the commit closure; the module saves the outgoing bag,
 * synchronously drives the mutation to commit (so the incoming card's
 * DOM subtree is visible and mounted before a focus attempt), resolves
 * the target, gates through the focus-theft rules, and executes the
 * transfer. There is no RAF, no microtask hop, no React effect.
 *
 * ## What has shipped
 *
 * - **Step 23A** — module seam: types, store registrations, the
 *   `resolveActivationTarget` resolver. The three side-effecting
 *   entries were stubs that threw with step pointers.
 *
 * - **Step 23B Pass 3 split (a)** — `transferFocusForActivation`'s
 *   five-step body lands here, plus its first caller wiring inside
 *   `pane-focus-controller.ts` (Branch A activation). Splits (b) and
 *   (c) wire the remaining gesture sources (`tug-pane.tsx`,
 *   `deck-manager.ts#_removeCard` / `_closePane`) and retire the
 *   legacy `[A3]` `useLayoutEffect` in `CardHost`.
 *
 * - **Steps 23C / 23D** — `captureFocusForDragStart`,
 *   `transferFocusAfterMove`, and `reactivateCurrentFocusDestination`
 *   (the app-lifecycle entry) still throw; their implementations
 *   land in their respective steps.
 *
 * ## The activation target
 *
 * `resolveActivationTarget` returns an `ActivationTarget` discriminated
 * union with three variants:
 *
 *   - `{ kind: "focus-element", el }` — a concrete focusable DOM
 *     element was resolved from the card's saved `bag.focus` (or
 *     `bag.formControls` when the focused element was a persisted
 *     form control). The caller may call `.focus()` on `el` after
 *     passing the focus-theft gate.
 *
 *   - `{ kind: "dispatch-activated" }` — the card is content-owning
 *     (`bag.content !== undefined`). The caller should invoke
 *     `store.invokeActivationCallback(cardId)` and let the factory's
 *     registered `onCardActivated` handle targeting. Factories know
 *     their own "the card was just brought to front; put the caret
 *     in the right place" logic in a way the framework cannot
 *     generalize (e.g. an editor with multiple nested focusables).
 *
 *   - `{ kind: "none" }` — nothing to focus. Returned when the card
 *     is unknown, when no bag exists, when the bag declares
 *     `focus.kind === "none"`, when no host root is registered for
 *     the card, or when the targeted element is not in the DOM.
 *
 * The union carries the resolved element directly so downstream
 * gating and transfer code never re-queries. Re-querying would invite
 * a TOCTOU gap between "resolve" and "focus" — if the subtree is
 * mutated between those two reads, the gate could pass a card-root
 * contains() check while the element itself has already been removed.
 *
 * ## How the resolver reads state
 *
 * `resolveActivationTarget(cardId, store)` consults two sources:
 *
 *   1. `store.getCardState(cardId)` — the persisted bag. Drives the
 *      FC (form-control / dom) vs EM (`bag.content`) classification.
 *
 *   2. `store.peekCardHostRoot(cardId)` — the registered card-host
 *      DOM root (`[data-card-host][data-card-id="…"]`). Used as the
 *      scope for `querySelector` lookups so the resolver does not
 *      need to walk the deck container or rely on global uniqueness
 *      of the focus-key attributes (card roots are the per-card
 *      scoping anchor).
 *
 * The resolver is side-effect-free: it reads DOM via
 * `querySelector`, reads the store's bag and host-root registry, and
 * returns. It does not mutate focus, selection, or any DOM state.
 *
 * ## Not pure over the store alone
 *
 * The resolver is idempotent — calling it twice with the same inputs
 * and the same DOM yields the same result — but it is NOT pure over
 * the store value alone. Between two calls the DOM may have changed:
 * a content factory may have swapped the element that
 * `data-tug-focus-key="save"` identifies; a previously-hidden subtree
 * may have mounted; the registered host root may have detached. The
 * resolver always reads DOM live rather than caching a stale handle.
 *
 * ## Framework-local, no React
 *
 * Nothing in this module imports from React. It is called from
 * synchronous event handlers (`performSelectCard`,
 * `handleTitleBarPointerDown`, the drag coordinator's `pointerup`
 * callback, a deferred app-lifecycle listener). Callers that need to
 * sandwich a React state commit pass a `commitMutation` closure; the
 * transfer function uses `react-dom`'s `flushSync` to force the
 * mutation's commit before resolving against post-commit DOM.
 *
 * ## Tuglaws
 *
 *   - **L10** — this module owns exactly one responsibility (focus
 *     and caret transfer between cards on activation).
 *   - **L22** — the synchronous entries drive DOM writes from
 *     external state without round-tripping through a React effect.
 *   - **L23** — outgoing state is saved before any mutation; the
 *     transfer is atomic save → commit → resolve → gate → focus.
 *   - **L07** — the resolver reads current store state at call time;
 *     it does not capture a stale snapshot.
 *
 * @module focus-transfer
 */

import { flushSync } from "react-dom";

import { selectionGuard } from "./components/tugways/selection-guard";
import { deckTrace, formatElement } from "./deck-trace";
import { canProgrammaticallyFocus } from "./focus-theft-gate";

import type { IDeckManagerStore } from "./deck-manager-store";

/**
 * Local replica of `card-host.tsx`'s `isElementHidden`. Detects
 * elements that are visually absent because some ancestor (or the
 * element itself) is `display: none`. `offsetParent` is null in
 * that case for non-`position: fixed` elements; we accept fixed-
 * positioned elements as "not hidden" because they intentionally
 * have no offsetParent but remain visible.
 *
 * Replicated rather than imported so this module stays free of
 * dependencies on React component files (per the module header's
 * "framework-local, no React" contract). Two ~12-line copies is
 * cheaper than the alternative — promoting the helper into a
 * shared utility module — at this scope.
 */
function isElementHidden(el: HTMLElement | null): boolean {
  if (el === null) return false;
  if (el.offsetParent === null) {
    const style =
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(el)
        : null;
    if (style !== null && style.position === "fixed") return false;
    return true;
  }
  return false;
}

/**
 * The resolved destination of an activation-driven focus transfer.
 *
 * Every call to {@link resolveActivationTarget} returns one of these
 * three variants. Downstream gating and transfer code branches on
 * `kind` and — for `focus-element` — uses the carried `el` directly
 * without re-querying the DOM.
 */
export type ActivationTarget =
  | {
      /**
       * A concrete DOM element was resolved. The caller passes `el`
       * into the focus-theft gate and, if allowed, calls
       * `el.focus()`.
       */
      kind: "focus-element";
      el: HTMLElement;
    }
  | {
      /**
       * The card is content-owning (`bag.content !== undefined`).
       * The caller dispatches to
       * `store.invokeActivationCallback(cardId)`; the factory's
       * registered `onCardActivated` handles targeting.
       */
      kind: "dispatch-activated";
    }
  | {
      /**
       * Nothing to focus. The card is unknown, has no bag, has
       * `focus.kind === "none"`, or the target element could not
       * be located in the DOM. The caller is expected to do
       * nothing.
       */
      kind: "none";
    };

/**
 * Narrow subset of `IDeckManagerStore` that this module reads. Kept
 * narrow so tests (and future refactors) do not need to hand in the
 * full deck store — a handful of methods is enough. Downstream
 * side-effecting entries (Step 23B / 23C / 23D) will expand this list
 * as they wire in the mutation and dispatch paths.
 */
export type FocusTransferStore = Pick<
  IDeckManagerStore,
  "getCardState" | "peekCardHostRoot"
>;

/**
 * Resolve the activation target for `cardId`.
 *
 * Consults the card's persisted bag via `store.getCardState(cardId)`
 * and, when the bag describes a DOM-authority card with a saved
 * focus snapshot, queries the registered card-host root via
 * `store.peekCardHostRoot(cardId)` to produce a concrete
 * `HTMLElement`. See the module header for the full contract.
 *
 * Side-effect-free. Callers may invoke this as often as needed; the
 * only side channel it reads is the live DOM.
 */
export function resolveActivationTarget(
  cardId: string,
  store: FocusTransferStore,
): ActivationTarget {
  const bag = store.getCardState(cardId);
  if (bag === undefined) return { kind: "none" };

  // Content-owning cards dispatch through the factory's registered
  // callback. We don't try to resolve a DOM element for them — the
  // factory knows where focus should land in its own subtree.
  if (bag.content !== undefined) return { kind: "dispatch-activated" };

  const focus = bag.focus;
  if (!focus || focus.kind === "none") return { kind: "none" };

  const hostRoot = store.peekCardHostRoot(cardId);
  if (hostRoot === null) return { kind: "none" };

  let el: HTMLElement | null = null;
  if (focus.kind === "form-control") {
    el = hostRoot.querySelector<HTMLElement>(
      `[data-tug-persist-value="${CSS.escape(focus.persistKey)}"]`,
    );
  } else if (focus.kind === "dom") {
    el = hostRoot.querySelector<HTMLElement>(
      `[data-tug-focus-key="${CSS.escape(focus.focusKey)}"]`,
    );
  } else if (focus.kind === "component-owned") {
    el = hostRoot.querySelector<HTMLElement>(
      "[data-tug-prompt-input-root] [contenteditable]",
    );
  }

  if (el === null) return { kind: "none" };

  // Defensive check. The registered host root may have been detached
  // since registration without a matching unregister (the callback-
  // ref cleanup in `CardHost` handles the common case, but nothing
  // forbids a stray). A detached element's `querySelector` still
  // returns its descendants; we want to refuse focus on anything
  // that isn't live in the document.
  if (!el.isConnected) return { kind: "none" };

  return { kind: "focus-element", el };
}

/**
 * Options for {@link transferFocusForActivation}.
 *
 * This signature lands in Step 23B. Summarized here so callers that
 * wire in early see the full shape.
 */
export interface TransferFocusForActivationOptions {
  /**
   * The card losing first-responder status. `null` when the new
   * activation has no prior active card (cold-boot or first
   * activation after an empty-canvas deselect). When non-null and
   * `outgoingWillBeDestroyed !== true`, the caller's save callback
   * for the outgoing card is invoked before the mutation runs.
   */
  outgoingCardId: string | null;
  /** The card becoming first responder. */
  incomingCardId: string;
  /** The deck store used for bag reads, host-root lookup, and dispatch. */
  store: IDeckManagerStore;
  /**
   * Closure the helper invokes (inside `flushSync`) to commit the
   * React-visible state change that drives the activation (e.g.
   * `setActiveCardInPane`, `activateCard`). The helper must control
   * commit timing so the incoming card's `display: none` style
   * flips to `display: contents` before the resolver reads the DOM.
   *
   * Optional only in contexts where the commit happened elsewhere
   * and the helper is purely restoring focus to an already-visible
   * card (rare; the drag path is the primary caller there).
   */
  commitMutation?: () => void;
  /**
   * When `true`, skip the outgoing-save step because the outgoing
   * card is being destroyed by the same mutation (e.g. close
   * handoff). Saving into a card that's about to be removed is
   * wasted work at best and may write through to the persistence
   * layer after the id is gone.
   */
  outgoingWillBeDestroyed?: boolean;
}

/**
 * Save the outgoing card's bag, commit the activation mutation,
 * resolve the incoming card's target, gate through the focus-theft
 * rules, and transfer focus / DOM selection.
 *
 * Implemented in Step 23B (Pass 3 split (a) of the
 * `#step-23-execution-strategy`). The five-step body below mirrors
 * the plan's spec verbatim.
 *
 * **Interim status (Pass 3 splits (a) + (b)):** the legacy `[A3]`
 * `useLayoutEffect` in `CardHost` remains live until split (c)
 * retires it. That means each activation transition emits both
 * the helper's `focus-call` (site `"focus-transfer"`) and the
 * legacy effect's `focus-call` (site `"a3-…"`). Both target the
 * same element; `el.focus()` is idempotent on an already-focused
 * element, so the duplication is observable in the deck-trace ring
 * but not in user-visible focus / caret behavior. The existing
 * `toContainOrderedSubset` matchers accept either occurrence.
 */
export function transferFocusForActivation(
  options: TransferFocusForActivationOptions,
): void {
  const {
    outgoingCardId,
    incomingCardId,
    store,
    commitMutation,
    outgoingWillBeDestroyed,
  } = options;

  // Step 1 — Save outgoing.
  //
  // Skipped when there is no outgoing (`null`), when the same card
  // is "transitioning" to itself (no-op activation), or when the
  // outgoing card is being destroyed by the same mutation
  // (`_removeCard` / `_closePane` already runs
  // `flushSaveCallbackBeforeDestruction` in its phase 2).
  if (
    outgoingCardId !== null &&
    outgoingCardId !== incomingCardId &&
    outgoingWillBeDestroyed !== true
  ) {
    store.invokeSaveCallback(outgoingCardId);
  }

  // Step 2 — Commit the mutation.
  //
  // `flushSync` forces React to apply the store-driven render
  // synchronously inside this call, so by the time the resolver
  // runs in step 3 the incoming card's subtree has already
  // transitioned from `display: none` to `display: contents`
  // (intra-pane tab switch in `tug-pane.tsx#performSelectCard`)
  // and the host root is mounted (close-handoff in `_removeCard`).
  // For callers that are outside React's event system already
  // (document-level pointerdown listeners), `useSyncExternalStore`
  // would force the same synchronous re-render even without
  // `flushSync` — but wrapping unconditionally is harmless and
  // keeps the contract uniform.
  if (commitMutation !== undefined) {
    flushSync(() => {
      commitMutation();
    });
  }

  // Step 3 — Resolve target against post-commit DOM.
  const target = resolveActivationTarget(incomingCardId, store);
  if (target.kind === "none") return;

  // Step 4 — Gate through focus-theft rules ([A8]).
  //
  // Reads `document.activeElement` directly; we are post-commit so
  // the DOM is consistent with the store snapshot we hand the gate.
  const targetCardHostEl = store.peekCardHostRoot(incomingCardId);
  const allowed = canProgrammaticallyFocus(
    incomingCardId,
    store.getSnapshot(),
    targetCardHostEl !== null ? { targetCardHostEl } : undefined,
  );
  if (!allowed) return;

  // Step 5 — Transfer.
  if (target.kind === "focus-element") {
    const doc = target.el.ownerDocument;
    const activeBefore = formatElement(doc.activeElement);
    target.el.focus();
    const activeAfter = formatElement(doc.activeElement);
    deckTrace.record({
      kind: "focus-call",
      site: "focus-transfer",
      cardId: incomingCardId,
      targetSelector: describeTargetSelector(target.el, store, incomingCardId),
      activeBefore,
      activeAfter,
      hidden: isElementHidden(target.el),
    });

    const bag = store.getCardState(incomingCardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
      const cardRoot =
        targetCardHostEl ?? store.peekCardHostRoot(incomingCardId);
      if (cardRoot !== null) {
        selectionGuard.restoreCardDomSelection(
          incomingCardId,
          bag.domSelection,
          cardRoot,
        );
        deckTrace.record({
          kind: "selection-restore",
          cardId: incomingCardId,
          via: "restoreCardDomSelection",
        });
      }
    }
    return;
  }

  // `dispatch-activated` — the content factory's registered
  // callback handles its own targeting.
  store.invokeActivationCallback(incomingCardId);
}

/**
 * Best-effort selector string for the resolved target, used as the
 * `targetSelector` field of the `focus-call` deck-trace event. The
 * selector matches the same form `card-host.tsx`'s
 * `traceApplyFocusSnapshot` records, so trace-based diagnosis can
 * compare helper vs. legacy-effect call sites apples-to-apples.
 */
function describeTargetSelector(
  el: HTMLElement,
  store: FocusTransferStore,
  cardId: string,
): string {
  const bag = store.getCardState(cardId);
  const focus = bag?.focus;
  if (focus !== undefined && focus !== null) {
    if (focus.kind === "form-control") {
      return `[data-tug-persist-value="${focus.persistKey}"]`;
    }
    if (focus.kind === "dom") {
      return `[data-tug-focus-key="${focus.focusKey}"]`;
    }
    if (focus.kind === "component-owned") {
      return "component-owned";
    }
  }
  // Fallback — should not occur for a `focus-element` resolution
  // (the resolver returned `none` if focus was null/none) but
  // keeps the trace event well-formed regardless.
  return el.tagName.toLowerCase();
}

/**
 * Options for {@link captureFocusForDragStart}.
 */
export interface CaptureFocusForDragStartOptions {
  /** The card whose drag gesture is starting. */
  sourceCardId: string;
  /** The deck store used for bag reads and save invocation. */
  store: IDeckManagerStore;
}

/**
 * Snapshot focus and DOM selection for a card whose pane / tab is
 * being dragged. The snapshot is stored on the drag coordinator's
 * per-gesture context so {@link transferFocusAfterMove} can restore
 * it after the drop commits.
 *
 * Implemented in Step 23C. Step 23A ships the signature only.
 */
export function captureFocusForDragStart(
  _options: CaptureFocusForDragStartOptions,
): void {
  throw new Error(
    "captureFocusForDragStart: not implemented (lands in Step 23C of tugplan-selection)",
  );
}

/**
 * Options for {@link transferFocusAfterMove}.
 */
export interface TransferFocusAfterMoveOptions {
  /** The card whose drag gesture just committed. */
  sourceCardId: string;
  /** The deck store used for bag reads and host-root lookup. */
  store: IDeckManagerStore;
}

/**
 * Restore focus and DOM selection to `sourceCardId` after a drop /
 * re-parent commits. Reads the snapshot captured at drag start,
 * resolves against the post-commit DOM, gates through the focus-theft
 * rules, and transfers.
 *
 * Implemented in Step 23C. Step 23A ships the signature only.
 */
export function transferFocusAfterMove(
  _options: TransferFocusAfterMoveOptions,
): void {
  throw new Error(
    "transferFocusAfterMove: not implemented (lands in Step 23C of tugplan-selection)",
  );
}
