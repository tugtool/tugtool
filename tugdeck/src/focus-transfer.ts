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
 * - Single-channel dispatcher: pure `resolveBagFocus` + impure
 *   `applyBagFocus`. Every focus-claim path reads `bag.focus`
 *   through these primitives; the engine is a callable invoked
 *   from the dispatcher's `engine` branch. The `framework` branch
 *   carries an idempotency guard: when the resolved element is
 *   already `document.activeElement`, the dispatcher yields
 *   rather than re-calling `.focus()` (WebKit can drop focus to
 *   body on a redundant mount-time `.focus()`).
 * - `transferFocusForActivation` and gesture hooks from
 *   `pane-focus-controller`, `tug-pane`, and `deck-manager`
 *   (`_removeCard` / `_closePane`); the legacy `[A3]`
 *   `useLayoutEffect` in `CardHost` retires in favor of this
 *   path. `default-focus` covers cards with no saved `bag.focus`.
 * - Drag: `captureFocusForDragStart` / `transferFocusAfterMove`
 *   from pane/tab drag handlers and `deck-manager` after
 *   cross-pane moves; cancel path refocuses the pre-drag target.
 * - App focus: `reactivateCurrentFocusDestination` on window
 *   `focus` after `setHasFocus(true)`; `blur` flushes save
 *   before `hasFocus` clears.
 *
 * ## The dispatch model
 *
 * `resolveBagFocus(cardId, store)` returns a `BagFocusResolution`
 * six-variant union (`framework` / `engine` / `default-focus` /
 * `deferred-dom` / `deferred-engine` / `none`). `applyBagFocus`
 * consumes that resolution and performs the corresponding side
 * effect:
 *
 *   - `framework` → `el.focus()`, unless the element is already
 *     `document.activeElement` — then the dispatcher yields and
 *     returns `"applied"` without re-calling (idempotency guard).
 *   - `engine` → `store.invokeEnginePaintMirrorAsActive(cardId)`.
 *     The engine hook is internally idempotent.
 *   - `default-focus` → walk the `DEFAULT_FOCUS_SELECTORS` chain.
 *   - `deferred-dom` / `deferred-engine` → return `"deferred"`.
 *     `deferred-engine` is retried by `CardHost`'s
 *     `subscribeEngineHooksChange` channel when the engine
 *     registers. `deferred-dom` is a best-effort resolution: if
 *     the saved framework-axis target is not in the DOM at
 *     dispatch time, focus does not land — the one-shot callers
 *     accept `"deferred"` as a graceful no-focus outcome.
 *   - `none` → idempotent no-op.
 *
 * `resolveBagFocus` is side-effect-free: it reads DOM via
 * `querySelector`, reads the store's bag, host-root registry, and
 * engine-hook registry, and returns. It is idempotent — calling
 * it twice with the same inputs and the same DOM yields the same
 * result — but it is NOT pure over the store value alone. Between
 * two calls the DOM may have changed: a content factory may have
 * swapped the element that `data-tug-focus-key="save"` identifies;
 * a previously-hidden subtree may have mounted; the registered
 * host root may have detached. The resolver always reads DOM live
 * rather than caching a stale handle.
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
import { getFocusManager } from "./components/tugways/focus-manager";
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
 * Diagnostic helper — emits the `pre-sync` and `post-sync` halves
 * of a `focus-measurement` triple around a framework focus-claim
 * site, then schedules the `post-gesture` tail on a macrotask so it
 * lands after the same-tick gesture default actions (e.g. WebKit's
 * mousedown focus default) have settled. The triple records, for
 * each activation source, whether sync `.focus()` survives the
 * gesture or is swallowed by gesture focus-lock.
 *
 * The `claim` closure runs between `pre-sync` and `post-sync`. The
 * caller is responsible for the real focus call inside `claim`;
 * this helper only observes.
 *
 * Observation-only — call sites that wrap their existing `.focus()`
 * in `measureFocusClaim` execute the same focus call in the same
 * tick. The three observations record into the deck-trace ring only
 * when `deckTrace.enable(true)` is in effect.
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
 * Narrow subset of `IDeckManagerStore` that this module reads. Kept
 * narrow so tests (and future refactors) do not need to hand in the
 * full deck store — a handful of methods is enough. Downstream
 * side-effecting entries will expand this list
 * as they wire in the mutation and dispatch paths.
 */
export type FocusTransferStore = Pick<
  IDeckManagerStore,
  | "getCardState"
  | "peekCardHostRoot"
  | "getSnapshot"
  // `applyBagFocus` reads these to resolve `engine` vs
  // `deferred-engine` and to invoke the registered engine hook.
  | "hasEngineHooks"
  | "invokeEnginePaintMirrorAsActive"
>;

// ---------------------------------------------------------------------------
// Single-channel focus dispatcher
//
// `resolveBagFocus` (pure) + `applyBagFocus` (impure). Every
// activation-focus path reads `bag.focus` through these primitives:
// `transferFocusForActivation`, `transferFocusAfterMove`,
// `reactivateCurrentFocusDestination`, and `CardHost`'s cold-boot
// RESTORE effect all dispatch through `applyBagFocus`.
// ---------------------------------------------------------------------------

/**
 * Resolved destination of a `bag.focus` lookup — the single-channel
 * dispatcher's return type.
 *
 * `resolveBagFocus` is pure (reads bag + DOM, no side effects);
 * `applyBagFocus` is the impure dispatcher that calls into this and
 * performs the corresponding side effect. The six-variant union
 * names every outcome the dispatcher can encounter:
 *
 *   - `framework` — concrete focusable element resolved from
 *     `bag.focus.kind === "dom" | "form-control"`. The dispatcher
 *     calls `el.focus()`, unless the element is already
 *     `document.activeElement` — then it yields (idempotency
 *     guard).
 *   - `engine` — the card's bag names engine-owned focus and the
 *     engine has registered hooks. The dispatcher invokes
 *     `store.invokeEnginePaintMirrorAsActive(cardId)`.
 *   - `default-focus` — DOM-authority card with no usable saved
 *     focus snapshot; the dispatcher walks
 *     {@link DEFAULT_FOCUS_SELECTORS} via
 *     {@link traceApplyDefaultFocus}.
 *   - `deferred-dom` — bag names a framework-axis target whose
 *     element is not in the DOM at dispatch time. The dispatcher
 *     returns `"deferred"`; the one-shot callers accept that as a
 *     graceful no-focus outcome. Reachable only by non-engine
 *     framework-axis cards — a content-owning + engine card
 *     resolves to `engine` / `deferred-engine`, never here.
 *   - `deferred-engine` — bag names engine focus but no engine
 *     hooks are registered yet (engine mounts late, e.g. dev's
 *     editor after `feedsReady`). The dispatcher returns
 *     `"deferred"`; CardHost's `subscribeEngineHooksChange`
 *     listener re-fires `applyBagFocus` when the engine registers.
 *   - `none` — nothing to focus. Bag is absent, host root is
 *     unregistered, or `bag.focus.kind === "none"`. The dispatcher
 *     returns `"applied"` (idempotent no-op) so callers can stop
 *     retrying.
 */
export type BagFocusResolution =
  | { kind: "framework"; el: HTMLElement; sourceKind: "dom" | "form-control"; keyboard?: boolean }
  | { kind: "engine"; cardId: string }
  | { kind: "default-focus"; cardRoot: HTMLElement }
  | { kind: "deferred-dom"; cardId: string; focusKind: "dom" | "form-control"; key: string; keyboard?: boolean }
  | { kind: "deferred-engine"; cardId: string }
  | { kind: "none" };

/**
 * Pure resolver — the single-channel dispatcher's read half.
 *
 * Consults `bag.focus` and resolves it to a {@link BagFocusResolution}
 * suitable for {@link applyBagFocus}. Side-effect free: reads the
 * bag, the host root, the engine-hook registration via
 * `store.hasEngineHooks`, and the live DOM via `querySelector`.
 * Does not mutate focus, selection, or any DOM state.
 *
 * Single source of truth for "where does focus go on this
 * activation?" — the [L23] single-channel contract.
 */
export function resolveBagFocus(
  cardId: string,
  store: FocusTransferStore,
): BagFocusResolution {
  const bag = store.getCardState(cardId);
  const hostRoot = store.peekCardHostRoot(cardId);

  const focus = bag?.focus;
  if (focus === undefined || focus === null || focus.kind === "none") {
    // No saved focus. Default-focus walk inside the card root for
    // DOM-authority cards; engine resolution for engine-bearing
    // cards — a content-owning + engine card (a dev card) has one
    // text-entry surface, so "no saved focus" still resolves to the
    // engine.
    const card = store.getSnapshot().cards.find((c) => c.id === cardId);
    const isEngineManaged =
      card !== undefined && isEngineManagedCard(card.componentId);
    const isContentOwning = bag !== undefined && bag.content !== undefined;
    if (isEngineManaged || isContentOwning) {
      if (store.hasEngineHooks(cardId)) {
        return { kind: "engine", cardId };
      }
      return { kind: "deferred-engine", cardId };
    }
    if (hostRoot === null || !hostRoot.isConnected) {
      return { kind: "none" };
    }
    return { kind: "default-focus", cardRoot: hostRoot };
  }

  if (focus.kind === "engine") {
    if (store.hasEngineHooks(cardId)) {
      return { kind: "engine", cardId };
    }
    return { kind: "deferred-engine", cardId };
  }

  // Framework-axis kinds: `dom` / `form-control`. Resolve the
  // concrete element via the host-root-scoped selector. Reachable
  // only by non-engine cards — a content-owning + engine card never
  // carries a `dom` / `form-control` `bag.focus`.
  const deferredKeyboard = focus.kind === "dom" ? focus.keyboard === true : false;
  if (hostRoot === null || !hostRoot.isConnected) {
    // No host root yet. `deferred-dom` is a graceful no-focus outcome for the
    // one-shot callers; the `keyboard` flag arms a late-mount ring resume in
    // `applyBagFocus` (an item-group focusable in a Radix/portal subtree can
    // mount after this dispatch).
    const key =
      focus.kind === "dom" ? focus.focusKey : focus.componentStatePreservationKey;
    return { kind: "deferred-dom", cardId, focusKind: focus.kind, key, keyboard: deferredKeyboard };
  }
  const selector =
    focus.kind === "dom"
      ? `[data-tug-focus-key="${CSS.escape(focus.focusKey)}"]`
      : `[data-tug-state-key="${CSS.escape(focus.componentStatePreservationKey)}"]`;
  const el = hostRoot.querySelector<HTMLElement>(selector);
  if (el === null || !el.isConnected) {
    const key =
      focus.kind === "dom" ? focus.focusKey : focus.componentStatePreservationKey;
    return { kind: "deferred-dom", cardId, focusKind: focus.kind, key, keyboard: deferredKeyboard };
  }
  return {
    kind: "framework",
    el,
    sourceKind: focus.kind,
    keyboard: focus.kind === "dom" ? focus.keyboard === true : false,
  };
}

/**
 * Options for {@link applyBagFocus}.
 */
export interface ApplyBagFocusOptions {
  /**
   * Site tag for `focus-call` / `focus-measurement` trace events.
   * Defaults to `"apply-bag-focus"`. Callers that want to preserve
   * legacy site tags (e.g. `"focus-transfer"`) pass their own.
   */
  site?: string;
  /**
   * When true, framework `el.focus()` is called with
   * `{ preventScroll: true }`. Used by
   * `reactivateCurrentFocusDestination` so window-focus
   * reactivation does not scroll the focused element back into
   * view ([L23] — preserve user-visible scroll).
   */
  preventScroll?: boolean;
}

/**
 * Single-channel focus dispatcher — the [L05] / [L23] gate.
 *
 * Reads `bag.focus` via {@link resolveBagFocus}, then performs the
 * resolved side effect:
 *
 *   - `framework` → `el.focus()`, unless the element is already
 *     `document.activeElement` — then yield (idempotency guard)
 *     and return `"applied"` without re-calling. Emit a
 *     `focus-call` trace event either way.
 *   - `engine` → `store.invokeEnginePaintMirrorAsActive(cardId)`.
 *     The engine hook is internally idempotent — the guard above
 *     applies only to the framework branch.
 *   - `default-focus` → `traceApplyDefaultFocus`.
 *   - `deferred-dom` / `deferred-engine` → return `"deferred"`.
 *     `deferred-engine` is retried by CardHost's
 *     `subscribeEngineHooksChange` channel; `deferred-dom` is a
 *     graceful no-focus outcome for the one-shot callers.
 *   - `none` → return `"applied"` (idempotent no-op).
 *
 * Returns `"applied"` for any resolution that committed (or that
 * was a definitive no-op) and `"deferred"` only when the caller
 * should retry. This function does not install observers.
 */
export function applyBagFocus(
  cardId: string,
  store: FocusTransferStore,
  options?: ApplyBagFocusOptions,
): "applied" | "deferred" {
  const site = options?.site ?? "apply-bag-focus";

  // [P21] activation drives the key card. This is THE focus-activation channel
  // (click / tab switch / pane activation / cross-pane move / window blur→focus /
  // cold boot all dispatch here), so it is the single seam that names the key
  // card: adopt this card and project its focus context. [P20] then falls out —
  // if the card's context already owns a pushed key destination (a pending
  // card-modal dialog's trap, a mid-flow focus-cycle, a descended scope), THAT is
  // the card's focus destination, not the resting editor: `adoptKeyCard` lands
  // focus on it and reports `true`, and we skip the framework/engine claim below.
  // A resting card (base mode) reports `false` and falls through unchanged.
  if (getFocusManager()?.adoptKeyCard(cardId) === true) {
    return "applied";
  }

  const resolution = resolveBagFocus(cardId, store);

  if (resolution.kind === "none") return "applied";
  if (
    resolution.kind === "deferred-dom" ||
    resolution.kind === "deferred-engine"
  ) {
    // The saved focusable isn't in the DOM yet (an item-group stop inside a
    // Radix/portal subtree that late-mounts). If it wore the keyboard ring, arm
    // the engine to re-light it the moment that focusable registers — the
    // late-mount retry for the focus axis ([state-preservation]). Focus itself
    // is not retried (the one-shot contract); only the ring resumes.
    if (resolution.kind === "deferred-dom" && resolution.keyboard === true) {
      getFocusManager()?.armKeyboardRestore(resolution.key);
    }
    return "deferred";
  }

  if (resolution.kind === "framework") {
    const el = resolution.el;
    const doc = el.ownerDocument;
    const activeBefore = formatElement(doc.activeElement);
    const targetSelector =
      resolution.sourceKind === "dom"
        ? `[data-tug-focus-key=...]`
        : `[data-tug-state-key=...]`;

    // Idempotency guard. When the resolved target is already the
    // active element, re-calling `.focus()` is not a no-op in
    // WebKit during a mount commit — it can interfere with React
    // reconciliation's focus-restoration heuristics and drop focus
    // to body. Yield instead: record the trace event for coherence
    // without re-calling `.focus()`.
    if (doc.activeElement === el) {
      deckTrace.record({
        kind: "focus-call",
        site: `${site}:yielded`,
        cardId,
        targetSelector,
        activeBefore,
        activeAfter: activeBefore,
        hidden: isElementHidden(el),
      });
    } else {
      measureFocusClaim(`${site}:framework`, cardId, doc, () => {
        el.focus(
          options?.preventScroll === true ? { preventScroll: true } : undefined,
        );
      });
      deckTrace.record({
        kind: "focus-call",
        site,
        cardId,
        targetSelector,
        activeBefore,
        activeAfter: formatElement(doc.activeElement),
        hidden: isElementHidden(el),
      });
    }
    // Resume the keyboard focus ring on the restored focusable, through the
    // engine, as part of this single focus claim — so a reload / relaunch
    // re-lights the ring on exactly the element focus landed on, and nothing
    // re-seeds it afterward ([state-preservation] focus axis). The `.focus()`
    // above fires a `focusin` that re-seeds the key view to the card with
    // `keyboard=false`; this set runs after, so it wins. No-op when the saved
    // focus was not keyboard-active.
    if (resolution.keyboard === true) {
      const focusableId = el.getAttribute("data-tug-focusable");
      if (focusableId !== null) {
        getFocusManager()?.setKeyView(focusableId, true);
      }
    }
    return "applied";
  }

  if (resolution.kind === "engine") {
    // Engine claim runs through the registered hook. The hook
    // records its own `engine-paint-mirror-active` event tagged
    // `caller: "via-engine-hook"`.
    const doc =
      store.peekCardHostRoot(cardId)?.ownerDocument ??
      (typeof document !== "undefined" ? document : null);
    if (doc !== null) {
      measureFocusClaim(`${site}:engine`, cardId, doc, () => {
        store.invokeEnginePaintMirrorAsActive(cardId);
      });
    } else {
      store.invokeEnginePaintMirrorAsActive(cardId);
    }
    return "applied";
  }

  // default-focus
  traceApplyDefaultFocus(
    `${site}-default`,
    cardId,
    resolution.cardRoot,
    options?.preventScroll === true ? { preventScroll: true } : undefined,
  );
  return "applied";
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
 * The single emitter of `focus-call` events for click / tab /
 * close-handoff activations; wired into `pane-focus-controller`,
 * `tug-pane#performSelectCard`, and `deck-manager#_removeCard` /
 * `_closePane`.
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

  // Step 3 — Gate through focus-theft rules ([A8]).
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

  // Step 4 — Single-channel dispatch via `applyBagFocus`.
  //
  // `applyBagFocus` reads `bag.focus`, resolves to one of
  // `framework` / `engine` / `default-focus` / `deferred-*` /
  // `none`, and performs the resolved side effect. For a
  // content-owning + engine card it routes to
  // `store.invokeEnginePaintMirrorAsActive(cardId)` — the engine's
  // own activation paint, invoked through the framework's single
  // channel.
  const result = applyBagFocus(incomingCardId, store, {
    site: "focus-transfer",
  });

  // Step 5 — Post-dispatch follow-ups (selection / form-control).
  //
  // `applyBagFocus` owns the focus claim only. Adjacent axes
  // (`bag.domSelection`, `bag.formControls`) ride separate channels;
  // restore them post-dispatch.
  if (result === "applied") {
    const bag = store.getCardState(incomingCardId);
    const cardRoot =
      targetCardHostEl ?? store.peekCardHostRoot(incomingCardId);
    if (
      bag?.domSelection !== undefined &&
      bag.domSelection !== null &&
      cardRoot !== null
    ) {
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

  // Step 6 — Outgoing-card blur safety net.
  //
  // When the dispatcher resolved to `engine` (no DOM mutation on
  // OUTGOING) or to an engine whose `paintMirrorAsActive` didn't
  // claim focus (no engine hooks registered yet), the prior
  // `document.activeElement` may still be inside the outgoing
  // card. The blur safety net deterministically removes it so the
  // user cannot keep typing into a card they just deactivated.
  blurFocusInOutgoingCard(store, outgoingCardId, incomingCardId);
}

/**
 * If `document.activeElement` is still inside the OUTGOING card root
 * after an activation transition, blur it. Used as a safety net at the
 * end of `transferFocusForActivation` where the incoming card's
 * dispatch may not focus anything (gallery cards, content shells with
 * no engine, an engine whose hooks aren't registered yet) — without
 * the blur, the prior focus persists in the now-inactive card and the
 * user can keep typing into a card they just deactivated.
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
 *   1. Gate through {@link canProgrammaticallyFocus}.
 *   2. Single-channel dispatch via {@link applyBagFocus}.
 *   3. Post-dispatch DOM-selection restore.
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

  // Step 1 — Gate.
  const targetCardHostEl = store.peekCardHostRoot(sourceCardId);
  const allowed = canProgrammaticallyFocus(
    sourceCardId,
    store.getSnapshot(),
    targetCardHostEl !== null ? { targetCardHostEl } : undefined,
  );
  if (!allowed) return;

  // Step 2 — Single-channel dispatch.
  const result = applyBagFocus(sourceCardId, store, {
    site: "focus-transfer-after-move",
  });

  // Step 3 — Post-dispatch DOM-selection restore.
  if (result === "applied") {
    const bag = store.getCardState(sourceCardId);
    const cardRoot =
      targetCardHostEl ?? store.peekCardHostRoot(sourceCardId);
    if (
      bag?.domSelection !== undefined &&
      bag.domSelection !== null &&
      cardRoot !== null
    ) {
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
 *   2. Read the host root via `store.peekCardHostRoot` and gate
 *      through {@link canProgrammaticallyFocus}. The gate's
 *      `state.hasFocus` branch is correctly `true` at this point
 *      because the listener flipped it to `true` immediately before
 *      this call.
 *   3. Single-channel dispatch via {@link applyBagFocus} with
 *      `preventScroll: true` ([L23] — preserve user-visible scroll
 *      across cmd-tab return; the default `focus()` semantics scroll
 *      the focused element into view, which in a dev-card
 *      (transcript above + editor below) drags the transcript
 *      downward whenever the editor re-claims focus on cmd-tab
 *      return).
 *   4. Post-dispatch DOM-selection restore for `applied` results
 *      that carry a saved `bag.domSelection`.
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

  // Step 1 — Gate.
  const targetCardHostEl = store.peekCardHostRoot(cardId);
  const allowed = canProgrammaticallyFocus(
    cardId,
    store.getSnapshot(),
    targetCardHostEl !== null ? { targetCardHostEl } : undefined,
  );
  if (!allowed) return;

  // Step 2 — Single-channel dispatch via `applyBagFocus`.
  const result = applyBagFocus(cardId, store, {
    site: "focus-transfer-reactivate",
    preventScroll: true,
  });

  // Step 3 — Post-dispatch DOM-selection restore.
  if (result === "applied") {
    const bag = store.getCardState(cardId);
    const cardRoot = targetCardHostEl ?? store.peekCardHostRoot(cardId);
    if (
      bag?.domSelection !== undefined &&
      bag.domSelection !== null &&
      cardRoot !== null
    ) {
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
}
