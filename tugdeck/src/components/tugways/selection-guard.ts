/**
 * selection-guard.ts -- SelectionGuard singleton for Phase 5a Selection Model.
 *
 * Three-layer selection containment system:
 *   1. CSS `user-select: none` baseline (globals.css) prevents selection
 *      starting in chrome. Card content areas opt back in with `user-select: text`.
 *   2. SelectionGuard (this file) clips selection at runtime when it escapes
 *      card boundaries:
 *        - Pointer-clamped clipping on every `pointermove` (primary path, D03)
 *        - `selectionchange` safety net for keyboard-driven extension (D04)
 *        - RAF-based autoscroll for overflow cards (Strategy §RAF-autoscroll)
 *   3. `data-td-select` attribute API (D05): four modes (default, none, all,
 *      custom) give card authors fine-grained per-region control.
 *
 * Design decisions referenced:
 *   [D02] Module-level singleton (matches ResponderChainManager pattern)
 *   [D03] Pointer-clamped clipping via caretPositionFromPoint
 *   [D04] selectionchange safety net for keyboard selection
 *   [D05] data-td-select attribute API
 *   [D06] Cmd+A selectAll action (wired in tugcard.tsx, Step 5)
 *   [D07] Selection tokens (tug-tokens.css)
 *
 * API reference: Spec S01, Spec S04
 * Risk mitigations: R01 (caretPositionFromPoint compat), R02 (selection flash)
 *
 * See also: tugplan-tugways-phase-5a-selection-model.md §strategy,
 * design-system-concepts.md Concept 14.
 */

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
 * (up to but not including `boundary`) has `data-td-select="custom"`.
 *
 * When found, SelectionGuard skips clipping for that subtree ([D05]).
 */
function hasCustomSelectAncestor(node: Node, boundary: HTMLElement): boolean {
  let current: Node | null = node instanceof Element ? node : node.parentElement;
  while (current !== null && current !== boundary) {
    if (
      current instanceof HTMLElement &&
      current.dataset["tdSelect"] === "custom"
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
 * SelectionGuard — module-level singleton that contains text selection within
 * registered card content boundaries.
 *
 * Registration:
 *   Cards call `registerBoundary(cardId, element)` on mount and
 *   `unregisterBoundary(cardId)` on unmount (via `useSelectionBoundary` hook).
 *
 * Lifecycle:
 *   `attach()` installs document-level event listeners.
 *   `detach()` removes them. Called by `ResponderChainProvider` (Step 6).
 *
 * Selection persistence:
 *   `saveSelection(cardId)` / `restoreSelection(cardId, saved)` for Phase 5b
 *   tab switching (saves selection before unmount, restores after remount).
 *
 * Inactive selection highlight (Phase 5f2, [D03], [D04], [D05]):
 *   `captureInactiveHighlight(cardId)` saves the live Range for a card being
 *   deactivated and adds it to the CSS Custom Highlight for inactive painting.
 *   `clearInactiveHighlight(cardId)` removes a card's range when it becomes active.
 *
 * Testing:
 *   `reset()` clears all state between test cases.
 *
 * [D02] Module-level singleton — zero React state, synchronous imperative
 * handling, same pattern as ResponderChainManager.
 */
class SelectionGuard {
  // cardId → boundary element
  private boundaries: Map<string, HTMLElement> = new Map();

  // ---- CSS Custom Highlight API state (Phase 5f2, Spec S02) ----

  // cardId → saved Range for the CSS inactive-selection highlight.
  // Only populated for inactive cards that had a selection when clicked away.
  private highlightRanges: Map<string, Range> = new Map();

  // The CSS Highlight object registered as "inactive-selection".
  // Null when CSS.highlights is unavailable (feature-detected in attach()).
  private highlight: Highlight | null = null;

  // ---- Phase 5f3: Pending highlight restore (Spec S02, [D02]) ----

  // cardId → Range stashed on pointerdown inside a card with a stored highlight.
  // On pointerup, if the resulting selection is collapsed (simple click), the
  // stashed Range is restored as the real Selection. If non-collapsed (drag),
  // the stash is discarded — the user created a new selection.
  // stopTracking() clears this as a safety net for pointer-cancel paths.
  private pendingHighlightRestore: Map<string, Range> = new Map();

  // Current tracking state during a pointer-driven drag
  private activeCardId: string | null = null;
  private isTracking = false;

  // Last known pointer position (client coords) used by RAF autoscroll
  private lastPointerX = 0;
  private lastPointerY = 0;

  // RAF handle for autoscroll loop
  private rafHandle: number | null = null;

  // One-shot mousedown handler installed during pointerdown when restoring a
  // highlight. Calls preventDefault() on the mousedown to prevent the browser
  // from placing a caret and starting selection tracking. Without this, the
  // browser's mouseup default processing finalizes the pending selection as a
  // collapsed caret, overwriting the selection we restore in handlePointerUp.
  // The handler removes itself after firing (one-shot).
  private boundPreventMousedown: ((e: MouseEvent) => void) | null = null;

  // Bound listener references (so they can be removed)
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundSelectionChange: () => void;
  private boundSelectStart: (e: Event) => void;

  constructor() {
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundSelectionChange = this.handleSelectionChange.bind(this);
    this.boundSelectStart = this.handleSelectStart.bind(this);
  }

  // ---- Boundary registration ----

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
   * Also cleans up any inactive selection highlight for this card.
   */
  unregisterBoundary(cardId: string): void {
    this.boundaries.delete(cardId);
    if (this.activeCardId === cardId) {
      this.stopTracking();
    }
    // Clean up the inactive highlight range for this card if one exists.
    this.clearInactiveHighlight(cardId);
  }

  // ---- Lifecycle ----

  /**
   * Install document-level event listeners.
   * Called once at app startup by `ResponderChainProvider` (Step 6).
   *
   * Also creates and registers the CSS Custom Highlight for inactive selection
   * painting (Phase 5f2, [D03], Spec S02). Feature-detected: if CSS.highlights
   * is unavailable, highlight management is silently skipped.
   */
  attach(): void {
    document.addEventListener("pointerdown", this.boundPointerDown, { capture: true });
    document.addEventListener("pointermove", this.boundPointerMove, { capture: true });
    document.addEventListener("pointerup", this.boundPointerUp, { capture: true });
    document.addEventListener("selectionchange", this.boundSelectionChange);
    document.addEventListener("selectstart", this.boundSelectStart, { capture: true });

    // CSS Custom Highlight API feature detection (Risk R02).
    if (typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      this.highlight = new Highlight();
      CSS.highlights.set("inactive-selection", this.highlight);
    }
  }

  /**
   * Remove document-level event listeners.
   * Called on teardown by `ResponderChainProvider`.
   *
   * Also removes the CSS Custom Highlight registration and clears all
   * inactive highlight state (Phase 5f2, Spec S02).
   */
  detach(): void {
    document.removeEventListener("pointerdown", this.boundPointerDown, { capture: true });
    document.removeEventListener("pointermove", this.boundPointerMove, { capture: true });
    document.removeEventListener("pointerup", this.boundPointerUp, { capture: true });
    document.removeEventListener("selectionchange", this.boundSelectionChange);
    document.removeEventListener("selectstart", this.boundSelectStart, { capture: true });
    this.stopAutoscroll();
    this.removePreventMousedown();

    // Clean up the CSS Custom Highlight registration.
    if (typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      CSS.highlights.delete("inactive-selection");
    }
    this.highlightRanges.clear();
    this.highlight = null;
  }

  // ---- Selection persistence (Phase 5b infrastructure) ----

  /**
   * Save the current selection state for a card.
   *
   * Returns `null` if:
   *   - The card is not registered.
   *   - The active selection does not have both anchor and focus within this
   *     card's boundary element.
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

    // Fallback: use the highlighted range captured during pointerdown capture
    // phase. The browser clears the live Selection on mousedown, so by the time
    // a click handler calls saveSelection the Selection is empty. The highlight
    // range was captured before the browser cleared it and is the source of
    // truth for the selection that was visible in this card.
    const highlightRange = this.highlightRanges.get(cardId);
    if (highlightRange) {
      const startNode = highlightRange.startContainer;
      const endNode = highlightRange.endContainer;
      if (
        startNode !== boundary && endNode !== boundary &&
        boundary.contains(startNode) && boundary.contains(endNode)
      ) {
        const anchorPath = nodeToPath(boundary, startNode);
        const focusPath = nodeToPath(boundary, endNode);
        if (anchorPath && focusPath && anchorPath.length > 0 && focusPath.length > 0) {
          return {
            anchorPath,
            anchorOffset: highlightRange.startOffset,
            focusPath,
            focusOffset: highlightRange.endOffset,
          };
        }
      }
    }

    return null;
  }

  /**
   * Restore a previously saved selection state for a card.
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
    } catch {
      // setBaseAndExtent can throw if offsets are out of range (e.g. content
      // changed). Fail silently — best-effort restoration.
    }
  }

  // ---- CSS Custom Highlight API: inactive selection painting (Phase 5f2) ----

  /**
   * Capture the current selection Range for a card being deactivated and
   * register it with the CSS Custom Highlight for inactive selection painting.
   *
   * Called from the highlight-capture loop in `handlePointerDown` when the
   * user clicks outside a card that has an active selection. The browser will
   * clear the global Selection on pointerdown, so we capture the Range before
   * that happens (pointerdown capture phase).
   *
   * No-op if:
   * - The highlight API is unavailable (`this.highlight` is null).
   * - The card has no registered boundary.
   * - The current selection has no ranges.
   * - The selection's anchor is not inside this card's boundary.
   * - The range spans outside the card's boundary (cross-card selection).
   *
   * Spec S03, [D03], [D04]
   */
  captureInactiveHighlight(cardId: string): void {
    if (!this.highlight) return;

    const boundary = this.boundaries.get(cardId);
    if (!boundary) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    if (!selection.anchorNode || !boundary.contains(selection.anchorNode)) return;

    // Clone the range before the browser clears the selection on pointerdown.
    const range = selection.getRangeAt(0).cloneRange();

    // Boundary containment check: both endpoints must be within this card.
    // Prevents painting a highlight that crosses card boundaries (Spec S03).
    if (!boundary.contains(range.startContainer) || !boundary.contains(range.endContainer)) {
      return;
    }

    // Remove the previous range for this card from the highlight (if any).
    const existing = this.highlightRanges.get(cardId);
    if (existing) {
      this.highlight.delete(existing);
    }

    this.highlightRanges.set(cardId, range);
    this.highlight.add(range);
  }

  /**
   * Remove the inactive selection highlight for a card (card becoming active).
   *
   * Called from the highlight-capture loop in `handlePointerDown` when the
   * user clicks inside a card, and from `unregisterBoundary` on card unmount.
   *
   * No-op if the card has no saved Range in `highlightRanges`.
   *
   * Spec S03, [D03]
   */
  clearInactiveHighlight(cardId: string): void {
    const range = this.highlightRanges.get(cardId);
    if (!range) return;
    this.highlightRanges.delete(cardId);
    if (this.highlight) {
      this.highlight.delete(range);
    }
  }

  // ---- Reset (for testing) ----

  /**
   * Clear all state. Used between test cases ([D02] testing note).
   */
  reset(): void {
    this.stopTracking();
    this.boundaries.clear();
    this.highlightRanges.clear();
    this.pendingHighlightRestore.clear();
    this.removePreventMousedown();
    if (this.highlight) {
      this.highlight.clear();
    }
    this.activeCardId = null;
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

    // Clean up any leftover one-shot mousedown handler from a previous click
    // that didn't complete normally (e.g. pointer cancel).
    this.removePreventMousedown();

    // ---- Determine which card the click belongs to ----
    //
    // First check content boundaries (most common), then walk up the DOM to
    // find card chrome (title bar, tab bar, etc.) via data-card-id. This lets
    // the highlight-capture loop treat title-bar clicks the same as content
    // clicks for highlight restore — clicking anywhere on a card should
    // restore its dimmed selection to active.
    let clickedCardId: string | null = null;
    for (const [cardId, element] of this.boundaries) {
      if (element.contains(target)) {
        clickedCardId = cardId;
        break;
      }
    }
    if (clickedCardId === null) {
      let el: Element | null = target instanceof Element ? target : (target as Node).parentElement;
      while (el) {
        const cid = el.getAttribute("data-card-id");
        if (cid !== null && this.boundaries.has(cid)) {
          clickedCardId = cid;
          break;
        }
        el = el.parentElement;
      }
    }

    // ---- Phase 5f2: Highlight-capture loop (Spec S03, [D04]) ----
    //
    // This loop runs BEFORE the tracking loop below. It must visit ALL
    // registered boundaries to capture/clear the inactive highlight for every
    // card. The tracking loop below finds the single boundary containing the
    // click target and returns early — the two loops cannot be merged.
    //
    // The browser clears the global Selection on pointerdown. We capture the
    // live Range here (capture phase, before the browser's default behavior)
    // so the saved Range is still valid for highlight painting.
    if (this.highlight) {
      const selection = window.getSelection();
      for (const [cardId, element] of this.boundaries) {
        if (element.contains(target)) {
          // Click is inside this card's content area.
          if (this.highlightRanges.has(cardId)) {
            // The card has a stored inactive highlight. Stash the range for
            // potential restore on pointerup. Keep the highlight VISIBLE until
            // pointerup so the user sees a single dimmed→active transition
            // with no flash of nothing in between.
            const range = this.highlightRanges.get(cardId)!;
            this.pendingHighlightRestore.set(cardId, range);
          } else {
            // No highlight stored — use normal clear path (no-op when empty).
            this.clearInactiveHighlight(cardId);
          }
        } else if (cardId === clickedCardId && this.highlightRanges.has(cardId)) {
          // Click is on this card's chrome (title bar, tab bar) and the card
          // has a dimmed inactive highlight. Stash for restore on pointerup so
          // clicking the title bar restores the selection just like clicking
          // the content area does.
          const range = this.highlightRanges.get(cardId)!;
          this.pendingHighlightRestore.set(cardId, range);
        } else if (
          selection &&
          selection.rangeCount > 0 &&
          selection.anchorNode !== null &&
          element.contains(selection.anchorNode)
        ) {
          // Click is outside this card but the selection's anchor is inside it.
          // Capture the range for the inactive highlight before the browser
          // clears the selection.
          this.captureInactiveHighlight(cardId);
        }
      }

      // If a highlight was stashed for restore, prevent the browser's default
      // mousedown behavior (caret placement / selection tracking start). Without
      // this, the browser finalizes the pending selection as a collapsed caret on
      // mouseup, overwriting the selection we restore in handlePointerUp.
      // pointerdown fires before mousedown, so this listener is ready in time.
      if (this.pendingHighlightRestore.size > 0) {
        this.installPreventMousedown();
      }
    }

    // ---- Existing tracking loop ----
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

    const rect = boundary.getBoundingClientRect();
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
    // ---- Phase 5f3: Pending highlight restore (Spec S02, [D02]) ----
    //
    // If the user clicked back into a card that had an inactive highlight,
    // the range was stashed in pendingHighlightRestore on pointerdown. The
    // highlight was kept visible during the pointerdown→pointerup interval
    // to avoid a flash of nothing. Now clear the highlight AND restore the
    // selection atomically (same tick) for a single dimmed→active transition.
    //
    // The browser's default mousedown behavior (caret placement) was prevented
    // by installPreventMousedown() in handlePointerDown, so the browser has no
    // pending selection to finalize on mouseup — our restore survives.
    if (this.pendingHighlightRestore.size > 0) {
      const sel = window.getSelection();
      for (const [cardId, range] of this.pendingHighlightRestore) {
        // Clear the highlight now (deferred from pointerdown).
        this.highlightRanges.delete(cardId);
        if (this.highlight) {
          this.highlight.delete(range);
        }

        if (sel && sel.isCollapsed) {
          // Simple click — restore the stashed Selection.
          sel.removeAllRanges();
          sel.addRange(range);
        }
        // Else: user dragged to create a new selection — discard stash.
      }
      this.pendingHighlightRestore.clear();
    }
    this.stopTracking();
  }

  // ---- selectionchange safety net ([D04]) ----

  private handleSelectionChange(): void {
    const selection = window.getSelection();
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

    // Check for data-td-select="custom" — skip clipping for custom subtrees
    if (hasCustomSelectAncestor(anchorNode, boundary)) return;

    // Focus escaped the boundary. Clip the selection to the boundary edge.
    // Use setBaseAndExtent to forcibly pin the focus inside the boundary,
    // overriding the browser's native selection extension.
    try {
      if (this.isTracking && this.lastPointerY < boundary.getBoundingClientRect().top) {
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
    const newRect = boundary.getBoundingClientRect();
    this.clampSelectionToRect(newRect, boundary);

    // Schedule next tick
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      if (!this.isTracking || this.activeCardId === null) return;
      const currentBoundary = this.boundaries.get(this.activeCardId);
      if (!currentBoundary) return;
      this.runAutoscrollTick(currentBoundary, currentBoundary.getBoundingClientRect());
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

  /**
   * Install a one-shot mousedown capture listener that prevents the browser's
   * default selection behavior (caret placement, selection tracking start).
   * Called from handlePointerDown when a highlight restore is pending.
   * pointerdown fires before mousedown, so this is installed in time.
   */
  private installPreventMousedown(): void {
    this.removePreventMousedown(); // clean up any stale handler
    this.boundPreventMousedown = (e: MouseEvent) => {
      e.preventDefault();
      this.removePreventMousedown();
    };
    document.addEventListener("mousedown", this.boundPreventMousedown, { capture: true });
  }

  /**
   * Remove the one-shot mousedown capture listener if one is installed.
   */
  private removePreventMousedown(): void {
    if (this.boundPreventMousedown) {
      document.removeEventListener("mousedown", this.boundPreventMousedown, { capture: true });
      this.boundPreventMousedown = null;
    }
  }

  private stopTracking(): void {
    this.isTracking = false;
    this.activeCardId = null;
    this.stopAutoscroll();
    // Safety net for pointer-cancel paths that bypass handlePointerUp.
    this.pendingHighlightRestore.clear();
    this.removePreventMousedown();
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
