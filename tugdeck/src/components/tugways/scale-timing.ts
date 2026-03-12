/**
 * scale-timing.ts -- JS helpers for the global scale/timing/motion multipliers.
 *
 * Provides runtime access to the three global CSS custom properties defined on
 * :root in tug-base.css:
 *   --tug-zoom   continuous dimension multiplier (default 1)
 *   --tug-timing  continuous animation-duration multiplier (default 1)
 *   --tug-motion  binary motion toggle: 1 = on, 0 = off (default 1)
 *
 * Also provides initMotionObserver() which wires up the prefers-reduced-motion
 * media query and manages the data-tug-motion attribute on <body>. Call this
 * once during app boot (before DeckManager construction) so the attribute is
 * set from first paint.
 */

/** Read the current --tug-zoom value from :root computed style. Returns 1 if unset or unparseable. */
export function getTugZoom(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--tug-zoom").trim();
  const value = parseFloat(raw);
  return isNaN(value) ? 1 : value;
}

/** Read the current --tug-timing value from :root computed style. Returns 1 if unset or unparseable. */
export function getTugTiming(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--tug-timing").trim();
  const value = parseFloat(raw);
  return isNaN(value) ? 1 : value;
}

/** Check whether motion is enabled. Returns false when --tug-motion is 0, true otherwise. */
export function isTugMotionEnabled(): boolean {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--tug-motion").trim();
  const value = parseFloat(raw);
  return isNaN(value) ? true : value !== 0;
}

/**
 * Initialize motion attribute management.
 *
 * - Reads the prefers-reduced-motion media query on call
 * - Sets data-tug-motion="off" on <body> when motion is disabled
 * - Removes the attribute when motion is enabled
 * - Listens for media query changes and updates the attribute accordingly
 * - Returns a cleanup function that removes the listener
 *
 * Call once during app boot before DeckManager construction.
 */
export function initMotionObserver(): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

  function applyMotionAttribute(reduced: boolean): void {
    if (reduced) {
      document.body.setAttribute("data-tug-motion", "off");
    } else {
      document.body.removeAttribute("data-tug-motion");
    }
  }

  // Apply immediately based on current media query state
  applyMotionAttribute(mq.matches);

  // Listen for changes (e.g., user changes system accessibility setting)
  function handleChange(event: MediaQueryListEvent): void {
    applyMotionAttribute(event.matches);
  }

  mq.addEventListener("change", handleChange);

  // Return cleanup function to remove the listener
  return () => {
    mq.removeEventListener("change", handleChange);
  };
}
