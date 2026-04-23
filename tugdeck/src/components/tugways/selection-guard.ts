/**
 * selection-guard.ts -- SelectionGuard singleton (boundary enforcer).
 *
 * Architecture: SelectionGuard operates at the CARD LEVEL only. It:
 *   - Prevents selections from escaping card boundaries
 *   - Handles card-switch dimming (inactive-selection CSS Highlight)
 *   - Handles card-switch restoration (restore browser Selection on click-back)
 *   - Manages app activation/deactivation dimming
 *
 * It does NOT reach inside cards to manage content selection. Active
 * selection rendering uses native ::selection. Components own their own
 * selection behavior.
 *
 * Only ONE CSS Custom Highlight: "inactive-selection" for dimmed cards.
 * No "card-selection" highlight — native ::selection handles the active card.
 *
 * Three-layer selection containment system:
 *   1. CSS `user-select: none` baseline (globals.css) prevents selection
 *      starting in chrome. Content components opt in with `user-select: text`.
 *   2. SelectionGuard (this file) clips selection at runtime when it escapes
 *      card boundaries:
 *        - Pointer-clamped clipping on every `pointermove` (primary path)
 *        - `selectionchange` safety net for keyboard-driven extension
 *        - RAF-based autoscroll for overflow cards
 *   3. `data-tug-select` attribute API: four modes (default, none, all,
 *      custom) give card authors fine-grained per-region control.
 *
 * See tuglaws/selection-model.md for the full system documentation.
 */

import { getDeckStore } from "../../lib/deck-store-registry";
import { isDevEnv } from "../../lib/dev-env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Serialized selection state for save/restore across tab switches.
 *
 * Anchor and focus positions are encoded as index paths from the card's
 * boundary element root down to the target text node. This is stable across
 * unmount/remount as long as the content structure is unchanged (same content,
 * re-mounted — Phase 5b contract).
 */
export interface SavedSelection {
  /** Index path from boundary root to anchor node (array of child indices). */
  anchorPath: number[];
  anchorOffset: number;
  /** Index path from boundary root to focus node (array of child indices). */
  focusPath: number[];
  focusOffset: number;
}

// ---------------------------------------------------------------------------
// caretPositionFromPointCompat (Spec S04, Risk R01)
// ---------------------------------------------------------------------------

/**
 * Get the caret position at a document point using the best available API.
 *
 * Uses `document.caretPositionFromPoint` (standard) with a fallback to
 * `document.caretRangeFromPoint` (WebKit/Safari legacy). Both APIs return
 * equivalent position information for the purpose of pointer-clamped clipping.
 *
 * Returns `{ node, offset }` or `null` if no position can be determined.
 * See: Risk R01 — caretPositionFromPoint API availability.
 */
export function caretPositionFromPointCompat(
  x: number,
  y: number
): { node: Node; offset: number } | null {
  // Standard API (Chrome, Firefox, modern Safari)
  if (typeof document.caretPositionFromPoint === "function") {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      return { node: pos.offsetNode, offset: pos.offset };
    }
    return null;
  }

  // WebKit/Safari legacy fallback (caretRangeFromPoint)
  if (typeof (document as any).caretRangeFromPoint === "function") {
    const range = (document as any).caretRangeFromPoint(x, y) as Range | null;
    if (range) {
      return { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp `value` to the range [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamp a point (clientX, clientY) to within the given DOMRect.
 * Returns the clamped coordinates as { x, y }.
 */
export function clampPointToRect(
  x: number,
  y: number,
  rect: DOMRect
): { x: number; y: number } {
  return {
    x: clamp(x, rect.left, rect.right),
    y: clamp(y, rect.top, rect.bottom),
  };
}

/**
 * Walk from `node` up through its ancestors to check whether any ancestor
 * (up to but not including `boundary`) has `data-tug-select="custom"`.
 *
 * When found, SelectionGuard skips clipping for that subtree ([D05]).
 */
function hasCustomSelectAncestor(node: Node, boundary: HTMLElement): boolean {
  let current: Node | null = node instanceof Element ? node : node.parentElement;
  while (current !== null && current !== boundary) {
    if (
      current instanceof HTMLElement &&
      current.dataset["tugSelect"] === "custom"
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Compute the index path from `root` to `node`.
 * Returns an array of child indices, or null if `node` is not a descendant
 * of `root`.
 */
function nodeToPath(root: HTMLElement, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;

  while (current !== null && current !== root) {
    const parent: Node | null = current.parentNode;
    if (parent === null) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index === -1) return null;
    path.unshift(index);
    current = parent;
  }

  if (current !== root) return null;
  return path;
}

/**
 * Resolve a `path` (array of child indices from `root`) back to a Node.
 * Returns null if the path cannot be resolved (DOM structure changed).
 */
function pathToNode(root: HTMLElement, path: number[]): Node | null {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

// ---------------------------------------------------------------------------
// SelectionGuard class
// ---------------------------------------------------------------------------

// Autoscroll constants
const EDGE_SIZE_PX = 40;
const MAX_SCROLL_SPEED = 20;

/**
 * SelectionGuard — module-level singleton that enforces selection boundaries
 * at the card level.
 *
 * ## Architecture (boundary enforcer)
 *
 * Active selection uses native `::selection`. One CSS Custom Highlight
 * (`inactive-selection`) renders dimmed selections for background cards.
 *
 * On card switch: the old card's Selection is cloned into `inactive-selection`
 * (dimmed). The new card's saved Range (if any) is restored to the browser
 * Selection. A one-shot mousedown handler prevents the click from collapsing
 * the restored selection.
 *
 * ## Registration
 *
 * Cards call `registerBoundary(cardId, element)` on mount and
 * `unregisterBoundary(cardId)` on unmount (via `useSelectionBoundary` hook).
 *
 * ## Lifecycle
 *
 * `attach()` installs document-level event listeners. `detach()` removes them.
 * Called by `ResponderChainProvider`.
 *
 * ## Selection persistence
 *
 * `saveSelection(cardId)` / `restoreSelection(cardId, saved)` for tab
 * switching (saves selection before unmount, restores after remount).
 *
 * ## Testing
 *
 * `reset()` clears all state between test cases.
 */
class SelectionGuard {
  // cardId → boundary element
  private boundaries: Map<string, HTMLElement> = new Map();

  // ---- CSS Custom Highlight API state ----
  //
  // Only ONE highlight: "inactive-selection" for dimmed cards.
  // Active selection uses native ::selection — no highlight needed.

  // CSS Highlight for inactive cards' dimmed selections.
  private inactiveHighlight: Highlight | null = null;

  // cardId → last-known DOM Range published by the card's owning
  // component (e.g. TugTextEngine's `onSelectionChanged`). This is the
  // input to the multi-card paint generalization in `updatePaint`.
  //
  // Only real Ranges are stored: `updateCardDomSelection(id, null)`
  // removes the entry rather than writing a sentinel. "No entry" covers
  // both "never published" and "explicitly cleared" — paint treats
  // them identically, so there is no reason to distinguish. Readable
  // from tests via {@link getCardRange}; components publish via
  // {@link updateCardDomSelection}.
  private cardRanges: Map<string, Range> = new Map();

  // The card that currently "owns" the active selection (i.e., the
  // focused card). Used to know which card to deactivate when a
  // different card is clicked.
  private activeCardId_highlight: string | null = null;

  // Whether CSS.highlights is available.
  private highlightsAvailable = false;

  // Whether the app window currently holds focus. Flipped to `false`
  // on `applicationDidResignActive` and back to `true` on
  // `applicationDidBecomeActive`. Read by `updatePaint`: when `false`,
  // every card's Range — including the focused card's — paints in the
  // `inactive-selection` highlight, matching the browser's own
  // window-blur dim. Replaces the old `deactivatedCardId` field that
  // tracked one card's Range across the resign/activate transition.
  private windowHasFocus = true;

  // Deck-store subscription installed by `attach()` when a deck store
  // is registered. Fires on any state change; the handler calls
  // `updatePaint()` so paint keeps up with `activePaneId` /
  // `activeCardId` transitions that change which card's Range belongs
  // in native `::selection` vs. the `inactive-selection` highlight.
  private deckStoreUnsubscribe: (() => void) | null = null;

  // Last focused card id observed by the deck-store subscription
  // handler. Held so the handler can detect *transitions* (focus
  // moved from A → B) and install the one-shot mousedown interceptor
  // only for genuine switches that will restore a saved Range via
  // `setBaseAndExtent`. Every-notify paint calls still happen, but
  // the interceptor is scoped to real focus changes.
  private lastPaintFocusedCardId: string | null = null;

  // One-shot mousedown prevention handler reference (for cleanup in reset).
  private boundPreventMousedown: ((e: MouseEvent) => void) | null = null;

  // Current tracking state during a pointer-driven drag
  private activeCardId: string | null = null;
  private isTracking = false;

  // Last known pointer position (client coords) used by RAF autoscroll
  private lastPointerX = 0;
  private lastPointerY = 0;

  // RAF handle for autoscroll loop
  private rafHandle: number | null = null;

  // Bound listener references (so they can be removed)
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundSelectionChange: () => void;
  private boundSelectStart: (e: Event) => void;

  // CardLifecycle subscription — installed on attach() when a
  // card lifecycle is provided. Replaces the deck-canvas-side
  // `useLayoutEffect(() => selectionGuard.activateCard(focusedCardId), ...)`
  // so the guard reacts to activations via one subscription rather
  // than two coupled effects on opposite sides of the tree.
  private lifecycleUnsubscribe: (() => void) | null = null;

  // AppLifecycle subscriptions — installed on attach() when an app
  // lifecycle is provided. Step 5 of the lifecycle-delegates plan
  // replaces the old window-global RPC functions with delegate
  // subscriptions that fire the same dim/restore logic from the
  // `applicationDidResignActive` / `applicationDidBecomeActive`
  // events. An array of disposers so detach() can release all at once.
  private appLifecycleUnsubscribers: Array<() => void> = [];

  constructor() {
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundSelectionChange = this.handleSelectionChange.bind(this);
    this.boundSelectStart = this.handleSelectStart.bind(this);

    this.initHighlights();
  }

  /**
   * Create the inactive-selection CSS Highlight if the API is available.
   * Idempotent — safe to call multiple times.
   */
  private initHighlights(): void {
    if (this.highlightsAvailable) return;
    if (typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      this.highlightsAvailable = true;
      this.inactiveHighlight = new Highlight();
      CSS.highlights.set("inactive-selection", this.inactiveHighlight);
    }
  }

  // ---- Boundary registration ----

  /**
   * Return a real viewport rect for a boundary element.
   *
   * `CardHost` registers the card-host div, which uses `display: contents`
   * so that its content portals into the pane's content area without adding
   * a layout box. A `display: contents` element returns a zero-sized
   * `DOMRect` from `getBoundingClientRect()`, which would make drag-clip
   * clamp every pointer to the screen origin. Walk up to the nearest
   * ancestor (typically `.tug-pane-content`) that *does* produce a box and
   * return its rect — that's the viewport rect the pre-card-level design
   * used, preserved verbatim now that boundary identity has moved down a
   * level.
   */
  private getBoundaryRect(boundary: HTMLElement): DOMRect {
    const rect = boundary.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
    let parent: HTMLElement | null = boundary.parentElement;
    while (parent) {
      const pRect = parent.getBoundingClientRect();
      if (pRect.width > 0 || pRect.height > 0) return pRect;
      parent = parent.parentElement;
    }
    return rect;
  }

  /**
   * Register a card content area as a selection boundary.
   * Called by `useSelectionBoundary` on mount.
   */
  registerBoundary(cardId: string, element: HTMLElement): void {
    this.boundaries.set(cardId, element);
  }

  /**
   * Unregister a card content area.
   * Called by `useSelectionBoundary` on unmount cleanup.
   *
   * Clears every card-scoped data structure in lockstep so no card-
   * specific state survives past its boundary: the `cardRanges` Map
   * entry and any lingering interactive-tracking state. Any future
   * card-scoped map added to this class must be cleared here too.
   * A final `updatePaint()` flushes the inactive highlight so stale
   * Ranges don't linger until the next publish.
   */
  unregisterBoundary(cardId: string): void {
    this.boundaries.delete(cardId);
    if (this.activeCardId === cardId) {
      this.stopTracking();
    }
    const hadRange = this.cardRanges.delete(cardId);
    if (this.activeCardId_highlight === cardId) {
      this.activeCardId_highlight = null;
    }
    if (hadRange) this.updatePaint();
  }

  // ---- Card DOM-selection publish ----

  /**
   * Publish the latest DOM `Range` for a card. Called by the card's
   * owning component (e.g. a `TugTextEngine` via `onSelectionChanged`)
   * whenever the card's selection moves, or on unmount to clear the
   * entry by passing `null`. [D05], [Q06a].
   *
   * This step only stores the Range. Step 5 adds the paint step that
   * renders stored Ranges into the `inactive-selection` CSS Custom
   * Highlight (for cards other than the focused one) and into
   * `window.getSelection()` (for the focused card). Separating
   * "store" from "paint" keeps the component publish API stable while
   * the paint implementation evolves.
   */
  updateCardDomSelection(cardId: string, range: Range | null): void {
    if (range === null) {
      this.cardRanges.delete(cardId);
    } else {
      this.cardRanges.set(cardId, range);
    }
    this.updatePaint({ changedCardId: cardId });
  }

  /**
   * Read the most-recently-published DOM `Range` for a card. Returns
   * `undefined` when the guard has no published Range for the card
   * (either never published, or the last publish was an explicit clear
   * — the two cases are indistinguishable by design, see
   * {@link cardRanges}). Exposed primarily for tests; production code
   * reads `cardRanges` indirectly through {@link updatePaint}.
   */
  getCardRange(cardId: string): Range | undefined {
    return this.cardRanges.get(cardId);
  }

  // ---- Paint ----

  /**
   * Resolve the id of the card whose selection belongs in native
   * `::selection`: the active card of the active pane. Returns `null`
   * when no pane is active, no deck store is registered (tests that
   * bootstrap only the guard), or the active pane has no active card.
   * Does not consider window focus — callers that want focus-gated
   * behavior read {@link windowHasFocus} alongside.
   */
  private getFocusedCardId(): string | null {
    const store = getDeckStore();
    if (store === null) return null;
    const state = store.getSnapshot();
    if (state.activePaneId === undefined) return null;
    const pane = state.panes.find((p) => p.id === state.activePaneId);
    if (pane === undefined) return null;
    return pane.activeCardId;
  }

  /**
   * Rebuild the `inactive-selection` CSS Custom Highlight and sync the
   * native `window.getSelection()` to reflect the current state of
   * {@link cardRanges}, {@link windowHasFocus}, and the deck-store's
   * focused card. [L06] is the anchor: paint is appearance-zone, driven
   * by singleton state mutations on the DOM highlight and the native
   * selection — no React render involved. [L22] is why paint is driven
   * by a store subscription rather than a `useSyncExternalStore`-style
   * round-trip.
   *
   * ## Rules
   *
   * - Every entry of `cardRanges` whose Range is still anchored to
   *   live DOM (`document.contains(startContainer) && document.contains(endContainer)`)
   *   paints in the `inactive-selection` highlight, **except** when the
   *   entry's cardId is the focused card *and* the window has focus.
   *   In that case the Range paints natively via `window.getSelection()`
   *   instead.
   * - Stale Ranges (one or both endpoints detached from the document —
   *   see [R01](#r01-stale-ranges): an engine mutated its subtree
   *   without calling `updateCardDomSelection(cardId, newRange)`) are
   *   dropped from `cardRanges` and, in dev builds, logged with a
   *   `[selection-guard]` warning naming the offending `cardId`.
   * - When `windowHasFocus` is `false`, every live Range paints in the
   *   inactive highlight — including the focused card's. This matches
   *   the browser's own window-blur dim without needing a separate
   *   "deactivatedCardId" tracking field.
   *
   * ## Hint and short-circuit
   *
   * Callers may pass `{ changedCardId }` to indicate that only one
   * card's entry changed. When `changedCardId` matches the focused
   * card *and* the window has focus, the inactive-highlight set is by
   * construction unchanged (the focused card's Range doesn't paint
   * there), so the rebuild loop is skipped. Native `::selection`
   * already reflects the user's live selection in the focused engine —
   * no intervention needed. This bounds the cost of eager publishing
   * ([Q03]) to one `Map.set` + one short-circuit check per caret move.
   *
   * Deck-state-change callers pass no hint → full rebuild. Calls from
   * `handleApplicationDid{Resign,Become}Active` likewise pass no hint,
   * because the focus flip affects every entry's destination.
   */
  private updatePaint(hint?: { changedCardId?: string }): void {
    if (!this.inactiveHighlight) return;

    const focusedCardId =
      this.windowHasFocus ? this.getFocusedCardId() : null;

    // Short-circuit: if the only change is to the focused card's
    // entry, and the window has focus, the `inactive-selection` set
    // does not change and native `::selection` is already current.
    if (
      hint?.changedCardId !== undefined &&
      focusedCardId !== null &&
      hint.changedCardId === focusedCardId
    ) {
      return;
    }

    // Full rebuild: clear the highlight, walk cardRanges, and repopulate.
    this.inactiveHighlight.clear();
    for (const [cardId, range] of this.cardRanges) {
      if (
        !document.contains(range.startContainer) ||
        !document.contains(range.endContainer)
      ) {
        // Stale range — its anchor DOM has been detached. The owning
        // component mutated the subtree without publishing a fresh
        // Range. Drop the entry so we don't paint against dead nodes,
        // and in dev surface the cardId so the offender can be found.
        this.cardRanges.delete(cardId);
        if (isDevEnv()) {
          console.warn(
            `[selection-guard] stale range dropped for card "${cardId}" ` +
              `— owning component did not re-publish after DOM mutation`,
          );
        }
        continue;
      }
      if (cardId === focusedCardId) {
        // Focused card's Range paints natively (below), not in the
        // inactive highlight.
        continue;
      }
      this.inactiveHighlight.add(range);
    }

    // Sync native `::selection` to the focused card's Range. When
    // there is no focused card or the focused card has not published
    // a Range, leave native selection alone — the user's click or
    // interactive selection is the source of truth.
    if (focusedCardId !== null) {
      const range = this.cardRanges.get(focusedCardId);
      if (range !== undefined) {
        const sel = window.getSelection();
        if (sel !== null) {
          try {
            sel.setBaseAndExtent(
              range.startContainer,
              range.startOffset,
              range.endContainer,
              range.endOffset,
            );
          } catch {
            // Offsets may be out of range if the DOM mutated between
            // the publish and this paint. Best-effort only — a later
            // publish will re-sync.
          }
        }
      }
    }
  }

  // ---- Lifecycle ----

  /**
   * Install document-level event listeners.
   * Called once at app startup by `ResponderChainProvider` (Step 6).
   *
   * CSS Custom Highlights are created eagerly in the constructor (not here)
   * so they exist before any React effects fire.
   *
   * @param cardLifecycle - optional card lifecycle to subscribe to for
   *   activation events (drives the highlight bookkeeping). Tests that
   *   exercise the guard in isolation pass nothing.
   * @param appLifecycle - optional app lifecycle to subscribe to for
   *   resign/become-active events (drives selection dim/restore).
   *   Added in Step 5 of the lifecycle-delegates plan; replaces the
   *   imperative `deactivateApp()` / `activateApp()` public entry
   *   points that were called from window-global RPC functions.
   */
  attach(
    cardLifecycle?: {
      observeCardDidActivate: (
        cardId: string | null,
        callback: (cardId: string) => void,
      ) => () => void;
    } | null,
    appLifecycle?: {
      observeApplicationDidResignActive: (cb: () => void) => () => void;
      observeApplicationDidBecomeActive: (cb: () => void) => () => void;
    } | null,
  ): void {
    document.addEventListener("pointerdown", this.boundPointerDown, { capture: true });
    document.addEventListener("pointermove", this.boundPointerMove, { capture: true });
    document.addEventListener("pointerup", this.boundPointerUp, { capture: true });
    document.addEventListener("selectionchange", this.boundSelectionChange);
    document.addEventListener("selectstart", this.boundSelectStart, { capture: true });

    // Initialize highlight if not yet created (covers tests that install
    // mock CSS.highlights after module import), and re-register with
    // CSS.highlights if detach() previously unregistered it.
    this.initHighlights();
    if (this.highlightsAvailable && this.inactiveHighlight &&
        typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      CSS.highlights.set("inactive-selection", this.inactiveHighlight);
    }

    // Wildcard subscription to the card lifecycle so every activation
    // flips the highlight bookkeeping. Initial-sync fires the
    // callback immediately for the currently-active card, so the
    // old explicit-effect path is no longer needed in DeckCanvas.
    if (cardLifecycle) {
      this.lifecycleUnsubscribe = cardLifecycle.observeCardDidActivate(
        null,
        (cardId) => this.activateCard(cardId),
      );
    }

    // App-lifecycle subscriptions. The guard is the sole consumer of
    // these events today; more delegates may attach later. Kept as
    // observer registrations rather than a `TugAppDelegate` object
    // because the guard is a non-React singleton and the hook-side
    // deferral is unnecessary here (selection dim/restore has no
    // focus-lock interaction to escape).
    if (appLifecycle) {
      this.appLifecycleUnsubscribers.push(
        appLifecycle.observeApplicationDidResignActive(() =>
          this.handleApplicationDidResignActive(),
        ),
        appLifecycle.observeApplicationDidBecomeActive(() =>
          this.handleApplicationDidBecomeActive(),
        ),
      );
    }

    // Deck-store subscription. Fires on every state notify. The handler
    // asks for a full rebuild without a hint because any deck-state
    // change is potentially an `activePaneId` / `activeCardId` change,
    // which moves which card's Range belongs in native selection. The
    // rebuild loop is O(cards × 1 `document.contains` check) — cheap.
    // [L22] direct store observation drives DOM mutation; no React
    // round-trip.
    //
    // When focus genuinely moves to a card that has a saved Range,
    // install a one-shot capture-phase `mousedown` interceptor before
    // painting. `updatePaint` will `setBaseAndExtent` the saved Range
    // into native `::selection`, restoring the UX the user had on
    // that card before switching away; the interceptor stops the
    // click's own `mousedown` from immediately collapsing that
    // restoration to the click point. If the newly-focused card has
    // no saved Range (fresh card, never selected), no interceptor is
    // installed — the click's caret-placement proceeds normally.
    const deckStore = getDeckStore();
    if (deckStore !== null) {
      this.deckStoreUnsubscribe = deckStore.subscribe(() => {
        const newFocused = this.getFocusedCardId();
        if (newFocused !== this.lastPaintFocusedCardId) {
          if (
            newFocused !== null &&
            this.cardRanges.has(newFocused)
          ) {
            this.installPreventMousedown();
          }
          this.lastPaintFocusedCardId = newFocused;
        }
        this.updatePaint();
      });
      // Initial sync so the first paint reflects the store's current
      // active card, not the constructor-default (no focused card).
      this.lastPaintFocusedCardId = this.getFocusedCardId();
      this.updatePaint();
    }
  }

  /**
   * Remove document-level event listeners and unregister CSS Custom Highlights.
   * Called on teardown by `ResponderChainProvider`.
   *
   * Unregisters highlights from CSS.highlights (stops painting) but does NOT
   * null the Highlight objects — they are owned by the singleton for its
   * lifetime. attach() re-registers them.
   */
  detach(): void {
    document.removeEventListener("pointerdown", this.boundPointerDown, { capture: true });
    document.removeEventListener("pointermove", this.boundPointerMove, { capture: true });
    document.removeEventListener("pointerup", this.boundPointerUp, { capture: true });
    document.removeEventListener("selectionchange", this.boundSelectionChange);
    document.removeEventListener("selectstart", this.boundSelectStart, { capture: true });
    this.stopAutoscroll();
    this.removePreventMousedown();

    if (this.highlightsAvailable && typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      CSS.highlights.delete("inactive-selection");
    }
    this.cardRanges.clear();
    this.activeCardId_highlight = null;
    this.windowHasFocus = true;
    this.lastPaintFocusedCardId = null;

    if (this.lifecycleUnsubscribe !== null) {
      this.lifecycleUnsubscribe();
      this.lifecycleUnsubscribe = null;
    }

    for (const unsub of this.appLifecycleUnsubscribers) unsub();
    this.appLifecycleUnsubscribers = [];

    if (this.deckStoreUnsubscribe !== null) {
      this.deckStoreUnsubscribe();
      this.deckStoreUnsubscribe = null;
    }
  }

  // ---- Card activation (highlight management) ----

  /**
   * Mark a card as the focus-tracking target for the pointer / keyboard
   * clamp logic. The dim / restore paint dance is **not** driven from
   * here anymore — {@link updatePaint} reads the deck store's focused
   * card and the `cardRanges` store directly, and the deck-store
   * subscription installed in `attach()` reruns paint whenever
   * `activePaneId` / `activeCardId` changes.
   *
   * This method remains as a narrow hook from `handlePointerDown`: it
   * records which card owns the pointer-driven activation attempt so
   * drag-clip can clamp against that card's boundary. Paint follows
   * from the deck-store subscription.
   *
   * Called from {@link handlePointerDown} (pointer-driven focus) and
   * from the `cardLifecycle.observeCardDidActivate` wildcard
   * subscription installed in `attach()`.
   */
  activateCard(cardId: string): void {
    if (this.activeCardId_highlight === cardId) return;
    this.activeCardId_highlight = cardId;
  }

  /**
   * Handle `applicationDidResignActive`: flip the `windowHasFocus`
   * flag to `false` and repaint. With the flag off, {@link updatePaint}
   * paints every card's Range — including the focused card's — in the
   * inactive highlight, matching the browser's own window-blur dim
   * without any manual Range cloning.
   */
  private handleApplicationDidResignActive(): void {
    if (!this.windowHasFocus) return;
    this.windowHasFocus = false;
    this.updatePaint();
  }

  /**
   * Handle `applicationDidBecomeActive`: flip `windowHasFocus` back to
   * `true` and repaint. The focused card's Range returns to native
   * `::selection`; all other cards' Ranges remain in the inactive
   * highlight.
   */
  private handleApplicationDidBecomeActive(): void {
    if (this.windowHasFocus) return;
    this.windowHasFocus = true;
    this.updatePaint();
  }

  // ---- Selection persistence (Phase 5b infrastructure) ----

  /**
   * Save the current selection state for a card.
   *
   * Returns `null` if:
   *   - The card is not registered.
   *   - No selection exists within this card's boundary (live or stored Range).
   *
   * Used by Phase 5b tab switching to save selection before unmounting a tab.
   */
  saveSelection(cardId: string): SavedSelection | null {
    const boundary = this.boundaries.get(cardId);
    if (!boundary) return null;

    // Try the live browser Selection first.
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (
        anchorNode && focusNode &&
        anchorNode !== boundary && focusNode !== boundary &&
        boundary.contains(anchorNode) && boundary.contains(focusNode)
      ) {
        const anchorPath = nodeToPath(boundary, anchorNode);
        const focusPath = nodeToPath(boundary, focusNode);
        if (anchorPath && focusPath && anchorPath.length > 0 && focusPath.length > 0) {
          return {
            anchorPath,
            anchorOffset: selection.anchorOffset,
            focusPath,
            focusOffset: selection.focusOffset,
          };
        }
      }
    }

    // Fallback: use the most-recently-published Range from `cardRanges`.
    // This covers the case where the browser Selection was cleared
    // (e.g., the user clicked `user-select: none` chrome) but the card
    // still has a selection the owning component has published.
    const publishedRange = this.cardRanges.get(cardId);
    if (publishedRange) {
      const startNode = publishedRange.startContainer;
      const endNode = publishedRange.endContainer;
      if (
        startNode !== boundary && endNode !== boundary &&
        boundary.contains(startNode) && boundary.contains(endNode)
      ) {
        const anchorPath = nodeToPath(boundary, startNode);
        const focusPath = nodeToPath(boundary, endNode);
        if (anchorPath && focusPath && anchorPath.length > 0 && focusPath.length > 0) {
          return {
            anchorPath,
            anchorOffset: publishedRange.startOffset,
            focusPath,
            focusOffset: publishedRange.endOffset,
          };
        }
      }
    }

    return null;
  }

  /**
   * Restore a previously saved selection state for a card.
   *
   * Sets the browser Selection (for copy/paste) and the active highlight
   * will be updated automatically via the selectionchange event.
   *
   * No-ops if:
   *   - The card boundary is not registered.
   *   - The anchor or focus node cannot be resolved from the saved path
   *     (DOM structure changed since save).
   *
   * Used by Phase 5b tab switching to restore selection after remounting.
   */
  restoreSelection(cardId: string, saved: SavedSelection): void {
    const boundary = this.boundaries.get(cardId);
    if (!boundary) return;

    const anchorNode = pathToNode(boundary, saved.anchorPath);
    const focusNode = pathToNode(boundary, saved.focusPath);
    if (!anchorNode || !focusNode) return;

    const selection = window.getSelection();
    if (!selection) return;

    try {
      selection.setBaseAndExtent(
        anchorNode,
        saved.anchorOffset,
        focusNode,
        saved.focusOffset
      );
      // Native ::selection renders the restored selection immediately.
      // No syncActiveHighlight call needed.
    } catch {
      // setBaseAndExtent can throw if offsets are out of range (e.g. content
      // changed). Fail silently — best-effort restoration.
    }
  }

  // ---- Reset (for testing) ----

  /**
   * Clear all state. Used between test cases ([D02] testing note).
   */
  reset(): void {
    this.stopTracking();
    this.removePreventMousedown();
    this.boundaries.clear();
    this.cardRanges.clear();
    this.activeCardId_highlight = null;
    this.windowHasFocus = true;
    this.lastPaintFocusedCardId = null;
    if (this.inactiveHighlight) {
      this.inactiveHighlight.clear();
    }
  }

  // ---- selectstart gate ----

  /**
   * Block text selection from starting outside card content areas.
   *
   * `user-select: none` on body prevents selection from *visually* starting
   * in chrome, but WebKit still allows a drag originating in a `user-select:
   * none` region to extend into `user-select: text` children. Preventing the
   * `selectstart` event stops the selection from being created at all.
   */
  private handleSelectStart(event: Event): void {
    const target = event.target as Node | null;
    if (!target) return;

    // Allow selection to start inside any registered card content boundary
    for (const [, element] of this.boundaries) {
      if (element.contains(target)) {
        return;
      }
    }

    // Selection is starting outside all card content areas — block it
    event.preventDefault();
  }

  // ---- Pointer event handlers ----

  private handlePointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (!target) return;

    // Skip highlight activation for elements marked data-no-activate —
    // e.g. close buttons, where clicking a background card's chrome must
    // not dim the frontmost card's selection.
    const targetEl = target instanceof Element ? target : (target as Node).parentElement;
    if (targetEl?.closest("[data-no-activate]")) return;

    // ---- Determine which card the click belongs to ----
    //
    // First check content boundaries (most common). For clicks that land on
    // deck chrome (title bar, tab bar, close button) — which lives outside
    // the boundary subtree — walk up to the nearest `[data-card-host]`
    // ancestor and read its `data-card-id`. This is the card-level identity
    // anchor installed by `CardHost`.
    let clickedCardId: string | null = null;
    for (const [cardId, element] of this.boundaries) {
      if (element.contains(target)) {
        clickedCardId = cardId;
        break;
      }
    }
    if (clickedCardId === null) {
      const el = target instanceof Element ? target : (target as Node).parentElement;
      const cardHost = el?.closest("[data-card-host]");
      const cid = cardHost?.getAttribute("data-card-id") ?? null;
      if (cid !== null && this.boundaries.has(cid)) {
        clickedCardId = cid;
      }
    }

    // ---- Activate the clicked card ----
    //
    // activateCard handles all cases: same-card (no-op), card switch
    // (deactivate old, activate new, restore selection), and first
    // activation (just set the tracking field).
    if (clickedCardId) {
      this.activateCard(clickedCardId);
    }

    // ---- Tracking loop ----
    //
    // Find which registered card boundary contains the pointer target.
    // Only begin tracking if the target is inside a registered card content
    // area — this prevents resize handles, title bars, and canvas clicks from
    // starting selection tracking ([D03]).
    for (const [cardId, element] of this.boundaries) {
      if (element.contains(target)) {
        this.activeCardId = cardId;
        this.isTracking = true;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        return;
      }
    }

    // Pointer started outside all registered boundaries — no tracking
    this.isTracking = false;
    this.activeCardId = null;
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.isTracking || this.activeCardId === null) return;

    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    const boundary = this.boundaries.get(this.activeCardId);
    if (!boundary) return;

    const rect = this.getBoundaryRect(boundary);
    const x = event.clientX;
    const y = event.clientY;

    const isOutside =
      x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;

    if (isOutside) {
      // Clamp coordinates to boundary edge and set selection focus there ([D03])
      this.clampSelectionToRect(rect, boundary);

      // Start or continue RAF-based autoscroll if the pointer is outside the
      // scroll viewport edge zone
      this.maybeStartAutoscroll(boundary, rect);
    } else {
      // Pointer is back inside — stop autoscroll
      this.stopAutoscroll();
    }
  }

  private handlePointerUp(_event: PointerEvent): void {
    this.stopTracking();
  }

  // ---- selectionchange: boundary clipping safety net ----

  private handleSelectionChange(): void {
    const selection = window.getSelection();

    // No mirroring — native ::selection handles rendering.
    // This handler only clips selections that escape card boundaries.

    if (!selection || selection.rangeCount === 0) return;

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode) return;

    // Find the boundary that contains the anchor (the selection origin).
    // This works for both pointer-driven and keyboard-driven selection.
    let boundary: HTMLElement | null = null;
    for (const [, element] of this.boundaries) {
      if (element.contains(anchorNode)) {
        boundary = element;
        break;
      }
    }
    if (!boundary) {
      // Anchor is outside all registered card content areas. If the focus
      // landed inside a card (drag from canvas into card content), clear the
      // selection entirely — selections must originate inside a card.
      for (const [, element] of this.boundaries) {
        if (element.contains(focusNode)) {
          selection.removeAllRanges();
          return;
        }
      }
      return;
    }

    // If focus is inside the same boundary, nothing to clip
    if (boundary.contains(focusNode)) return;

    // Check for data-tug-select="custom" — skip clipping for custom subtrees
    if (hasCustomSelectAncestor(anchorNode, boundary)) return;

    // Focus escaped the boundary. Clip the selection to the boundary edge.
    // Use setBaseAndExtent to forcibly pin the focus inside the boundary,
    // overriding the browser's native selection extension.
    try {
      if (this.isTracking && this.lastPointerY < this.getBoundaryRect(boundary).top) {
        // Dragging upward — pin focus to start of boundary
        selection.setBaseAndExtent(
          anchorNode, selection.anchorOffset,
          boundary, 0
        );
      } else {
        // Dragging downward or keyboard — pin focus to end of boundary
        selection.setBaseAndExtent(
          anchorNode, selection.anchorOffset,
          boundary, boundary.childNodes.length
        );
      }
    } catch {
      // Last resort: collapse to anchor
      selection.collapse(anchorNode, selection.anchorOffset);
    }
  }

  // ---- Clamping logic ----

  /**
   * Clamp the current selection's focus to the nearest text position within
   * the boundary rect. Uses `caretPositionFromPointCompat` (Spec S04, R01).
   */
  private clampSelectionToRect(rect: DOMRect, boundary: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    // Skip if anchor is in a custom-managed subtree
    if (hasCustomSelectAncestor(selection.anchorNode, boundary)) return;

    const { x, y } = clampPointToRect(
      this.lastPointerX,
      this.lastPointerY,
      rect
    );

    const pos = caretPositionFromPointCompat(x, y);
    if (!pos) return;

    // Verify the resolved node is actually inside the boundary. At rect
    // edges, caretPositionFromPoint can resolve to an adjacent sibling
    // (e.g. the header element sitting right above the content area).
    if (!boundary.contains(pos.node)) return;

    // Pin the selection focus at the clamped edge position
    try {
      selection.extend(pos.node, pos.offset);
    } catch {
      // extend() can throw if the node is not in the same tree. Ignore.
    }
  }

  // ---- RAF-based autoscroll ----

  /**
   * Start an autoscroll RAF loop if the pointer is near the scroll viewport
   * edge of the card's content area.
   *
   * When pointer-clamping is active, the browser never sees the pointer
   * leaving the scrollable area, so native autoscroll is suppressed. We
   * reimplement it here: compute scroll velocity proportional to the distance
   * outside the edge zone, scroll, then re-extend the selection after each
   * tick to track newly visible content.
   */
  private maybeStartAutoscroll(boundary: HTMLElement, rect: DOMRect): void {
    if (this.rafHandle !== null) return; // already running
    this.runAutoscrollTick(boundary, rect);
  }

  private runAutoscrollTick(boundary: HTMLElement, rect: DOMRect): void {
    const x = this.lastPointerX;
    const y = this.lastPointerY;

    // Compute scroll delta based on distance outside the edge zone
    let scrollDx = 0;
    let scrollDy = 0;

    if (x < rect.left) {
      const dist = rect.left - x;
      scrollDx = -this.scrollSpeed(dist);
    } else if (x > rect.right) {
      const dist = x - rect.right;
      scrollDx = this.scrollSpeed(dist);
    }

    if (y < rect.top) {
      const dist = rect.top - y;
      scrollDy = -this.scrollSpeed(dist);
    } else if (y > rect.bottom) {
      const dist = y - rect.bottom;
      scrollDy = this.scrollSpeed(dist);
    }

    if (scrollDx === 0 && scrollDy === 0) {
      // Pointer back inside scroll viewport — stop
      this.stopAutoscroll();
      return;
    }

    boundary.scrollBy(scrollDx, scrollDy);

    // Re-extend selection to the clamped boundary edge after scroll, so the
    // selection tracks newly visible content
    const newRect = this.getBoundaryRect(boundary);
    this.clampSelectionToRect(newRect, boundary);

    // Schedule next tick
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      if (!this.isTracking || this.activeCardId === null) return;
      const currentBoundary = this.boundaries.get(this.activeCardId);
      if (!currentBoundary) return;
      this.runAutoscrollTick(currentBoundary, this.getBoundaryRect(currentBoundary));
    });
  }

  /**
   * Compute scroll speed (pixels per frame) proportional to the distance
   * outside the edge zone, capped at MAX_SCROLL_SPEED.
   */
  private scrollSpeed(distanceOutside: number): number {
    const ratio = Math.min(distanceOutside / EDGE_SIZE_PX, 1);
    return Math.round(ratio * MAX_SCROLL_SPEED);
  }

  private stopAutoscroll(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  // ---- Mousedown prevention ----

  /**
   * Install a one-shot capture-phase mousedown listener that calls
   * preventDefault to stop the browser from collapsing a just-restored
   * selection. Removes itself after firing once.
   */
  private installPreventMousedown(): void {
    this.removePreventMousedown();
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      this.boundPreventMousedown = null;
    };
    this.boundPreventMousedown = handler;
    document.addEventListener("mousedown", handler, { capture: true, once: true });
  }

  /**
   * Remove the one-shot mousedown prevention handler if it hasn't fired yet.
   */
  private removePreventMousedown(): void {
    if (this.boundPreventMousedown) {
      document.removeEventListener("mousedown", this.boundPreventMousedown, { capture: true });
      this.boundPreventMousedown = null;
    }
  }

  // ---- Tracking ----

  private stopTracking(): void {
    this.isTracking = false;
    this.activeCardId = null;
    this.stopAutoscroll();
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton ([D02])
// ---------------------------------------------------------------------------

/**
 * Module-level singleton instance of SelectionGuard.
 *
 * Exported for use by `useSelectionBoundary` (Step 4) and
 * `ResponderChainProvider` (Step 6). Tests call `.reset()` between cases.
 */
export const selectionGuard = new SelectionGuard();
