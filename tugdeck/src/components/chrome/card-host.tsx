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
 *   1. **Content restore** fires inside `registerPersistenceCallbacks`,
 *      synchronously when the child content component calls
 *      `register(callbacks)` from its own `useLayoutEffect`. The child's
 *      mount moment *is* the trigger: there is no effect dep array to
 *      re-evaluate, no version counter, no ref gate. For bags that
 *      carry `content`, the harness installs an `onContentReady`
 *      callback (re-applies scroll, DOM-selection, and focus after the
 *      child re-renders with restored state) and calls
 *      `onRestore(bag.content)`.
 *   2. **Mount restore effect** (a `useLayoutEffect` keyed on
 *      `[cardId, hostStackId, hostContentEl]`) applies `bag.scroll`
 *      to `hostContentEl`, publishes `bag.domSelection` to
 *      `selectionGuard` (translation via `restoreCardDomSelection`),
 *      applies `bag.focus` via `applyFocusSnapshot` when this card is
 *      the active card of the active pane ([D10]), and replays
 *      `bag.formControls` + `bag.regionScroll` via a single
 *      `MutationObserver` scoped to the card root so late-mounting
 *      elements restore when they appear.
 *   3. **Cross-pane-move focus effect** (a secondary `useLayoutEffect`
 *      keyed on `[hostStackId]` with a `hasMountedRef` guard) re-runs
 *      `applyFocusSnapshot` on subsequent `hostStackId` transitions to
 *      close the gap where a drag-drop blurs the card's focused
 *      element before the drop re-parents the DOM into the new pane.
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

import React, { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

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
    el.scrollLeft = pos.x;
    el.scrollTop = pos.y;
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

  // Content restore is imperative and trigger-driven. The trigger is the
  // child calling `register(callbacks)` — its own `useLayoutEffect` is
  // the deterministic moment content restoration is safe. We do not gate
  // restore behind a React dep array because the prerequisites (host
  // element available, child registered) can arrive in any order and
  // React's reconciler is not the authority on "ready." This callback
  // owns only the content branch; scroll/selection live in the effect
  // below (keyed on host-element availability) and in the child-driven
  // `onContentReady` for the with-content case. L11, L22, L23.
  const registerPersistenceCallbacks = useCallback(
    (callbacks: CardPersistenceCallbacks) => {
      persistenceCallbacksRef.current = callbacks;

      const bag = store.getCardState(cardId);
      if (!bag || bag.content === undefined) return;
      // `callbacks.restorePendingRef` is absent on the no-op cleanup pair
      // installed by `useCardPersistence`'s cleanup. Skip that re-entry.
      if (callbacks.restorePendingRef === undefined) return;

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
          // re-applied. See the pre-mask block below for the
          // rationale behind `opacity: 0` (vs `visibility: hidden`).
          if (el.style.opacity === "0") {
            el.style.opacity = "";
          }
        }
      };
      // Pre-mask the host to hide the pre-restore scroll position
      // while the child re-renders with restored content.
      //
      // We use `opacity: 0`, NOT `visibility: hidden`, even though
      // the goal is the same (full transparency while the restore
      // settles). Elements inside a `visibility: hidden` subtree
      // are not focusable: `.focus()` silently no-ops. For
      // engine-managed cards (tide, gallery prompt-input) the
      // engine's `setSelectedRange` focuses its content-editable
      // root *before* calling `sel.addRange` so WebKit doesn't
      // orphan the selection. If the root is unfocusable during
      // that call, the focus step fails and the selection is set
      // on an unfocused element — WebKit later discards the caret
      // when focus finally lands, collapsing the user's selection.
      // `opacity: 0` keeps the element focusable while still
      // producing a fully-transparent mask for the flash window.
      if (hostContentElRef.current && bag.scroll !== undefined) {
        hostContentElRef.current.style.opacity = "0";
      }

      callbacks.restorePendingRef.current = true;
      callbacks.onRestore(bag.content);
    },
    [cardId, store],
  );

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
      applyFocusSnapshot(cardRootForDomAxes, bag.focus);
    }

    const formSnapshots = bag.formControls;
    const regionSnapshot = bag.regionScroll ?? undefined;
    if (!formSnapshots && !regionSnapshot) return;

    const formApplied = new WeakSet<Element>();
    const regionApplied = new Set<string>();

    const apply = () => {
      const cardRoot = findCardRoot(hostContentEl, cardId);
      if (!cardRoot) return;
      if (formSnapshots) {
        for (const [key, snap] of Object.entries(formSnapshots)) {
          const el = cardRoot.querySelector<
            HTMLInputElement | HTMLTextAreaElement
          >(`[data-tug-persist-value="${CSS.escape(key)}"]`);
          if (!el) continue;
          if (formApplied.has(el)) continue;
          formApplied.add(el);
          applyFormControlSnapshot(el, snap);
        }
      }
      if (regionSnapshot) {
        // Only apply regions we haven't applied yet. `applyRegionScrolls`
        // would otherwise re-slam the scroll on every subtree mutation,
        // fighting the user after they scrolled post-restore.
        const pending: RegionScrollSnapshot = {};
        let hasPending = false;
        for (const [key, pos] of Object.entries(regionSnapshot)) {
          if (regionApplied.has(key)) continue;
          const el = cardRoot.querySelector<HTMLElement>(
            `[data-tug-scroll-key="${CSS.escape(key)}"]`,
          );
          if (!el) continue;
          regionApplied.add(key);
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
    observer.observe(cardRoot, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [cardId, hostStackId, hostContentEl, store]);

  // Cross-pane-move focus restore. A drag-drop that moves a card from
  // pane A to pane B starts with a pointerdown on pane chrome, which
  // blurs whatever element inside the card had focus. The card's own
  // persisted state survives the move (form-control selection stays on
  // the DOM node; contentEditable Range stays in `selectionGuard.cardRanges`),
  // but native browser focus does not — the user would otherwise have
  // to click back in for `::selection` to repaint. Re-applying
  // `bag.focus` after `hostStackId` changes closes that gap.
  //
  // Keyed ONLY on `[hostStackId]` so this fires on cross-pane moves
  // without firing on other deps' changes. `hasMountedRef` skips the
  // initial-mount run so this effect does not double-fire with the
  // primary restore effect above; only subsequent `hostStackId`
  // transitions trigger the refocus. The active-card gate and the
  // pre-check inside `applyFocusSnapshot` keep the refocus from
  // stealing focus out from under a user who has since clicked
  // elsewhere. L23, R07.
  const hasMountedRef = useRef(false);
  useLayoutEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (!hostContentEl) return;
    const bag = store.getCardState(cardId);
    if (!bag || !bag.focus || bag.focus.kind === "none") return;
    // Content-owning cards manage focus themselves ([D07]). CardHost
    // must not drive focus for them even on a cross-pane move; the
    // engine's own onSelectionChanged-driven publish plus the deck-
    // store's focus-change subscription in selection-guard keep the
    // card's selection painted correctly across the move.
    if (bag.content !== undefined) return;
    if (!isActiveCardOfActivePane(store, cardId)) return;
    const cardRoot = findCardRoot(hostContentEl, cardId);
    if (!cardRoot) return;
    applyFocusSnapshot(cardRoot, bag.focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostStackId]);

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
  const feedsReady = feedIds.length === 0 || feedData.size > 0;

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

  // Compose the card-root ref with `responderRef` (a callback ref the
  // responder chain uses for DOM anchoring). A stable useCallback keeps
  // React from firing the callback with `null` then the element on every
  // render. L07.
  const setCardRootEl = useCallback(
    (el: HTMLDivElement | null) => {
      cardRootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

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
