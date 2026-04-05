/**
 * theme-tokens.ts — Runtime API for reading theme token values and
 * observing theme changes.
 *
 * getTokenValue reads the current resolved value of a CSS custom property.
 * subscribeThemeChange / unsubscribeThemeChange let non-React code observe
 * theme changes without pulling state into React [L22].
 *
 * The theme provider calls notifyThemeChange when the theme switches.
 * In production, CSS is guaranteed to be applied at that point (stylesheet
 * load event). In dev mode (HMR), CSS may not be applied yet — the
 * notification defers until the sentinel token value actually changes.
 */

// Sentinel token — used to detect when CSS has been applied after a theme change.
// Must differ between themes. --tugx-host-canvas-color is designed for this.
const SENTINEL_TOKEN = "--tugx-host-canvas-color";

const _subscribers = new Set<() => void>();
let _cachedSentinel = "";
let _pendingObserver: MutationObserver | null = null;

/** Read the current resolved value of a CSS custom property. */
export function getTokenValue(tokenName: string): string {
  return getComputedStyle(document.body).getPropertyValue(tokenName).trim();
}

/** Subscribe to theme change notifications. */
export function subscribeThemeChange(callback: () => void): void {
  _subscribers.add(callback);
}

/** Unsubscribe from theme change notifications. */
export function unsubscribeThemeChange(callback: () => void): void {
  _subscribers.delete(callback);
}

/** Fire all theme change subscribers. */
function fireSubscribers(): void {
  for (const cb of _subscribers) {
    cb();
  }
}

/**
 * Called by the theme provider when the theme changes.
 *
 * Checks if CSS has already been applied by comparing a sentinel token
 * against the cached value. If applied, fires subscribers immediately.
 * If not yet applied (dev mode HMR race), sets up a MutationObserver
 * on document.head and fires when the sentinel actually changes.
 */
export function notifyThemeChange(): void {
  // Disconnect any pending observer from a previous call
  if (_pendingObserver) {
    _pendingObserver.disconnect();
    _pendingObserver = null;
  }

  const current = getTokenValue(SENTINEL_TOKEN);
  if (current !== _cachedSentinel && _cachedSentinel !== "") {
    // CSS already applied — fire immediately
    _cachedSentinel = current;
    fireSubscribers();
    return;
  }

  // CSS not yet applied — observe document.head for stylesheet changes
  _pendingObserver = new MutationObserver(() => {
    const now = getTokenValue(SENTINEL_TOKEN);
    if (now !== _cachedSentinel) {
      _cachedSentinel = now;
      _pendingObserver!.disconnect();
      _pendingObserver = null;
      fireSubscribers();
    }
  });
  _pendingObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/**
 * Initialize the sentinel cache. Called once at startup so the first
 * notifyThemeChange has a baseline to compare against.
 */
export function initThemeTokens(): void {
  _cachedSentinel = getTokenValue(SENTINEL_TOKEN);
}
