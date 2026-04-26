/**
 * CardHost — wiring harness for a card's per-content state.
 *
 * CardHost lives at the deck level in the React tree; its DOM output
 * portals into the host pane's content `<div>` via `CardPortal`, so
 * React-tree position (and therefore identity) stays stable across
 * cross-pane moves — the mechanism that preserves tide card sessions
 * across detach / merge / pane-to-pane moves.
 *
 * Per-concern state is delegated to hooks under `tugways/hooks/`:
 * `useCardPropertyStore`, `useCardDirtyState`, and `useCardFeedStore`.
 * The harness itself owns only the cross-cutting wiring:
 * `hostContentEl` / `hostCardRootEl` registry lookups, the per-card
 * `saveCurrentCardState` closure, persistence-callback registration,
 * the `registerSaveCallback(cardId, …)` binding into DeckManager, the
 * card-level responder that routes `SET_PROPERTY`, and the
 * context-provider tree wrapping the content factory.
 *
 * ## Restoration
 *
 * CardHost orchestrates restore for every axis of `CardStateBag`;
 * per-axis translation is delegated to the axis's owner (see [L10]).
 * Restoration is trigger-driven, not React-dep-gated:
 *
 *   1. **Content restore** fires from a CardHost-owned
 *      `useLayoutEffect` keyed on `[cardId, hostContentEl, store]`,
 *      after `registerPersistenceCallbacks` has merely stored the
 *      child's callbacks. CardHost's effects fire AFTER CardPortal's
 *      own `useLayoutEffect` has appended the portal slot to the
 *      host pane's content element — so the engine root is
 *      connected to the document at the moment `onRestore(bag.content)`
 *      runs and any `engine.setSelectedRange` (`.focus()` + `addRange`)
 *      inside it lands on a live node. This is the L04 ready-callback
 *      pattern; doing the restore synchronously inside
 *      `registerPersistenceCallbacks` (called from a CHILD's effect,
 *      before the parent CardPortal can attach the slot) was the
 *      cold-boot selection-paint bug closed by selection plan Step
 *      23F gap-1. A `hasAppliedContentRestoreRef` guard keeps the
 *      restore one-shot so cross-pane moves (which re-fire the
 *      effect via `hostContentEl` change) don't clobber engine
 *      state the user may have edited since first mount. The
 *      effect also installs `onContentReady` (scroll restore +
 *      opacity unmask) before invoking `onRestore`.
 *   2. **Mount restore effect** (a `useLayoutEffect` keyed on
 *      `[cardId, hostStackId, hostContentEl]`) applies `bag.scroll`
 *      to `hostContentEl`, publishes `bag.domSelection` to
 *      `selectionGuard` (translation via `restoreCardDomSelection`),
 *      applies `bag.focus` via `applyFocusSnapshot` when this card is
 *      the active card of the active pane ([D10]), and replays
 *      `bag.formControls` + `bag.regionScroll` via a single
 *      `MutationObserver` scoped to the card root so late-mounting
 *      elements restore when they appear.
 * Cross-pane-move focus restore is no longer a CardHost concern —
 * it lives in `focus-transfer.ts#transferFocusAfterMove`, called
 * from `deck-manager.ts#_detachCard` / `_moveCardToPane` (selection
 * plan #step-23c retired the `[hostStackId]`-keyed effect that
 * previously lived here). CardHost's mount-time restore (the
 * primary effect above) remains the cold-boot focus authority.
 *
 * Paint of the restored DOM selection is not CardHost's job — that's
 * selection-guard's paint authority, driven by its deck-store
 * subscription. CardHost's responsibility is to hand the snapshot to
 * the axis's owner at the right moment; the owner paints.
 *
 * Neither path uses `persistenceCallbacksRef` as a dep — refs do not
 * trigger re-renders, and a dep array is not how we coordinate. The
 * trigger is the store callsite (register, or host-element change).
 *
 * @module components/chrome/card-host
 */

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { CardDataProvider } from "../tugways/hooks/use-card-data";
import { CardPropertyContext } from "../tugways/hooks/use-property-store";
import { useCardPropertyStore } from "../tugways/hooks/use-card-property-store";
import { useCardFeedStore } from "../tugways/hooks/use-card-feed-store";
import { useCardDirtyState } from "../tugways/hooks/use-card-dirty-state";
import {
  CardPersistenceContext,
  type CardPersistenceCallbacks,
  type CardPersistenceContextValue,
} from "../tugways/use-card-persistence";
import {
  CardComponentRegistryContext,
  type CardComponentRegistryContextValue,
} from "../tugways/use-component-persistence";
import { CardDirtyContext, TugPanePortalContext } from "./tug-pane";
import { useResponder } from "../tugways/use-responder";
import type { ActionEvent } from "../tugways/responder-chain";
import { TUG_ACTIONS } from "../tugways/action-vocabulary";
import { useDeckManager } from "../../deck-manager-context";
import { getRegistration } from "../../card-registry";
import { useSelectionBoundary } from "../tugways/hooks/use-selection-boundary";
import { nodeToPath, selectionGuard } from "../tugways/selection-guard";
import type {
  CardStateBag,
  DeckState,
  DomSelectionSnapshot,
  FocusSnapshot,
  FormControlSnapshot,
  RegionScrollSnapshot,
} from "../../layout-tree";
import * as paneContentRegistry from "./pane-content-registry";
import * as paneRootRegistry from "./pane-root-registry";
import { CardPortal } from "./card-portal";
import {
  deckTrace,
  formatElement,
} from "../../deck-trace";

export interface CardHostProps {
  /** Stable identity of this card — survives cross-pane moves. */
  cardId: string;
  /** The pane currently hosting this card. Used to locate the content element and for the workspace binding. */
  hostStackId: string;
  /** The registry componentId that produces this card's content via `contentFactory`. */
  componentId: string;
  /**
   * Whether this card is the active card within its host pane. When false,
   * the content mounts and stays alive but is hidden via `display: none` so
   * that identity (React state, session connections, scroll position)
   * survives across card switches and cross-pane moves. Defaults to `true`.
   */
  isActive?: boolean;
}

/**
 * Input types that accept a text selection via
 * `selectionStart` / `selectionEnd` / `setSelectionRange`. Reading or
 * writing those properties on other types (e.g. `checkbox`, `radio`,
 * `number`, `email`, `range`) throws `InvalidStateError` in real
 * browsers; happy-dom returns `null`. This set matches the HTML spec's
 * "input type with selection APIs" list.
 */
const SELECTION_CAPABLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "tel",
  "url",
  "password",
]);

function supportsTextSelection(
  el: HTMLInputElement | HTMLTextAreaElement,
): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  return SELECTION_CAPABLE_INPUT_TYPES.has(el.type);
}

/**
 * DOM-authority persistence for native `<input>` and `<textarea>` elements
 * carrying `data-tug-persist-value="<key>"`. Walks the card's own subtree
 * and snapshots each element's value, scroll, and selection offsets keyed
 * by the attribute value.
 *
 * **Scope matters.** The `root` passed here must be the card-host div
 * (`[data-card-host][data-card-id]`) — not the pane's content element.
 * Multiple cards inside one pane (tab-group panes) all portal into the
 * same pane-content `<div>`, so a query rooted at the pane would
 * cross-pollinate between sibling cards that happen to share a
 * `persistKey`. Rooting at the card-host div keeps `persistKey`
 * uniqueness a per-card concern, which is what the caller already
 * assumes.
 *
 * Selection is captured *regardless of focus* so the user's range
 * survives app resign and cross-card saves. Restore pairs with focus
 * restore (see [D10]): an unfocused input with selection state holds
 * it internally, and `::selection` paints the moment focus arrives.
 *
 * Only reads from the DOM (uncontrolled-input assumption — controlled
 * React-owned `value` is the caller's concern via `useCardPersistence`).
 * Selection reads on types that don't support it (checkbox, radio,
 * number, etc.) are skipped via a capability check; residual errors
 * are swallowed so one misbehaving input never blocks save.
 */
export function captureFormControls(
  root: HTMLElement,
): Record<string, FormControlSnapshot> | undefined {
  const result: Record<string, FormControlSnapshot> = {};
  const els = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "[data-tug-persist-value]",
  );
  for (const el of els) {
    const key = el.getAttribute("data-tug-persist-value");
    if (!key) continue;
    const snap: FormControlSnapshot = {
      value: el.value,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
    if (supportsTextSelection(el)) {
      try {
        const { selectionStart, selectionEnd, selectionDirection } = el;
        if (selectionStart !== null) snap.selectionStart = selectionStart;
        if (selectionEnd !== null) snap.selectionEnd = selectionEnd;
        if (
          selectionDirection === "forward" ||
          selectionDirection === "backward" ||
          selectionDirection === "none"
        ) {
          snap.selectionDirection = selectionDirection;
        }
      } catch {
        // Some inputs report as selection-capable via .type but still
        // throw on property access (custom element polyfills, JSDOM
        // edge cases). Drop silently — the other axes still survive.
      }
    }
    result[key] = snap;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Serialize the card's currently-published Range (if any) into a
 * `DomSelectionSnapshot` rooted at `cardRoot`.
 *
 * `selectionGuard` owns the live Range (published by the card's content
 * component — e.g. `TugTextEngine.onSelectionChanged`). CardHost owns
 * the serialization shape into the bag: indices walked from the
 * card-boundary root, so paths survive cross-pane moves where the
 * card's DOM subtree travels intact but its surrounding pane changes.
 *
 * Returns `null` when:
 *   - the card has no published Range;
 *   - either endpoint is not a descendant of `cardRoot` (stale Range
 *     whose owner failed to re-publish after a DOM mutation, or a
 *     selection that genuinely escaped the boundary — either way, not
 *     serializable against this root).
 *
 * Pure read. Does not mutate `selectionGuard` state or the DOM.
 */
export function captureDomSelection(
  cardId: string,
  cardRoot: HTMLElement,
): DomSelectionSnapshot | null {
  const range = selectionGuard.getCardRange(cardId);
  if (!range) return null;
  const anchorPath = nodeToPath(cardRoot, range.startContainer);
  const focusPath = nodeToPath(cardRoot, range.endContainer);
  if (anchorPath === null || focusPath === null) return null;
  return {
    anchorPath,
    anchorOffset: range.startOffset,
    focusPath,
    focusOffset: range.endOffset,
  };
}

/**
 * Selectors that identify a focus-bearing element belonging to a
 * component that owns its own focus + selection state together. Focus
 * on any such element serializes as `{ kind: "component-owned" }` — the
 * component's `bag.content` carries the detail; `CardHost`'s
 * responsibility is only to remember which component had focus.
 *
 * New owning components add their marker attribute here. Keep selectors
 * tag-agnostic (attribute-based) so authors cannot accidentally match
 * bystander DOM.
 */
const COMPONENT_OWNED_SELECTORS: readonly string[] = [
  "[data-tug-prompt-input-root]",
];

/**
 * For each component-owned root, the inner focusable element that
 * `applyFocusSnapshot` focuses when restoring `{ kind: "component-owned" }`.
 * Kept parallel with {@link COMPONENT_OWNED_SELECTORS}: both arrays
 * describe the same components but from opposite sides — `closest(...)`
 * on save, `querySelector(...)` on restore. Order must match.
 */
const COMPONENT_OWNED_FOCUS_TARGETS: readonly string[] = [
  "[data-tug-prompt-input-root] [contenteditable]",
];

/**
 * Classify `document.activeElement` relative to the card root into one
 * of the four `FocusSnapshot` variants.
 *
 *   - Focus outside the card root (including `document.body`) → `none`.
 *   - `[data-tug-persist-value]` wins over the other markers because
 *     a keyed form-control's focus is implicit in its persistKey (see
 *     [D10]) — no separate focus key needed.
 *   - `[data-tug-focus-key]` → `dom`; keyed via the attribute value.
 *   - Matches a component-owned selector → `component-owned`.
 *   - Anything else → `none`.
 *
 * Pure read; does not mutate focus, selection, or any DOM state.
 */
export function captureFocus(cardRoot: HTMLElement): FocusSnapshot {
  // Step 25C.5 Layer 4 dropped m36's `fallbackPersistKey` parameter.
  // Layer 1's audit (verified by `_smoke-capture-phase-save.test.ts`)
  // proved every activation-trigger source already saves in capture
  // phase — `document.activeElement` is correct at save time, no
  // fallback needed.
  const active = cardRoot.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement)) return { kind: "none" };
  if (!cardRoot.contains(active)) return { kind: "none" };

  const persistKey = active.getAttribute("data-tug-persist-value");
  if (persistKey !== null && persistKey !== "") {
    return { kind: "form-control", persistKey };
  }

  const focusKey = active.getAttribute("data-tug-focus-key");
  if (focusKey !== null && focusKey !== "") {
    return { kind: "dom", focusKey };
  }

  for (const selector of COMPONENT_OWNED_SELECTORS) {
    if (active.closest(selector)) return { kind: "component-owned" };
  }

  return { kind: "none" };
}

/**
 * Cold-boot / cross-pane-move counterpart of {@link captureFocus}.
 * Resolves the four `FocusSnapshot` variants back to a concrete DOM
 * element inside `cardRoot` and calls `.focus()` on it.
 *
 * Defensive semantics:
 *   - Pre-check: if focus is already somewhere inside the card, do
 *     nothing. Re-applying would fight a user interaction in progress
 *     (race between mount restore and a click inside the freshly-
 *     mounted subtree).
 *   - If the keyed element is not in the DOM yet (late-mounting
 *     content), no-op — the caller is responsible for re-trying at a
 *     later readiness point (e.g. `onContentReady`).
 *   - `kind === "none"` never mutates focus.
 *
 * Pure-ish: mutates `document.activeElement` only when the target is
 * resolvable and focus is not already inside the card.
 */
export function applyFocusSnapshot(
  cardRoot: HTMLElement,
  snapshot: FocusSnapshot,
): void {
  if (snapshot.kind === "none") return;

  // Respect any focus already inside the card — a click that landed
  // during the restore window must win over the saved snapshot.
  const currentActive = cardRoot.ownerDocument.activeElement;
  if (
    currentActive instanceof HTMLElement &&
    cardRoot.contains(currentActive)
  ) {
    return;
  }

  let target: HTMLElement | null = null;
  if (snapshot.kind === "form-control") {
    target = cardRoot.querySelector<HTMLElement>(
      `[data-tug-persist-value="${CSS.escape(snapshot.persistKey)}"]`,
    );
  } else if (snapshot.kind === "dom") {
    target = cardRoot.querySelector<HTMLElement>(
      `[data-tug-focus-key="${CSS.escape(snapshot.focusKey)}"]`,
    );
  } else if (snapshot.kind === "component-owned") {
    for (const selector of COMPONENT_OWNED_FOCUS_TARGETS) {
      const el = cardRoot.querySelector<HTMLElement>(selector);
      if (el) {
        target = el;
        break;
      }
    }
  }

  if (target !== null) target.focus();
}

/**
 * Find this card's own DOM subtree root inside a pane's content element.
 * The `[data-card-host][data-card-id]` div is rendered by `CardHost`
 * itself and travels with the card across cross-pane moves (via the
 * stable `CardPortal` slot), so it is the authoritative per-card
 * scoping anchor for any DOM walk done by the host.
 */
function findCardRoot(
  hostContentEl: HTMLElement,
  cardId: string,
): HTMLElement | null {
  return hostContentEl.querySelector<HTMLElement>(
    `[data-card-host][data-card-id="${CSS.escape(cardId)}"]`,
  );
}

/**
 * True when `cardId` is the active card of the deck's active pane per
 * the store's current snapshot.
 *
 * Used by focus restore to enforce [D10]'s "Option B" gate: only the
 * one card that the user is actually looking at may steal focus on
 * cold boot or after a cross-pane move. Every other card keeps its
 * `bag.focus` data but does not disturb whatever the user is doing
 * elsewhere. [R07].
 */
function isActiveCardOfActivePane(
  store: { getSnapshot: () => DeckState },
  cardId: string,
): boolean {
  const state = store.getSnapshot();
  if (state.activePaneId === undefined) return false;
  const pane = state.panes.find((p) => p.id === state.activePaneId);
  if (pane === undefined) return false;
  return pane.activeCardId === cardId;
}

/**
 * `true` when the element is visually hidden via `display: none` (either
 * directly or via an ancestor). Used as the `hidden` payload on
 * `focus-call` deck-trace events so a trace reader can distinguish a
 * focus call against a live element from one against a node whose
 * ancestor's `display: none` silently swallows focus (the WebKit
 * behavior behind the M-series neighbor-not-focusable symptoms).
 */
function isElementHidden(el: HTMLElement | null): boolean {
  if (el === null) return false;
  if (el.offsetParent === null) {
    // offsetParent === null implies some ancestor is display:none OR
    // the element itself is display:none (excluding position:fixed
    // which intentionally has no offsetParent but is still visible).
    const style =
      typeof window !== "undefined" && typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(el)
        : null;
    if (style !== null && style.position === "fixed") return false;
    return true;
  }
  return false;
}

/**
 * Run `applyFocusSnapshot` while emitting a `focus-call` deck-trace
 * event that captures the site tag, the pre/post active-element, the
 * target selector (computed post-resolve — see
 * `resolveApplyFocusSnapshotTargetSelector` for why we re-query here),
 * and the hidden bit.
 *
 * The helper is a thin wrapper so the existing `applyFocusSnapshot`
 * contract and three call sites remain clean.
 */
function traceApplyFocusSnapshot(
  site: string,
  cardId: string,
  cardRoot: HTMLElement,
  snapshot: FocusSnapshot,
): void {
  const doc = cardRoot.ownerDocument;
  const activeBefore = formatElement(doc.activeElement);
  // Resolve target ONCE here so we can record the selector that
  // `applyFocusSnapshot` is going to resolve internally. This is an
  // O(1) additional query; the alternative (adding a ref-out from
  // applyFocusSnapshot) would change its public contract.
  let target: HTMLElement | null = null;
  let targetSelector = "";
  if (snapshot.kind === "form-control") {
    targetSelector = `[data-tug-persist-value="${snapshot.persistKey}"]`;
    target = cardRoot.querySelector<HTMLElement>(
      `[data-tug-persist-value="${CSS.escape(snapshot.persistKey)}"]`,
    );
  } else if (snapshot.kind === "dom") {
    targetSelector = `[data-tug-focus-key="${snapshot.focusKey}"]`;
    target = cardRoot.querySelector<HTMLElement>(
      `[data-tug-focus-key="${CSS.escape(snapshot.focusKey)}"]`,
    );
  } else if (snapshot.kind === "component-owned") {
    targetSelector = "component-owned";
  }

  applyFocusSnapshot(cardRoot, snapshot);

  const activeAfter = formatElement(doc.activeElement);
  deckTrace.record({
    kind: "focus-call",
    site,
    cardId,
    targetSelector,
    activeBefore,
    activeAfter,
    hidden: isElementHidden(target),
  });
}

/**
 * Apply a saved `FormControlSnapshot` to an element. Idempotent guard at the
 * call site (via a `WeakSet`) keeps user typing from being overwritten on
 * subsequent mutation-observer fires.
 *
 * Order matters: value is restored first so `setSelectionRange` lands
 * against the correct string length; scroll is restored last so the
 * browser's own scroll-into-view side effect from `setSelectionRange`
 * does not override the saved scroll position.
 *
 * Selection restore is no-op when the element's type does not support
 * it, and any residual error from `setSelectionRange` is swallowed —
 * one misbehaving input must not abort the rest of the restore walk.
 */
export function applyFormControlSnapshot(
  el: HTMLInputElement | HTMLTextAreaElement,
  snap: FormControlSnapshot,
): void {
  if (el.value !== snap.value) el.value = snap.value;
  if (
    supportsTextSelection(el) &&
    snap.selectionStart !== undefined &&
    snap.selectionEnd !== undefined
  ) {
    try {
      el.setSelectionRange(
        snap.selectionStart,
        snap.selectionEnd,
        snap.selectionDirection,
      );
    } catch {
      // See captureFormControls for the matching symmetry.
    }
  }
  if (snap.scrollTop !== undefined) el.scrollTop = snap.scrollTop;
  if (snap.scrollLeft !== undefined) el.scrollLeft = snap.scrollLeft;
}

/**
 * DOM-authority persistence for nested scrollable regions inside a card.
 *
 * Walks the card subtree for every element carrying
 * `data-tug-scroll-key="<key>"` and snapshots its `scrollLeft` /
 * `scrollTop`. Symmetric with {@link captureFormControls}: same
 * opt-in / keyed model, same scope rules — roots at the card-host
 * div so sibling cards in a tab-group pane cannot cross-pollinate.
 *
 * Returns `undefined` when no matching regions exist, so `saveCurrentCardStateRef`
 * can omit the axis from the bag entirely and keep empty-card bags
 * light.
 *
 * `bag.scroll` covers the outer `hostContentEl` scroll; this helper
 * handles the inner virtualized scrollers that the user scrolled
 * independently (e.g. `tug-markdown-view`).
 */
export function captureRegionScrolls(
  root: HTMLElement,
): RegionScrollSnapshot | undefined {
  const result: RegionScrollSnapshot = {};
  const els = root.querySelectorAll<HTMLElement>("[data-tug-scroll-key]");
  for (const el of els) {
    const key = el.getAttribute("data-tug-scroll-key");
    if (!key) continue;
    result[key] = { x: el.scrollLeft, y: el.scrollTop };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Apply a saved {@link RegionScrollSnapshot} to every matching
 * `data-tug-scroll-key` element currently in the card subtree.
 * Unknown keys in the snapshot are skipped; extra regions in the DOM
 * without a saved entry are left alone.
 *
 * Called from the mount restore effect (after `hostContentEl` scroll)
 * and re-applied when the card's subtree grows via `MutationObserver`
 * so late-mounting scrollers (any that appear behind a content-factory
 * readiness gate) restore correctly.
 */
export function applyRegionScrolls(
  root: HTMLElement,
  snapshot: RegionScrollSnapshot,
): void {
  for (const [key, pos] of Object.entries(snapshot)) {
    const el = root.querySelector<HTMLElement>(
      `[data-tug-scroll-key="${CSS.escape(key)}"]`,
    );
    if (!el) continue;
    // Dispatch a cancelable `tug-region-scroll-set` event before
    // touching `scrollLeft` / `scrollTop` directly. Components like
    // `tug-markdown-view` that wrap their scroll container in a
    // SmartScroll instance listen for this event so they can
    // simultaneously (a) apply the requested scroll position and
    // (b) disengage SmartScroll's follow-bottom flag — without (b)
    // the next ResizeObserver-driven height refinement re-slams
    // `scrollTop` to the bottom, defeating cold-boot restore.
    // Generic scroll regions don't install a listener, so the
    // event is not preventDefaulted and we fall back to the direct
    // assignment.
    const event = new CustomEvent<{ top: number; left: number }>(
      "tug-region-scroll-set",
      { detail: { top: pos.y, left: pos.x }, cancelable: true, bubbles: false },
    );
    const wasHandled = !el.dispatchEvent(event);
    if (!wasHandled) {
      el.scrollLeft = pos.x;
      el.scrollTop = pos.y;
    }
  }
}

/**
 * Look up the host pane's content element from the registry, reactively:
 * re-fires when the element is registered, replaced, or unregistered.
 */
function useHostContentElement(hostStackId: string): HTMLDivElement | null {
  return useSyncExternalStore(
    (cb) => paneContentRegistry.subscribe(hostStackId, cb),
    () => paneContentRegistry.getElement(hostStackId),
    () => null,
  );
}

/**
 * Look up the host pane's root element from `pane-root-registry`,
 * reactively. Used to bridge `TugPanePortalContext` — card content needs
 * access to its host pane's root `<div>` for sheets and tooltips that
 * portal into it, and CardHost cannot consume the provider
 * directly because it lives outside the pane's React tree.
 */
function useHostStackRootElement(hostStackId: string): HTMLDivElement | null {
  return useSyncExternalStore(
    (cb) => paneRootRegistry.subscribe(hostStackId, cb),
    () => paneRootRegistry.getElement(hostStackId),
    () => null,
  );
}

export function CardHost({ cardId, hostStackId, componentId, isActive = true }: CardHostProps): React.ReactElement | null {
  const store = useDeckManager();
  const registration = getRegistration(componentId);
  const hostContentEl = useHostContentElement(hostStackId);
  const hostCardRootEl = useHostStackRootElement(hostStackId);

  const { register: registerPropertyStore, ref: propertyStoreRef } = useCardPropertyStore();

  const persistenceCallbacksRef = useRef<CardPersistenceCallbacks | null>(null);

  // Ref for the latest `hostContentEl` so closures installed in
  // `registerPersistenceCallbacks` (onContentReady) read the current
  // element at fire time, not the mount-time capture. L07.
  const hostContentElRef = useRef<HTMLDivElement | null>(null);
  hostContentElRef.current = hostContentEl;

  // (Step 25C.5 Layer 4 retired the `lastFocusedPersistKeyRef`
  // fallback that m36 added to `captureFocus`. The fallback was a
  // workaround for the case where the deactivation save fired AFTER
  // focus moved to a sibling card. Layer 1's audit (verified by
  // `_smoke-capture-phase-save.test.ts`) proved every activation-
  // trigger source already saves in capture phase before focus moves
  // — the fallback is unnecessary in steady state. `captureFocus`
  // returned to its single-argument signature.)

  // Content restore is imperative and trigger-driven. The trigger is the
  // child calling `register(callbacks)` — its own `useLayoutEffect` is
  // the deterministic moment content restoration is safe. We do not gate
  // restore behind a React dep array because the prerequisites (host
  // element available, child registered) can arrive in any order and
  // React's reconciler is not the authority on "ready." This callback
  // owns only the content branch; scroll/selection live in the effect
  // below (keyed on host-element availability) and in the child-driven
  // `onContentReady` for the with-content case. L11, L22, L23.
  // Pure-storage registration. The actual restore (`callbacks.onRestore`,
  // `onContentReady` install, opacity mask, cold-boot trace) is driven by
  // the post-attach effect below — NOT here. registerPersistenceCallbacks
  // fires from a child's `useLayoutEffect` (deepest first), which runs
  // BEFORE CardPortal's own layout effect that calls `host.appendChild(slot)`.
  // Doing the restore here would call `engine.restoreState` (and its
  // `setSelectedRange`) while the engine root sits in a detached portal
  // slot — `.focus()` silently no-ops on disconnected nodes and the
  // subsequent `addRange` doesn't stick, costing the user their selection
  // paint on cold-boot. Selection plan Step 23F gap-1.
  //
  // L04 ready-callback pattern: defer the side-effecting restore to a
  // hook (CardHost's own layout effect) that fires AFTER all descendants'
  // effects AND AFTER CardPortal's slot attach. By the time the
  // `[cardId, hostContentEl, callbacksVersion, store]` effect below runs,
  // the engine root is connected to the document and
  // `engine.setSelectedRange` will land.
  //
  // `callbacksVersion` is the bridge from a child's late registration
  // back into the restore-effect's dep set. Cards whose content factory
  // mounts conditionally (e.g. tide-card gates on `feedsReady` — its
  // editor doesn't render until `defaultFeedIds` resolve from tugcast)
  // can have their persistence-callback registration arrive several
  // commits AFTER hostContentEl is non-null. Without this counter, the
  // restore effect would have already fired with `callbacks=null` and
  // returned early, never re-running when callbacks finally appear.
  const [callbacksVersion, setCallbacksVersion] = useState(0);
  const registerPersistenceCallbacks = useCallback(
    (callbacks: CardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;
      setCallbacksVersion((v) => v + 1);
    },
    [],
  );

  // Apply `bag.content` restore exactly once per CardHost mount, AFTER
  // CardPortal's slot.appendChild has connected the engine root to the
  // document. CardPortal is a child of CardHost in the React tree, so its
  // `useLayoutEffect` fires before this one — `engine.root.isConnected`
  // is therefore guaranteed true here.
  //
  // The guard ref keeps this one-shot. Cross-pane moves swap
  // `hostStackId` and re-fire CardPortal's effect (re-attaching the slot
  // to the new host); they do NOT re-fire this restore — the engine has
  // its state from first mount, and a cross-pane move preserves DOM
  // identity for the engine root, so re-restoring would clobber any user
  // edits made between mount and the move.
  const hasAppliedContentRestoreRef = useRef(false);
  useLayoutEffect(() => {
    if (hasAppliedContentRestoreRef.current) return;
    if (!hostContentEl) return;
    const callbacks = persistenceCallbacksRef.current;
    if (!callbacks) return;
    // Cleanup-pair re-entries (no `restorePendingRef`) skip this branch
    // for the same reason as the original synchronous registration did.
    if (callbacks.restorePendingRef === undefined) return;
    const bag = store.getCardState(cardId);
    if (!bag || bag.content === undefined) return;

    // Install onContentReady so scroll is applied after the child
    // commits restored content — at that point the content's
    // dimensions are valid and scroll clamps correctly. This is
    // also where the pre-restore opacity mask is lifted.
    //
    // DOM-selection and focus restore are NOT called here. This
    // branch runs only when `bag.content !== undefined` — i.e.
    // content-owning cards — and per [D07] those cards' content
    // factory owns selection and focus end-to-end. The engine's
    // `setSelectedRange` inside its own `restoreState` both
    // focuses the root and sets the selection; any second
    // `.focus()` or `setBaseAndExtent` call from CardHost would
    // race the engine and, under WebKit's focus-with-selection
    // quirk, collapse the just-restored selection. The save-side
    // gate also keeps `bag.domSelection` / `bag.focus` absent from
    // freshly-saved content-owning bags for symmetry.
    callbacks.onContentReady = () => {
      const el = hostContentElRef.current;
      if (el) {
        if (bag.scroll !== undefined) {
          el.scrollLeft = bag.scroll.x;
          el.scrollTop = bag.scroll.y;
        }
        // Un-mask the host content now that scroll has been
        // re-applied.
        if (el.style.opacity === "0") {
          el.style.opacity = "";
        }
      }
    };
    // Pre-mask the host to hide the pre-restore scroll position
    // while the child re-renders with restored content. `opacity: 0`
    // (not `visibility: hidden`) keeps the engine root focusable
    // during the restore window.
    if (hostContentElRef.current && bag.scroll !== undefined) {
      hostContentElRef.current.style.opacity = "0";
    }

    // Diagnostic snapshot for the cold-boot / cross-pane-mount
    // restore path. Selection plan Step 23F gap-1.
    let coldBootSelection: { start: number; end: number } | null = null;
    const content = bag.content as Record<string, unknown> | undefined;
    if (content !== undefined) {
      let engineState: Record<string, unknown> | undefined;
      if (
        typeof content.currentRoute === "string" &&
        typeof content.perRoute === "object" &&
        content.perRoute !== null
      ) {
        const perRoute = content.perRoute as Record<string, unknown>;
        const inner = perRoute[content.currentRoute as string];
        if (typeof inner === "object" && inner !== null) {
          engineState = inner as Record<string, unknown>;
        }
      } else {
        engineState = content;
      }
      const sel = engineState?.selection;
      if (
        typeof sel === "object" &&
        sel !== null &&
        typeof (sel as Record<string, unknown>).start === "number" &&
        typeof (sel as Record<string, unknown>).end === "number"
      ) {
        coldBootSelection = {
          start: (sel as { start: number }).start,
          end: (sel as { end: number }).end,
        };
      }
    }
    deckTrace.record({
      kind: "cold-boot-restore-snapshot",
      cardId,
      hasContent: bag.content !== undefined,
      engineSelection: coldBootSelection,
    });

    callbacks.restorePendingRef.current = true;
    // Compute `isActive` from the deck-level first responder snapshot
    // ([D10]). Per Step 25C.4 [L23], the consumer's onRestore branches
    // on this flag: active cards run `paintMirrorAsActive` (focus +
    // global Selection); inactive cards run
    // `paintMirrorAsInactive(publish)` (selectionGuard publish, no
    // focus claim, no global Selection mutation). The non-React read
    // on the deck-store singleton is L02-compliant — no useEffect
    // copying external state into React state.
    const isActive = store.getFirstResponderCardId() === cardId;
    callbacks.onRestore(bag.content, { isActive });
    hasAppliedContentRestoreRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, hostContentEl, store, callbacksVersion]);

  // Scroll / DOM-selection / form-control / region-scroll restore:
  // triggered by `hostContentEl` becoming available. Fires idempotently
  // whenever the host element changes (mount, cross-pane move, pane
  // re-registration).
  //
  // **Outer scroll** applies regardless of content-case: for a no-content
  // bag this is the only restore path; for a with-content bag this is a
  // best-effort apply before the child commits, and `onContentReady`
  // re-applies the correct clamp after content renders.
  //
  // **DOM selection** is published to `selectionGuard` for every card
  // that carries a saved `bag.domSelection`, regardless of whether this
  // card is the active card of the active pane — the Step 5 paint
  // authority buckets each card's Range into either native `::selection`
  // or the `inactive-selection` custom highlight. For engine-managed
  // cards the engine's own restore (inside `onContentReady`) re-publishes
  // after innerHTML settles and wins by running after this call; for
  // engine-less cards this is the only publish and it seeds `cardRanges`.
  //
  // **Form controls** and **region scrolls** both replay via the same
  // MutationObserver so elements that mount late (behind feedsReady or
  // any content-factory readiness gate) restore when they appear.
  // The observer MUST be scoped to this card's root — not the whole
  // pane — so sibling cards in a tab-group pane cannot cross-notify.
  // Both branches guard against re-applying to elements they have
  // already touched: form controls via a `WeakSet`, region scrolls via
  // a `Set<key>` — so unrelated subtree mutations after the first
  // apply never clobber a scroll position the user has since changed.
  //
  // L22 (paint observes the store), L23 (preserve user-visible state).
  useLayoutEffect(() => {
    if (!hostContentEl) return;
    const bag = store.getCardState(cardId);
    if (!bag) return;
    // Content-owning cards manage selection and focus through their
    // own restore path ([D07]); CardHost does not touch those axes
    // for such cards. See `saveCurrentCardStateRef.current` for the
    // matching save-side gate.
    const ownsSelectionAndFocus = bag.content !== undefined;
    if (bag.scroll !== undefined) {
      hostContentEl.scrollLeft = bag.scroll.x;
      hostContentEl.scrollTop = bag.scroll.y;
    }

    // DOM-selection restore — skipped for content-owning cards (the
    // content owner publishes via `engine.onSelectionChanged` during
    // its own `restoreState` and is the authoritative source). For
    // cards without `bag.content` (form-control cards, generic
    // contentEditable cards) CardHost's publish is the only
    // selection-guard seed. The `bag.domSelection` field is absent
    // from freshly-saved content-owning bags per the save-side gate;
    // this branch's extra `!ownsSelectionAndFocus` check covers
    // pre-fix bags still in tugbank.
    const cardRootForDomAxes = findCardRoot(hostContentEl, cardId);
    if (
      bag.domSelection &&
      !ownsSelectionAndFocus &&
      cardRootForDomAxes
    ) {
      selectionGuard.restoreCardDomSelection(cardId, bag.domSelection, cardRootForDomAxes);
      deckTrace.record({
        kind: "selection-restore",
        cardId,
        via: "restoreCardDomSelection",
      });
    }

    // Focus restore, [D10] Option B gated. Skipped for
    // content-owning cards — the engine focuses its own root inside
    // `setSelectedRange`, and a second `.focus()` here would race
    // the engine and (WebKit's focus-with-selection quirk) collapse
    // the just-restored selection. For non-content cards the active-
    // card-of-active-pane gate prevents focus theft across panes
    // ([R07]) and the helper's own pre-check keeps focus from being
    // yanked away from a user who has clicked mid-restore.
    if (
      bag.focus &&
      bag.focus.kind !== "none" &&
      !ownsSelectionAndFocus &&
      cardRootForDomAxes &&
      isActiveCardOfActivePane(store, cardId)
    ) {
      traceApplyFocusSnapshot(
        "cold-boot",
        cardId,
        cardRootForDomAxes,
        bag.focus,
      );
      // `applyFocusSnapshot` of a form-control target triggers the
      // browser's native selection-on-focus behavior; record the
      // cold-boot entry via the `applyFocusSnapshot` tag per
      // [#l01-recording-sites].
      deckTrace.record({
        kind: "selection-restore",
        cardId,
        via: "applyFocusSnapshot",
      });
    }

    // Step 25C.5 Layer 4: form-control apply is a ONE-SHOT at mount.
    // Pre-Layer-4 it lived inside the MutationObserver-driven
    // `apply()` loop, gated by a `WeakSet` to keep observer fires
    // from clobbering user typing. With activation-time re-apply
    // owned by `transferFocusForActivation` (m36's
    // `installFormControlReapplyOnNextMousedown`), the observer no
    // longer needs to handle form-controls — apply once at mount
    // for cold-boot, then trust the activation-transition path for
    // every subsequent re-apply. Cleanup: no WeakSet, no observer
    // dependency.
    const formSnapshots = bag.formControls;
    if (formSnapshots) {
      const cardRoot = findCardRoot(hostContentEl, cardId);
      if (cardRoot !== null) {
        for (const [key, snap] of Object.entries(formSnapshots)) {
          const el = cardRoot.querySelector<
            HTMLInputElement | HTMLTextAreaElement
          >(`[data-tug-persist-value="${CSS.escape(key)}"]`);
          if (el !== null) {
            applyFormControlSnapshot(el, snap);
          }
        }
      }
    }

    const regionSnapshot = bag.regionScroll ?? undefined;
    if (!regionSnapshot) return;

    // For region scrolls we can't mark "applied after one shot" — a
    // virtualized scroller (most notably `tug-markdown-view`) renders
    // estimated-height blocks first, so its `scrollHeight` is below
    // the saved `scrollTop` on the initial apply. The browser
    // clamps the assignment, then ResizeObserver-driven height
    // refinement grows the spacer divs (which mutates their `style`
    // attribute) and `scrollHeight` catches up. Track the settled
    // state instead: re-apply on every observed mutation until
    // `el.scrollTop` lands within tolerance of the saved value,
    // then mark settled and stop fighting any subsequent scroll.
    //
    // The matching MutationObserver below adds `attributes: true,
    // attributeFilter: ["style"]` so the spacer-height mutations
    // fire `apply()`; without that, only `childList` mutations
    // would trigger re-application and the bake-in race would
    // never resolve. See selection plan Step 25C.2 Layer 4.
    const regionSettled = new Set<string>();
    const REGION_SCROLL_TOLERANCE_PX = 8;

    const apply = () => {
      const cardRoot = findCardRoot(hostContentEl, cardId);
      if (!cardRoot) return;
      // Form-controls were applied one-shot above (Step 25C.5
      // Layer 4); the observer-driven path here handles only
      // region-scrolls, which need re-assertion until the
      // virtualized layout's `scrollHeight` catches up.
      if (regionSnapshot) {
        const pending: RegionScrollSnapshot = {};
        let hasPending = false;
        for (const [key, pos] of Object.entries(regionSnapshot)) {
          if (regionSettled.has(key)) continue;
          const el = cardRoot.querySelector<HTMLElement>(
            `[data-tug-scroll-key="${CSS.escape(key)}"]`,
          );
          if (!el) continue;
          // If the element already sits within tolerance of the
          // saved position, mark it settled and stop fighting any
          // subsequent user scroll. Covers two cases: (a) the
          // saved-position-is-zero no-op, and (b) the post-bake-in
          // pass where ResizeObserver has finished growing the
          // spacer and our previous `applyRegionScrolls` has
          // already landed the scrollTop on target.
          if (
            Math.abs(el.scrollTop - pos.y) <= REGION_SCROLL_TOLERANCE_PX &&
            Math.abs(el.scrollLeft - pos.x) <= REGION_SCROLL_TOLERANCE_PX
          ) {
            regionSettled.add(key);
            continue;
          }
          pending[key] = pos;
          hasPending = true;
        }
        if (hasPending) applyRegionScrolls(cardRoot, pending);
      }
    };

    apply();
    const cardRoot = findCardRoot(hostContentEl, cardId);
    if (!cardRoot) return;
    const observer = new MutationObserver(apply);
    observer.observe(cardRoot, {
      childList: true,
      subtree: true,
      // `style` mutations catch the virtualization-driven spacer-
      // height growth that grows `scrollHeight` past the saved
      // `scrollTop`. Without this, the initial clamped assignment
      // never re-runs and the user lands at scrollTop=0.
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, [cardId, hostStackId, hostContentEl, store]);

  // Cross-pane-move focus restore is owned by
  // `transferFocusAfterMove` in `focus-transfer.ts`, called
  // synchronously from `deck-manager.ts#_detachCard` /
  // `_moveCardToPane` after their `notify()`. The legacy
  // `[hostStackId]`-keyed `useLayoutEffect` that lived here —
  // observing `hostStackId` transitions and re-applying
  // `bag.focus` via `applyFocusSnapshot` — was retired in
  // selection plan #step-23c. CardHost is no longer a focus
  // restorer for cross-pane moves; it remains the cold-boot
  // mount-restore path (the primary restore effect above) for
  // initial focus on first mount.

  // Activation-driven focus + selection transfer is owned by
  // `transferFocusForActivation` in `focus-transfer.ts`, called
  // synchronously from each gesture source (pane-focus-controller,
  // `tug-pane#performSelectCard`, `deck-manager#_removeCard` /
  // `_closePane`). The legacy `[A3]` `useLayoutEffect` that lived
  // here — subscribing to `useFocusDestination` and re-applying
  // focus/selection/default-focus on every reactivation — was
  // retired in selection plan #step-23b Pass 3 split (c). CardHost
  // is now a registrar (it registers its root via
  // `store.registerCardHostRoot`) and a cold-boot/cross-pane
  // restorer; runtime activation transitions flow through the
  // helper, not through this component.
  //
  // `useFocusDestination` remains exported from `deck-store-hooks`
  // for any future React consumer that legitimately *renders* on
  // destination status. CardHost no longer subscribes to it.

  // Framework-axes assembler. Rewritten every render so closures read
  // the latest `hostContentEl` / `hostStackId` / `cardId` without stale
  // capture. This is the "assembler" the CardStateOrchestrator invokes
  // on every save trigger ([A9c]); the orchestrator layers
  // `bag.components` on top of whatever this returns.
  const assembleFrameworkBagRef = useRef<() => CardStateBag>(() => ({}));
  assembleFrameworkBagRef.current = () => {
    const contentEl = hostContentEl;
    const scroll = contentEl
      ? { x: contentEl.scrollLeft, y: contentEl.scrollTop }
      : undefined;
    const content = persistenceCallbacksRef.current?.onSave();
    // Scope form-control capture to THIS card's subtree so sibling cards in
    // the same pane (tab-group) never contaminate each other's values.
    const cardRoot = contentEl ? findCardRoot(contentEl, cardId) : null;
    const formControls = cardRoot ? captureFormControls(cardRoot) : undefined;
    const regionScroll = cardRoot ? captureRegionScrolls(cardRoot) : undefined;
    // [D07] — content-owning cards (any card whose factory writes
    // `bag.content` via `useCardPersistence`) own their own selection
    // and focus. The content payload carries whatever the owner needs
    // (for tide-card: `bag.content.selection` flat offsets, and
    // engine-driven focus via `setSelectedRange`). CardHost must step
    // out: a second source of truth for selection / focus would race
    // the owner's restore on mount and clobber it. For cards without
    // a content payload (form-control cards, markdown-view cards)
    // CardHost is the sole authority on these axes.
    const ownsSelectionAndFocus = content !== undefined;
    const domSelection =
      cardRoot && !ownsSelectionAndFocus
        ? captureDomSelection(cardId, cardRoot)
        : null;
    const focus: FocusSnapshot =
      cardRoot && !ownsSelectionAndFocus
        ? captureFocus(cardRoot)
        : { kind: "none" };
    const bag: CardStateBag = {
      ...(scroll !== undefined ? { scroll } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(formControls !== undefined ? { formControls } : {}),
      ...(regionScroll !== undefined ? { regionScroll } : {}),
      ...(domSelection !== null ? { domSelection } : {}),
      ...(focus.kind !== "none" ? { focus } : {}),
    };
    return bag;
  };

  // Canonical save closure consumed by `useCardDirtyState` (debounced
  // save path) and `registerSaveCallback` (close-before-destroy flush
  // and app will-phase triggers). Routes through `captureCardState` so
  // every save trigger picks up both framework axes and opt-in
  // component state in one call ([A9c] / [M17]).
  const saveCurrentCardStateRef = useRef<() => void>(() => {});
  saveCurrentCardStateRef.current = () => {
    store.setCardState(cardId, store.captureCardState(cardId));
  };

  useLayoutEffect(() => {
    // Register the framework-axes assembler with the orchestrator so
    // `store.captureCardState(cardId)` can invoke it from every save
    // trigger. Identity is stable across renders (the assembler object
    // is built once here); its underlying closure reads the latest
    // render's state via `assembleFrameworkBagRef.current`.
    const unregisterAssembler = store.registerCardAssembler(cardId, {
      capture: () => assembleFrameworkBagRef.current(),
    });
    store.registerSaveCallback(cardId, () => saveCurrentCardStateRef.current());
    return () => {
      store.unregisterSaveCallback(cardId);
      unregisterAssembler();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, store]);

  // Component-level restore ([A9c]). Fires once per mount, after child
  // `useComponentPersistence` hooks have run (React commits effects
  // child-first, so by the time this parent effect runs every
  // descendant component has already registered with the card's
  // registry). Keyed on `[cardId, store]` for identity stability, but
  // the `hasRestoredComponentsRef` guard keeps it one-shot so
  // cross-pane moves and re-mounts don't re-apply stale state to
  // components the user may have already edited.
  const hasRestoredComponentsRef = useRef(false);
  useLayoutEffect(() => {
    if (hasRestoredComponentsRef.current) return;
    hasRestoredComponentsRef.current = true;
    const bag = store.getCardState(cardId);
    if (!bag) return;
    store.restoreCardState(cardId, bag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, store]);

  const markDirty = useCardDirtyState({
    hostContentEl,
    saveRef: saveCurrentCardStateRef,
  });

  const feedIds = useMemo(() => registration?.defaultFeedIds ?? [], [registration]);
  const feedData = useCardFeedStore(hostStackId, feedIds);
  // Test-mode override: bypass the feed-data gate so cards whose
  // `defaultFeedIds` would otherwise wait on a live tugcast/tugcode
  // backend (notably tide-card, which gates on `[CODE_INPUT,
  // CODE_OUTPUT, SESSION_METADATA, FILETREE]`) can mount in the
  // in-app harness. Tests don't drive the AI side of those cards;
  // they exercise focus, selection, persistence, and other
  // framework concerns that don't depend on real feed data. The
  // production path is unchanged: `__tugTestMode` is set only when
  // launched via `TUGAPP_TEST_SOCKET`, in DEV builds.
  const isTestMode =
    typeof window !== "undefined" && window.__tugTestMode === true;
  const feedsReady =
    isTestMode || feedIds.length === 0 || feedData.size > 0;

  // Stable context value carrying both the cardId and the register
  // callback. A memoized object is cheaper to stabilize than threading
  // both through the tree separately, and it lets descendants that only
  // need the id read it via `useCardId` without subscribing to register.
  const cardPersistenceContextValue = useMemo<CardPersistenceContextValue>(
    () => ({ cardId, register: registerPersistenceCallbacks }),
    [cardId, registerPersistenceCallbacks],
  );

  // Per-card Component Persistence Protocol registry ([D13], [A9]).
  // Lazily materialized by the deck manager on first child call to
  // `useComponentPersistence`; we fetch a reference here so the
  // context provider below carries it to every descendant of this card.
  // The root context starts with an empty prefix and empty treePath;
  // `<PersistenceScope>` providers nested beneath extend both.
  const componentRegistryContextValue = useMemo<
    CardComponentRegistryContextValue
  >(
    () => ({
      registry: store.getComponentRegistry(cardId),
      prefix: "",
      treePath: [],
    }),
    [store, cardId],
  );

  // Card-level responder for `SET_PROPERTY` dispatched via
  // `manager.sendToTarget(cardId, …)`. `parentId: hostStackId` re-parents
  // the chain to the portaled DOM layout — without the override the
  // responder's parent would follow the React tree (pointing at
  // `deck-canvas`) and the chain walk from `firstResponderId = cardId`
  // would skip every pane-level handler.
  const { ResponderScope, responderRef } = useResponder({
    id: cardId,
    parentId: hostStackId,
    actions: {
      [TUG_ACTIONS.SET_PROPERTY]: (event: ActionEvent) => {
        const ps = propertyStoreRef.current;
        if (!ps) return;
        const payload = event.value as
          | { path: string; value: unknown; source?: string }
          | undefined;
        if (!payload || typeof payload.path !== "string") return;
        ps.set(payload.path, payload.value, payload.source ?? "inspector");
      },
    },
  });

  // Selection boundary is the card-host div itself. Registering here (not
  // on the pane's content div) gives `selectionGuard` one entry per card,
  // even when multiple cards share one pane's content element (tab-group
  // panes). [L12].
  const cardRootRef = useRef<HTMLDivElement | null>(null);
  useSelectionBoundary(cardId, cardRootRef);

  // Element-state for the registered card-host root. Captured via the
  // ref-callback on every mount, unmount, and element-identity change
  // (e.g. if React's portal reconciler swaps the subtree on a
  // cross-pane move rather than moving it in place). Tracking the
  // current element in state — not just a ref — means the effect
  // below re-runs when the DOM node identity changes, so
  // `registerCardHostRoot` re-registers the new node and unregisters
  // the old one in one commit. L07.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);

  // Compose the card-root ref with `responderRef` (a callback ref the
  // responder chain uses for DOM anchoring) and the `rootEl` state
  // setter (driving the registration effect below). A stable
  // useCallback keeps React from firing the callback with `null` then
  // the element on every render. L07.
  const setCardRootEl = useCallback(
    (el: HTMLDivElement | null) => {
      cardRootRef.current = el;
      responderRef(el);
      setRootEl(el);
    },
    [responderRef],
  );

  // Register the live card-host root with the deck store so the
  // focus-transfer resolver can scope its DOM queries to this card's
  // subtree. Keyed on `[cardId, rootEl, store]`: mount registers the
  // initial element, unmount (cleanup) unregisters it, and an
  // element-identity change (cleanup → effect body in the same
  // commit) swaps registrations without leaving a stale entry.
  // L03 — registration runs in the same commit phase as any event
  // that could drive an activation, so the resolver never reads a
  // stale registry. L10 — the store owns the registry; CardHost is
  // only the caller that keeps it honest.
  useLayoutEffect(() => {
    if (rootEl === null) return;
    store.registerCardHostRoot(cardId, rootEl);
    deckTrace.record({
      kind: "card-host-mount",
      cardId,
      hostStackId,
    });
    return () => {
      store.registerCardHostRoot(cardId, null);
      deckTrace.record({
        kind: "card-host-unmount",
        cardId,
        hostStackId,
      });
    };
  }, [cardId, rootEl, store, hostStackId]);

  // (Step 25C.5 Layer 4 retired the `lastFocusedPersistKeyRef`
  // focusin listener that m36 added. Capture-phase deactivation save
  // is the canonical capture point; `document.activeElement` is
  // sufficient there. See `_smoke-capture-phase-save.test.ts`.)

  // ---- Render ----
  if (!registration) {
    return null;
  }

  // `CardPortal` routes DOM output into the host pane's content div and
  // preserves identity across re-root. Non-active cards are hidden with
  // `display: none` so identity survives card switches without layout impact.
  return (
    <CardPortal hostStackId={hostStackId}>
      <div
        ref={setCardRootEl}
        data-card-host
        data-card-id={cardId}
        style={{
          display: isActive ? "contents" : "none",
        }}
      >
        <TugPanePortalContext value={hostCardRootEl}>
          <ResponderScope>
            <CardDataProvider feedData={feedData}>
              <CardPropertyContext value={registerPropertyStore}>
                <CardPersistenceContext value={cardPersistenceContextValue}>
                  <CardComponentRegistryContext.Provider
                    value={componentRegistryContextValue}
                  >
                    <CardDirtyContext value={markDirty}>
                      {feedsReady ? (
                        // `cardId` is the stable identity content factories key
                        // their per-card state off; it survives detach/merge
                        // whereas `hostStackId` changes on cross-pane moves.
                        registration.contentFactory(cardId)
                      ) : (
                        <div className="tug-pane-loading" data-testid="tug-pane-loading">
                          Loading...
                        </div>
                      )}
                    </CardDirtyContext>
                  </CardComponentRegistryContext.Provider>
                </CardPersistenceContext>
              </CardPropertyContext>
            </CardDataProvider>
          </ResponderScope>
        </TugPanePortalContext>
      </div>
    </CardPortal>
  );
}
