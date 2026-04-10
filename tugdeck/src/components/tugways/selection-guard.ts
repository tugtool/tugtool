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
 *   3. `data-td-select` attribute API: four modes (default, none, all,
 *      custom) give card authors fine-grained per-region control.
 *
 * See tuglaws/selection-model.md for the full system documentation.
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

  // cardId → cloned Range for cards whose selection is dimmed in the
  // inactive-selection highlight. Written on card deactivation, removed
  // on card reactivation. NOT written on every selectionchange.
  private inactiveRanges: Map<string, Range> = new Map();

  // The card that currently "owns" the active selection (i.e., the
  // focused card). Used to know which card to deactivate when a
  // different card is clicked.
  private activeCardId_highlight: string | null = null;

  // Whether CSS.highlights is available.
  private highlightsAvailable = false;

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
   * Register a card content area as a selection boundary.
   * Called by `useSelectionBoundary` on mount.
   */
  registerBoundary(cardId: string, element: HTMLElement): void {
    this.boundaries.set(cardId, element);
  }

  /**
   * Unregister a card content area.
   * Called by `useSelectionBoundary` on unmount cleanup.
   * Also cleans up any highlight state for this card.
   */
  unregisterBoundary(cardId: string): void {
    this.boundaries.delete(cardId);
    if (this.activeCardId === cardId) {
      this.stopTracking();
    }
    // Clean up any inactive highlight state for this card.
    const range = this.inactiveRanges.get(cardId);
    if (range && this.inactiveHighlight) {
      this.inactiveHighlight.delete(range);
    }
    this.inactiveRanges.delete(cardId);
    if (this.activeCardId_highlight === cardId) {
      this.activeCardId_highlight = null;
    }
  }

  // ---- Lifecycle ----

  /**
   * Install document-level event listeners.
   * Called once at app startup by `ResponderChainProvider` (Step 6).
   *
   * CSS Custom Highlights are created eagerly in the constructor (not here)
   * so they exist before any React effects fire.
   */
  attach(): void {
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
    this.inactiveRanges.clear();
    this.activeCardId_highlight = null;
  }

  // ---- Card activation (highlight management) ----

  /**
   * Activate a card — make it the "focused" card for selection purposes.
   *
   * When switching FROM a different card:
   *   1. Clone the old card's current DOM Selection Range into the
   *      inactive-selection highlight (dimmed visual).
   *   2. Clear the browser Selection (the old card's selection is now
   *      only in the inactive highlight).
   *   3. Restore the new card's saved Range (if any) to the browser
   *      Selection and remove it from inactive-selection.
   *   4. Install preventMousedown so the activation click doesn't
   *      collapse the restored selection.
   *
   * When the same card is re-activated (no-op) or when no card was
   * previously active: just update the tracking field.
   *
   * Called from handlePointerDown (pointer-driven focus) and from
   * DeckCanvas's useLayoutEffect (all focus-change paths).
   */
  activateCard(cardId: string): void {
    // No-op if already the active card.
    if (this.activeCardId_highlight === cardId) return;

    const previousCardId = this.activeCardId_highlight;

    // ---- Deactivate the previous card ----
    if (previousCardId && this.inactiveHighlight) {
      // Clone the current DOM Selection into inactive-selection for the
      // old card, so it renders dimmed.
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const anchorNode = sel.anchorNode;
        const boundary = previousCardId ? this.boundaries.get(previousCardId) : null;
        if (anchorNode && boundary && boundary.contains(anchorNode)) {
          const range = sel.getRangeAt(0).cloneRange();
          if (boundary.contains(range.startContainer) && boundary.contains(range.endContainer)) {
            // Remove any previous inactive range for this card.
            const oldInactive = this.inactiveRanges.get(previousCardId);
            if (oldInactive) this.inactiveHighlight.delete(oldInactive);
            this.inactiveRanges.set(previousCardId, range);
            this.inactiveHighlight.add(range);
          }
        }
      }
      // Clear the browser Selection — the old card's selection is now
      // represented only by the inactive highlight.
      const sel2 = window.getSelection();
      if (sel2) sel2.removeAllRanges();
    }

    // ---- Activate the new card ----
    this.activeCardId_highlight = cardId;

    // If the new card has a saved inactive range, restore it to the
    // browser Selection and remove from inactive-selection.
    if (this.inactiveHighlight) {
      const savedRange = this.inactiveRanges.get(cardId);
      if (savedRange && !savedRange.collapsed) {
        // Remove from inactive highlight.
        this.inactiveHighlight.delete(savedRange);
        this.inactiveRanges.delete(cardId);

        // Restore to browser Selection — native ::selection paints it.
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange.cloneRange());
        }

        // Prevent the activation click from collapsing the restored selection.
        this.installPreventMousedown();
      } else if (savedRange) {
        // Collapsed range — just clean up, don't restore.
        this.inactiveHighlight.delete(savedRange);
        this.inactiveRanges.delete(cardId);
      }
    }
  }

  // ---- App activation state ----

  // The card that was active before app deactivation.
  private deactivatedCardId: string | null = null;

  /**
   * Dim the active card's selection when the app loses focus.
   *
   * Clones the active card's DOM Selection Range into inactive-selection
   * so it renders dimmed. Clears the browser Selection.
   *
   * Called from the native app via window.__tugdeckAppDeactivated().
   */
  deactivateApp(): void {
    if (!this.inactiveHighlight) return;

    this.deactivatedCardId = this.activeCardId_highlight;

    if (this.activeCardId_highlight) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const boundary = this.boundaries.get(this.activeCardId_highlight);
        if (boundary && sel.anchorNode && boundary.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0).cloneRange();
          if (boundary.contains(range.startContainer) && boundary.contains(range.endContainer)) {
            const oldInactive = this.inactiveRanges.get(this.activeCardId_highlight);
            if (oldInactive) this.inactiveHighlight.delete(oldInactive);
            this.inactiveRanges.set(this.activeCardId_highlight, range);
            this.inactiveHighlight.add(range);
          }
        }
        sel.removeAllRanges();
      }
    }
  }

  /**
   * Restore the active card's selection when the app regains focus.
   *
   * Restores the browser Selection from the saved Range in inactive-selection
   * and removes it from the inactive highlight.
   *
   * Called from the native app via window.__tugdeckAppActivated().
   */
  activateApp(): void {
    if (!this.inactiveHighlight) return;
    if (!this.deactivatedCardId) return;

    const range = this.inactiveRanges.get(this.deactivatedCardId);
    if (range && !range.collapsed) {
      this.inactiveHighlight.delete(range);
      this.inactiveRanges.delete(this.deactivatedCardId);

      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range.cloneRange());
      }
    } else if (range) {
      this.inactiveHighlight.delete(range);
      this.inactiveRanges.delete(this.deactivatedCardId);
    }

    this.deactivatedCardId = null;
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

    // Fallback: use the stored Range from the inactive-selection highlight.
    // This covers the case where the browser Selection was cleared (e.g.
    // the user clicked user-select:none chrome) but the card still has a
    // dimmed selection in the inactive highlight.
    const storedRange = this.inactiveRanges.get(cardId);
    if (storedRange) {
      const startNode = storedRange.startContainer;
      const endNode = storedRange.endContainer;
      if (
        startNode !== boundary && endNode !== boundary &&
        boundary.contains(startNode) && boundary.contains(endNode)
      ) {
        const anchorPath = nodeToPath(boundary, startNode);
        const focusPath = nodeToPath(boundary, endNode);
        if (anchorPath && focusPath && anchorPath.length > 0 && focusPath.length > 0) {
          return {
            anchorPath,
            anchorOffset: storedRange.startOffset,
            focusPath,
            focusOffset: storedRange.endOffset,
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
    this.inactiveRanges.clear();
    this.activeCardId_highlight = null;
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
    // First check content boundaries (most common), then walk up the DOM to
    // find card chrome (title bar, tab bar, etc.) via data-card-id.
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
