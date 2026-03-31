/**
 * SmartScroll — auto-scroll manager for dynamic content containers.
 *
 * Follows the bottom when content grows and the user is at/near the bottom.
 * Disengages when the user scrolls up. Re-engages when the user scrolls
 * back to the bottom.
 *
 * Architecture [D93]:
 *   1. ResizeObserver on content element — triggers auto-scroll on content growth
 *   2. wheel event on scroll container — detects user scroll-up intent (deltaY < 0)
 *   3. scroll event on scroll container — filtered for re-engagement detection only
 *
 * Not a React hook — a plain class that manages DOM listeners directly.
 * Callers create an instance, attach to elements, and dispose when done.
 *
 * Studied from use-stick-to-bottom (StackBlitz Labs, MIT license).
 * See THIRD_PARTY_NOTICES.md.
 *
 * @module lib/smart-scroll
 */

const NEAR_BOTTOM_THRESHOLD = 60;

export class SmartScroll {
  private _scrollContainer: HTMLElement;
  private _contentElement: HTMLElement;
  private _isAtBottom = true;
  private _ignoreScrollToTop: number | undefined = undefined;
  private _resizeDifference = 0;
  private _previousContentHeight = 0;
  private _lastScrollTop = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _disposed = false;
  private _handleWheel: (e: WheelEvent) => void;
  private _handleScroll: () => void;

  constructor(scrollContainer: HTMLElement, contentElement: HTMLElement) {
    this._scrollContainer = scrollContainer;
    this._contentElement = contentElement;
    this._previousContentHeight = contentElement.getBoundingClientRect().height;
    this._lastScrollTop = scrollContainer.scrollTop;

    this._resizeObserver = new ResizeObserver((entries) => {
      if (this._disposed) return;
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        const heightDelta = newHeight - this._previousContentHeight;
        this._previousContentHeight = newHeight;

        if (heightDelta > 0 && this._isAtBottom) {
          const target = this._scrollContainer.scrollHeight - this._scrollContainer.clientHeight;
          this._ignoreScrollToTop = target;
          this._scrollContainer.scrollTop = target;
          this._resizeDifference = heightDelta;
          requestAnimationFrame(() => {
            setTimeout(() => { this._resizeDifference = 0; }, 1);
          });
        }

        if (heightDelta < 0 && this._isNearBottom()) {
          this._isAtBottom = true;
        }
      }
    });
    this._resizeObserver.observe(contentElement);

    this._handleWheel = (e: WheelEvent) => {
      if (this._disposed) return;
      if (e.deltaY < 0 && this._scrollContainer.scrollTop > 0) {
        this._isAtBottom = false;
      }
    };
    scrollContainer.addEventListener('wheel', this._handleWheel, { passive: true });

    this._handleScroll = () => {
      if (this._disposed) return;
      const scrollTop = this._scrollContainer.scrollTop;

      if (this._resizeDifference !== 0) {
        this._lastScrollTop = scrollTop;
        return;
      }

      if (this._ignoreScrollToTop !== undefined && Math.abs(scrollTop - this._ignoreScrollToTop) < 2) {
        this._ignoreScrollToTop = undefined;
        this._lastScrollTop = scrollTop;
        return;
      }
      this._ignoreScrollToTop = undefined;

      if (scrollTop > this._lastScrollTop && this._isNearBottom()) {
        this._isAtBottom = true;
      }

      if (scrollTop < this._lastScrollTop - 5 && !this._isNearBottom()) {
        this._isAtBottom = false;
      }

      this._lastScrollTop = scrollTop;
    };
    scrollContainer.addEventListener('scroll', this._handleScroll, { passive: true });
  }

  get isAtBottom(): boolean { return this._isAtBottom; }

  scrollToBottom(): void {
    this._isAtBottom = true;
    const target = this._scrollContainer.scrollHeight - this._scrollContainer.clientHeight;
    this._ignoreScrollToTop = target;
    this._scrollContainer.scrollTop = target;
  }

  disengage(): void { this._isAtBottom = false; }

  dispose(): void {
    this._disposed = true;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this._scrollContainer.removeEventListener('wheel', this._handleWheel);
    this._scrollContainer.removeEventListener('scroll', this._handleScroll);
  }

  private _isNearBottom(): boolean {
    const { scrollTop, scrollHeight, clientHeight } = this._scrollContainer;
    return scrollHeight - clientHeight - Math.max(0, scrollTop) <= NEAR_BOTTOM_THRESHOLD;
  }
}
