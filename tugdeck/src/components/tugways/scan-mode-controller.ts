/**
 * scan-mode-controller.ts -- Reticle-based element selection for the style inspector card.
 *
 * `ScanModeController` manages a transparent full-viewport overlay that lets the
 * user hover over any element to highlight it, then click to select it. The
 * controller is activated by the inspect button in `StyleInspectorContent` and
 * automatically deactivates after a selection is made.
 *
 * Design decisions:
 *   [D02] Scan overlay DOM -- the overlay and highlight rect are direct DOM elements
 *         on `document.body`, not React-managed (L06).
 *   [D05] Option-key hover suppression -- pointer-events toggling + elementFromPoint,
 *         no React state involvement (L06).
 *
 * **Authoritative references:**
 *   Spec S03 (#scan-mode-controller)
 *   (#constraints, #strategy)
 *
 * @module components/tugways/scan-mode-controller
 */

import "./style-inspector-overlay.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** z-index for the scan overlay (sits below the highlight rect at 999998). */
const OVERLAY_Z_INDEX = "999997";

/** CSS class added to #deck-container when Alt/Option is held during scan. */
const SUPPRESSION_CLASS = "tug-scan-hover-suppressed";

// ---------------------------------------------------------------------------
// DeactivateOptions
// ---------------------------------------------------------------------------

/**
 * Options for `deactivate()`.
 *
 * When `keepHighlight` is true, the highlight rect is NOT removed from the DOM
 * on deactivate. The caller takes ownership of the highlight element (e.g., to
 * pin it on a selected element). The caller is then responsible for removing
 * the highlight from the DOM when appropriate.
 */
export interface DeactivateOptions {
  /** When true, leaves highlightEl in the DOM after deactivating. Default: false. */
  keepHighlight?: boolean;
}

// ---------------------------------------------------------------------------
// ScanModeController
// ---------------------------------------------------------------------------

/**
 * Manages a full-viewport transparent overlay for reticle-based element selection.
 *
 * Usage:
 * ```ts
 * const ctrl = new ScanModeController();
 * ctrl.activate((el) => {
 *   // el is the selected element
 * });
 * // Later:
 * ctrl.deactivate();
 * ```
 *
 * To keep the highlight rect visible after selection (for pinning):
 * ```ts
 * ctrl.deactivate({ keepHighlight: true });
 * // highlightEl remains in DOM with current position; caller manages removal
 * ```
 */
export class ScanModeController {
  // ----- State -----

  /** Whether scan mode is currently active. */
  private active = false;

  /** The element currently under the cursor during scan. */
  private hoveredEl: HTMLElement | null = null;

  /** Callback invoked when the user clicks to select an element. */
  private onSelectCallback: ((el: HTMLElement) => void) | null = null;

  // ----- DOM Elements -----

  /** Transparent full-viewport overlay that captures pointer events. */
  readonly overlayEl: HTMLDivElement;

  /** Absolutely-positioned highlight rect. Uses .tug-inspector-highlight styles. */
  readonly highlightEl: HTMLDivElement;

  // ----- Bound handlers -----

  private readonly _onPointerMove: (e: PointerEvent) => void;
  private readonly _onClick: (e: MouseEvent) => void;
  private readonly _onKeyDown: (e: KeyboardEvent) => void;
  private readonly _onKeyUp: (e: KeyboardEvent) => void;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor() {
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "tug-scan-overlay";
    this.overlayEl.style.cssText = [
      "position: fixed",
      "inset: 0",
      `z-index: ${OVERLAY_Z_INDEX}`,
      "background: transparent",
      "cursor: crosshair",
      "pointer-events: auto",
    ].join("; ");

    this.highlightEl = document.createElement("div");
    this.highlightEl.className = "tug-inspector-highlight";
    this.highlightEl.style.display = "none";

    // Bind handlers once so we can remove them by reference
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onClick = this._handleClick.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Whether scan mode is currently active. */
  get isActive(): boolean {
    return this.active;
  }

  /**
   * Enter scan mode.
   *
   * Appends the overlay and highlight rect to `document.body`, attaches all
   * pointer and keyboard listeners, and stores the `onSelect` callback.
   *
   * @param onSelect - Called with the selected element when the user clicks.
   */
  activate(onSelect: (el: HTMLElement) => void): void {
    if (this.active) return;

    this.active = true;
    this.onSelectCallback = onSelect;

    document.body.appendChild(this.overlayEl);
    document.body.appendChild(this.highlightEl);

    this.overlayEl.addEventListener("pointermove", this._onPointerMove);
    this.overlayEl.addEventListener("click", this._onClick);
    document.addEventListener("keydown", this._onKeyDown, true);
    document.addEventListener("keyup", this._onKeyUp, true);
  }

  /**
   * Exit scan mode.
   *
   * Removes the overlay from the DOM and detaches all listeners.
   * By default, also removes the highlight rect. Pass `{ keepHighlight: true }`
   * to leave the highlight rect in the DOM — the caller then owns it.
   *
   * A no-op if not active.
   *
   * @param options.keepHighlight - When true, highlightEl is NOT removed from DOM.
   */
  deactivate(options: DeactivateOptions = {}): void {
    if (!this.active) return;

    this.active = false;
    this.onSelectCallback = null;
    this.hoveredEl = null;

    // Always remove the overlay
    if (this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }

    // Remove highlight unless caller requested to keep it
    if (!options.keepHighlight) {
      if (this.highlightEl.parentNode) {
        this.highlightEl.parentNode.removeChild(this.highlightEl);
      }
      this.highlightEl.style.display = "none";
      this.highlightEl.classList.remove("tug-inspector-highlight--scan-suppressed");
    }

    // Remove all event listeners
    this.overlayEl.removeEventListener("pointermove", this._onPointerMove);
    this.overlayEl.removeEventListener("click", this._onClick);
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("keyup", this._onKeyUp, true);

    // Remove hover suppression class if still present
    this._setSuppression(false);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Handle pointermove on the overlay.
   *
   * Technique (L06 compliant):
   *   1. Temporarily set `pointer-events: none` on the overlay so the overlay
   *      is not the hit-test target.
   *   2. Call `document.elementFromPoint` to find the real element under cursor.
   *   3. Restore `pointer-events: auto` immediately.
   *   4. Skip the overlay itself or the highlight rect (identity check).
   *   5. If the target is inside the inspector card, hide the highlight and return.
   *   6. Position the highlight rect on the identified element.
   */
  private _handlePointerMove(e: PointerEvent): void {
    // Temporarily suppress overlay to allow elementFromPoint to see through it
    this.overlayEl.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    this.overlayEl.style.pointerEvents = "auto";

    if (!el || el === this.overlayEl || el === this.highlightEl) {
      return;
    }

    const target = el as HTMLElement;

    // Don't highlight elements inside the inspector card itself
    if (this._isInsideInspectorCard(target)) {
      this.highlightEl.style.display = "none";
      return;
    }

    this.hoveredEl = target;
    this._positionHighlight(target);
  }

  /**
   * Handle click on the overlay.
   *
   * If metaKey (Cmd) is held, the click passes through to the underlying element
   * as a normal click instead of triggering element selection. This lets users
   * Cmd+Click on card title bars or other UI chrome during scan mode without
   * accidentally selecting them for inspection. The synthetic click is dispatched
   * regardless of whether the target is inside the inspector card (so card
   * interactions like focusing/closing still work normally via Cmd+Click).
   *
   * Otherwise, identifies the real element under cursor using the same
   * pointer-events suppression technique, calls the onSelect callback, and
   * deactivates while keeping the highlight rect in the DOM for the caller to pin.
   * Clicks on elements inside the inspector card itself are ignored (no selection).
   */
  private _handleClick(e: MouseEvent): void {
    // Find the real target via pointer-events suppression
    this.overlayEl.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    this.overlayEl.style.pointerEvents = "auto";

    // Cmd+Click passthrough: dispatch a synthetic click on the real target.
    // Always forwarded (even if target is inside the inspector card), so that
    // card interactions (close, focus) continue to work normally.
    if (e.metaKey) {
      if (el && el !== this.overlayEl && el !== this.highlightEl) {
        const synthetic = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: e.clientX,
          clientY: e.clientY,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        });
        el.dispatchEvent(synthetic);
      }
      return;
    }

    if (!el || el === this.overlayEl || el === this.highlightEl) {
      return;
    }

    const target = el as HTMLElement;

    // Ignore clicks on elements inside the inspector card itself (no selection)
    if (this._isInsideInspectorCard(target)) {
      return;
    }

    const cb = this.onSelectCallback;
    // Deactivate before calling callback, keeping highlight for caller to pin
    this.deactivate({ keepHighlight: true });
    if (cb) {
      cb(target);
    }
  }

  /**
   * Handle keydown during scan mode.
   *
   * Alt (Option) key: add `tug-scan-hover-suppressed` to `#deck-container`
   * and switch highlight to dashed border style.
   *
   * Escape: cancel scan mode without selection.
   */
  private _handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Alt") {
      this._setSuppression(true);
    } else if (e.key === "Escape") {
      this.deactivate();
    }
  }

  /**
   * Handle keyup during scan mode.
   *
   * Alt (Option) key released: remove `tug-scan-hover-suppressed` and restore
   * solid highlight border.
   */
  private _handleKeyUp(e: KeyboardEvent): void {
    if (e.key === "Alt") {
      this._setSuppression(false);
    }
  }

  /**
   * Toggle the hover-suppression class on `#deck-container` and update the
   * highlight border style to indicate suppression state.
   */
  private _setSuppression(active: boolean): void {
    const container = document.getElementById("deck-container");
    if (container) {
      if (active) {
        container.classList.add(SUPPRESSION_CLASS);
      } else {
        container.classList.remove(SUPPRESSION_CLASS);
      }
    }

    // Toggle dashed highlight border when suppressed
    if (active) {
      this.highlightEl.classList.add("tug-inspector-highlight--scan-suppressed");
    } else {
      this.highlightEl.classList.remove("tug-inspector-highlight--scan-suppressed");
    }
  }

  /**
   * Returns true if `el` is inside the style inspector card content.
   *
   * Uses `closest` to walk up the DOM tree looking for an ancestor with
   * `data-testid="style-inspector-content"`. This prevents the scan overlay
   * from highlighting or selecting elements within the inspector card itself.
   */
  private _isInsideInspectorCard(el: HTMLElement): boolean {
    return el.closest('[data-testid="style-inspector-content"]') !== null;
  }

  /**
   * Position the highlight rect around a given element using its bounding rect.
   */
  private _positionHighlight(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    this.highlightEl.style.display = "";
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;
  }
}
