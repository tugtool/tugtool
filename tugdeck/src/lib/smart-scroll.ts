/**
 * SmartScroll — scroll state machine and auto-scroll manager.
 *
 * Models UIScrollView/UIScrollViewDelegate for the web. Manages a scroll
 * container element, tracks scroll phases (idle, tracking, dragging,
 * decelerating, programmatic), provides programmatic scroll methods, fires
 * lifecycle callbacks, and owns two built-in scroll-position policies:
 * auto-follow-bottom (pin to the live edge as content grows) and
 * cold-boot scroll restore (re-place the scroller at a saved
 * mid-content position via a consumer-supplied resolver). The two are
 * mutually exclusive — engaging the live edge clears a pending restore.
 *
 * Architecture [D93]:
 *   The state machine is the guard for distinguishing user scrolls from
 *   programmatic or DOM-manipulation-caused scrolls. No timing hacks, no
 *   rAF+setTimeout, no flags cleared after arbitrary delays.
 *
 *   Six listeners:
 *   1. scroll on container (passive) — onScroll callback, lastScrollTop update,
 *      phase transitions, follow-bottom re-engagement.
 *   2. scrollend on container — terminal signal for deceleration and programmatic
 *      animation. Feature-detected at construction; 150ms timer fallback for
 *      browsers without it.
 *   3. pointerdown on container (passive) — enters TRACKING phase.
 *   4. pointerup/pointercancel on document (passive) — exits DRAGGING; 50ms check
 *      determines whether DECELERATING follows (via SETTLING phase).
 *   5. wheel on container (passive) — skips TRACKING, enters DRAGGING immediately;
 *      disengages follow-bottom on deltaY < 0.
 *   6. keydown on container — scroll keys skip TRACKING, enter DRAGGING immediately.
 *      Only scroll-up keys disengage follow-bottom.
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

import { deckTrace } from "../deck-trace";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Scroll phase — mutually exclusive states. */
export type ScrollPhase = 'idle' | 'tracking' | 'dragging' | 'settling' | 'decelerating' | 'programmatic';

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
  callbacks?: SmartScrollCallbacks;
  /** Default: true */
  followBottom?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed pixel threshold for the "at bottom" check. Used for disengagement
 *  jitter guard and conservative auto-re-engagement at idle. Small and fixed. */
const AT_BOTTOM_PX = 60;

/**
 * All scroll key codes that initiate user scroll without pointer input.
 * The scroll container needs tabindex="0" for keydown to fire on it.
 */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'Space']);

/**
 * Scroll-up key codes that should disengage follow-bottom.
 */
const SCROLL_UP_KEYS = new Set(['PageUp', 'Home', 'ArrowUp']);

/**
 * True when the keydown event's target is an editable element —
 * `<input>`, `<textarea>`, `<select>`, or any element with
 * `contenteditable`. SmartScroll skips its keydown handling for
 * these so cursor-movement keys typed into a cell's input do not
 * register as scroll intent.
 *
 * Module-private; not part of the public surface.
 */
function _isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT') return true;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

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
  private readonly _callbacks: SmartScrollCallbacks;
  private readonly _supportsScrollEnd: boolean;

  private _phase: ScrollPhase = 'idle';
  private _isFollowingBottom: boolean;
  private _lastScrollTop: number;
  private _disposed = false;

  // One-shot guard: the next scroll event won't fire idle-phase
  // auto-re-engagement of follow-bottom. Set by `scrollTo` so that
  // the deferred scroll event emitted by a programmatic write
  // doesn't flip follow-bottom back on. Without this, a state-
  // restore path that explicitly disengages follow-bottom and writes
  // a saved scrollTop has its disengage immediately undone by the
  // deferred event's auto-re-engagement check — which fires whenever
  // `isAtBottom` is satisfied while content is still settling.
  //
  // Consumed on the FIRST `_handleScroll` invocation after the
  // programmatic write — regardless of phase — and immediately
  // cleared so a subsequent genuine user scroll re-engages
  // normally.
  private _suppressIdleReengagementOnNextScroll = false;

  // Timer handles
  private _decelerationTimer: ReturnType<typeof setTimeout> | null = null;
  private _scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

  // Deceleration detection: did scroll events arrive during the 50ms window?
  private _scrolledAfterPointerUp = false;

  // Gesture direction tracking: scrollTop at the start of the current gesture.
  // Used to determine net direction (up vs down) when the gesture ends.
  // Re-engagement at idle only fires if the gesture was net-downward.
  private _gestureStartScrollTop: number = 0;

  // Pending cold-boot scroll-restore resolver, or `null` when no
  // restore is in flight. A consumer that mounts into a saved
  // mid-content scroll position installs a resolver via
  // `setRestoreTarget`; it returns the desired `scrollTop` (or `null`
  // while the target is not yet resolvable — e.g. the anchor cell is
  // not in range, or content has not laid out). `applyRestoreTarget`
  // re-resolves and writes the target on each layout signal the
  // consumer forwards, until the user gestures or follow-bottom
  // engages — at which point the restore is superseded and cleared.
  // The resolver, not a stored pixel value, is the contract: as
  // virtualized content settles its heights the resolved offset
  // drifts, and the restore tracks it.
  private _restoreTarget: (() => number | null) | null = null;

  // Listener function references stored for removeEventListener
  private readonly _onScroll: () => void;
  private readonly _onScrollEnd: () => void;
  private readonly _onPointerDown: (e: PointerEvent) => void;
  private readonly _onPointerUp: (e: PointerEvent) => void;
  private readonly _onWheel: (e: WheelEvent) => void;
  private readonly _onKeyDown: (e: KeyboardEvent) => void;

  constructor(options: SmartScrollOptions) {
    const {
      scrollContainer,
      callbacks = {},
      followBottom = true,
    } = options;

    this._container = scrollContainer;
    this._callbacks = callbacks;
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
    return scrollHeight - clientHeight - Math.max(0, scrollTop) <= AT_BOTTOM_PX;
  }

  get isAtTop(): boolean {
    return this._container.scrollTop <= 0;
  }

  /** True while the user is actively interacting (tracking, dragging, settling, or decelerating). */
  get isUserScrolling(): boolean {
    const p = this._phase;
    return p === 'tracking' || p === 'dragging' || p === 'settling' || p === 'decelerating';
  }

  get isFollowingBottom(): boolean { return this._isFollowingBottom; }

  // -------------------------------------------------------------------------
  // Public API — programmatic scroll
  // -------------------------------------------------------------------------

  scrollTo(options: { top?: number; left?: number; animated?: boolean }): void {
    if (this._disposed) return;
    const { top, animated = false } = options;
    if (top === undefined) return;
    // An explicit programmatic scroll supersedes a pending cold-boot
    // restore — the consumer has named a position, so a restore that
    // would pull `scrollTop` back to the saved anchor must be
    // dropped. The restore heartbeat (`applyRestoreTarget`) writes
    // through the private `_writeScrollTop` directly, NOT this
    // method, so it does not clear its own target.
    this.clearRestoreTarget();
    this._writeScrollTop(top, animated);
  }

  /**
   * Programmatic `scrollTop` write — the shared mechanism behind the
   * public `scrollTo` and the cold-boot restore heartbeat. Enters the
   * programmatic phase and arms the one-shot idle-re-engagement
   * suppression so the deferred scroll event this write emits cannot
   * flip follow-bottom back on: without it, a restore path that
   * disengages follow-bottom before writing would have its disengage
   * undone by the deferred event's `isAtBottom`-driven re-engagement.
   * The flag is consumed by the FIRST `_handleScroll` invocation.
   *
   * Does NOT touch the restore target — the caller owns that policy:
   * the public `scrollTo` clears it (an explicit scroll supersedes a
   * restore); `applyRestoreTarget` preserves it (the restore must
   * re-apply across the content-settle window).
   */
  private _writeScrollTop(top: number, animated: boolean): void {
    this._enterProgrammatic();
    this._suppressIdleReengagementOnNextScroll = true;
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
    this._setFollowingBottom(true, 'scroll-to-bottom');
    // 2^30 sentinel: large enough to exceed any real document height,
    // small enough to avoid WebKit's 32-bit int overflow. The browser
    // clamps to `scrollHeight - clientHeight` for us.
    this.scrollTo({ top: 0x40000000, animated });
  }

  /** Slam scrollTop to bottom without entering programmatic phase.
   *  Used for content growth while following bottom. Stays in idle. [D04]
   *
   *  Idempotent: reads the live scroll geometry and skips the write when
   *  scrollTop is already at (or past) the maximum. Setting scrollTop to a
   *  clamped value is *logically* a no-op, but on WebKit the assignment can
   *  still fire a scroll event regardless, which feeds back into a caller
   *  that re-runs after every commit (see TugListView's post-commit pin
   *  effect) and produces a 60Hz scrollTop-write loop on relaunch. The
   *  callers have just committed, so the layout read here is fresh and
   *  cheap. */
  pinToBottom(): void {
    if (this._disposed) return;
    const max = this._container.scrollHeight - this._container.clientHeight;
    if (this._container.scrollTop >= max) return;
    this._container.scrollTop = Math.max(0, max);
  }

  /** True when a content-growth signal should auto-pin the scroller to the
   *  bottom: the scroller is following the bottom (intent) AND the user is
   *  not actively scrolling (safe to take the scroll position).
   *
   *  This is the single home of the `isFollowingBottom && !isUserScrolling`
   *  gate. Auto-pin callers previously re-derived it inline at many sites —
   *  the list view's three growth-pin paths, the markdown view's two raw
   *  `scrollTop` slams (which omitted the `isUserScrolling` half entirely
   *  and so fought an in-flight user gesture), and the markdown view's
   *  predicted-bottom render decision. Reading the gate from one place
   *  keeps the policy consistent: a user mid-scroll always wins, and a
   *  scroller the user has scrolled up from is never yanked back.
   *
   *  Exposed as a getter (not just folded into `maybePinToBottom`) because
   *  some callers need the gate as a *value* — e.g. choosing whether to
   *  render the virtualized window at the predicted bottom or at the
   *  user's live scroll position. */
  get shouldAutoPin(): boolean {
    return this._isFollowingBottom && !this.isUserScrolling;
  }

  /** Pin to bottom when `shouldAutoPin` — the convenience wrapper for the
   *  pure-pin case (a ResizeObserver fire, a spacer reflow, a post-commit
   *  re-window). The underlying `pinToBottom` is idempotent, so a call
   *  that passes the gate but finds scrollTop already at the bottom is a
   *  cheap no-op. */
  maybePinToBottom(): void {
    if (this._disposed) return;
    if (this.shouldAutoPin) this.pinToBottom();
  }

  scrollToElement(
    element: HTMLElement,
    options: { animated?: boolean; block?: ScrollLogicalPosition } = {},
  ): void {
    if (this._disposed) return;
    const { animated = false, block = 'nearest' } = options;
    // An explicit programmatic scroll supersedes a pending cold-boot
    // restore — see `scrollTo`.
    this.clearRestoreTarget();
    this._enterProgrammatic();
    element.scrollIntoView({ behavior: animated ? 'smooth' : 'instant', block });
    if (!animated) {
      this._exitProgrammaticImmediate();
    }
    // animated: scrollend or timer fallback handles return to idle.
  }

  // -------------------------------------------------------------------------
  // Public API — cold-boot scroll restore
  //
  // A consumer that mounts into a saved mid-content scroll position
  // (a virtualized list / markdown view restoring `bag.regionScroll`)
  // installs a `resolver` here. SmartScroll owns the restore policy:
  //   - a pending restore means the scroller is being placed, not
  //     tracking the live edge — `setRestoreTarget` disengages
  //     follow-bottom;
  //   - the user engaging the live edge (`scrollToBottom`, keyboard
  //     End / Cmd+ArrowDown, idle re-engagement, gesture-end
  //     re-engage) supersedes the restore — `_setFollowingBottom(true)`
  //     clears it;
  //   - a user scroll gesture supersedes the restore — `applyRestore
  //     Target` clears it when `isUserScrolling`;
  //   - an explicit programmatic scroll (`scrollTo`, `scrollToTop`,
  //     `scrollToElement`) supersedes the restore — the consumer
  //     named a position, so those methods clear the target.
  // The consumer's only job is to forward layout signals by calling
  // `applyRestoreTarget` (its post-commit / ResizeObserver heartbeat);
  // it holds no restore state of its own.
  // -------------------------------------------------------------------------

  /**
   * Install a cold-boot scroll-restore `resolver`. The resolver
   * returns the desired `scrollTop`, or `null` while the target is
   * not yet resolvable (anchor cell out of range, content not laid
   * out). It is re-invoked on every `applyRestoreTarget` call so the
   * restore tracks a target that drifts as virtualized content
   * settles its heights.
   *
   * A pending restore is incompatible with following the live edge,
   * so this disengages follow-bottom — the auto-pin must not fight
   * the restore write.
   */
  setRestoreTarget(resolver: () => number | null): void {
    if (this._disposed) return;
    this._restoreTarget = resolver;
    this._setFollowingBottom(false, 'restore-target');
  }

  /** Drop the pending restore target, if any. */
  clearRestoreTarget(): void {
    this._restoreTarget = null;
  }

  /**
   * Re-resolve the installed restore target and write `scrollTop` to
   * it when it has drifted. No-op when no target is installed. A user
   * scroll gesture supersedes the restore: when `isUserScrolling`,
   * the target is cleared and nothing is written — the user owns the
   * position from that point on.
   *
   * Consumers call this from their layout heartbeat (a post-commit
   * `useLayoutEffect`, a `ResizeObserver` flush) so the restore
   * tracks the resolved offset as content settles. The write goes
   * through the private `_writeScrollTop` — NOT the public
   * `scrollTo` — so the restore does not clear its own target;
   * `_writeScrollTop` still arms the one-shot idle-re-engagement
   * suppression so the deferred scroll event cannot flip follow-bottom
   * back on mid-restore.
   */
  applyRestoreTarget(): void {
    if (this._disposed) return;
    const resolver = this._restoreTarget;
    if (resolver === null) return;
    // A user scroll gesture supersedes the restore — they own the
    // position now. Clear so a later commit doesn't fight them.
    if (this.isUserScrolling) {
      this._restoreTarget = null;
      return;
    }
    const desired = resolver();
    if (desired === null) return;
    if (Math.abs(this._container.scrollTop - desired) > 0.5) {
      this._writeScrollTop(desired, false);
    }
  }

  // -------------------------------------------------------------------------
  // Public API — follow-bottom control
  // -------------------------------------------------------------------------

  /** Engage auto-follow-bottom. `source` tags the trigger for the
   *  deck trace — see {@link _setFollowingBottom}. */
  engageFollowBottom(source: string): void {
    this._setFollowingBottom(true, source);
  }

  /** Disengage auto-follow-bottom. `source` tags the trigger for the
   *  deck trace — see {@link _setFollowingBottom}. */
  disengageFollowBottom(source: string): void {
    this._setFollowingBottom(false, source);
  }

  /**
   * Engage follow-bottom on behalf of a named `source` — the typed
   * funnel for follow-bottom intent crossing a component boundary, to
   * which the `useScroller()` façade delegates. A thin wrapper over
   * `engageFollowBottom`; the `source` reaches the deck trace via
   * `_setFollowingBottom`, the chokepoint every transition routes
   * through. `source` is a short, stable trigger tag so a follow-bottom
   * regression in the trace can be attributed to who flipped it.
   */
  engage(source: string): void {
    if (this._disposed) return;
    this.engageFollowBottom(source);
  }

  /**
   * Disengage follow-bottom on behalf of a named `source`. Counterpart
   * to {@link engage}; see its doc for the funnel rationale. The
   * bubbling descendant-to-host signalling this replaces had no record
   * of who fired it — `source` closes that gap.
   */
  disengage(source: string): void {
    if (this._disposed) return;
    this.disengageFollowBottom(source);
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
  }

  // -------------------------------------------------------------------------
  // Private — scroll event handler
  // -------------------------------------------------------------------------

  private _handleScroll(): void {
    if (this._disposed) return;

    const scrollTop = this._container.scrollTop;

    // Fire onScroll for every scroll event regardless of phase.
    this._callbacks.onScroll?.(this);

    // Consume the one-shot post-`scrollTo` suppression flag. We clear
    // unconditionally on the FIRST scroll event after a programmatic
    // write — regardless of phase — so a subsequent genuine user
    // gesture re-engages normally. Without unconditional clear, a
    // browser that fires the scroll synchronously inside the write
    // (still in 'programmatic' phase) would never enter the idle
    // case, and the flag would carry over to a real user scroll.
    const suppressIdleReengage = this._suppressIdleReengagementOnNextScroll;
    this._suppressIdleReengagementOnNextScroll = false;

    switch (this._phase) {
      case 'idle':
        // Conservative auto-re-engagement: only if scrolled down to within
        // 60px of the absolute bottom while idle. This handles the non-streaming
        // case (user manually scrolls to bottom). During streaming, the bottom
        // moves too fast for this to reliably trigger — the user should use
        // End/Cmd+Down for explicit re-engagement.
        //
        // The suppression flag rides on top: a deferred scroll event
        // from a programmatic `scrollTo` skips re-engagement so a
        // state-restore path's disengage isn't undone by the very
        // write it set up. See `_suppressIdleReengagementOnNextScroll`
        // for the full rationale.
        if (
          !suppressIdleReengage &&
          !this._isFollowingBottom &&
          scrollTop >= this._lastScrollTop &&
          this.isAtBottom
        ) {
          this._setFollowingBottom(true, 'idle-reengage');
        }
        break;

      case 'settling':
        // During settling, a scroll event means momentum deceleration is arriving.
        this._scrolledAfterPointerUp = true;
        break;

      case 'dragging':
        // During active dragging, the user is in deliberate control — no
        // re-engagement. Only DISENGAGE if they scroll up past the jitter guard.
        if (scrollTop < this._lastScrollTop && this._isFollowingBottom && !this.isAtBottom) {
          this._setFollowingBottom(false, 'drag-up');
        }
        if (!this._supportsScrollEnd) {
          this._restartScrollEndTimer();
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
      this._gestureStartScrollTop = this._container.scrollTop;
      this._phase = 'tracking';
    }
    // If decelerating or settling, a new pointerdown interrupts; enter tracking
    // to capture the new gesture.
    else if (this._phase === 'decelerating' || this._phase === 'settling') {
      this._clearScrollEndTimer();
      this._clearDecelerationTimer();
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
      // Enter SETTLING phase: wait 50ms to see if momentum scroll events arrive.
      this._scrolledAfterPointerUp = false;
      this._phase = 'settling';

      this._decelerationTimer = setTimeout(() => {
        this._decelerationTimer = null;
        if (this._disposed) return;

        if (this._scrolledAfterPointerUp) {
          // Momentum is happening — transition settling → decelerating.
          this._phase = 'decelerating';
          this._callbacks.onDidEndDragging?.(this, true);
          this._callbacks.onWillBeginDecelerating?.(this);
          if (!this._supportsScrollEnd) {
            this._restartScrollEndTimer();
          }
        } else {
          // No momentum — drag ended cleanly, transition settling → idle.
          this._phase = 'idle';
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

    // Start/restart scrollend fallback timer (Issue 3).
    if (!this._supportsScrollEnd) {
      this._restartScrollEndTimer();
    }

    // Disengage follow-bottom on scroll-up.
    if (e.deltaY < 0 && this._isFollowingBottom) {
      this._setFollowingBottom(false, 'wheel-up');
    }
  }

  // -------------------------------------------------------------------------
  // Private — keydown event handler
  // -------------------------------------------------------------------------

  private _handleKeyDown(e: KeyboardEvent): void {
    if (this._disposed) return;
    if (!SCROLL_KEYS.has(e.code)) return;

    // Skip when the keydown originates inside an editable descendant
    // — typing in an `<input>` / `<textarea>` / `[contenteditable]`
    // shouldn't be interpreted as scroll intent. Without this guard,
    // arrow-key cursor movement inside a cell's input would
    // disengage `_isFollowingBottom` and enter the dragging phase
    // even though the user never gestured at the scroll container.
    // The keydown still bubbles to any other listener; this only
    // affects SmartScroll's intent tracking.
    if (_isEditableEventTarget(e.target)) return;

    // All scroll keys enter DRAGGING directly (keyboard has no pointer).
    if (this._phase !== 'dragging') {
      this._enterDragging();
    }

    // Start/restart scrollend fallback timer.
    if (!this._supportsScrollEnd) {
      this._restartScrollEndTimer();
    }

    // Disengage follow-bottom for scroll-up keys.
    const isScrollUpKey = SCROLL_UP_KEYS.has(e.code) || (e.code === 'Space' && e.shiftKey);
    if (isScrollUpKey && this._isFollowingBottom) {
      this._setFollowingBottom(false, 'key-up');
    }

    // Explicit re-engagement: End and Cmd+Down are definite "go to bottom"
    // actions. Re-engage follow-bottom and scroll to bottom immediately.
    // These work regardless of content size or streaming state — the user
    // declared their intent explicitly.
    const isJumpToBottom = e.code === 'End'
      || (e.code === 'ArrowDown' && e.metaKey);
    if (isJumpToBottom) {
      e.preventDefault(); // prevent native scroll — we handle it
      this.scrollToBottom();
    }
  }

  // -------------------------------------------------------------------------
  // Private — phase transitions
  // -------------------------------------------------------------------------

  private _enterDragging(): void {
    const wasIdle = this._phase === 'idle';
    const wasAlreadyDragging = this._phase === 'dragging';
    if (wasIdle) {
      // Use `_lastScrollTop` rather than `_container.scrollTop` for the
      // pre-gesture snapshot. With `passive: true` wheel listeners on
      // macOS WKWebView the browser pre-applies the deltaY *before*
      // dispatching the wheel JS event, so by the time `_handleWheel`
      // calls `_enterDragging` the live `scrollTop` already reflects
      // the first wheel tick. Reading it would treat that initial pull
      // as the gesture's starting position, and the post-gesture
      // re-engage check (`scrollTop > gestureStart`) would later
      // misread a return to bottom (driven by layout's natural
      // scrollHeight jitter while the user wheels up) as a net-down
      // gesture and re-engage follow-bottom against the user's intent.
      // `_lastScrollTop` is the value `_handleScroll` saw on the
      // previous scroll event, which has not yet been updated for the
      // new gesture — the true pre-gesture position.
      this._gestureStartScrollTop = this._lastScrollTop;
    }
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
    } else if (previousPhase === 'dragging') {
      // scrollend fired while still in DRAGGING (e.g., wheel/keyboard scroll ended
      // without a pointerup). Treat as terminal — transition to idle.
      this._phase = 'idle';
      this._callbacks.onDidEndDragging?.(this, false);
      this._callbacks.onDidEndScrolling?.(this);
      this._checkReEngageFollowBottom();
    }
    // Other phases: ignore (scrollend can fire spuriously).
  }

  // -------------------------------------------------------------------------
  // Private — follow-bottom helpers
  // -------------------------------------------------------------------------

  private _setFollowingBottom(following: boolean, source: string): void {
    if (this._isFollowingBottom === following) return;
    this._isFollowingBottom = following;
    // Record every follow-bottom transition to the deck trace.
    // `_setFollowingBottom` is the one chokepoint all engage /
    // disengage paths route through, so recording here — rather than
    // in the public `engage` / `disengage` wrappers — captures the
    // heuristic internal flips too: wheel-up, keyboard scroll-up,
    // idle re-engagement, gesture-end re-engage. Those are the paths
    // a follow-bottom regression most often hides in. `source` names
    // the trigger; the early-return above means only real transitions
    // are logged, never no-op calls.
    deckTrace.record({ kind: 'follow-bottom', following, source });
    // Engaging the live edge supersedes any pending cold-boot
    // restore: the user (or an explicit jump-to-latest) has declared
    // the bottom is where they want to be, so a restore target that
    // would pull them back to a saved mid-content position must be
    // dropped.
    if (following) this.clearRestoreTarget();
    this._callbacks.onFollowBottomChanged?.(this, following);
  }

  private _checkReEngageFollowBottom(): void {
    // Conservative re-engagement at gesture end: only if the gesture was
    // net-downward AND the user landed at the absolute bottom (within 60px).
    // Net-upward gestures that end near the bottom are the user scrolling
    // AWAY — don't yank them back.
    if (!this._isFollowingBottom
      && this.isAtBottom
      && this._container.scrollTop > this._gestureStartScrollTop) {
      this._setFollowingBottom(true, 'gesture-end-reengage');
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
