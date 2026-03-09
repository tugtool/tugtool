/**
 * selection-guard.ts -- SelectionGuard singleton for Phase 5a Selection Model.
 *
 * Architecture: Single-system selection rendering via CSS Custom Highlight API.
 *
 * Native `::selection` is transparent. ALL selection painting goes through two
 * CSS Custom Highlights:
 *   - "card-selection": active card's selection (mirrored on every selectionchange)
 *   - "inactive-selection": dimmed selections for inactive cards
 *
 * On card switch, the Range object moves between Highlights — same Range
 * objects, different Highlights. A one-shot mousedown prevention handler
 * stops the browser from collapsing a restored selection on click-back.
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
 * ## Selection rendering (single-system architecture)
 *
 * Native `::selection` is transparent. Two CSS Custom Highlights render all
 * selection visuals:
 *   - `card-selection`: the active card's selection, mirrored from the browser
 *     Selection on every `selectionchange` event.
 *   - `inactive-selection`: dimmed selections for cards that lost focus.
 *
 * On card switch (pointerdown), the active card's Range moves from
 * `card-selection` to `inactive-selection`, and the clicked card's Range
 * (if any) moves from `inactive-selection` to `card-selection`. Same Range
 * objects, different Highlights. The swap is a simple delete/add on each
 * Highlight — no intermediate empty state, no flash.
 *
 * ## Registration
 *
 * Cards call `registerBoundary(cardId, element)` on mount and
 * `unregisterBoundary(cardId)` on unmount (via `useSelectionBoundary` hook).
 *
 * ## Lifecycle
 *
 * `attach()` installs document-level event listeners and creates Highlights.
 * `detach()` removes them. Called by `ResponderChainProvider` (Step 6).
 *
 * ## Selection persistence
 *
 * `saveSelection(cardId)` / `restoreSelection(cardId, saved)` for Phase 5b
 * tab switching (saves selection before unmount, restores after remount).
 *
 * ## Testing
 *
 * `reset()` clears all state between test cases.
 *
 * [D02] Module-level singleton — zero React state, synchronous imperative
 * handling, same pattern as ResponderChainManager.
 */
class SelectionGuard {
  // cardId → boundary element
  private boundaries: Map<string, HTMLElement> = new Map();

  // ---- CSS Custom Highlight API state ----

  // cardId → Range for cards with a selection (active or inactive).
  // The Range is always owned by exactly one of the two Highlights.
  private cardRanges: Map<string, Range> = new Map();

  // The card whose Range is in activeHighlight (if any).
  private activeHighlightCardId: string | null = null;

  // CSS Highlight for the active card's selection ("card-selection").
  private activeHighlight: Highlight | null = null;

  // CSS Highlight for inactive cards' dimmed selections ("inactive-selection").
  private inactiveHighlight: Highlight | null = null;

  // Whether CSS.highlights is available. When false, all highlight
  // management is silently skipped (graceful degradation).
  private highlightsAvailable = false;

  // Set by activateCard when a card with a non-collapsed inactive range is
  // activated. syncActiveHighlight checks this to preserve the existing range
  // when the browser collapses the selection due to the activation click.
  // Cleared after the first selectionchange is processed.
  private justActivatedCardId: string | null = null;

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

    // Create CSS Custom Highlights eagerly so they exist before any React
    // effects fire. Tugcard's activation useLayoutEffect calls restoreSelection
    // → syncActiveHighlight, which needs these objects. Since the singleton is
    // created at module scope, this runs before React mounts. (Risk R02)
    this.initHighlights();
  }

  /**
   * Create CSS Custom Highlight objects if the API is available and they
   * haven't been created yet. Idempotent — safe to call multiple times.
   *
   * Called eagerly in the constructor (so highlights exist before React mounts)
   * and again in attach() (so tests that install mock CSS.highlights after
   * import can still initialize highlights).
   */
  private initHighlights(): void {
    if (this.highlightsAvailable) return; // already initialized
    if (typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      this.highlightsAvailable = true;
      this.activeHighlight = new Highlight();
      this.inactiveHighlight = new Highlight();
      CSS.highlights.set("card-selection", this.activeHighlight);
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
    this.removeCardHighlight(cardId);
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

    // Initialize highlights if not yet created (covers tests that install
    // mock CSS.highlights after module import), and re-register with
    // CSS.highlights if detach() previously unregistered them.
    this.initHighlights();
    if (this.highlightsAvailable && this.activeHighlight && this.inactiveHighlight &&
        typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      CSS.highlights.set("card-selection", this.activeHighlight);
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
    this.justActivatedCardId = null;

    if (this.highlightsAvailable && typeof CSS !== "undefined" && CSS.highlights !== undefined) {
      CSS.highlights.delete("card-selection");
      CSS.highlights.delete("inactive-selection");
    }
    this.cardRanges.clear();
    this.activeHighlightCardId = null;
  }

  // ---- Highlight management ----

  /**
   * Mirror the live browser Selection into the active card's CSS Highlight.
   *
   * Called from handleSelectionChange on every selection mutation. Clones the
   * browser's Range and places it in the "card-selection" Highlight so the
   * user sees the selection painted with our custom colors (native ::selection
   * is transparent).
   */
  private syncActiveHighlight(): void {
    if (!this.activeHighlight || !this.inactiveHighlight) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      // Selection was cleared — remove from the active highlight visual,
      // but keep the Range in cardRanges. The cardRanges entry serves as
      // a fallback for saveSelection when the browser clears the selection
      // before the save callback runs (e.g. clicking user-select:none chrome).
      if (this.activeHighlightCardId) {
        const oldRange = this.cardRanges.get(this.activeHighlightCardId);
        if (oldRange) {
          this.activeHighlight.delete(oldRange);
        }
        this.activeHighlightCardId = null;
      }
      return;
    }

    const anchorNode = selection.anchorNode;
    if (!anchorNode) return;

    // Find which card boundary contains the selection anchor.
    let selCardId: string | null = null;
    let selBoundary: HTMLElement | null = null;
    for (const [cardId, element] of this.boundaries) {
      if (element.contains(anchorNode)) {
        selCardId = cardId;
        selBoundary = element;
        break;
      }
    }

    if (!selCardId || !selBoundary) {
      // Selection anchor is outside all card boundaries — remove from the
      // active highlight visual but keep the Range in cardRanges (same
      // rationale as the rangeCount=0 case above).
      if (this.activeHighlightCardId) {
        const oldRange = this.cardRanges.get(this.activeHighlightCardId);
        if (oldRange) {
          this.activeHighlight.delete(oldRange);
        }
        this.activeHighlightCardId = null;
      }
      return;
    }

    // Clone the browser's Range for our highlight.
    const range = selection.getRangeAt(0).cloneRange();

    // Boundary containment: both endpoints must be within this card.
    if (!selBoundary.contains(range.startContainer) || !selBoundary.contains(range.endContainer)) {
      return;
    }

    // If a card was just activated (pointerdown moved its Range from inactive
    // to active) and the browser collapsed the selection (default click behavior),
    // preserve the existing non-collapsed range. This prevents click-back from
    // wiping out a dimmed selection that the user expects to reactivate.
    if (range.collapsed && this.justActivatedCardId === selCardId) {
      const existing = this.cardRanges.get(selCardId);
      if (existing && !existing.collapsed) {
        this.justActivatedCardId = null;
        // Ensure the existing range is in the active highlight.
        this.activeHighlight!.delete(existing);
        this.activeHighlight!.add(existing);
        this.activeHighlightCardId = selCardId;
        return;
      }
    }
    this.justActivatedCardId = null;

    // If the active card changed, move the old card's range to inactive.
    if (this.activeHighlightCardId && this.activeHighlightCardId !== selCardId) {
      const oldRange = this.cardRanges.get(this.activeHighlightCardId);
      if (oldRange) {
        this.activeHighlight.delete(oldRange);
        this.inactiveHighlight.add(oldRange);
      }
    }

    // Remove the previous range for this card from whichever highlight owns it.
    const existing = this.cardRanges.get(selCardId);
    if (existing) {
      this.activeHighlight.delete(existing);
      this.inactiveHighlight.delete(existing);
    }

    // Add the new range to the active highlight.
    this.cardRanges.set(selCardId, range);
    this.activeHighlight.add(range);
    this.activeHighlightCardId = selCardId;
  }

  /**
   * Activate a card's highlight. Move the clicked card's Range from inactive to
   * active highlight, and move the previous active card's Range from active
   * to inactive.
   *
   * Called internally from handlePointerDown (pointer-driven focus) and
   * externally from DeckCanvas's useLayoutEffect (all focus-change paths).
   * Safe to call multiple times for the same cardId — the second call is a
   * no-op since activeHighlightCardId already matches.
   */
  activateCard(cardId: string): void {
    if (!this.activeHighlight || !this.inactiveHighlight) return;

    const wasDifferentCard = this.activeHighlightCardId !== null &&
                             this.activeHighlightCardId !== cardId;

    // Move the previous active card's range to inactive (if different card).
    if (wasDifferentCard) {
      const oldRange = this.cardRanges.get(this.activeHighlightCardId!);
      if (oldRange) {
        this.activeHighlight.delete(oldRange);
        this.inactiveHighlight.add(oldRange);
      }
    }

    // Move the clicked card's range from inactive to active (if it has one).
    const range = this.cardRanges.get(cardId);
    if (range) {
      this.inactiveHighlight.delete(range);
      this.activeHighlight.add(range);
    }

    // If activating a different card that has a non-collapsed range, mark it
    // so syncActiveHighlight preserves the range instead of letting the
    // browser's click collapse overwrite it.
    if (wasDifferentCard && range && !range.collapsed) {
      this.justActivatedCardId = cardId;
    }

    this.activeHighlightCardId = cardId;
  }

  /**
   * Remove all highlight state for a card (used on unregister/cleanup).
   */
  private removeCardHighlight(cardId: string): void {
    const range = this.cardRanges.get(cardId);
    if (!range) return;

    this.cardRanges.delete(cardId);
    if (this.activeHighlight) this.activeHighlight.delete(range);
    if (this.inactiveHighlight) this.inactiveHighlight.delete(range);

    if (this.activeHighlightCardId === cardId) {
      this.activeHighlightCardId = null;
    }
  }

  // ---- App activation state ----

  // The card whose Range was in activeHighlight before app deactivation.
  // Used by activateApp() to restore the correct card to active state.
  private deactivatedCardId: string | null = null;

  /**
   * Dim all selections when the app loses focus (deactivation).
   *
   * Moves the active card's Range from activeHighlight to inactiveHighlight
   * so all selections render with the dimmed style. Remembers which card was
   * active so activateApp() can restore it.
   *
   * Called from the native app via window.__tugdeckAppDeactivated().
   */
  deactivateApp(): void {
    if (!this.activeHighlight || !this.inactiveHighlight) return;

    this.deactivatedCardId = this.activeHighlightCardId;

    if (this.activeHighlightCardId) {
      const range = this.cardRanges.get(this.activeHighlightCardId);
      if (range) {
        this.activeHighlight.delete(range);
        this.inactiveHighlight.add(range);
      }
      this.activeHighlightCardId = null;
    }
  }

  /**
   * Restore the active card's selection when the app regains focus (activation).
   *
   * Moves the previously-active card's Range from inactiveHighlight back to
   * activeHighlight. Clears the deactivated state.
   *
   * Called from the native app via window.__tugdeckAppActivated().
   */
  activateApp(): void {
    if (!this.activeHighlight || !this.inactiveHighlight) return;
    if (!this.deactivatedCardId) return;

    const range = this.cardRanges.get(this.deactivatedCardId);
    if (range) {
      this.inactiveHighlight.delete(range);
      this.activeHighlight.add(range);
    }
    this.activeHighlightCardId = this.deactivatedCardId;
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

    // Fallback: use the stored Range from our highlight system.
    // This works whether the card is active or inactive, since we always
    // have the Range in cardRanges regardless of which Highlight owns it.
    const storedRange = this.cardRanges.get(cardId);
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
    if (!boundary) {
      console.log(`[RESTORE-DEBUG] restoreSelection(${cardId}) — no boundary registered`);
      return;
    }

    const anchorNode = pathToNode(boundary, saved.anchorPath);
    const focusNode = pathToNode(boundary, saved.focusPath);
    if (!anchorNode || !focusNode) {
      console.log(`[RESTORE-DEBUG] restoreSelection(${cardId}) — pathToNode failed: anchor=${!!anchorNode} focus=${!!focusNode} anchorPath=${JSON.stringify(saved.anchorPath)} focusPath=${JSON.stringify(saved.focusPath)}`);
      return;
    }

    const selection = window.getSelection();
    if (!selection) return;

    console.log(`[RESTORE-DEBUG] restoreSelection(${cardId}) — calling setBaseAndExtent, highlights exist: active=${!!this.activeHighlight} inactive=${!!this.inactiveHighlight}`);

    try {
      selection.setBaseAndExtent(
        anchorNode,
        saved.anchorOffset,
        focusNode,
        saved.focusOffset
      );
      // Mirror the restored selection into the CSS Highlight synchronously.
      // selectionchange fires asynchronously after setBaseAndExtent, so
      // without this call the highlight wouldn't update until the next event
      // loop tick — causing the selection to be invisible during the gap.
      this.syncActiveHighlight();
      console.log(`[RESTORE-DEBUG] restoreSelection(${cardId}) — syncActiveHighlight done, activeHighlightCardId=${this.activeHighlightCardId}, cardRanges has ${this.cardRanges.size} entries`);
    } catch (e) {
      console.log(`[RESTORE-DEBUG] restoreSelection(${cardId}) — threw:`, e);
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
    this.justActivatedCardId = null;
    this.boundaries.clear();
    this.cardRanges.clear();
    this.activeHighlightCardId = null;
    if (this.activeHighlight) {
      this.activeHighlight.clear();
    }
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

    // ---- Activate the clicked card's highlight ----
    //
    // Move the clicked card's Range from inactive to active highlight,
    // and move the previous active card's Range to inactive.
    //
    // When re-activating a card that had a non-collapsed inactive range,
    // also restore the browser Selection to match and install a one-shot
    // mousedown handler to prevent the click from collapsing the selection.
    if (clickedCardId && this.highlightsAvailable) {
      const hadInactiveRange = this.cardRanges.has(clickedCardId) &&
                               this.activeHighlightCardId !== clickedCardId;

      this.activateCard(clickedCardId);

      if (hadInactiveRange) {
        const range = this.cardRanges.get(clickedCardId);
        if (range && !range.collapsed) {
          // Restore browser Selection to match the activated range so
          // copy/paste works immediately and the selection is functional.
          const sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(range.cloneRange());
          }

          // One-shot mousedown prevention: stop the browser from processing
          // the click as a new selection action, which would collapse the
          // restored selection.
          this.installPreventMousedown();
        }
      }
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

  // ---- selectionchange: mirror + safety net ([D04]) ----

  private handleSelectionChange(): void {
    const selection = window.getSelection();

    // Mirror the live selection into the active card's CSS Highlight.
    this.syncActiveHighlight();

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
