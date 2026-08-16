/**
 * Tooltip dismissal broadcaster — the input gestures that end a hover.
 *
 * A tooltip is an answer to "what is this thing the pointer is resting on".
 * The moment the user does something — presses a button, opens a context
 * menu, scrolls the view out from under the pointer — the question is no
 * longer being asked, and the bubble is in the way of the answer to the new
 * one. A context menu and a tooltip on screen together is the worst of these:
 * two floating surfaces describing the same target, one of them stale.
 *
 * `TugTooltip` already dismisses on any action flowing through the responder
 * chain (`manager.observeDispatch`). That covers the deliberate act that
 * *reaches* the chain. It does not cover the gestures that never dispatch:
 * a right-click that only opens a native/portal menu, a press on a surface
 * that handles its own pointer events, a wheel or trackpad scroll. Those are
 * raw input, so they are observed as raw input — at the document, in the
 * capture phase, before any handler can stop them.
 *
 * ## Why one module-level emitter
 *
 * Every open tooltip wants the same four listeners. Installing them per
 * tooltip would mean four `addEventListener` calls per bubble and four more
 * per nested trigger. Instead the listeners are installed once, lazily, when
 * the first subscriber arrives, and removed when the last one leaves — so an
 * app with no tooltip showing carries no document-level input listeners at
 * all. This is appearance-zone infrastructure outside the React tree [L22];
 * components subscribe from an effect.
 *
 * ## Capture phase, and `scroll` in particular
 *
 * All four listeners are capture-phase. `pointerdown` and `contextmenu` in
 * capture means the tooltip is gone before the surface that owns the gesture
 * gets to run — a menu can never paint alongside a bubble that outlived it,
 * even if the surface calls `stopPropagation`. `scroll` does not bubble at
 * all, so capture at the document is the only way to hear a scroll inside an
 * arbitrary scroller; the same is true of any scroller the transcript or a
 * sheet mounts later. `wheel` is listened to separately from `scroll` because
 * a wheel over a non-scrollable region produces no scroll event, and the
 * user's intent to move on is identical.
 *
 * Listeners are passive: this module only observes.
 *
 * @module lib/tooltip-dismiss
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** The gestures that end a hover. All observed in the capture phase. */
const DISMISS_EVENTS = ["pointerdown", "contextmenu", "wheel", "scroll"] as const;

let installed = false;

function notify(): void {
  // Copy before iterating: a listener dismisses its own tooltip, which
  // unmounts an effect and calls `unsubscribe` — mutating the set mid-loop.
  for (const cb of [...listeners]) cb();
}

function install(): void {
  if (installed || typeof document === "undefined") return;
  for (const type of DISMISS_EVENTS) {
    document.addEventListener(type, notify, { capture: true, passive: true });
  }
  installed = true;
}

function uninstall(): void {
  if (!installed || typeof document === "undefined") return;
  for (const type of DISMISS_EVENTS) {
    document.removeEventListener(type, notify, { capture: true });
  }
  installed = false;
}

/**
 * Subscribe to tooltip-dismissing input. The callback runs synchronously in
 * the capture phase of the gesture, so a tooltip closed from it is closed
 * before the gesture reaches whatever surface handles it.
 *
 * Returns an unsubscribe function. The document listeners exist only while
 * at least one subscriber is registered.
 */
export function observeTooltipDismiss(cb: Listener): () => void {
  listeners.add(cb);
  install();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) uninstall();
  };
}

/**
 * Dismiss every open tooltip now, without an input gesture. For surfaces
 * that open a floating panel programmatically (a menu raised from a
 * keyboard command, say) and need the hover bubble gone with it.
 */
export function dismissTooltips(): void {
  notify();
}
