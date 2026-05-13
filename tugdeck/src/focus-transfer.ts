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
 * ## What ships in this module
 *
 * - Resolver plus store wiring (`resolveActivationTarget`, registrations).
 * - `transferFocusForActivation` and gesture hooks from `pane-focus-controller`,
 *   `tug-pane`, and `deck-manager` (`_removeCard` / `_closePane`); the
 *   legacy `[A3]` `useLayoutEffect` in `CardHost` retires in favor of
 *   this path. `default-focus` covers cards with no saved `bag.focus`.
 * - Drag: `captureFocusForDragStart` / `transferFocusAfterMove` from
 *   pane/tab drag handlers and `deck-manager` after cross-pane moves;
 *   cancel path refocuses the pre-drag target.
 * - App focus: `reactivateCurrentFocusDestination` on window `focus` after
 *   `setHasFocus(true)`; `blur` flushes save before `hasFocus` clears.
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
 *   - `{ kind: "default-focus", cardRoot }` — the card is DOM-
 *     authority but has no usable focus snapshot (no bag, or
 *     `bag.focus` is `null` / `kind: "none"`, or the snapshot
 *     pointed at a stale element). The caller passes `cardRoot` to
 *     `traceApplyDefaultFocus` from `default-focus.ts`, which
 *     walks the {@link DEFAULT_FOCUS_SELECTORS} priority chain.
 *
 *   - `{ kind: "none" }` — nothing to focus. Returned when no host
 *     root is registered for the card. Without a host root, the
 *     resolver cannot scope a default-focus walk, so even fresh
 *     cards return `none` until their `CardHost` registration
 *     completes.
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

import { isEngineManagedCard } from "./card-registry";
import { applyFormControlSnapshot } from "./components/chrome/card-host";
import { selectionGuard } from "./components/tugways/selection-guard";
import { deckTrace, formatElement } from "./deck-trace";
import { traceApplyDefaultFocus } from "./default-focus";
import { canProgrammaticallyFocus } from "./focus-theft-gate";

import type { IDeckManagerStore } from "./deck-manager-store";
import type { CardStateBag } from "./layout-tree";

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
 * Phase E.11 Step 1 investigation helper — emits the `pre-sync` and
 * `post-sync` halves of a `focus-measurement` triple around a
 * framework focus-claim site, then schedules the `post-gesture`
 * tail on a macrotask so it lands after the same-tick gesture
 * default actions (e.g. WebKit's mousedown focus default) have
 * settled. The triple lets the per-source × per-kind matrix decide,
 * for each activation source, whether sync `.focus()` survives the
 * gesture or is swallowed by gesture focus-lock — the [L05] gate
 * the Phase E.11 dispatcher will lean on at Step 3.
 *
 * The `claim` closure runs between `pre-sync` and `post-sync`. The
 * caller is responsible for the real focus call inside `claim`;
 * this helper only observes.
 *
 * Diagnostic instrumentation per Phase E.11 #e11-step-1. No
 * production behavior change — call sites that wrap their existing
 * `.focus()` in `measureFocusClaim` execute the same focus call in
 * the same tick. The three observations record into the deck-trace
 * ring only when `deckTrace.enable(true)` is in effect.
 */
function measureFocusClaim(
  site: string,
  cardId: string | null,
  doc: Document,
  claim: () => void,
): void {
  deckTrace.record({
    kind: "focus-measurement",
    phase: "pre-sync",
    site,
    cardId,
    activeElement: formatElement(doc.activeElement),
  });
  claim();
  deckTrace.record({
    kind: "focus-measurement",
    phase: "post-sync",
    site,
    cardId,
    activeElement: formatElement(doc.activeElement),
  });
  // Defer the post-gesture observation onto a macrotask so any
  // same-tick browser default action (mousedown focus, click focus)
  // has settled before we read `activeElement`. setTimeout(0) is
  // the simplest macrotask boundary; the investigation does not
  // need the MessageChannel-precise scheduling that the lifecycle
  // delegate uses.
  if (typeof setTimeout === "function") {
    setTimeout(() => {
      deckTrace.record({
        kind: "focus-measurement",
        phase: "post-gesture",
        site,
        cardId,
        activeElement: formatElement(doc.activeElement),
      });
    }, 0);
  }
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
       * The card is DOM-authority but has no usable focus snapshot
       * (no bag yet, or `bag.focus` is `null` / `kind: "none"`). The
       * caller passes `cardRoot` to {@link traceApplyDefaultFocus}
       * which walks the {@link DEFAULT_FOCUS_SELECTORS} priority
       * chain to land the caret on a sensible default.
       *
       * This case covers two production scenarios: a fresh DOM-
       * authority card whose first activation has no prior save
       * (creation paths route through this when their host root is
       * registered before the activation fires), and a neighbor
       * card promoted to active by a tab-close handoff (the m16
       * scenario, where `c1` has never been saved).
       */
      kind: "default-focus";
      cardRoot: HTMLElement;
    }
  | {
      /**
       * Nothing to focus. The card is unknown, no host root is
       * registered, or the target element resolved by the saved
       * snapshot is not in the DOM. The caller is expected to do
       * nothing.
       */
      kind: "none";
    };

/**
 * Narrow subset of `IDeckManagerStore` that this module reads. Kept
 * narrow so tests (and future refactors) do not need to hand in the
 * full deck store — a handful of methods is enough. Downstream
 * side-effecting entries will expand this list
 * as they wire in the mutation and dispatch paths.
 */
export type FocusTransferStore = Pick<
  IDeckManagerStore,
  "getCardState" | "peekCardHostRoot" | "getSnapshot"
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

  const card = store
    .getSnapshot()
    .cards.find((c) => c.id === cardId);
  const isEngineManaged =
    card !== undefined && isEngineManagedCard(card.componentId);
  const isContentOwning = bag !== undefined && bag.content !== undefined;

  // Engine carve-out precondition. For engine-managed or content-
  // owning cards, attempt to honour a framework-axis `bag.focus`
  // BEFORE falling through to the dispatch-activated path. The
  // SAVE site only writes `bag.focus` for these cards when the
  // kind is `dom` or `form-control` (engine focus stays absent),
  // so this branch never resolves to the engine's contenteditable
  // — it covers transient in-card targets like a find input or a
  // future inline editor that should survive activation across
  // app-switch, card-switch, and reload paths. If the kind is not
  // a framework-axis kind, or the element no longer resolves,
  // fall through unchanged so the engine's `onCardActivated`
  // (or the bag.content factory's callback) handles its default.
  // See `tuglaws/state-preservation.md` and
  // `tuglaws/design-decisions.md` (engine-vs-framework focus
  // boundary).
  if ((isEngineManaged || isContentOwning) && bag?.focus !== undefined && bag.focus !== null) {
    const focus = bag.focus;
    if (focus.kind === "dom" || focus.kind === "form-control") {
      const hostRoot = store.peekCardHostRoot(cardId);
      if (hostRoot !== null && hostRoot.isConnected) {
        const selector =
          focus.kind === "dom"
            ? `[data-tug-focus-key="${CSS.escape(focus.focusKey)}"]`
            : `[data-tug-state-key="${CSS.escape(focus.componentStatePreservationKey)}"]`;
        const el = hostRoot.querySelector<HTMLElement>(selector);
        if (el !== null && el.isConnected) {
          return { kind: "focus-element", el };
        }
      }
    }
  }

  // Engine-managed cards dispatch through the factory's registered
  // `onCardActivated` callback regardless of whether `bag.content` is
  // populated yet. The registry's `engineKind: "em"` tag is the
  // authoritative discriminator here — a fresh, never-saved EM card
  // (no bag, no content) still has a content factory that knows where
  // to put the caret. Falling through to `default-focus` for those
  // cards would walk DEFAULT_FOCUS_SELECTORS and land focus on the
  // first focusable descendant, which is typically a toolbar button
  // sitting above the engine's contenteditable.
  //
  // The bag.content fallback below remains for cards whose
  // registration somehow wasn't tagged but whose persisted bag clearly
  // identifies them as content-owning — defensive coverage during the
  // migration window and for any future content-owning factories that
  // don't use the engine pattern.
  if (isEngineManaged) {
    return { kind: "dispatch-activated" };
  }

  // Content-owning cards dispatch through the factory's registered
  // callback. We don't try to resolve a DOM element for them — the
  // factory knows where focus should land in its own subtree.
  if (isContentOwning) {
    return { kind: "dispatch-activated" };
  }

  const hostRoot = store.peekCardHostRoot(cardId);
  if (hostRoot === null) return { kind: "none" };

  // Defensive: a stale `registerCardHostRoot` entry may point at a
  // detached subtree (e.g. mid-cross-pane move where the cleanup
  // ordering left the registry pointing at the previous DOM node).
  // `querySelector` on a detached root still returns its descendants
  // — without this guard the resolver would hand back a default-
  // focus target whose `traceApplyDefaultFocus` walk targets a node
  // outside the document. Mirror the same `isConnected` check the
  // focus-element path uses on the resolved target.
  if (!hostRoot.isConnected) return { kind: "none" };

  // DOM-authority card with a usable saved focus snapshot: resolve
  // the element via the snapshot's selector and return it for an
  // exact restore.
  const focus = bag?.focus;
  if (focus !== undefined && focus !== null && focus.kind !== "none") {
    let el: HTMLElement | null = null;
    if (focus.kind === "form-control") {
      el = hostRoot.querySelector<HTMLElement>(
        `[data-tug-state-key="${CSS.escape(focus.componentStatePreservationKey)}"]`,
      );
    } else if (focus.kind === "dom") {
      el = hostRoot.querySelector<HTMLElement>(
        `[data-tug-focus-key="${CSS.escape(focus.focusKey)}"]`,
      );
    } else if (focus.kind === "engine") {
      // Defensive handling for the rare (effectively impossible)
      // case of a DOM-authority card carrying an `engine` snapshot.
      // Real engine-bearing cards return `dispatch-activated` above
      // via the `isEngineManaged` / `isContentOwning` branches.
      // Phase E.11 Step 3 routes engine kind through the single
      // `applyBagFocus` dispatcher; until then this branch resolves
      // to the canonical engine selector so the path stays
      // well-formed for any pre-E.11 bag that surfaces here.
      el = hostRoot.querySelector<HTMLElement>(
        "[data-tug-prompt-input-root] [contenteditable]",
      );
    }

    // Defensive check. The registered host root may have been
    // detached since registration without a matching unregister
    // (the callback-ref cleanup in `CardHost` handles the common
    // case, but nothing forbids a stray). A detached element's
    // `querySelector` still returns its descendants; we want to
    // refuse focus on anything that isn't live in the document.
    if (el !== null && el.isConnected) {
      return { kind: "focus-element", el };
    }
    // The snapshot pointed at an element that no longer exists.
    // Fall through to the default-focus path so the activated card
    // still receives the caret rather than silently no-op'ing.
  }

  // DOM-authority card with no usable snapshot: hand the host root
  // back so the caller can run the default-focus chain. Covers
  // never-saved cards (m16's c1) and cards whose snapshot resolved
  // a stale element.
  return { kind: "default-focus", cardRoot: hostRoot };
}

/**
 * Options for {@link transferFocusForActivation}.
 *
 * Stabilized once `transferFocusForActivation` shipped. Summarized so
 * early wire-in stays typed.
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
 * Implemented across Pass 3 of the
 * Focus-transfer seam: one implementation shipped the body and the
 * `pane-focus-controller` wiring; split (b) wired
 * `tug-pane#performSelectCard` and `deck-manager#_removeCard` /
 * `_closePane`; split (c) retired the `[A3]` `useLayoutEffect` in
 * `CardHost` and grew the resolver's `default-focus` variant. The
 * helper is now the single emitter of `focus-call` events for
 * row-1/2/3 activations.
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

  // Step 1 — Save outgoing + hand its selection over to the
  // inactive-paint channel.
  //
  // Skipped when there is no outgoing (`null`), when the same card
  // is "transitioning" to itself (no-op activation), or when the
  // outgoing card is being destroyed by the same mutation
  // (`_removeCard` / `_closePane` already runs
  // `flushSaveCallbackBeforeDestruction` in its phase 2).
  //
  // The deactivation callback fires before the activation mutation
  // commits, so the outgoing card's editor routes its selection into
  // `selectionGuard.cardRanges` (via `paintMirrorAsInactive(publish)`)
  // before the incoming card's activation hook runs
  // `setSelectedRange` — which would otherwise call
  // `removeAllRanges()` on the global Selection and destroy the
  // outgoing card's selection. [L23] enforcement.
  if (
    outgoingCardId !== null &&
    outgoingCardId !== incomingCardId &&
    outgoingWillBeDestroyed !== true
  ) {
    store.invokeSaveCallback(outgoingCardId);
    store.invokeDeactivationCallback(outgoingCardId, "transfer-for-activation");
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
    measureFocusClaim(
      "focus-transfer:focus-element",
      incomingCardId,
      doc,
      () => target.el.focus(),
    );
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
    const cardRoot =
      targetCardHostEl ?? store.peekCardHostRoot(incomingCardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
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
    if (
      bag !== undefined &&
      cardRoot !== null &&
      outgoingCardId !== incomingCardId
    ) {
      installFormControlReapplyOnNextMousedown(bag, cardRoot, incomingCardId);
    }
    return;
  }

  if (target.kind === "default-focus") {
    // Walk the DEFAULT_FOCUS_SELECTORS chain inside the activated
    // card's root. The helper records its own `focus-call` event
    // (site `"focus-transfer-default"`) so traces can distinguish a
    // snapshot-driven restore from a default-fallback restore.
    traceApplyDefaultFocus(
      "focus-transfer-default",
      incomingCardId,
      target.cardRoot,
    );

    // A card may have a saved domSelection even when its focus
    // snapshot is missing (e.g., a content factory that publishes a
    // selection without a focus key). Preserve [A3]'s exact
    // semantics: restore selection regardless of which focus path
    // we took.
    const bag = store.getCardState(incomingCardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
      selectionGuard.restoreCardDomSelection(
        incomingCardId,
        bag.domSelection,
        target.cardRoot,
      );
      deckTrace.record({
        kind: "selection-restore",
        cardId: incomingCardId,
        via: "restoreCardDomSelection",
      });
    }
    if (bag !== undefined && outgoingCardId !== incomingCardId) {
      installFormControlReapplyOnNextMousedown(bag, target.cardRoot, incomingCardId);
    }
    return;
  }

  // `dispatch-activated` — the content factory's registered
  // callback handles its own targeting. For content-owning cards that
  // register no callback (gallery shells, ad-hoc fixtures), nothing
  // focuses; the prior `document.activeElement` retains focus. When
  // that prior focus is inside the OUTGOING card root, the visible
  // symptom is a blinking caret in the now-inactive card (the user
  // can keep typing into a card they just deactivated). Blur in that
  // case so the activation gesture deterministically removes focus
  // from the outgoing card even when no incoming target was named.
  const dispatchDoc =
    typeof document !== "undefined"
      ? document
      : (store.peekCardHostRoot(incomingCardId)?.ownerDocument ?? null);
  if (dispatchDoc !== null) {
    measureFocusClaim(
      "focus-transfer:dispatch-activated",
      incomingCardId,
      dispatchDoc,
      () => {
        store.invokeActivationCallback(incomingCardId, "transfer-for-activation");
      },
    );
  } else {
    store.invokeActivationCallback(incomingCardId, "transfer-for-activation");
  }
  blurFocusInOutgoingCard(store, outgoingCardId, incomingCardId);
}

/**
 * If `document.activeElement` is still inside the OUTGOING card root
 * after an activation transition, blur it. Used as a safety net at the
 * end of `transferFocusForActivation`'s `dispatch-activated` branch
 * where the content factory's `onCardActivated` may not focus anything
 * (gallery cards, content shells with no engine) — without the blur,
 * the prior focus persists in the now-inactive card and the user can
 * keep typing into a card they just deactivated.
 *
 * Idempotent and tightly scoped:
 *   - No-op when there is no outgoing card.
 *   - No-op when outgoing === incoming (same-card activation).
 *   - No-op when current focus is already outside the outgoing card
 *     (the transition's focus side-effects already moved it).
 *   - Reads `document.activeElement` directly — post-commit DOM is
 *     consistent with the store snapshot at this point.
 *
 * Does not call `.focus()` on anything — that would risk picking the
 * wrong target. Blurring to body is the conservative move; the next
 * gesture (click, keystroke) drives the next focus.
 */
function blurFocusInOutgoingCard(
  store: FocusTransferStore,
  outgoingCardId: string | null,
  incomingCardId: string,
): void {
  if (outgoingCardId === null) return;
  if (outgoingCardId === incomingCardId) return;
  const outgoingRoot = store.peekCardHostRoot(outgoingCardId);
  if (outgoingRoot === null) return;
  const doc = outgoingRoot.ownerDocument;
  const active = doc.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!outgoingRoot.contains(active)) return;
  active.blur();
}

/**
 * Install a one-shot capture-phase `mousedown` listener that
 * suppresses the browser's caret-placement default and re-applies
 * the activated card's form-control snapshot to the input the user
 * just clicked.
 *
 * ## Why this is needed
 *
 * `transferFocusForActivation` runs in the pointerdown handler that
 * also triggered the activation. The matching mousedown for the same
 * physical click hasn't fired yet. WebKit's mousedown default
 * action will (a) focus the click target and (b) place a collapsed
 * caret at the click position — clobbering any saved selection on
 * the input. The mount-restore effect in `card-host.tsx` applies
 * form-control snapshots once at mount (one-shot; historically
 * `WeakSet`-gated through a MutationObserver loop),
 * so a card that was deactivated then re-activated WITHOUT remount
 * has no path that re-applies its saved selection. This helper is
 * the activation-time re-apply that closes that gap.
 *
 * ## Why an event listener, not timing
 *
 * `requestAnimationFrame` / `setTimeout(0)` / `queueMicrotask` would
 * be a guess at "when has the mousedown's default action run." None
 * of those are deterministic ordering primitives — [L05] explicitly
 * forbids RAF for ordering with React commits, and the same logic
 * applies to any timing-based defer here. A capture-phase
 * `mousedown` listener fires before the target's listeners, before
 * the default action, deterministically, in the browser's event
 * dispatch sequence. `event.preventDefault()` then suppresses the
 * default action, keeping the application strictly ordered against
 * a known event boundary.
 *
 * ## Pattern
 *
 * Same shape as `selectionGuard.installPreventMousedown` (used for
 * range-published selections). The only addition here is the post-
 * preventDefault application of the form-control snapshot:
 * `preventDefault` stopped the browser from focusing the input AND
 * placing the caret, so we manually focus and apply the saved
 * selection.
 *
 * `{ once: true, capture: true }` — fires for the next mousedown
 * (typically the same physical click that triggered this
 * activation), then auto-removes. If the activation was
 * programmatic with no upcoming click, the listener stays installed
 * until the next mousedown anywhere — same tradeoff as
 * `installPreventMousedown`. In practice, every activation
 * transition is click-driven, so the listener gets consumed by the
 * intended click. [L23]
 *
 * ## Only on cross-card transitions
 *
 * Callers must gate installation on `outgoingCardId !== incomingCardId`.
 * A same-card pointerdown (clicking inside the already-active card)
 * still flows through `transferFocusForActivation`, but the live DOM
 * state IS the truth at that point — there is no save→restore cycle
 * to recover from. Installing the listener anyway would `preventDefault`
 * the user's mousedown on a `data-tug-state-key` input/textarea,
 * killing native drag-to-select and re-applying a stale selection
 * snapshot on top of a click the user meant to position a caret /
 * start a selection drag. tug-text-editor (CodeMirror contenteditable)
 * does not match the `input/textarea` selector, which is why the
 * symptom only showed up on TugInput / TugTextarea.
 */
function installFormControlReapplyOnNextMousedown(
  bag: CardStateBag,
  cardRoot: HTMLElement,
  cardId: string,
): void {
  const formSnapshots = bag.formControls;
  if (!formSnapshots || Object.keys(formSnapshots).length === 0) return;

  const handler = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const clickedInput = target?.closest<HTMLInputElement | HTMLTextAreaElement>(
      "input[data-tug-state-key], textarea[data-tug-state-key]",
    );
    if (clickedInput === null || clickedInput === undefined) return;
    if (!cardRoot.contains(clickedInput)) return;

    const componentStatePreservationKey = clickedInput.getAttribute("data-tug-state-key");
    if (componentStatePreservationKey === null) return;
    const snap = formSnapshots[componentStatePreservationKey];
    if (snap === undefined) return;

    // Suppress the mousedown's default action. The browser would
    // otherwise focus the input AND collapse any selection to a
    // caret at the click position; both effects clobber the saved
    // state we're about to restore.
    event.preventDefault();

    // Manually focus the input — preventDefault stopped the
    // browser's default focus action.
    if (clickedInput.ownerDocument.activeElement !== clickedInput) {
      clickedInput.focus({ preventScroll: true });
    }

    applyFormControlSnapshot(clickedInput, snap);
    deckTrace.record({
      kind: "selection-restore",
      cardId,
      via: "applyFocusSnapshot",
    });
  };

  document.addEventListener("mousedown", handler, { capture: true, once: true });
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
      return `[data-tug-state-key="${focus.componentStatePreservationKey}"]`;
    }
    if (focus.kind === "dom") {
      return `[data-tug-focus-key="${focus.focusKey}"]`;
    }
    if (focus.kind === "engine") {
      return "engine";
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
 * being dragged. Called unconditionally on the gesture-start
 * pointerdown — even if the click never crosses the drag threshold,
 * a save is cheap and idempotent with the subsequent debounced
 * save. Capturing on pointerdown (before the browser's mousedown
 * default has a chance to blur the focused element inside the
 * card) is the only place that can preserve `bag.focus` and
 * `bag.domSelection` across a drag gesture.
 *
 * The save is delegated to the store's per-card save callback so
 * the captured bag picks up everything (focus, scroll, selection,
 * form-controls, region-scrolls, opt-in components) in one pass —
 * the same surface the close-handoff and debounced saves use.
 *
 * Idempotent on no-op: if the card has no registered save callback
 * (orchestrator hasn't seen a `registerSaveCallback` for this id
 * yet — possible if the gesture starts pre-mount on an unloaded
 * deck), `invokeSaveCallback` no-ops silently.
 */
export function captureFocusForDragStart(
  options: CaptureFocusForDragStartOptions,
): void {
  options.store.invokeSaveCallback(options.sourceCardId, "manual");
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
 * re-parent commits, or after a drag is cancelled (Escape /
 * pointercancel). Three-step body — no save here; drag-start
 * already captured the bag.
 *
 *   1. Resolve the activation target via {@link resolveActivationTarget}.
 *   2. Read the registered host root via `store.peekCardHostRoot`
 *      and gate through {@link canProgrammaticallyFocus}.
 *   3. Transfer:
 *      - `focus-element` → `el.focus()` + `restoreCardDomSelection`
 *      - `default-focus` → `traceApplyDefaultFocus` walk
 *      - `dispatch-activated` → `store.invokeActivationCallback`
 *      - `none` → return
 *
 * Called by `deck-manager#_detachCard` / `_moveCardToPane` after
 * their `notify()` (so the moved card's DOM is in its post-commit
 * location), and by the drag coordinator's onDragCancel hook
 * (Escape / pointercancel — no commit ran, focus restores into the
 * card's original DOM location). React reconciliation has already
 * landed at the moment the helper runs in both cases, so no
 * `flushSync` is needed (the helper does no `commitMutation` of its
 * own).
 */
export function transferFocusAfterMove(
  options: TransferFocusAfterMoveOptions,
): void {
  const { sourceCardId, store } = options;

  // Step 1 — Resolve.
  const target = resolveActivationTarget(sourceCardId, store);
  if (target.kind === "none") return;

  // Step 2 — Gate.
  const targetCardHostEl = store.peekCardHostRoot(sourceCardId);
  const allowed = canProgrammaticallyFocus(
    sourceCardId,
    store.getSnapshot(),
    targetCardHostEl !== null ? { targetCardHostEl } : undefined,
  );
  if (!allowed) return;

  // Step 3 — Transfer.
  if (target.kind === "focus-element") {
    const doc = target.el.ownerDocument;
    const activeBefore = formatElement(doc.activeElement);
    measureFocusClaim(
      "focus-transfer-after-move:focus-element",
      sourceCardId,
      doc,
      () => target.el.focus(),
    );
    const activeAfter = formatElement(doc.activeElement);
    deckTrace.record({
      kind: "focus-call",
      site: "focus-transfer-after-move",
      cardId: sourceCardId,
      targetSelector: describeTargetSelector(target.el, store, sourceCardId),
      activeBefore,
      activeAfter,
      hidden: isElementHidden(target.el),
    });

    const bag = store.getCardState(sourceCardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
      const cardRoot =
        targetCardHostEl ?? store.peekCardHostRoot(sourceCardId);
      if (cardRoot !== null) {
        selectionGuard.restoreCardDomSelection(
          sourceCardId,
          bag.domSelection,
          cardRoot,
        );
        deckTrace.record({
          kind: "selection-restore",
          cardId: sourceCardId,
          via: "restoreCardDomSelection",
        });
      }
    }
    return;
  }

  if (target.kind === "default-focus") {
    traceApplyDefaultFocus(
      "focus-transfer-after-move-default",
      sourceCardId,
      target.cardRoot,
    );
    const bag = store.getCardState(sourceCardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
      selectionGuard.restoreCardDomSelection(
        sourceCardId,
        bag.domSelection,
        target.cardRoot,
      );
      deckTrace.record({
        kind: "selection-restore",
        cardId: sourceCardId,
        via: "restoreCardDomSelection",
      });
    }
    return;
  }

  // `dispatch-activated` — content factory's onCardActivated handles
  // its own targeting.
  const dispatchDoc =
    typeof document !== "undefined"
      ? document
      : (store.peekCardHostRoot(sourceCardId)?.ownerDocument ?? null);
  if (dispatchDoc !== null) {
    measureFocusClaim(
      "focus-transfer-after-move:dispatch-activated",
      sourceCardId,
      dispatchDoc,
      () => {
        store.invokeActivationCallback(sourceCardId, "transfer-after-move");
      },
    );
  } else {
    store.invokeActivationCallback(sourceCardId, "transfer-after-move");
  }
}

/**
 * Re-focus the current first responder after the tugdeck window
 * regains OS focus (cmd-tab return, click-back-from-Finder, etc.).
 *
 * Called from `installDeckStoreFocusListeners`'s window-`focus`
 * handler, AFTER `setHasFocus(true)` has flipped the gate axis.
 * Three-step body — no save here; the companion window-`blur`
 * handler already flushed the bag synchronously before the
 * `hasFocus` axis went false:
 *
 *   1. Resolve `cardId` from `store.getFirstResponderCardId()`. If
 *      `null` (canvas-background deselect, or boot before the first
 *      activation), return — there is no destination to reactivate.
 *   2. Resolve the activation target via {@link resolveActivationTarget}.
 *   3. Read the host root via `store.peekCardHostRoot` and gate
 *      through {@link canProgrammaticallyFocus}. The gate's
 *      `state.hasFocus` branch is correctly `true` at this point
 *      because the listener flipped it to `true` immediately before
 *      this call.
 *   4. Transfer:
 *      - `focus-element` → `el.focus()` + `restoreCardDomSelection`
 *      - `default-focus` → `traceApplyDefaultFocus` walk
 *      - `dispatch-activated` → `store.invokeActivationCallback`
 *      - `none` → return
 *
 * No `commitMutation`. The window-`focus` event arrives outside any
 * pending React commit; React reconciliation has already drained
 * by the time the helper runs, so `flushSync` would be redundant.
 */
export function reactivateCurrentFocusDestination(
  store: IDeckManagerStore,
): void {
  const cardId = store.getFirstResponderCardId();
  if (cardId === null) return;

  const target = resolveActivationTarget(cardId, store);
  if (target.kind === "none") return;

  const targetCardHostEl = store.peekCardHostRoot(cardId);
  const allowed = canProgrammaticallyFocus(
    cardId,
    store.getSnapshot(),
    targetCardHostEl !== null ? { targetCardHostEl } : undefined,
  );
  if (!allowed) return;

  if (target.kind === "focus-element") {
    const doc = target.el.ownerDocument;
    const activeBefore = formatElement(doc.activeElement);
    // `preventScroll: true` — window-focus reactivation is "I just
    // came back to where I was." The user-visible scroll state of
    // any scrollport above us must not change just because the
    // focused element regained the caret. The default `focus()`
    // semantics scroll the focused element into view, which in a
    // tide-card (transcript above + editor below) drags the
    // transcript downward whenever the editor re-claims focus on
    // cmd-tab return. The browser's own window-state focus
    // restoration on cmd-tab is already pixel-stable; this
    // synchronous re-claim is just our deterministic guarantee
    // that the chain agrees on who owns the caret. No scroll-
    // into-view is needed. [L23] — preserve user-visible scroll.
    measureFocusClaim(
      "focus-transfer-reactivate:focus-element",
      cardId,
      doc,
      () => target.el.focus({ preventScroll: true }),
    );
    const activeAfter = formatElement(doc.activeElement);
    deckTrace.record({
      kind: "focus-call",
      site: "focus-transfer-reactivate",
      cardId,
      targetSelector: describeTargetSelector(target.el, store, cardId),
      activeBefore,
      activeAfter,
      hidden: isElementHidden(target.el),
    });

    const bag = store.getCardState(cardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
      const cardRoot = targetCardHostEl ?? store.peekCardHostRoot(cardId);
      if (cardRoot !== null) {
        selectionGuard.restoreCardDomSelection(
          cardId,
          bag.domSelection,
          cardRoot,
        );
        deckTrace.record({
          kind: "selection-restore",
          cardId,
          via: "restoreCardDomSelection",
        });
      }
    }
    return;
  }

  if (target.kind === "default-focus") {
    // `preventScroll: true` — see the focus-element branch above
    // for the rationale. Window-focus reactivation must preserve
    // the user-visible scroll state of every ancestor scrollport.
    traceApplyDefaultFocus(
      "focus-transfer-reactivate-default",
      cardId,
      target.cardRoot,
      { preventScroll: true },
    );
    const bag = store.getCardState(cardId);
    if (bag?.domSelection !== undefined && bag.domSelection !== null) {
      selectionGuard.restoreCardDomSelection(
        cardId,
        bag.domSelection,
        target.cardRoot,
      );
      deckTrace.record({
        kind: "selection-restore",
        cardId,
        via: "restoreCardDomSelection",
      });
    }
    return;
  }

  // `dispatch-activated` — content factory's onCardActivated handles
  // its own targeting.
  const dispatchDoc =
    typeof document !== "undefined"
      ? document
      : (store.peekCardHostRoot(cardId)?.ownerDocument ?? null);
  if (dispatchDoc !== null) {
    measureFocusClaim(
      "focus-transfer-reactivate:dispatch-activated",
      cardId,
      dispatchDoc,
      () => {
        store.invokeActivationCallback(cardId, "reactivate-current");
      },
    );
  } else {
    store.invokeActivationCallback(cardId, "reactivate-current");
  }
}
