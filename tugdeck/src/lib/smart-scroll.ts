/**
 * SmartScroll — scroll state machine and auto-scroll manager.
 *
 * Models UIScrollView/UIScrollViewDelegate for the web. Manages a scroll
 * container element, tracks scroll phases (idle, tracking, dragging,
 * decelerating, programmatic), provides programmatic scroll methods, fires
 * lifecycle callbacks, and includes auto-follow-bottom as a built-in feature.
 *
 * Architecture [D93]:
 *   The state machine is the guard for distinguishing user scrolls from
 *   programmatic or DOM-manipulation-caused scrolls. No timing hacks, no
 *   rAF+setTimeout, no flags cleared after arbitrary delays.
 *
 *   Seven listeners:
 *   1. scroll on container (passive) — onScroll callback, lastScrollTop update,
 *      phase transitions, follow-bottom re-engagement.
 *   2. scrollend on container — terminal signal for deceleration and programmatic
 *      animation. Feature-detected at construction; 150ms timer fallback for
 *      browsers without it.
 *   3. pointerdown on container (passive) — enters TRACKING phase.
 *   4. pointerup/pointercancel on document (passive) — exits DRAGGING; 50ms check
 *      determines whether DECELERATING follows.
 *   5. wheel on container (passive) — skips TRACKING, enters DRAGGING immediately;
 *      disengages follow-bottom on deltaY < 0.
 *   6. keydown on container — Page Up/Home/Arrow Up/Shift+Space skips TRACKING,
 *      enters DRAGGING immediately.
 *   7. ResizeObserver on contentElement — follow-bottom auto-scroll trigger.
 *
 * Not a React hook — a plain class that manages DOM listeners directly.
 * Callers create an instance and call dispose() when done.
 *
 * Modeled after UIScrollView/UIScrollViewDelegate.
 * Studied from use-stick-to-bottom (StackBlitz Labs, MIT license).
 * See THIRD_PARTY_NOTICES.md.
 *
 * @module lib/smart-scroll
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scroll phase — mutually exclusive states. */
export type ScrollPhase = 'idle' | 'tracking' | 'dragging' | 'decelerating' | 'programmatic';

/** Lifecycle callbacks — modeled after UIScrollViewDelegate. */
export interface SmartScrollCallbacks {
  /** Fires for ALL scroll sources. Like scrollViewDidScroll. */
  onScroll?: (scroll: SmartScroll) => void;

  /** User drag started (pointer/wheel/keyboard). Like scrollViewWillBeginDragging. */
  onWillBeginDragging?: (scroll: SmartScroll) => void;
  /** User drag ended. Like scrollViewDidEndDragging(willDecelerate:). */
  onDidEndDragging?: (scroll: SmartScroll, willDecelerate: boolean) => void;

  /** Momentum coast started. Like scrollViewWillBeginDecelerating. */
  onWillBeginDecelerating?: (scroll: SmartScroll) => void;
  /** Momentum coast ended. Like scrollViewDidEndDecelerating. */
  onDidEndDecelerating?: (scroll: SmartScroll) => void;

  /** Programmatic animated scroll completed. Like scrollViewDidEndScrollingAnimation. */
  onDidEndScrollingAnimation?: (scroll: SmartScroll) => void;

  /** Any scroll sequence completed (user or programmatic). */
  onDidEndScrolling?: (scroll: SmartScroll) => void;

  /** Auto-follow-bottom state changed. */
  onFollowBottomChanged?: (scroll: SmartScroll, following: boolean) => void;
}

/** Constructor options. */
export interface SmartScrollOptions {
  scrollContainer: HTMLElement;
  contentElement: HTMLElement;
  callbacks?: SmartScrollCallbacks;
  /** Default: 60px */
  nearBottomThreshold?: number;
  /** Default: true */
  followBottom?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 60;

/**
 * Scroll-up key codes that initiate user scroll without pointer input.
 * The scroll container needs tabindex="0" for keydown to fire on it.
 */
const SCROLL_UP_KEYS = new Set(['PageUp', 'Home', 'ArrowUp']);

/**
 * After pointerup, wait this long for continued scroll events before deciding
 * that no momentum deceleration is happening. This is a state machine
 * transition guard — not a timing hack for filtering scroll events.
 */
const DECELERATION_DETECTION_MS = 50;

/**
 * Timer fallback for browsers that don't support the scrollend event.
 * Only used when 'onscrollend' in element returns false at construction.
 * Restarted on every scroll event so it fires 150ms after the last scroll.
 */
const SCROLLEND_FALLBACK_MS = 150;

// ---------------------------------------------------------------------------
// SmartScroll
// ---------------------------------------------------------------------------

export class SmartScroll {
  private readonly _container: HTMLElement;
  private readonly _content: HTMLElement;
  private readonly _callbacks: SmartScrollCallbacks;
  private readonly _nearBottomThreshold: number;
  private readonly _supportsScrollEnd: boolean;

  private _phase: ScrollPhase = 'idle';
  private _isFollowingBottom: boolean;
  private _lastScrollTop: number;
  private _disposed = false;

  // Timer handles
  private _decelerationTimer: ReturnType<typeof setTimeout> | null = null;
  private _scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

  // Deceleration detection: did scroll events arrive during the 50ms window?
  private _scrolledAfterPointerUp = false;

  // Listener function references stored for removeEventListener
  private readonly _onScroll: () => void;
  private readonly _onScrollEnd: () => void;
  private readonly _onPointerDown: (e: PointerEvent) => void;
  private readonly _onPointerUp: (e: PointerEvent) => void;
  private readonly _onWheel: (e: WheelEvent) => void;
  private readonly _onKeyDown: (e: KeyboardEvent) => void;

  private readonly _resizeObserver: ResizeObserver;

  constructor(options: SmartScrollOptions) {
    const {
      scrollContainer,
      contentElement,
      callbacks = {},
      nearBottomThreshold = DEFAULT_NEAR_BOTTOM_THRESHOLD,
      followBottom = true,
    } = options;

    this._container = scrollContainer;
    this._content = contentElement;
    this._callbacks = callbacks;
    this._nearBottomThreshold = nearBottomThreshold;
    this._isFollowingBottom = followBottom;
    this._lastScrollTop = scrollContainer.scrollTop;

    // Feature-detect scrollend support.
    this._supportsScrollEnd = 'onscrollend' in scrollContainer;

    // Bind listeners.
    this._onScroll = this._handleScroll.bind(this);
    this._onScrollEnd = this._handleScrollEnd.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);

    // Register listeners.
    scrollContainer.addEventListener('scroll', this._onScroll, { passive: true });
    if (this._supportsScrollEnd) {
      scrollContainer.addEventListener('scrollend', this._onScrollEnd, { passive: true });
    }
    scrollContainer.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    document.addEventListener('pointerup', this._onPointerUp, { passive: true });
    document.addEventListener('pointercancel', this._onPointerUp, { passive: true });
    scrollContainer.addEventListener('wheel', this._onWheel, { passive: true });
    // keydown does not use passive:true here — that option is not universally
    // accepted for keydown and we don't call preventDefault in this handler.
    scrollContainer.addEventListener('keydown', this._onKeyDown);

    // ResizeObserver for content growth detection.
    this._resizeObserver = new ResizeObserver(this._handleResize.bind(this));
    this._resizeObserver.observe(contentElement);
  }

  // -------------------------------------------------------------------------
  // Public state (read-only)
  // -------------------------------------------------------------------------

  get phase(): ScrollPhase { return this._phase; }

  get scrollTop(): number { return this._container.scrollTop; }
  get scrollHeight(): number { return this._container.scrollHeight; }
  get clientHeight(): number { return this._container.clientHeight; }

  get isAtBottom(): boolean {
    const { scrollTop, scrollHeight, clientHeight } = this._container;
    return scrollHeight - clientHeight - Math.max(0, scrollTop) <= this._nearBottomThreshold;
  }

  get isAtTop(): boolean {
    return this._container.scrollTop <= 0;
  }

  /** True while the user is actively interacting (tracking, dragging, or decelerating). */
  get isUserScrolling(): boolean {
    const p = this._phase;
    return p === 'tracking' || p === 'dragging' || p === 'decelerating';
  }

  get isFollowingBottom(): boolean { return this._isFollowingBottom; }

  // -------------------------------------------------------------------------
  // Public API — programmatic scroll
  // -------------------------------------------------------------------------

  scrollTo(options: { top?: number; left?: number; animated?: boolean }): void {
    if (this._disposed) return;
    const { top, animated = false } = options;
    if (top === undefined) return;

    this._enterProgrammatic();

    if (animated) {
      this._container.scrollTo({ top, behavior: 'smooth' });
      // scrollend event (or 150ms fallback) will return us to idle.
    } else {
      this._container.scrollTop = top;
      // Non-animated: target is reached immediately.
      this._exitProgrammaticImmediate();
    }
  }

  scrollToTop(animated = false): void {
    this.scrollTo({ top: 0, animated });
  }

  scrollToBottom(animated = false): void {
    if (this._disposed) return;
    this._setFollowingBottom(true);
    const target = this._container.scrollHeight - this._container.clientHeight;
    this.scrollTo({ top: target, animated });
  }

  scrollToElement(
    element: HTMLElement,
    options: { animated?: boolean; block?: ScrollLogicalPosition } = {},
  ): void {
    if (this._disposed) return;
    const { animated = false, block = 'nearest' } = options;
    this._enterProgrammatic();
    element.scrollIntoView({ behavior: animated ? 'smooth' : 'instant', block });
    if (!animated) {
      this._exitProgrammaticImmediate();
    }
    // animated: scrollend or timer fallback handles return to idle.
  }

  // -------------------------------------------------------------------------
  // Public API — follow-bottom control
  // -------------------------------------------------------------------------

  engageFollowBottom(): void {
    this._setFollowingBottom(true);
  }

  disengageFollowBottom(): void {
    this._setFollowingBottom(false);
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this._clearDecelerationTimer();
    this._clearScrollEndTimer();

    this._container.removeEventListener('scroll', this._onScroll);
    if (this._supportsScrollEnd) {
      this._container.removeEventListener('scrollend', this._onScrollEnd);
    }
    this._container.removeEventListener('pointerdown', this._onPointerDown);
    document.removeEventListener('pointerup', this._onPointerUp);
    document.removeEventListener('pointercancel', this._onPointerUp);
    this._container.removeEventListener('wheel', this._onWheel);
    this._container.removeEventListener('keydown', this._onKeyDown);

    this._resizeObserver.disconnect();
  }

  // -------------------------------------------------------------------------
  // Private — scroll event handler
  // -------------------------------------------------------------------------

  private _handleScroll(): void {
    if (this._disposed) return;

    const scrollTop = this._container.scrollTop;

    // Fire onScroll for every scroll event regardless of phase.
    this._callbacks.onScroll?.(this);

    switch (this._phase) {
      case 'idle':
        // If we're in the 50ms post-pointerup window, note that scroll arrived.
        if (this._decelerationTimer !== null) {
          this._scrolledAfterPointerUp = true;
        }
        // Re-engagement: scrolled down into near-bottom while idle.
        if (!this._isFollowingBottom && scrollTop >= this._lastScrollTop && this.isAtBottom) {
          this._setFollowingBottom(true);
        }
        break;

      case 'dragging':
        // Detect user scrolling up — disengage follow-bottom.
        if (scrollTop < this._lastScrollTop && this._isFollowingBottom) {
          this._setFollowingBottom(false);
        }
        break;

      case 'decelerating':
      case 'programmatic':
        // Restart scrollend fallback timer on every scroll event.
        if (!this._supportsScrollEnd) {
          this._restartScrollEndTimer();
        }
        break;

      default:
        break;
    }

    this._lastScrollTop = scrollTop;
  }

  // -------------------------------------------------------------------------
  // Private — scrollend event handler
  // -------------------------------------------------------------------------

  private _handleScrollEnd(): void {
    if (this._disposed) return;
    this._clearScrollEndTimer();
    this._onScrollTerminal();
  }

  // -------------------------------------------------------------------------
  // Private — pointer event handlers
  // -------------------------------------------------------------------------

  private _handlePointerDown(_e: PointerEvent): void {
    if (this._disposed) return;
    if (this._phase === 'idle') {
      this._phase = 'tracking';
    }
    // If decelerating, a new pointerdown interrupts; enter tracking to
    // capture the new gesture.
    else if (this._phase === 'decelerating') {
      this._clearScrollEndTimer();
      this._phase = 'tracking';
    }
  }

  private _handlePointerUp(_e: PointerEvent): void {
    if (this._disposed) return;

    if (this._phase === 'tracking') {
      // Pointerup with no scroll — tap without scroll, return to idle.
      this._phase = 'idle';
      return;
    }

    if (this._phase === 'dragging') {
      // Wait 50ms to see if momentum scroll events arrive.
      this._scrolledAfterPointerUp = false;
      // Temporarily hold at idle so _handleScroll can detect incoming events
      // via the _decelerationTimer sentinel.
      this._phase = 'idle';

      this._decelerationTimer = setTimeout(() => {
        this._decelerationTimer = null;
        if (this._disposed) return;

        if (this._scrolledAfterPointerUp) {
          // Momentum is happening — enter decelerating.
          this._phase = 'decelerating';
          this._callbacks.onDidEndDragging?.(this, true);
          this._callbacks.onWillBeginDecelerating?.(this);
          if (!this._supportsScrollEnd) {
            this._restartScrollEndTimer();
          }
        } else {
          // No momentum — drag ended cleanly.
          this._callbacks.onDidEndDragging?.(this, false);
          this._callbacks.onDidEndScrolling?.(this);
          this._checkReEngageFollowBottom();
        }
      }, DECELERATION_DETECTION_MS);
    }
  }

  // -------------------------------------------------------------------------
  // Private — wheel event handler
  // -------------------------------------------------------------------------

  private _handleWheel(e: WheelEvent): void {
    if (this._disposed) return;

    // wheel always enters DRAGGING directly (no pointer down involved).
    if (this._phase !== 'dragging') {
      this._enterDragging();
    }

    // Disengage follow-bottom on scroll-up.
    if (e.deltaY < 0 && this._isFollowingBottom) {
      this._setFollowingBottom(false);
    }
  }

  // -------------------------------------------------------------------------
  // Private — keydown event handler
  // -------------------------------------------------------------------------

  private _handleKeyDown(e: KeyboardEvent): void {
    if (this._disposed) return;

    const isScrollUpKey =
      SCROLL_UP_KEYS.has(e.code) ||
      (e.code === 'Space' && e.shiftKey);

    if (!isScrollUpKey) return;

    // Scroll-up keys enter DRAGGING directly (keyboard has no pointer).
    if (this._phase !== 'dragging') {
      this._enterDragging();
    }

    // Disengage follow-bottom for any up-scroll key.
    if (this._isFollowingBottom) {
      this._setFollowingBottom(false);
    }
  }

  // -------------------------------------------------------------------------
  // Private — ResizeObserver
  // -------------------------------------------------------------------------

  private _handleResize(): void {
    // ResizeObserver does NOT auto-scroll. The controller (the component)
    // decides when to scroll by calling scrollToBottom() after content
    // changes settle. This follows the UIScrollView model: the scroll view
    // provides the method and the state; the controller decides when to use them.
    //
    // The ResizeObserver is retained for future use (content-change detection
    // for callbacks) but does not write scrollTop.
  }

  // -------------------------------------------------------------------------
  // Private — phase transitions
  // -------------------------------------------------------------------------

  private _enterDragging(): void {
    const wasAlreadyDragging = this._phase === 'dragging';
    this._phase = 'dragging';
    if (!wasAlreadyDragging) {
      this._callbacks.onWillBeginDragging?.(this);
    }
  }

  private _enterProgrammatic(): void {
    this._clearDecelerationTimer();
    this._clearScrollEndTimer();
    this._phase = 'programmatic';
  }

  private _exitProgrammaticImmediate(): void {
    if (this._phase !== 'programmatic') return;
    this._phase = 'idle';
    // Non-animated programmatic scroll fires end-of-scroll but not animation callback.
    this._callbacks.onDidEndScrolling?.(this);
    this._checkReEngageFollowBottom();
  }

  /** Terminal signal — called by scrollend event or timer fallback. */
  private _onScrollTerminal(): void {
    if (this._disposed) return;

    const previousPhase = this._phase;

    if (previousPhase === 'decelerating') {
      this._phase = 'idle';
      this._callbacks.onDidEndDecelerating?.(this);
      this._callbacks.onDidEndScrolling?.(this);
      this._checkReEngageFollowBottom();
    } else if (previousPhase === 'programmatic') {
      this._phase = 'idle';
      this._callbacks.onDidEndScrollingAnimation?.(this);
      this._callbacks.onDidEndScrolling?.(this);
      this._checkReEngageFollowBottom();
    }
    // Other phases: ignore (scrollend can fire spuriously).
  }

  // -------------------------------------------------------------------------
  // Private — follow-bottom helpers
  // -------------------------------------------------------------------------

  private _setFollowingBottom(following: boolean): void {
    if (this._isFollowingBottom === following) return;
    this._isFollowingBottom = following;
    this._callbacks.onFollowBottomChanged?.(this, following);
  }

  private _checkReEngageFollowBottom(): void {
    if (!this._isFollowingBottom && this.isAtBottom) {
      this._setFollowingBottom(true);
    }
  }

  // -------------------------------------------------------------------------
  // Private — timer helpers
  // -------------------------------------------------------------------------

  private _clearDecelerationTimer(): void {
    if (this._decelerationTimer !== null) {
      clearTimeout(this._decelerationTimer);
      this._decelerationTimer = null;
    }
  }

  private _clearScrollEndTimer(): void {
    if (this._scrollEndTimer !== null) {
      clearTimeout(this._scrollEndTimer);
      this._scrollEndTimer = null;
    }
  }

  private _restartScrollEndTimer(): void {
    this._clearScrollEndTimer();
    this._scrollEndTimer = setTimeout(() => {
      this._scrollEndTimer = null;
      this._onScrollTerminal();
    }, SCROLLEND_FALLBACK_MS);
  }
}
