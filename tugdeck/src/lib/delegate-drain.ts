/**
 * delegate-drain.ts — shared `MessageChannel` drain for delegate hooks.
 *
 * Both `useCardDelegate` (card-lifecycle.ts) and `useAppDelegate`
 * (app-lifecycle.ts) defer their user callbacks off the observer path
 * and onto a macrotask so the callbacks escape WebKit's gesture
 * focus-lock, skip the 4 ms setTimeout clamp and background-tab
 * throttling, and survive component unmount between the fire and the
 * drain. Previously each hook owned its own `MessageChannel`; when a
 * component subscribed both delegates on the same page, the relative
 * order of a cardDidActivate vs applicationDidBecomeActive drain was
 * non-deterministic across channels.
 *
 * A single shared channel solves that: posts land in the same queue,
 * and the drain flushes every queued call in FIFO order on the next
 * macrotask regardless of which hook enqueued it.
 *
 * Design notes:
 *   - The queue is snapshot+cleared on each drain so callbacks that
 *     enqueue further work run on the NEXT drain, preserving order
 *     within a tick and preventing runaway reentrant drains.
 *   - Errors thrown by queued callbacks are logged and swallowed so
 *     one bad delegate does not stall the rest of the drain.
 *   - Environments without `MessageChannel` (SSR, legacy tests) fall
 *     back to a no-op channel; `scheduleDelegateCall` still runs the
 *     push but no drain fires. The callers' tests all run under
 *     happy-dom which provides `MessageChannel`.
 */

type DelegateCall = () => void;

const queue: DelegateCall[] = [];

const channel: MessageChannel | null =
  typeof MessageChannel !== "undefined" ? new MessageChannel() : null;

if (channel !== null) {
  channel.port1.onmessage = (): void => {
    const pending = queue.splice(0);
    for (const fn of pending) {
      try {
        fn();
      } catch (err) {
        console.error("[delegate-drain] callback threw:", err);
      }
    }
  };
}

/**
 * Enqueue `fn` to run on the next macrotask drain. FIFO order across
 * every caller. Idempotent safeguards (dedupe, cancellation) are the
 * caller's responsibility — this module is a raw queue.
 */
export function scheduleDelegateCall(fn: DelegateCall): void {
  queue.push(fn);
  if (channel !== null) {
    channel.port2.postMessage(null);
  }
}
