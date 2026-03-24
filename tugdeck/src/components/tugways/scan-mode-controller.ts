/**
 * scan-mode-controller.ts -- Reticle-based element selection for the style inspector card.
 *
 * `ScanModeController` manages a transparent full-viewport overlay that lets the
 * user hover over any element to highlight it, then click to select it. The
 * controller is activated by the reticle button in `StyleInspectorContent` and
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
   * Removes the overlay and highlight rect from the DOM, detaches all listeners,
   * and removes the hover-suppression class if present. A no-op if not active.
   */
  deactivate(): void {
    if (!this.active) return;

    this.active = false;
    this.onSelectCallback = null;
    this.hoveredEl = null;

    // Remove overlay and highlight from DOM
    if (this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
    if (this.highlightEl.parentNode) {
      this.highlightEl.parentNode.removeChild(this.highlightEl);
    }

    // Remove all event listeners
    this.overlayEl.removeEventListener("pointermove", this._onPointerMove);
    this.overlayEl.removeEventListener("click", this._onClick);
    document.removeEventListener("keydown", this._onKeyDown, true);
    document.removeEventListener("keyup", this._onKeyUp, true);

    // Remove hover suppression class if still present
    this._setSuppression(false);

    // Hide highlight
    this.highlightEl.style.display = "none";
    this.highlightEl.classList.remove("tug-inspector-highlight--scan-suppressed");
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
   *   5. Position the highlight rect on the identified element.
   */
  private _handlePointerMove(e: PointerEvent): void {
    // Temporarily suppress overlay to allow elementFromPoint to see through it
    this.overlayEl.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    this.overlayEl.style.pointerEvents = "auto";

    if (!el || el === this.overlayEl || el === this.highlightEl) {
      return;
    }

    this.hoveredEl = el as HTMLElement;
    this._positionHighlight(el as HTMLElement);
  }

  /**
   * Handle click on the overlay.
   *
   * Identifies the real element under cursor using the same pointer-events
   * suppression technique, calls the onSelect callback, and deactivates.
   */
  private _handleClick(e: MouseEvent): void {
    // Find the real target (same technique as pointermove)
    this.overlayEl.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    this.overlayEl.style.pointerEvents = "auto";

    if (!el || el === this.overlayEl || el === this.highlightEl) {
      return;
    }

    const target = el as HTMLElement;
    const cb = this.onSelectCallback;
    // Deactivate before calling callback so the card can re-activate if needed
    this.deactivate();
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
